#!/usr/bin/env python3
"""Executor ACBrLib via ctypes (Python stdlib). Sem rede própria / SaaS / mock em produção.

Cada execução abre a biblioteca, carrega o INI tributário já revisado, invoca
as funções oficiais do ACBr e fecha a biblioteca. O certificado permanece
no INI da ACBrLib, fora do banco de dados e do payload do Node.
NENHUM retorno é marcado AUTORIZADA sem resposta e XML de autorização.
"""
import base64
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


def response(lib, name, args=(), types=(), limit=4 * 1024 * 1024):
    # Não repetir operações de rede para redimensionar buffer: isso poderia emitir duas vezes.
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


UF_CODES = {"SP": "35", "PR": "41", "MG": "31", "RJ": "33", "SC": "42", "RS": "43"}


def assert_nfe_model(xml, req):
    key, _, _, _, cnpj = nfe_identity(xml)
    model = "65" if req.get("kind") == "NFCE" else "55"
    if key[20:22] != model:
        raise ACBrError("Modelo da chave fiscal diverge do tipo de documento")
    if key[6:20] != str(req["issuerCnpj"]) or re.sub(r"\\D", "", cnpj) != str(req["issuerCnpj"]):
        raise ACBrError("CNPJ da chave/XML não corresponde ao emitente")
    uf = req.get("issuerUf")
    if uf and (uf not in UF_CODES or key[:2] != UF_CODES[uf]):
        raise ACBrError("UF da chave fiscal diverge do emitente")
    if req.get("kind") == "NFCE" and not uf:
        raise ACBrError("NFC-e exige UF da empresa configurada")
    return key


def nfe_transmit(lib, req):
    do(lib, "NFE_LimparLista")
    do(lib, "NFE_CarregarINI", encoded(req["iniPath"]), types=[ct.c_char_p])
    do(lib, "NFE_Assinar")
    do(lib, "NFE_Validar")
    signed = response(lib, "NFE_ObterXml", (0,), [ct.c_int])
    assert_nfe_model(signed, req)
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
    assert_nfe_model(received, req)
    return {"status": "AUTORIZADA", "environment": req["environment"],
            "accessKey": key, "protocol": protocol, "number": number, "series": series,
            "xml": received}


def nfe_consult(lib, req):
    path = Path(req["iniPath"]).with_suffix(".signed.xml")
    if not path.is_file():
        return {"status": "INDETERMINADO", "message": "XML assinado para consulta não localizado"}
    signed = path.read_text(encoding="utf-8-sig")
    key, number, series, environment, cnpj = nfe_identity(signed)
    assert_nfe_model(signed, req)
    expect_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    if environment != expect_amb or re.sub(r"\D", "", cnpj) != req["issuerCnpj"]:
        raise ACBrError("XML de consulta com CNPJ ou ambiente divergente")
    # ACBrLib recebe caminho do XML ou conteúdo XML, nunca somente a chave.
    # Extração de eventos habilitada para conciliação após timeout.
    result = response(lib, "NFE_Consultar", (encoded(str(path)), True),
                      [ct.c_char_p, ct.c_bool])
    fields = parse_sections(result).get("CONSULTA", {})
    if fields.get("CSTAT") != "100" or fields.get("TPAMB") != expect_amb or not fields.get("NPROT"):
        return {"status": "INDETERMINADO", "message": "Consulta não retornou autorização confirmada"}
    xml = candidate_xml(parse_sections(result))
    if not authorized_nfe_xml(xml, fields["NPROT"]):
        return {"status": "INDETERMINADO", "message": "Consulta confirmou protocolo, mas falta XML processado"}
    assert_nfe_model(xml, req)
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



def verified_event_xml(xml, key, protocol):
    root = root_or_none(xml)
    if root is None:
        return False
    for el in root.iter():
        if local_tag(el) in ("retEvento", "infEvento") and (
            find_text(el, "cStat") == "101" and
            find_text(el, "chNFe") == key and
            find_text(el, "nProt") == protocol
        ):
            return True
    return False


