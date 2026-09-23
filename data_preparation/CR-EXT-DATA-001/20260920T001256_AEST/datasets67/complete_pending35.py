from __future__ import annotations
import io, json, re, tarfile, time, zipfile
from collections import Counter
from pathlib import Path
import ijson

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
OUT=RUN/"datasets67"; SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
DEADLINE_SECONDS=30*60; OUTPUT_LIMIT=100*1024*1024; MEMORY_LIMIT=512*1024*1024

def jl(p): return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
def dump(p,rows): p.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in rows),encoding="utf-8")

class NormalizeConstants:
    def __init__(self, raw): self.raw=raw; self.buf=bytearray(); self.eof=False; self.in_string=False; self.escape=False; self.word=bytearray(); self.counts=Counter(); self.bytes_read=0
    def _emit_word(self):
        if not self.word:return
        w=bytes(self.word)
        if w in (b"NaN",b"Infinity",b"-Infinity"):
            self.buf.extend(b"null"); self.counts[w.decode()]+=1
        else:self.buf.extend(w)
        self.word.clear()
    def _fill(self,n):
        while len(self.buf)<n and not self.eof:
            chunk=self.raw.read(1024*1024); self.bytes_read+=len(chunk)
            if not chunk: self._emit_word(); self.eof=True; break
            for b in chunk:
                if self.in_string:
                    self.buf.append(b)
                    if self.escape:self.escape=False
                    elif b==92:self.escape=True
                    elif b==34:self.in_string=False
                else:
                    if b==34:self._emit_word(); self.buf.append(b); self.in_string=True
                    elif (65<=b<=90) or (97<=b<=122) or b==45:self.word.append(b)
                    else:self._emit_word(); self.buf.append(b)
    def read(self,n=-1):
        if n<0:
            while not self.eof:self._fill(max(1024*1024,len(self.buf)+1))
            n=len(self.buf)
        else:self._fill(n)
        out=bytes(self.buf[:n]); del self.buf[:n]; return out

def full_json(path,start,deadline):
    keys=set(); prefixes=set(); events=0; types=Counter(); complete=False; error=None
    with path.open("rb") as raw:
        norm=NormalizeConstants(raw)
        try:
            for prefix,event,value in ijson.parse(norm):
                events+=1
                if event=="map_key": keys.add(str(value)); prefixes.add(prefix)
                elif event in {"string","number","boolean","null"}:types[event]+=1
                if time.monotonic()>deadline: raise TimeoutError("global 30-minute budget reached")
            complete=True
        except Exception as exc:error=f"{type(exc).__name__}: {exc}"
        return {"complete":complete,"error":error,"bytes_read":norm.bytes_read,"events":events,"field_names":sorted(keys),"object_prefixes":sorted(prefixes),"scalar_event_counts":dict(types),"nonstandard_constant_counts":dict(norm.counts),"elapsed_seconds":round(time.monotonic()-start,3)}

def full_text(path,start,deadline):
    lines=0; width=Counter(); tabs=Counter(); nonnumeric=0; numeric=0; unit_lines=0; max_len=0; samples=set(); complete=False; error=None; bytes_read=0
    unit_re=re.compile(rb"(?i)(unit|uom|volt|amp|ohm|celsius|degc|temperature|capacity|energy)")
    try:
        with path.open("rb") as f:
            for line in f:
                bytes_read+=len(line); lines+=1; max_len=max(max_len,len(line)); tabs[line.count(b"\t")]+=1
                parts=line.rstrip(b"\r\n").split(b"\t"); width[len(parts)]+=1
                if unit_re.search(line):unit_lines+=1
                for token in parts:
                    t=token.strip()
                    if not t:continue
                    try:float(t);numeric+=1
                    except ValueError:
                        nonnumeric+=1
                        if len(samples)<100:samples.add(t[:80].decode("utf-8",errors="replace"))
                if lines%10000==0 and time.monotonic()>deadline:raise TimeoutError("global 30-minute budget reached")
        complete=True
    except Exception as exc:error=f"{type(exc).__name__}: {exc}"
    return {"complete":complete,"error":error,"bytes_read":bytes_read,"line_count":lines,"field_count_distribution":dict(width),"tab_count_distribution":dict(tabs),"maximum_line_bytes":max_len,"numeric_token_count":numeric,"nonnumeric_token_count":nonnumeric,"nonnumeric_token_examples":sorted(samples),"unit_or_quantity_declaration_line_count":unit_lines,"elapsed_seconds":round(time.monotonic()-start,3)}

