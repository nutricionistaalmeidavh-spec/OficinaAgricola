#!/usr/bin/env python3
"""Executor ACBrLib via ctypes (Python stdlib). Sem rede própria / SaaS / mock em produção.

Cada execução abre a biblioteca, carrega o INI tributário já revisado, invoca
as funções oficiais do ACBr e fecha a biblioteca. O certificado permanece
no INI da ACBrLib, fora do banco de dados e do payload do Node.
NENHUM retorno é marcado AUTORIZADA sem resposta e XML de autorização.
"""
import configparser
import ctypes as ct
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


class ACBrError(RuntimeError):
    pass


def functions(lib, name, arguments):
    fn = getattr(lib, name)
    fn.argtypes = arguments
    fn.restype = ct.c_int
    return fn


def do(lib, name, *args, types=()):
    ret = functions(lib, name, list(types))(*args)
    if ret != 0:
        raise ACBrError("%s retornou código %s; situação fiscal precisa ser consultada" % (name, ret))


def response(lib, name, args=(), types=()):
    # Não repetir operações de rede para redimensionar buffer: isso poderia emitir duas vezes.
    limit = 4 * 1024 * 1024
    buf = ct.create_string_buffer(limit)
    size = ct.c_int(limit)
    ret = functions(lib, name, list(types) + [ct.c_void_p, ct.POINTER(ct.c_int)])(
        *args, buf, ct.byref(size)
    )
    if ret != 0:
        raise ACBrError("%s falhou (%s); consultar a situação fiscal" % (name, ret))
    if size.value < 0 or size.value >= limit:
        raise ACBrError("Resposta ACBr excede limite; consultar situação fiscal")
    return buf.value.decode("utf-8", errors="replace")


def encoded(s):
    return str(s).encode("utf-8")


def parse_sections(payload):
    sections = {}
    active = None
    for line in payload.splitlines():
        match = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if match:
            active = match.group(1).strip().upper()
            sections[active] = {}
        elif active and "=" in line:
            key, value = line.split("=", 1)
            sections[active][key.strip().upper()] = value.strip()
    return sections


def local_tag(el):
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def find_text(root, tag):
    if root is None:
        return ""
    for el in root.iter():
        if local_tag(el).lower() == tag.lower():
            return (el.text or "").strip()
    return ""


def root_or_none(content):
    if not content or len(content) > 4 * 1024 * 1024:
        return None
    try:
        return ET.fromstring(content)
    except ET.ParseError:
        return None


def nfe_identity(xml):
    root = root_or_none(xml)
    if root is None:
        raise ACBrError("ACBr não devolveu um XML de NF-e válido")
    key = ""
    for el in root.iter():
        if local_tag(el) == "infNFe":
            key = el.attrib.get("Id", "").removeprefix("NFe")
            break
    if not re.fullmatch(r"\d{44}", key):
        raise ACBrError("XML NFe sem chave de 44 dígitos; consultar situação")
    return key, find_text(root, "nNF"), find_text(root, "serie"), find_text(root, "tpAmb"), find_text(root, "CNPJ")


def amount_cents(text):
    try:
        value = Decimal(str(text).strip().replace(",", "."))
        if not value.is_finite() or value < 0 or value * 100 != (value * 100).to_integral_value():
            raise InvalidOperation
        return int(value * 100)
    except (InvalidOperation, ValueError):
        raise ACBrError("Valor tributário monetário inválido")


def nfe_total_cents(xml):
    root = root_or_none(xml)
    if root is None:
        raise ACBrError("XML NFe indisponível para validar total")
    totals = [el for el in root.iter() if local_tag(el) == "ICMSTot"]
    if len(totals) != 1:
        raise ACBrError("Total NFe inconsistente")
    value = find_text(totals[0], "vNF")
    if not value:
        raise ACBrError("XML NFe sem valor final")
    return amount_cents(value)


def authorized_nfe_xml(xml, protocol):
    root = root_or_none(xml)
    if root is None:
        return False
    signatures = [el for el in root.iter() if local_tag(el) == "Signature"]
    infos = [el for el in root.iter() if local_tag(el) == "infProt"]
    return bool(signatures and infos and
                any(find_text(el, "cStat") == "100" and find_text(el, "nProt") == protocol
                    for el in infos))


def candidate_xml(sections):
    for section, fields in sections.items():
        if section.startswith("NFE_ARQ") or section.startswith("ARQUIVO"):
            file = fields.get("ARQUIVO") or fields.get("CAMINHOCOMPLETO")
            if file:
                try:
                    p = Path(file).resolve(strict=True)
                    if p.is_file() and p.stat().st_size < 4 * 1024 * 1024:
                        return p.read_text(encoding="utf-8-sig")
                except (OSError, UnicodeError):
                    pass
    return ""


