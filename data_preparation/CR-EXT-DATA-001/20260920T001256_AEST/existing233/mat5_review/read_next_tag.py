import json,struct
from pathlib import Path
SRC=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\extension_2026-09-17\low_rate\initialdata_all.mat")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\existing233\mat5_review")
offset=128+8+83+8+93
with SRC.open('rb') as f:f.seek(offset);b=f.read(8)
t,n=struct.unpack('<II',b)
r={"file_id":"FILE-017-6749aee75bee-8d52a4","offset":offset,"bytes_read":8,"type_id":t,"declared_nbytes":n,"payload_skipped":True}
(OUT/'LARGE_NEXT_TAG.json').write_text(json.dumps(r,indent=2)+'\n',encoding='utf-8');print(json.dumps(r))
