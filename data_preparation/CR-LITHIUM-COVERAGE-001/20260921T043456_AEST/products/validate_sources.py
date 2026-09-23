#!/usr/bin/env python3
"""Validate every new PRODUCTS PDF by signature and bounded pypdf parse."""
from __future__ import annotations
import json
from pathlib import Path
from pypdf import PdfReader
ROOT=Path(__file__).resolve().parent
PDF_IDS={"PROD-SRC-002","PROD-SRC-003","PROD-SRC-004","PROD-SRC-005","PROD-SRC-006","PROD-SRC-010","PROD-SRC-011","PROD-SRC-012","PROD-SRC-013","PROD-SRC-016"}
rows=[]
for line in (ROOT/"SOURCE_REGISTER.raw.jsonl").read_text("utf-8").splitlines():
    if not line.strip(): continue
    s=json.loads(line)
    if s["source_id"] not in PDF_IDS: continue
    p=Path(s["local_path"]); data=p.read_bytes()
    sig=data.lstrip().startswith(b"%PDF-")
    row={"source_id":s["source_id"],"path":str(p),"bytes":len(data),"pdf_signature":sig,"registered_status":s["status"]}
    if s["status"].startswith("ACQUIRED"):
        try:
            reader=PdfReader(p, strict=True)
            row.update(status="PASS",page_count=len(reader.pages),parse_method="pypdf strict=True")
        except Exception as exc:
            row.update(status="FAIL",page_count=None,error=f"{type(exc).__name__}: {exc}")
    else:
        row.update(status="EXPECTED_EXCLUDED_NON_PDF" if not sig else "EXCLUDED_OTHER_FAILURE",page_count=None)
    rows.append(row)
out={"status":"PASS" if all(r["status"] in {"PASS","EXPECTED_EXCLUDED_NON_PDF"} for r in rows) else "FAIL","pdf_candidates":rows}
(ROOT/"PDF_VALIDATION_RESULTS.json").write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n","utf-8")
print(json.dumps({"status":out["status"],"validated":sum(r["status"]=="PASS" for r in rows),"excluded_non_pdf":sum(r["status"]=="EXPECTED_EXCLUDED_NON_PDF" for r in rows)}))
if out["status"]!="PASS": raise SystemExit(1)
