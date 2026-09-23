"""Bounded follow-up for initialdata_all.mat; this window overlaps the initial read."""
import json,struct,zlib,re
from pathlib import Path
SRC=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate\initialdata_all.mat")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\existing233\mat5_review")
OFFSET=128+8+83; READ=8_000_000; CAP=8*1024*1024
with SRC.open("rb") as f: f.seek(OFFSET); data=f.read(READ)
typ,nbytes=struct.unpack_from("<II",data,0); result={"file_id":"FILE-017-6749aee75bee-8d52a4","source_offset":OFFSET,"bytes_read":len(data),"tag_type_id":typ,"declared_compressed_bytes":nbytes,"payload_complete":len(data)-8>=nbytes}
if typ==15:
 dec=zlib.decompressobj(); raw=dec.decompress(data[8:],CAP); result.update({"decompressed_bytes_retained":len(raw),"decompressed_cap_reached":len(raw)>=CAP,"bounded_structural_strings":[m.group().decode('ascii','replace') for m in list(re.finditer(rb"(?:MCOS|FileWrapper__|ndims|nrows|Properties|table|initial|charge)[ -~]{0,80}",raw))[:40]]})
(OUT/"LARGE_FOLLOWUP.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(json.dumps({"bytes_read":len(data),"tag_type_id":typ,"declared_compressed_bytes":nbytes,"decompressed_bytes_retained":result.get('decompressed_bytes_retained')}))