def nfe_cancel(lib, req):
    key = str(req.get("accessKey") or "")
    reason = str(req.get("reason") or "").strip()
    if not re.fullmatch(r"\\d{44}", key) or not 15 <= len(reason) <= 255 or "\\n" in reason:
        raise ACBrError("Chave ou justificativa de cancelamento da NF-e inválidas")
    authorized = req.get("authorizedXml", "")
    if not authorized_nfe_xml(authorized, str(req.get("originalProtocol") or "")):
        raise ACBrError("Cancelamento requer XML da NF-e com protocolo original")
    if assert_nfe_model(authorized, req) != key:
        raise ACBrError("Chave de cancelamento diverge do XML autorizado")
    result = response(lib, "NFE_Cancelar",
                      (encoded(key), encoded(reason), encoded(req["issuerCnpj"]), int(req["lot"])),
                      [ct.c_char_p, ct.c_char_p, ct.c_char_p, ct.c_int])
    fields = parse_sections(result).get("CANCELAMENTO", {})
    expected_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    protocol = fields.get("NPROT", "")
    xml = fields.get("XML", "")
    # A resposta oficial ACBr pode fornecer XML vazio, ainda que a SEFAZ
    # tenha devolvido cStat=101, protocolo, chave, ambiente e recibo datado.
    # O recibo estruturado é persistido como prova do cancelamento.
    received_at = fields.get("DHRECBTO", "")
    if (fields.get("CSTAT") != "101" or fields.get("TPAMB") != expected_amb or
            (fields.get("CHDFE") or fields.get("CHNFE")) != key or
            not protocol or len(received_at) < 10 or
            (xml and not verified_event_xml(xml, key, protocol))):
        return {"status": "INDETERMINADO", "message": "Evento de cancelamento sem comprovante oficial íntegro"}
    return {"status": "CANCELADA", "environment": req["environment"],
            "accessKey": key, "protocol": protocol, "xml": xml,
            "officialReceipt": {"cStat": 101, "accessKey": key,
                                "protocol": protocol, "receivedAt": received_at,
                                "environment": req["environment"]}}


def nfe_consult_cancellation(lib, req):
    key = str(req.get("accessKey") or "")
    if not re.fullmatch(r"\\d{44}", key):
        raise ACBrError("Chave da NF-e inválida para consulta de cancelamento")
    signed_path = Path(req["iniPath"]).with_suffix(".signed.xml")
    if not signed_path.is_file():
        return {"status": "INDETERMINADO", "message": "XML assinado de recuperação não disponível"}
    if assert_nfe_model(signed_path.read_text(encoding="utf-8-sig"), req) != key:
        raise ACBrError("XML assinado diverge da chave consultada")
    result = response(lib, "NFE_Consultar", (encoded(str(signed_path)), True),
                      [ct.c_char_p, ct.c_bool])
    sections = parse_sections(result)
    fields = sections.get("CONSULTA", {})
    expected_amb = "2" if req["environment"] == "HOMOLOGACAO" else "1"
    xml = fields.get("XML", "") or candidate_xml(sections)
    protocol = fields.get("NPROT", "")
    received_at = fields.get("DHRECBTO", "")
    if (fields.get("CSTAT") != "101" or fields.get("TPAMB") != expected_amb or
            (fields.get("CHNFE") or fields.get("CHDFE")) != key or
            not protocol or len(received_at) < 10 or
            (xml and not verified_event_xml(xml, key, protocol))):
        return {"status": "INDETERMINADO", "message": "Cancelamento ainda sem retorno oficial verificável"}
    return {"status": "CANCELADA", "environment": req["environment"],
            "accessKey": key, "protocol": protocol, "xml": xml,
            "officialReceipt": {"cStat": 101, "accessKey": key,
                                "protocol": protocol, "receivedAt": received_at,
                                "environment": req["environment"]}}


