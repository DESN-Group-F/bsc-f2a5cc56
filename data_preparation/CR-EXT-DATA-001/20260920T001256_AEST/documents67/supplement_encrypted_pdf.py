"""Metadata-only fallback for the one AES-encrypted, terms-limited PDF."""
from __future__ import annotations
import json, subprocess
from pathlib import Path

ROOT = Path(r"E:\desn 2000\bsc")
OUT = ROOT / "data_preparation/CR-EXT-DATA-001/20260920T001256_AEST/documents67"
FID = "FILE-038-cbd0f5edb42b-16d37f"
SOURCE = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\collection\quarantine\raw\technical\SRC-038\UN_test_summary_2019-07-12.pdf")
PDFINFO = Path(r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdfinfo.exe")

proc = subprocess.run([str(PDFINFO), str(SOURCE)], capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
if proc.returncode:
    raise SystemExit(f"pdfinfo failed: {proc.returncode}: {proc.stderr.strip()}")
fields = {}
for line in proc.stdout.splitlines():
    if ":" in line:
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip()
profile = {"fallback_method": "Poppler pdfinfo metadata only", "page_count": int(fields["Pages"]), "encrypted": fields.get("Encrypted"), "page_size": fields.get("Page size"), "pdf_version": fields.get("PDF version"), "tagged": fields.get("Tagged"), "javascript": fields.get("JavaScript"), "full_text_derived": False, "page_text_or_image_resources_inspected": False}
mp = OUT / "PROCESSING_MANIFEST.jsonl"
rows = [json.loads(x) for x in mp.open(encoding="utf-8") if x.strip()]
for row in rows:
    if row["file_id"] == FID:
        row["status"] = "LOCALLY_INSPECTED_TERMS_LIMITED"
        row["profile"] = profile
        row["limitations"].append("AES-encrypted PDF disallows copy; pypdf could not inspect page text/resources without unavailable cryptography support. Only pdfinfo metadata was recorded; no bypass was attempted.")
mp.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in rows), encoding="utf-8")
qp = OUT / "QUALITY_FINDINGS.jsonl"
findings = [json.loads(x) for x in qp.open(encoding="utf-8") if x.strip()]
for row in findings:
    if row["file_id"] == FID:
        row["issues"] = ["AES-encrypted PDF: print allowed, copy/change/annotation disallowed; pypdf page-text/resource inspection unavailable. Poppler pdfinfo reports 17 A4 pages, PDF 1.6; no content restriction was bypassed."]
        row["quality_status"] = "NEEDS_REVIEW_ENCRYPTED_METADATA_ONLY"
qp.write_text("".join(json.dumps(x, ensure_ascii=False, sort_keys=True) + "\n" for x in findings), encoding="utf-8")
log = {"file_id": FID, "command": f'"{PDFINFO}" "{SOURCE}"', "status": "PASS_METADATA_ONLY", "source_text_read": False, "restriction_bypassed": False, "recorded_fields": profile}
(OUT / "ENCRYPTED_PDF_FALLBACK_LOG.json").write_text(json.dumps(log, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"file_id": FID, "status": "PASS_METADATA_ONLY", "pages": profile["page_count"], "encrypted": profile["encrypted"]}, ensure_ascii=False))
