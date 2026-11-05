#!/usr/bin/env python3
"""Baixa NCM, CFOP e cClassTrib de fontes GOVERNAMENTAIS e gera snapshot offline.
Somente no build da ArtiSys; jamais executado no computador do cliente.
Sem dependências de terceiros e sem credenciais. Falha fechado se versões/layouts mudarem.
"""
import argparse
import datetime as dt
import hashlib
import io
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from urllib.parse import quote

NCM_URL = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json"
CFOP_URL = "https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=74KmX8poGpM="
IBSCBS_URL = ("https://dfe-portal.svrs.rs.gov.br/DFE/DownloadArquivoEstatico/"
              "?sistema=DFE&tipoArquivo=12&nomeArquivo=" +
              quote("Tabela IT 2025.002 v.1.71 - cClassTrib.xlsx"))
NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
MIN_COUNTS = {"ncm": 8000, "cfop": 550, "ibscbs": 150}

def fetch(url, maxbytes=7000000, cookie=False):
    headers = {"User-Agent": "ArtiSys-Oficina-fiscal-snapshot/1.0",
               "Accept": "*/*"}
    if cookie:
        headers["Cookie"] = "AspxAutoDetectCookieSupport=1"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=40) as resp:
        if resp.status != 200:
            raise ValueError("Status HTTP oficial não autorizado: " + str(resp.status))
        blob = resp.read(maxbytes + 1)
        if len(blob) > maxbytes or len(blob) < 5000:
            raise ValueError("Fonte fiscal fora do limite seguro: " + url)
        if not resp.geturl().startswith(("https://www.nfe.fazenda.gov.br/",
                                          "https://dfe-portal.svrs.rs.gov.br/",
                                          "https://portalunico.siscomex.gov.br/")):
            raise ValueError("Redirecionamento fora do domínio governamental")
        return blob

def excel_rows(blob, sheet):
    if not blob.startswith(b"PK\x03\x04"):
        raise ValueError("XLSX oficial não é ZIP válido")
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        if sum(x.file_size for x in archive.infolist()) > 60000000:
            raise ValueError("XLSX oficial expandido excede 60 MB")
        if not all(x in archive.namelist() for x in
                   ("xl/workbook.xml", sheet)):
            raise ValueError("Planilha oficial sem aba esperada")
        shared = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = ["".join(x.text or "" for x in si.findall(".//x:t", NS))
                      for si in root.findall("x:si", NS)]
        root = ET.fromstring(archive.read(sheet))
        result = []
        for row in root.findall(".//x:sheetData/x:row", NS):
            cells = {}
            for cell in row.findall("x:c", NS):
                reference = cell.attrib.get("r", "")
                match = re.match(r"^([A-Z]{1,2})\d+$", reference)
                if not match:
                    continue
                value = cell.find("x:v", NS)
                text = value.text if value is not None and value.text else ""
                if cell.attrib.get("t") == "s":
                    text = shared[int(text)] if text.isdigit() and int(text) < len(shared) else ""
                if cell.attrib.get("t") == "inlineStr":
                    text = "".join(el.text or "" for el in cell.findall(".//x:t", NS))
                cells[match.group(1)] = str(text).strip()
            result.append(cells)
        return result

def code(value, length):
    value = str(value).strip()
    if not re.fullmatch(r"\d{1,%d}" % length, value):
        return ""
    return value.zfill(length)

def full_ncm(blob, today):
    try:
        source = json.loads(blob)
    except Exception as e:
        raise ValueError("JSON oficial NCM ilegível") from e
    if not re.search(r"Vigente em \d{2}/\d{2}/\d{4}",
                     str(source.get("Data_Ultima_Atualizacao_NCM", ""))):
        raise ValueError("NCM oficial sem data explícita de vigência")
    raw = source.get("Nomenclaturas")
    if not isinstance(raw, list):
        raise ValueError("NCM sem lista de Nomenclaturas")
    codes = sorted({str(row.get("Codigo", "")).strip()
                    for row in raw if isinstance(row, dict) and
                    re.fullmatch(r"\d{8}", str(row.get("Codigo", "")).strip())})
    if len(codes) < MIN_COUNTS["ncm"]:
        from collections import Counter
        print("NCM_DIAG", "TOTAL",len(raw),"SAMPLES",[r.get("Codigo") for r in raw[:18]],
              "LENGTHS",Counter(len(str(r.get("Codigo",""))) for r in raw).most_common(15),
              "KEYS",list(raw[0]) if raw else [])
        raise ValueError("NCM oficial incompleta: " + str(len(codes)))
    return codes, str(source.get("Ato", "NCM Siscomex vigente")), str(
        source.get("Data_Ultima_Atualizacao_NCM"))