def stash_signed_xml(ini_path, xml):
    key, _, _, _, _ = nfe_identity(xml)
    dest = Path(ini_path).with_suffix(".signed.xml")
    if dest.exists():
        previous = dest.read_text(encoding="utf-8-sig")
        if previous != xml:
            raise ACBrError("XML assinado mudou após a primeira tentativa: reconciliação manual necessária")
        return key
    # Arquivo local de recuperação: somente o usuário atual pode acessar.
    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(xml)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return key


def nfe_transmit(lib, req):
    do(lib, "NFE_LimparLista")
    do(lib, "NFE_CarregarINI", encoded(req["iniPath"]), types=[ct.c_char_p])
    do(lib, "NFE_Assinar")
    do(lib, "NFE_Validar")
    signed = response(lib, "NFE_ObterXml", (0,), [ct.c_int])
    key = stash_signed_xml(req["iniPath"], signed)
    _, number, series, ambiente, cnpj = nfe_identity(signed)
    if nfe_total_cents(signed) != int(req["amountCents"]):
        raise ACBrError("Valor total da NF-e difere do registro comercial canônico")
    expect_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if ambiente != expect_amb or re.sub(r"\D", "", cnpj) != req["issuerCnpj"]:
        raise ACBrError("XML fiscal diverge do ambiente/CNPJ do snapshot")
    send = response(lib, "NFE_Enviar",
                    (int(req["lot"]), False, True, False),
                    [ct.c_int, ct.c_bool, ct.c_bool, ct.c_bool])
    parts = parse_sections(send)
    official = next((v for k, v in parts.items()
                     if re.fullmatch(r"NFE\d+", k) and v.get("CSTAT") == "100"), None)
    if not official:
        return {"status": "INDETERMINADO", "message": "Envio ACBr não comprovou autorização por NF-e"}
    protocol = official.get("NPROT", "")
    if official.get("CHDFE") != key or official.get("TPAMB") != expect_amb or not protocol:
        return {"status": "INDETERMINADO", "message": "Protocolo sem correspondência com chave ou ambiente"}
    # ObterXml após envio pode retornar nfeProc; se não vier, ler o XML de retorno ACBr.
    received = response(lib, "NFE_ObterXml", (0,), [ct.c_int])
    if not authorized_nfe_xml(received, protocol):
        received = candidate_xml(parts)
    if not authorized_nfe_xml(received, protocol):
        return {"status": "INDETERMINADO", "message": "Protocolo recebido, mas XML processado ainda não disponível"}
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": protocol, "number": number, "series": series,
            "xml": received}


def nfe_consult(lib, req):
    path = Path(req["iniPath"]).with_suffix(".signed.xml")
    if not path.is_file():
        return {"status": "INDETERMINADO", "message": "XML assinado para consulta não localizado"}
    signed = path.read_text(encoding="utf-8-sig")
    key, number, series, environment, cnpj = nfe_identity(signed)
    expect_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if environment != expect_amb or re.sub(r"\D", "", cnpj) != req["issuerCnpj"]:
        raise ACBrError("XML de consulta com CNPJ ou ambiente divergente")
    result = response(lib, "NFE_Consultar", (encoded(key), False),
                      [ct.c_char_p, ct.c_bool])
    fields = parse_sections(result).get("CONSULTA", {})
    if fields.get("CSTAT") != "100" or fields.get("TPAMB") != expect_amb or not fields.get("NPROT"):
        return {"status": "INDETERMINADO", "message": "Consulta não retornou autorização confirmada"}
    xml = candidate_xml(parse_sections(result))
    if not authorized_nfe_xml(xml, fields["NPROT"]):
        return {"status": "INDETERMINADO", "message": "Consulta confirmou protocolo, mas falta XML processado"}
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": fields["NPROT"], "number": number,
            "series": series, "xml": xml}


def nfse_details(xml):
    root = root_or_none(xml)
    if root is None or not any(local_tag(e).lower() in ("compnfse", "nfse") for e in root.iter()):
        return None
    number = find_text(root, "Numero")
    code = find_text(root, "CodigoVerificacao")
    access_key = find_text(root, "chNFSe") or find_text(root, "ChaveNFSe")
    if not number or not code or not access_key:
        return None
    return number, code, access_key


def rps_from_ini(file):
    text = Path(file).read_text(encoding="utf-8-sig")
    sections = parse_sections(text)
    rps = sections.get("IDENTIFICACAORPS", {})
    number = rps.get("NUMERO", "")
    series = rps.get("SERIE", "")
    if not number or not series:
        raise ACBrError("INI da NFSe sem número e série RPS para reconciliação")
    return number, series, rps.get("TIPO", "1")