def document_pdf(lib, req):
    xml = str(req.get("authorizedXml") or "")
    root = root_or_none(xml)
    if root is None or not req.get("accessKey"):
        raise ACBrError("PDF fiscal exige XML autorizado")
    if req["kind"] in ("NFE", "NFCE"):
        if not authorized_nfe_xml(xml, str(req.get("originalProtocol") or "")):
            raise ACBrError("DANFE sem protocolo de autorização válido")
        if assert_nfe_model(xml, req) != req["accessKey"]:
            raise ACBrError("DANFE diverge da chave autorizada")
    else:
        details = nfse_details(xml)
        if not details or details[2] != req["accessKey"]:
            raise ACBrError("DANFSe diverge da nota autorizada")
    prefix = "NFE" if req["kind"] == "NFCE" else req["kind"]
    do(lib, prefix + "_LimparLista")
    do(lib, prefix + "_CarregarXML", encoded(xml), types=[ct.c_char_p])
    raw = response(lib, prefix + "_SalvarPDF", limit=9 * 1024 * 1024).strip()
    try:
        binary = base64.b64decode(raw, validate=True)
    except (ValueError, base64.binascii.Error):
        raise ACBrError("ACBrLib devolveu PDF com codificação inválida")
    if len(binary) < 8 or len(binary) > 6 * 1024 * 1024 or not binary.startswith(b"%PDF-"):
        raise ACBrError("ACBrLib devolveu arquivo que não é PDF")
    return {"status": "PDF", "pdfBase64": raw}


def nfse_cancel(lib, req):
    # Layout e confirmação de cancelamento de NFS-e dependem do município.
    # Nunca supor deferimento baseado apenas no protocolo de solicitação.
    cancellation_ini = Path(req["iniPath"]).with_suffix(".cancel.ini")
    if not cancellation_ini.is_file() or cancellation_ini.stat().st_size > 65536:
        raise ACBrError("Cancelamento NFS-e requer INI municipal revisado")
    fields = parse_sections(cancellation_ini.read_text(encoding="utf-8-sig"))
    metadata = fields.get("INFCANCELAMENTO", {})
    if metadata.get("CHAVENFSE") != str(req.get("accessKey") or ""):
        raise ACBrError("Chave de cancelamento NFS-e difere do documento")
    result = response(lib, "NFSE_Cancelar", (encoded(str(cancellation_ini)),), [ct.c_char_p])
    sections = parse_sections(result)
    receipt = sections.get("RETCANCELAMENTO", {})
    xml = sections.get("CANCELARNFSE", {}).get("XMLRETORNO", "")
    if receipt.get("SUCESSO") != "1" or not root_or_none(xml):
        return {"status": "INDETERMINADO", "message": "Município não confirmou cancelamento NFS-e verificável"}
    # Um simples Sucesso=1 pode indicar somente recebimento, conforme provedor.
    # Validar cancelamento final no XML municipal específico antes de liberar.
    return {"status": "INDETERMINADO", "message": "NFS-e exige confirmação específica do provedor municipal"}


_dll_directories = []