def full_tar(path,file_id,start,deadline):
    rows=[]; formats=Counter(); complete=False; error=None
    raw=path.open("rb")
    try:
        tf=tarfile.open(fileobj=raw,mode="r|gz")
        for idx,info in enumerate(tf):
            rows.append({"container_file_id":file_id,"member_path":info.name,"member_format":Path(info.name).suffix.lower() or "<none>","uncompressed_bytes":info.size,"member_type":str(info.type),"directory_only":True,"content_sampled":False,"catalog_scope":"FULL_STREAM_DIRECTORY"}); formats[Path(info.name).suffix.lower() or "<none>"]+=1
            if idx%100==0 and time.monotonic()>deadline:raise TimeoutError("global 30-minute budget reached")
        complete=True
    except Exception as exc:error=f"{type(exc).__name__}: {exc}"
    finally:raw.close()
    return rows,{"complete":complete,"error":error,"members":len(rows),"member_formats":dict(formats),"compressed_bytes_consumed":raw.tell() if not raw.closed else path.stat().st_size if complete else None,"elapsed_seconds":round(time.monotonic()-start,3)}

def nested_zip_dirs(path,file_id,start,deadline):
    rows=[]; nested=[]; error=None
    try:
        with zipfile.ZipFile(path) as outer:
            candidates=[i for i in outer.infolist() if not i.is_dir() and Path(i.filename).suffix.lower()==".zip"]
            for info in candidates:
                if time.monotonic()>deadline:raise TimeoutError("global 30-minute budget reached")
                with outer.open(info) as stream:
                    try:
                        with zipfile.ZipFile(stream) as inner:
                            items=inner.infolist(); nested.append({"parent_member_path":info.filename,"valid_zip":True,"member_count":len(items),"member_formats":dict(Counter(Path(x.filename).suffix.lower() or "<none>" for x in items if not x.is_dir()))})
                            for x in items: rows.append({"container_file_id":file_id,"parent_member_path":info.filename,"member_path":x.filename,"member_format":Path(x.filename).suffix.lower() or "<none>","uncompressed_bytes":x.file_size,"compressed_bytes":x.compress_size,"crc32":f"{x.CRC:08x}","directory_only":True,"content_sampled":False,"catalog_scope":"FULL_NESTED_ZIP_DIRECTORY"})
                    except zipfile.BadZipFile:nested.append({"parent_member_path":info.filename,"valid_zip":False,"member_count":0,"member_formats":{}})
    except Exception as exc:error=f"{type(exc).__name__}: {exc}"
    return rows,{"complete":error is None,"error":error,"nested_archives":nested,"nested_member_rows":len(rows),"elapsed_seconds":round(time.monotonic()-start,3)}