def nfse_transmit(lib, req):
    do(lib, "NFSE_LimparLista")
    do(lib, "NFSE_CarregarINI", encoded(req["iniPath"]), types=[ct.c_char_p])
    result = response(lib, "NFSE_Emitir",
                      (encoded(str(req["lot"])), 0, False),
                      [ct.c_char_p, ct.c_int, ct.c_bool])
    fields = parse_sections(result).get("ENVIO", {})
    if fields.get("SUCESSO") != "1" or not fields.get("NUMERONOTA"):
        return {"status": "INDETERMINADO", "message": "RPS recebido sem NFSe autorizada"}
    xml = response(lib, "NFSE_ObterXml", (0,), [ct.c_int])
    details = nfse_details(xml)
    if not details or details[0] != fields["NUMERONOTA"]:
        return {"status": "INDETERMINADO", "message": "XML NFSe oficial não disponível"}
    number, code, key = details
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": code, "number": number,
            "series": rps_from_ini(req["iniPath"])[1], "xml": xml}


def nfse_consult(lib, req):
    number, series, kind = rps_from_ini(req["iniPath"])
    response_text = response(lib, "NFSE_ConsultarNFSePorRps",
                             (encoded(number), encoded(series), encoded(kind), encoded("")),
                             [ct.c_char_p] * 4)
    parts = parse_sections(response_text)
    xml = candidate_xml(parts)
    details = nfse_details(xml)
    if not details:
        return {"status": "INDETERMINADO", "message": "Consulta RPS sem XML NFSe autoritativo"}
    issued, code, key = details
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": code, "number": issued, "series": series, "xml": xml}


def native_library(library_path):
    # Python 3.8+ no Windows exige caminhos explicitamente autorizados para
    # resolver dependências transitivas de DLLs. Nada é copiado para System32.
    parent = Path(library_path).resolve().parent
    if os.name == "nt":
        for directory in (parent, parent / "deps"):
            if directory.is_dir():
                os.add_dll_directory(str(directory))
    return ct.CDLL(str(library_path))


def probe_library(path):
    lib = native_library(path)
    prefix = "NFSE" if "nfse" in Path(path).name.lower() else "NFE"
    required = (prefix + "_Inicializar", prefix + "_Finalizar",
                prefix + "_CarregarINI", prefix + "_LimparLista")
    for name in required:
        if not hasattr(lib, name):
            raise ACBrError("DLL nativa sem exportação obrigatória: " + name)
    return {"ok": True, "library": prefix, "exports": list(required)}


def execute(req):
    if req.get("operation") not in ("transmit", "consult") or req.get("kind") not in ("NFE", "NFSE"):
        raise ACBrError("Operação fiscal inválida")
    if req.get("environment") not in ("HOMOLOGACAO", "PRODUCAO"):
        raise ACBrError("Ambiente fiscal não identificado")
    if not re.fullmatch(r"\d{14}", str(req.get("issuerCnpj", ""))):
        raise ACBrError("CNPJ de emitente ausente")
    for field in ("libraryPath", "configPath", "iniPath"):
        if not Path(req.get(field, "")).is_file():
            raise ACBrError("Arquivo local obrigatório não encontrado: " + field)
    lib = native_library(req["libraryPath"])
    prefix = req["kind"]
    initialized = False
    try:
        do(lib, prefix + "_Inicializar", encoded(req["configPath"]), encoded(""),
           types=[ct.c_char_p, ct.c_char_p])
        initialized = True
        if req["kind"] == "NFE":
            return nfe_transmit(lib, req) if req["operation"] == "transmit" else nfe_consult(lib, req)
        return nfse_transmit(lib, req) if req["operation"] == "transmit" else nfse_consult(lib, req)
    finally:
        if initialized:
            try:
                do(lib, prefix + "_Finalizar")
            except Exception:
                pass


def main():
    # Diagnóstico offline para smoke do instalador: não lê certificado nem transmite.
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        print(json.dumps({"ok": True, "frozen": bool(getattr(sys, "frozen", False))}))
        return
    if len(sys.argv) == 3 and sys.argv[1] == "--probe":
        try:
            print(json.dumps(probe_library(sys.argv[2])))
        except Exception:
            print(json.dumps({"ok": False, "error": "Biblioteca ACBr ausente ou incompatível"}))
            sys.exit(2)
        return
    # Nunca incluir dados de notas, INIs ou segredos em tracebacks ou stderr.
    try:
        raw = sys.stdin.buffer.read(65536 + 1)
        if len(raw) > 65536:
            raise ACBrError("Comando fiscal excede limite")
        request = json.loads(raw)
        result = execute(request)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Sem confirmar situação fiscal, a aplicação manterá INDETERMINADO.
        print(json.dumps({"status": "INDETERMINADO", "message": "ACBr não confirmou operação; consulte situação fiscal"}))


if __name__ == "__main__":
    main()
