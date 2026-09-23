"""Bounded passive review of three MATLAB v5/MCOS files.

No object deserialization, code execution, or array-value loading. Total source
reads are capped at 16 MiB; decompressed output per compressed element at 8 MiB.
"""
from __future__ import annotations
import json,re,struct,zlib
from pathlib import Path,PurePosixPath

ROOT=Path(r"E:\desn 2000\bsc"); SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
RUN=ROOT/"data_preparation/CR-EXT-DATA-001/20260920T001256_AEST"; OUT=RUN/"existing233/mat5_review"; SCOPE=RUN/"INPUT_SCOPE.jsonl"
NAMES={"initialdata_all.mat","finaldata_4.mat","finaldata_6and8.mat"}; TOTAL_BUDGET=16*1024*1024; DECOMP_CAP=8*1024*1024
TYPES={1:"miINT8",2:"miUINT8",3:"miINT16",4:"miUINT16",5:"miINT32",6:"miUINT32",7:"miSINGLE",9:"miDOUBLE",12:"miINT64",13:"miUINT64",14:"miMATRIX",15:"miCOMPRESSED",16:"miUTF8",17:"miUTF16",18:"miUTF32"}

def tag(buf,pos,endian="<"):
 if pos+8>len(buf): return None
 a,b=struct.unpack_from(endian+"II",buf,pos)
 if a>>16:
  return {"type":a&0xffff,"nbytes":a>>16,"payload":pos+4,"next":pos+8,"small":True}
 padded=b if a==15 else (b+7)//8*8
 return {"type":a,"nbytes":b,"payload":pos+8,"next":pos+8+padded,"small":False}

def printable(data,limit=30):
 vals=[]
 for m in re.finditer(rb"[ -~]{4,160}",data):
  s=m.group().decode("ascii","replace")
  if s not in vals: vals.append(s)
  if len(vals)>=limit: break
 return vals

def subelements(data,endian="<",maxn=20):
 out=[]; pos=0
 while pos+8<=len(data) and len(out)<maxn:
  t=tag(data,pos,endian)
  if not t or t["type"] not in TYPES or t["nbytes"]>len(data)-t["payload"]: break
  payload=data[t["payload"]:t["payload"]+t["nbytes"]]
  item={"offset":pos,"type_id":t["type"],"type":TYPES[t["type"]],"nbytes":t["nbytes"],"printable_preview":printable(payload,5)}
  if t["type"] in {5,6} and t["nbytes"]<=64 and t["nbytes"]%4==0: item["uint32_words"]=[struct.unpack_from(endian+"I",payload,i)[0] for i in range(0,len(payload),4)]
  out.append(item); pos=t["next"]
 return out

def inspect_stream(data,endian):
 top=[]; pos=128 if data.startswith(b"MATLAB 5.0 MAT-file") else 0
 while pos+8<=len(data) and len(top)<20:
  t=tag(data,pos,endian)
  if not t or t["type"] not in TYPES: break
  available=max(0,min(t["nbytes"],len(data)-t["payload"])); item={"offset":pos,"type_id":t["type"],"type":TYPES[t["type"]],"declared_nbytes":t["nbytes"],"available_payload_bytes":available,"payload_complete_in_buffer":available==t["nbytes"]}
  payload=data[t["payload"]:t["payload"]+available]
  if t["type"]==14: item["matrix_subelements"]=subelements(payload,endian)
  elif t["type"]==15:
   dec=zlib.decompressobj(); raw=dec.decompress(payload,DECOMP_CAP); item["decompressed_bytes_retained"]=len(raw); item["decompressed_cap_reached"]=len(raw)>=DECOMP_CAP; item["inner_elements"]=inspect_stream(raw,endian)[:5]
  top.append(item)
  if t["next"]<=pos or t["next"]>len(data): break
  pos=t["next"]
 return top

def main():
 OUT.mkdir(parents=True,exist_ok=True); rows=[json.loads(x) for x in SCOPE.open(encoding="utf-8") if x.strip()]; rows=[x for x in rows if Path(x["relative_path"]).name in NAMES]
 remaining=TOTAL_BUDGET; reports=[]
 for row in sorted(rows,key=lambda x:x["bytes_registered"]):
  path=SOURCE.joinpath(*PurePosixPath(row["relative_path"]).parts); want=min(row["bytes_registered"],remaining,8*1024*1024 if row["bytes_registered"]>1024*1024 else row["bytes_registered"])
  with path.open("rb") as f: data=f.read(want)
  remaining-=len(data); header=data[:128]; endian="<" if header[126:128]==b"IM" else ">" if header[126:128]==b"MI" else "<"
  reports.append({"file_id":row["file_id"],"relative_path":row["relative_path"],"registered_bytes":row["bytes_registered"],"bytes_read":len(data),"complete_file_read":len(data)==row["bytes_registered"],"header_text":header[:116].decode("ascii","replace").rstrip(" \x00"),"endian_indicator":header[126:128].decode("ascii","replace"),"top_level":inspect_stream(data,endian),"bounded_printable_structural_strings":[s for s in printable(data,80) if any(k in s.lower() for k in ("mcos","final_","initial","matlab","handle","class"))]})
 (OUT/"BOUNDED_STRUCTURE.jsonl").write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in reports),encoding="utf-8")
 old_shapes=[[1634625894,1127505772],[1634625894,1127636844],[1634625894,1127767916]]
 correction={"old_shapes_valid":False,"evidence":[{"word":n,"hex":hex(n),"little_endian_ascii":n.to_bytes(4,"little").decode("ascii","replace")} for pair in old_shapes for n in pair],"interpretation":"The alleged dimension words concatenate to ASCII final_4C/final_6C/final_8C and occur in mxOPAQUE/MCOS metadata positions, so they are not array dimensions.","safe_decode_assessment":"Standard numeric MAT-v5 directory parsing is insufficient. mxOPAQUE class 17 carries MATLAB MCOS object metadata and may depend on MATLAB class definitions/subsystem data. A complete semantic conversion requires a trusted MATLAB-compatible reader that explicitly supports MCOS or MATLAB itself in a no-code-execution conversion workflow, followed by export to plain structs/tables/HDF5 and independent field/unit checks.","not_attempted":["MATLAB object deserialization","class constructor execution","array value loading","full decompression of the large compressed element","source hash recomputation"],"total_source_bytes_read":TOTAL_BUDGET-remaining,"total_budget_bytes":TOTAL_BUDGET,"per_compressed_element_output_cap":DECOMP_CAP}
 (OUT/"CORRECTION.json").write_text(json.dumps(correction,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 print(json.dumps({"objects":len(reports),"source_bytes_read":correction["total_source_bytes_read"],"budget":TOTAL_BUDGET,"old_shapes_valid":False},ensure_ascii=False))
if __name__=="__main__":main()
