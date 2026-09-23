#!/usr/bin/env python3
"""Bounded downloader for CR-LITHIUM-COVERAGE-001 PRODUCTS lane.

Downloads only the pre-registered official URLs below. Each object is capped at
20 MiB and the lane at 100 MiB. No crawling, link following, or code execution.
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import urllib.request
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "sources"
PER_FILE_LIMIT = 20 * 1024 * 1024
LANE_LIMIT = 100 * 1024 * 1024

SOURCES = [
    {
        "source_id": "PROD-SRC-001",
        "publisher": "Panasonic Energy Co., Ltd.",
        "url": "https://energy.panasonic.com/jp/business/products/lithium-ion/cylindrical-high-rate/models/NCR1865K",
        "filename": "panasonic_ncr1865k.html",
        "version": "live public product page snapshot",
    },
    {
        "source_id": "PROD-SRC-002",
        "publisher": "Murata Manufacturing Co., Ltd.",
        "url": "https://www.murata.com/-/media/webrenewal/products/batteries/cylindrical/datasheet/us18650vtc6-product-datasheet.ashx",
        "filename": "murata_us18650vtc6_product_datasheet.pdf",
        "version": "public product datasheet; version/date to be read from document",
    },
    {
        "source_id": "PROD-SRC-003",
        "publisher": "LG Energy Solution",
        "url": "https://www.lgensol.com/assets/file/LGES_spec_sheet_cells_2024.pdf",
        "filename": "lges_spec_sheet_cells_2024.pdf",
        "version": "2024 cell specification sheet",
    },
    {
        "source_id": "PROD-SRC-004",
        "publisher": "Toshiba Corporation",
        "url": "https://www.global.toshiba/content/dam/toshiba/ww/products-solutions/battery/scib/pdf/SCiB_toshiba_en.pdf",
        "filename": "toshiba_scib_catalog_202504.pdf",
        "version": "2025-04 catalog filename/metadata",
    },
    {
        "source_id": "PROD-SRC-005",
        "publisher": "Samsung SDI",
        "url": "https://samsungsdi.com/upload/ess_brochure/SamsungSDI_ESS_EN.pdf",
        "filename": "samsung_sdi_ess_brochure_en.pdf",
        "version": "public ESS brochure; version/date to be read from document",
    },
    {
        "source_id": "PROD-SRC-006",
        "publisher": "CATL",
        "url": "https://www.catl.com/en/uploads/1/file/public/202010/20201026135925_y06ysmij9p.pdf",
        "filename": "catl_bess_product_brochure_en.pdf",
        "version": "2020-10 URL path; document version to be read from document",
    },
    {
        "source_id": "PROD-SRC-007",
        "publisher": "Tianjin Lishen Battery Joint-Stock Co., Ltd.",
        "url": "https://en.lishen.com.cn/content/details_616_2817.html",
        "filename": "lishen_lr2170ea.html",
        "version": "live public product page snapshot",
    },
    {
        "source_id": "PROD-SRC-008",
        "publisher": "EVE Energy Co., Ltd.",
        "url": "https://www.evebattery.com/en/news-1510",
        "filename": "eve_lf280k_marine_news.html",
        "version": "2023-09-27 public company news page snapshot",
    },
    {
        "source_id": "PROD-SRC-009",
        "publisher": "BYD",
        "url": "https://media.byd.com/byd-extends-warranty-of-blade-battery-to-eight-years-or-250000km/?lang=eng",
        "filename": "byd_blade_battery_warranty_2026.html",
        "version": "2026 public company media page snapshot",
    },
    {
        "source_id": "PROD-SRC-010",
        "publisher": "Murata Manufacturing Co., Ltd.",
        "url": "https://www.murata.com/~/media/webrenewal/support/library/catalog/products/k70e.ashx?la=en-us",
        "filename": "murata_products_k70e_catalog.pdf",
        "version": "K70E product catalog; Jan. 6, 2021 page marker",
    },
    {
        "source_id": "PROD-SRC-011",
        "publisher": "Panasonic",
        "url": "https://eu.industrial.panasonic.com/sites/default/pidseu/files/downloads/files/panasonic-batteries-short-form-catalog-2018-for-professionals_interactive_08_11_18.pdf",
        "filename": "panasonic_short_form_catalog_2018_failed_response.html",
        "version": "2018 catalog URL failed response retained as HTML",
        "expected_media_type": "application/pdf",
    },
    {
        "source_id": "PROD-SRC-012",
        "publisher": "GS Yuasa Corporation",
        "url": "https://ir.gs-yuasa.com/en/ir/library/presentation/presentation_archive/main/07/teaserItems3/0/linkList/0/link/171108_e.pdf",
        "filename": "gs_yuasa_fy2017_h1_presentation.pdf",
        "version": "FY2017 six months ended 2017-09-30 presentation",
    },
    {
        "source_id": "PROD-SRC-013",
        "publisher": "Saft",
        "url": "https://saft4u.saft.com/en/download_file/d31dbd8b-a41d-4a81-a080-3117b4fff8bb/English",
        "filename": "saft_7s2p_mp176065_blf_datasheet.pdf",
        "version": "Doc. No. 54063-2-0212",
        "reuse_existing_on_download_error": True,
    },
    {
        "source_id": "PROD-SRC-014",
        "publisher": "Bosch Professional",
        "url": "https://www.bosch-professional.com/no/no/products/2-x-procore18v-8-0ah-gal-18v-160-c-1600A016GT",
        "filename": "bosch_procore18v_8ah_gal18v160c_startset.html",
        "version": "live official start-set product page snapshot",
    },
    {
        "source_id": "PROD-SRC-015",
        "publisher": "GS Yuasa Corporation",
        "url": "https://www.gs-yuasa.com/en/newsrelease/article.php?ucode=gs180116142019_495",
        "filename": "gs_yuasa_lim50en13_14_release.html",
        "version": "2018-01-16 official product release snapshot",
    },
    {
        "source_id": "PROD-SRC-016",
        "publisher": "Panasonic Energy Co., Ltd.",
        "url": "https://energy.panasonic.com/dam/master/pdf/eu/catalog/Panasonic_Industrial-Batteries-For-Professionals_Short-Form-Catalog.pdf",
        "filename": "panasonic_industrial_batteries_short_form_catalog.pdf",
        "version": "official current download endpoint snapshot 2026-09-21; document edition to inspect",
        "expected_media_type": "application/pdf",
        "per_file_limit": 40 * 1024 * 1024,
        "limit_exception_reason": "Controller-authorized 40 MiB exception for one official Panasonic catalog; lane remains below 100 MiB.",
    },
]


def main() -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    acquired = datetime.now(timezone.utc).isoformat()
    total = 0
    rows = []
    for item in SOURCES:
        path = SOURCE_DIR / item["filename"]
        row = dict(item)
        row.update(
            acquired_at=acquired,
            local_path=str(path),
            authority_basis="DIRECT_OFFICIAL_PUBLISHER_DOMAIN",
            use_decision={
                "public_read": "ALLOWED_PUBLICLY_ACCESSIBLE",
                "internal_nonverbatim_fact_structuring": "ALLOWED_FOR_CURRENT_USER_AUTHORIZED_RESEARCH_REVIEW",
                "local_search_or_rag_ingestion": "UNKNOWN_NOT_REVIEWED_NOT_ADMITTED",
                "model_training": "UNKNOWN_NOT_REVIEWED_NOT_ADMITTED",
                "source_file_redistribution": "UNKNOWN_NOT_REVIEWED_NOT_ADMITTED",
                "current_action": "BOUNDED_DOWNLOAD_AND_NONVERBATIM_FACT_REVIEW",
            },
            rights_evidence="No source-specific AI/RAG/training licence identified in the acquired document/page during this bounded review; ordinary copyright is not treated as a bar to public reading or nonverbatim fact checking.",
            evidence_refs=[],
        )
        item_limit = item.get("per_file_limit", PER_FILE_LIMIT)
        if path.exists():
            data = path.read_bytes()
            if item.get("expected_media_type") == "application/pdf" and not data.lstrip().startswith(b"%PDF-"):
                row.update(status="ACQUISITION_FAILED_HTML_INSTEAD_OF_PDF", bytes=len(data),
                           sha256=hashlib.sha256(data).hexdigest(),
                           error="Official URL returned HTML rather than a readable PDF; retained only as acquisition-failure evidence and excluded from facts.")
                rows.append(row)
                continue
            if len(data) > item_limit or total + len(data) > LANE_LIMIT:
                row.update(status="FAILED_EXISTING_SIZE_LIMIT", bytes=len(data), sha256=None,
                           error="existing object exceeds configured size limit")
            else:
                total += len(data)
                row.update(status="ACQUIRED_EXISTING_HASH_BOUND", bytes=len(data),
                           sha256=hashlib.sha256(data).hexdigest(),
                           acquisition_note="Existing captured object hash-bound and reused; downloader does not refresh or overwrite captured sources.")
            rows.append(row)
            continue
        try:
            req = urllib.request.Request(item["url"], headers={"User-Agent": "Mozilla/5.0 bounded-research-fetch/1.0"})
            with urllib.request.urlopen(req, timeout=45) as response:
                chunks = []
                size = 0
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > item_limit or total + size > LANE_LIMIT:
                        raise ValueError("size limit exceeded")
                    chunks.append(chunk)
            data = b"".join(chunks)
            path.write_bytes(data)
            total += len(data)
            row.update(status="ACQUIRED", bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        except Exception as exc:
            if item.get("reuse_existing_on_download_error") and path.exists() and path.stat().st_size <= item_limit:
                data = path.read_bytes()
                total += len(data)
                row.update(status="ACQUIRED_EXISTING_AFTER_STANDARD_CLIENT_FETCH", bytes=len(data),
                           sha256=hashlib.sha256(data).hexdigest(),
                           acquisition_note=f"Bundled urllib failed ({type(exc).__name__}); existing object was acquired with standard PowerShell Invoke-WebRequest without certificate bypass.")
            else:
                row.update(status="FAILED", bytes=0, sha256=None, error=f"{type(exc).__name__}: {exc}")
                if path.exists():
                    path.unlink()
        rows.append(row)
    with (ROOT / "SOURCE_REGISTER.raw.jsonl").open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(json.dumps({"sources": len(rows), "acquired": sum(r["status"].startswith("ACQUIRED") for r in rows), "bytes": total}))


if __name__ == "__main__":
    main()
