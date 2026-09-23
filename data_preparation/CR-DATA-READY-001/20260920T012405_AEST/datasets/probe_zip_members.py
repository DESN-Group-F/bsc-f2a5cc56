import json, pathlib, zipfile, time
ROOT=pathlib.Path(__file__).parent; RUN=ROOT.parent
def load(p): return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
out=ROOT/'ZIP_MEMBER_PROBES.jsonl'; log=ROOT/'ZIP_MEMBER_PROBES.log'; done=set()
if out.exists():
    for x in load(out): done.add(x['container_file_id'])
def detected(b,name):
    if b.startswith(b'PK\x03\x04'): return 'ZIP'
    if b.startswith(b'\x89PNG\r\n\x1a\n'): return 'PNG'
    if b.startswith(b'MATLAB '): return 'MAT_LEVEL5'
    if b.startswith(b'\x89HDF\r\n\x1a\n'): return 'HDF5_OR_MAT73'
    if b.startswith(b'%PDF-'): return 'PDF'
    if b.startswith(b'\x1f\x8b'): return 'GZIP'
    if b[:1] in (b'{',b'['): return 'JSON_LIKE'
    if b and not any(x==0 for x in b) and sum(32<=x<127 or x in (9,10,13) for x in b)/len(b)>.9: return 'TEXT_LIKE'
    return 'BINARY_OR_UNKNOWN'
with out.open('a',encoding='utf-8',newline='\n') as fo, log.open('a',encoding='utf-8',buffering=1) as lg:
    for fid,o in src.items():
        if fid in done or not zipfile.is_zipfile(o['input_path']): continue
        t=time.time(); n=err=0
        try:
            with zipfile.ZipFile(o['input_path']) as z:
                for info in z.infolist():
                    rec={'container_file_id':fid,'member_path':info.filename,'uncompressed_bytes':info.file_size,'compressed_bytes':info.compress_size,'directory':info.is_dir(),'bytes_read':0,'detected_format':'DIRECTORY' if info.is_dir() else None,'read_status':'DIRECTORY' if info.is_dir() else None,'error':None}
                    if not info.is_dir():
                        try:
                            with z.open(info) as f: b=f.read(512)
                            rec.update(bytes_read=len(b),detected_format=detected(b.lstrip(),info.filename),read_status='BOUNDED_PREFIX_READ')
                        except Exception as e: rec.update(read_status='READ_ERROR',error=type(e).__name__+': '+str(e)[:200]); err+=1
                    fo.write(json.dumps(rec,ensure_ascii=False,sort_keys=True)+'\n'); n+=1
        except Exception as e: lg.write(f'{fid}\tCONTAINER_ERROR\t{type(e).__name__}: {e}\n'); continue
        fo.flush(); lg.write(f'{fid}\tmembers={n}\terrors={err}\telapsed={time.time()-t:.3f}\n')