def main():
    start=time.monotonic(); deadline=start+DEADLINE_SECONDS
    scope={r["file_id"]:r for r in jl(RUN/"INPUT_SCOPE.jsonl")}
    manifest=jl(OUT/"PROCESSING_MANIFEST.jsonl"); schemas=jl(OUT/"SCHEMA_CATALOG.jsonl"); components=jl(OUT/"CONTAINER_COMPONENTS.jsonl"); findings=jl(OUT/"QUALITY_FINDINGS.jsonl")
    results=[]
    for m in manifest:
        if m["technical_format"]=="JSON":
            t=time.monotonic(); r=full_json(SOURCE/Path(m["relative_path"]),t,deadline); results.append({"file_id":m["file_id"],"kind":"FULL_JSON_STREAM",**r})
            schemas=[s for s in schemas if not(s["file_id"]==m["file_id"] and s["schema_id"].endswith("#object"))]
            schemas.append({"file_id":m["file_id"],"schema_id":m["file_id"]+"#object-full","locator":m["relative_path"],"structure":"json_full_stream","representative_scope":"complete file" if r["complete"] else "budget-limited prefix","units_confirmed":False,"conditions_confirmed":False,**r})
            m["detail"].update({"full_stream":r}); m["processing_status"]="PREPARED_FULL_STRUCTURE" if r["complete"] else "PREPARED_PARTIAL_BUDGET_LIMIT"
    for m in manifest:
        if m["technical_format"]=="NUMERIC_SUFFIX" and m["registered_bytes"]>16:
            t=time.monotonic(); r=full_text(SOURCE/Path(m["relative_path"]),t,deadline); results.append({"file_id":m["file_id"],"kind":"FULL_TEXT_SCAN",**r}); schemas.append({"file_id":m["file_id"],"schema_id":m["file_id"]+"#full-text-quality","locator":m["relative_path"],"structure":"full_text_quality_scan","representative_scope":"complete file" if r["complete"] else "budget-limited prefix",**r}); m["detail"].update({"full_text_scan":r}); m["processing_status"]="PREPARED_FULL_STRUCTURE_AND_QUALITY" if r["complete"] else "PREPARED_PARTIAL_BUDGET_LIMIT"
        elif m["technical_format"]=="NUMERIC_SUFFIX":
            m["detail"]["actual_format"]="SHORT_NUMERIC_SCALAR_TEXT"; m["processing_status"]="PREPARED_BOUNDED"
    findings=[f for f in findings if f.get("code")!="NINE_BYTE_NUMERIC_TEXT_OBJECT"]
    for m in manifest:
        if m["technical_format"]=="NUMERIC_SUFFIX" and m["registered_bytes"]<=16: findings.append({"file_id":m["file_id"],"severity":"INFO","code":"SHORT_NUMERIC_SCALAR_TEXT","detail":"Complete object is a short numeric line. No expected-length or parent-member evidence was found, so it is not labelled truncated or placeholder."})
    for m in manifest:
        if m["technical_format"] in {"TGZ","GZIP"}:
            t=time.monotonic(); new,r=full_tar(SOURCE/Path(m["relative_path"]),m["file_id"],t,deadline); results.append({"file_id":m["file_id"],"kind":"FULL_TAR_DIRECTORY",**r}); components=[c for c in components if c["container_file_id"]!=m["file_id"]]+new; m["detail"].update({"full_stream_directory":r}); m["processing_status"]="PREPARED_FULL_CONTAINER_DIRECTORY" if r["complete"] else "PREPARED_PARTIAL_BUDGET_LIMIT"
    for m in manifest:
        if m["technical_format"]=="ZIP":
            t=time.monotonic(); new,r=nested_zip_dirs(SOURCE/Path(m["relative_path"]),m["file_id"],t,deadline)
            if r["nested_archives"]:
                components=[c for c in components if not(c["container_file_id"]==m["file_id"] and c.get("parent_member_path"))]+new; results.append({"file_id":m["file_id"],"kind":"FULL_NESTED_ZIP_DIRECTORIES",**r}); m["detail"].update({"nested_zip_full_directories":r});
                if r["complete"]: m["processing_status"]="PREPARED_FULL_CONTAINER_DIRECTORY"
    dump(OUT/"PROCESSING_MANIFEST.jsonl",manifest); dump(OUT/"CONTAINER_COMPONENTS.jsonl",components); dump(OUT/"SCHEMA_CATALOG.jsonl",schemas); dump(OUT/"QUALITY_FINDINGS.jsonl",findings); dump(OUT/"FULL_SCAN_RESULTS.jsonl",results)
    cfg={"wall_clock_budget_seconds":DEADLINE_SECONDS,"metadata_output_limit_bytes":OUTPUT_LIMIT,"memory_limit_bytes":MEMORY_LIMIT,"actual_elapsed_seconds":round(time.monotonic()-start,3),"output_bytes":sum(p.stat().st_size for p in OUT.iterdir() if p.is_file()),"budget_exceeded":time.monotonic()>deadline,"result_counts":dict(Counter(r["kind"] for r in results)),"incomplete_results":[{"file_id":r["file_id"],"kind":r["kind"],"error":r.get("error")} for r in results if not r.get("complete",True)]}
    (OUT/"FULL_SCAN_CONFIG.json").write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n",encoding="utf-8"); print(json.dumps(cfg,ensure_ascii=False,indent=2))
if __name__=="__main__":main()
