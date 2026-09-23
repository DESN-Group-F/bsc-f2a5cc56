"""Use the final bounded source-read allowance to inspect MAT-v5 top-level tags."""
import json, struct, zlib, re
from pathlib import Path

SRC = Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate\initialdata_all.mat")
OUT = Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\existing233\mat5_review")
OFFSET, READ, CAP = 320, 160_000, 8 * 1024 * 1024
with SRC.open("rb") as f:
    f.seek(OFFSET)
    data = f.read(READ)

items, p = [], 0
while p + 8 <= len(data):
    typ, nbytes = struct.unpack_from("<II", data, p)
    if typ != 15 or nbytes > len(data) - p - 8:
        items.append({"offset": OFFSET+p, "type_id": typ, "declared_nbytes": nbytes,
                      "payload_available": max(0, len(data)-p-8), "skipped_or_incomplete": True})
        break
    raw = zlib.decompress(data[p+8:p+8+nbytes])
    strings = [m.group().decode("ascii", "replace") for m in
               list(re.finditer(rb"(?:MCOS|FileWrapper__|ndims|nrows|Properties|table|charge|discharge|initial)[ -~]{0,80}", raw))[:20]]
    items.append({"offset": OFFSET+p, "type_id": typ, "declared_nbytes": nbytes,
                  "decompressed_bytes": len(raw), "decompressed_cap_respected": len(raw) <= CAP,
                  "bounded_structural_strings": strings})
    # MATLAB's miCOMPRESSED top-level elements in these files begin immediately
    # after their payload; padding is not inserted between these elements.
    p += 8 + nbytes

result = {"file_id":"FILE-017-6749aee75bee-8d52a4", "source_offset":OFFSET,
          "bytes_read":len(data), "items":items}
(OUT/"LARGE_REMAINING_WINDOW.json").write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8")
print(json.dumps({"bytes_read":len(data), "items":len(items), "last":items[-1] if items else None}))
