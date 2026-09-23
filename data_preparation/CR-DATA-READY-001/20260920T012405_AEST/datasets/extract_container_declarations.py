import json,pathlib,zipfile,tempfile,shutil,re,hashlib
ROOT=pathlib.Path(__file__).parent;RUN=ROOT.parent;DER=ROOT/'derived'/'container_declarations';DER.mkdir(parents=True,exist_ok=True)
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
objs=[x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets' and x['source_id'] in ('SRC-012','SRC-013') and x['representation']=='ZIP_ARCHIVE']
rows=[]
def save(fid,locator,b):
 text=b.decode('utf-8','replace');name=fid+'__'+hashlib.sha256(locator.encode()).hexdigest()[:12]+'__'+re.sub(r'[^A-Za-z0-9_.-]+','_',locator)[-60:]+'.txt';p=DER/name;p.write_text(text,encoding='utf-8')
 lines=[x.strip() for x in text.splitlines() if re.search(r'(?i)\b(voltage|current|temperature|time|capacity|unit|ampere|volt|celsius|second|hour|cycle)\b',x)]
 rows.append({'container_file_id':fid,'member_locator':locator,'derived_text_path':str(p),'bytes':len(b),'unit_or_protocol_declaration_lines':lines[:200],'declaration_line_count':len(lines),'source_values_emitted':False})
for o in objs:
 with zipfile.ZipFile(o['input_path']) as z:
  for i in z.infolist():
   low=i.filename.lower()
   if not i.is_dir() and i.file_size<=1024*1024 and (low.endswith(('.txt','.md')) or 'readme' in low):save(o['file_id'],i.filename,z.read(i))
   elif not i.is_dir() and low.endswith('.zip'):
    with tempfile.SpooledTemporaryFile(max_size=16*1024*1024) as sp:
     with z.open(i) as q:shutil.copyfileobj(q,sp,1024*1024)
     sp.seek(0)
     try:
      with zipfile.ZipFile(sp) as nz:
       for j in nz.infolist():
        jl=j.filename.lower()
        if not j.is_dir() and j.file_size<=1024*1024 and (jl.endswith(('.txt','.md')) or 'readme' in jl):save(o['file_id'],i.filename+'!/'+j.filename,nz.read(j))
     except zipfile.BadZipFile:pass
with (ROOT/'CONTAINER_DECLARATIONS.jsonl').open('w',encoding='utf-8',newline='\n') as f:
 for x in rows:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'documents':len(rows),'with_declarations':sum(x['declaration_line_count']>0 for x in rows)}))