def native_library(library_path):
    # Python 3.8+ no Windows exige caminhos explicitamente autorizados para
    # resolver dependências transitivas de DLLs. Nada é copiado para System32.
    parent = Path(library_path).resolve().parent
    if os.name == "nt":
        for directory in (parent, parent / "deps"):
            if directory.is_dir():
                _dll_directories.append(os.add_dll_directory(str(directory)))
    return ct.CDLL(str(Path(library_path).resolve(strict=True)))


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
    if req.get("operation") not in ("transmit", "consult", "cancel", "consultCancellation", "pdf", "status", "certificate") or req.get("kind") not in ("NFE", "NFCE", "NFSE"):
        raise ACBrError("Operação fiscal inválida")
    if req.get("environment") not in ("HOMOLOGACAO", "PRODUCAO"):
        raise ACBrError("Ambiente fiscal não identificado")
    if not re.fullmatch(r"\d{14}", str(req.get("issuerCnpj", ""))):
        raise ACBrError("CNPJ de emitente ausente")
    required = ("libraryPath", "configPath") if req["operation"] in ("status", "certificate") else ("libraryPath", "configPath", "iniPath")
    for field in required:
        if not Path(req.get(field, "")).is_file():
            raise ACBrError("Arquivo local obrigatório não encontrado: " + field)
    lib = native_library(req["libraryPath"])
    prefix = "NFE" if req["kind"] == "NFCE" else req["kind"]
    initialized = False
    try:
        do(lib, prefix + "_Inicializar", encoded(req["configPath"]), encoded(""),
           types=[ct.c_char_p, ct.c_char_p])
        initialized = True
        if req["kind"] in ("NFE", "NFCE"):
            issuer_uf = str(req.get("issuerUf") or "")
            if issuer_uf not in UF_CODES:
                raise ACBrError("UF fiscal não configurada para as seis UFs iniciais")
            # Esses valores são aplicados apenas à instância isolada do processo.
            # NÃO persistir o arquivo INI nem alterar certificado/CSC existente.
            do(lib, "NFE_ConfigGravarValor", encoded("DFe"), encoded("UF"), encoded(issuer_uf),
               types=[ct.c_char_p] * 3)
            do(lib, "NFE_ConfigGravarValor", encoded("NFe"), encoded("Ambiente"),
               encoded("1" if req["environment"] == "HOMOLOGACAO" else "0"),
               types=[ct.c_char_p] * 3)
            if req["kind"] == "NFCE":
                config = configparser.ConfigParser(interpolation=None)
                config.read(req["configPath"], encoding="utf-8-sig")
                if (not config.has_option("NFe", "CSC") or
                        not config.get("NFe", "CSC").strip() or
                        not config.has_option("NFe", "IdCSC") or
                        not config.get("NFe", "IdCSC").strip()):
                    raise ACBrError("NFC-e exige CSC/IdCSC no arquivo ACBr privado do emitente")
                do(lib, "NFE_ConfigGravarValor", encoded("NFe"), encoded("FormaEmissao"),
                   encoded("0"), types=[ct.c_char_p] * 3)
        if req["operation"] == "certificate":
            if req["kind"] != "NFE":
                raise ACBrError("Certificado NFS-e depende de provedor municipal")
            detail = response(lib, "NFE_ObterCertificados", limit=128 * 1024)
            # A ACBr retorna um ou mais registros Serial|Razao|CNPJ|Vencimento|CA.
            # Não retornar lista de terceiros ou nomes ao backend.
            issuer = req["issuerCnpj"]
            matched = re.search(r"\|"+re.escape(issuer)+r"\|", detail) is not None
            return {"status": "CERTIFICATE_MATCH" if matched else "CERTIFICATE_MISMATCH"}
        if req["operation"] == "status":
            if req["kind"] != "NFE":
                raise ACBrError("Diagnóstico de NFS-e requer provedor municipal")
            status_data = parse_sections(response(lib, "NFE_StatusServico", limit=128 * 1024))
            status = status_data.get("STATUS", {})
            expected = "2" if req["environment"] == "HOMOLOGACAO" else "1"
            if status.get("TPAMB") != expected:
                return {"status": "INDETERMINADO", "message": "Ambiente da SEFAZ divergente"}
            code = str(status.get("CSTAT", ""))
            return {"status": "ONLINE" if code == "107" else "INDISPONIVEL", "code": code}
        if req["operation"] == "pdf":
            return document_pdf(lib, req)
        if req["kind"] in ("NFE", "NFCE"):
            if req["operation"] == "transmit":
                return nfe_transmit(lib, req)
            if req["operation"] == "consult":
                return nfe_consult(lib, req)
            if req["operation"] == "cancel":
                return nfe_cancel(lib, req)
            return nfe_consult_cancellation(lib, req)
        if req["operation"] == "transmit":
            return nfse_transmit(lib, req)
        if req["operation"] == "consult":
            return nfse_consult(lib, req)
        if req["operation"] == "cancel":
            return nfse_cancel(lib, req)
        return {"status": "INDETERMINADO", "message": "Consulta de cancelamento municipal exige integração específica"}
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
        raw = sys.stdin.buffer.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ACBrError("Comando fiscal excede limite")
        request = json.loads(raw)
        result = execute(request)
        print(json.dumps(result, ensure_ascii=False))
    except Exception:
        # Sem confirmar situação fiscal, a aplicação manterá INDETERMINADO.
        print(json.dumps({"status": "INDETERMINADO", "message": "ACBr não confirmou operação; consulte situação fiscal"}))


if __name__ == "__main__":
    main()