def full_cfop(blob, today):
    rows = excel_rows(blob, "xl/worksheets/sheet1.xml")
    if "CFOP" not in rows[0].get("A", "").upper():
        raise ValueError("Cabeçalho CFOP oficial inesperado")
    codes = set()
    for row in rows[1:]:
        item = code(row.get("A", ""), 4)
        if not re.fullmatch(r"[123567]\d{3}", item):
            continue
        # Datas do XLSX são números seriais do Excel (epoch 1899-12-30).
        begin = row.get("B", "").strip()
        end = row.get("C", "").strip()
        epoch = dt.date(1899, 12, 30)
        if begin and begin.isdecimal() and epoch + dt.timedelta(days=int(begin)) > today:
            continue
        if end and end.isdecimal() and epoch + dt.timedelta(days=int(end)) < today:
            continue
        codes.add(item)
    if len(codes) < MIN_COUNTS["cfop"]:
        raise ValueError("CFOP oficial incompleta ou fora da vigência: " + str(len(codes)))
    if not {"5102", "6102"}.issubset(codes):
        raise ValueError("CFOP saída essencial ausente no catálogo oficial")
    return sorted(codes)

def full_ibscbs(blob, today):
    rows = excel_rows(blob, "xl/worksheets/sheet1.xml")
    rules = excel_rows(blob, "xl/worksheets/sheet2.xml")
    if rows[0].get("A") != "CST-IBS/CBS" or rows[0].get("C") != "cClassTrib":
        raise ValueError("Cabeçalho oficial cClassTrib inesperado")
    if rules[0].get("A") != "CST-IBS/CBS" or rules[0].get("E") != "ind_gRed":
        raise ValueError("Indicadores de CST oficiais em layout inesperado")
    indicators = {code(r.get("A", ""), 3): r for r in rules[1:] if
                  code(r.get("A", ""), 3)}
    entries = []
    for row in rows[1:]:
        tax = code(row.get("A", ""), 3)
        cls = code(row.get("C", ""), 6)
        if not tax or not cls:
            continue
        if not cls.startswith(tax):
            raise ValueError("Código cClassTrib diverge do CST: " + cls)
        flags = indicators.get(tax)
        if not flags:
            raise ValueError("CST sem indicadores oficiais: " + tax)
        # Colunas O-S indicam monofasia/crédito e demandam regras especiais.
        special = any(row.get(col, "") == "1" for col in ("N", "O", "P", "Q", "R", "S"))
        reduced = flags.get("E") == "1"
        deferred = flags.get("F") == "1"
        if special or (reduced and deferred) or flags.get("D") == "1":
            regime = "ESPECIAL"
        elif reduced:
            regime = "REDUCAO"
        elif deferred:
            regime = "DIFERIMENTO"
        elif tax == "000" and cls == "000001":
            regime = "REGULAR"
        else:
            # Não presumir tributação regular para casos com regras próprias.
            regime = "ESPECIAL"
        entries.append({"cst": tax, "cClassTrib": cls, "regime": regime,
                        "reduction": reduced, "deferral": deferred,
                        "officialReductionIbs": row.get("K", "0") or "0",
                        "officialReductionCbs": row.get("L", "0") or "0",
                        "name": row.get("D", "")[:160]})
    if len(entries) < MIN_COUNTS["ibscbs"]:
        raise ValueError("Planilha IBS/CBS incompleta: " + str(len(entries)))
    classes = [x["cClassTrib"] for x in entries]
    if len(set(classes)) != len(classes):
        raise ValueError("cClassTrib duplicado na fonte governamental")
    if not any(r["cClassTrib"] == "000001" for r in entries):
        raise ValueError("Classificação 000001 ausente na fonte governamental")
    return sorted(entries, key=lambda x: x["cClassTrib"])

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="src/platform/fiscal-data/catalog.json")
    parser.add_argument("--checked-at", default=dt.date.today().isoformat())
    args = parser.parse_args()
    today = dt.date.fromisoformat(args.checked_at)
    ncm_raw = fetch(NCM_URL)
    cfop_raw = fetch(CFOP_URL, cookie=True)
    ibs_raw = fetch(IBSCBS_URL)
    ncm, ncm_act, ncm_date = full_ncm(ncm_raw, today)
    cfop = full_cfop(cfop_raw, today)
    ibs = full_ibscbs(ibs_raw, today)
    sources = {
        "ncm": {"url": NCM_URL, "version": ncm_act + " — " + ncm_date,
                "publishedAt": args.checked_at,
                "sha256": hashlib.sha256(ncm_raw).hexdigest()},
        "cfop": {"url": CFOP_URL, "version": "IT 2023.002 v2.10",
                 "publishedAt": "2026-09-04",
                 "sha256": hashlib.sha256(cfop_raw).hexdigest()},
        "ibscbs": {"url": IBSCBS_URL, "version": "IT 2025.002 v1.71",
                   "publishedAt": "2026-10-30",
                   "sha256": hashlib.sha256(ibs_raw).hexdigest()}
    }
    payload = {"schemaVersion": 1, "checkedAt": args.checked_at,
               "sources": sources, "tables": {"ncm": ncm, "cfop": cfop, "ibscbs": ibs}}
    compact = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(compact.encode("utf-8")).hexdigest()
    output = dict(payload, digest=digest)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("OFFICIAL_FISCAL_CATALOG", "NCM", len(ncm), "CFOP", len(cfop),
          "IBSCBS", len(ibs), "SHA256", digest, "PATH", target)

if __name__ == "__main__":
    main()
