import collections,csv,io,json,pathlib,tarfile,time
R=pathlib.Path(__file__).parent;RUN=R.parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl')}
targets={(x['container_file_id'],x['member_path']):x for x in load(R/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('member_path','').lower().endswith('.csv') and '/._' not in x.get('member_path','') and x.get('read_status')=='BOUNDED_MEMBER_SCHEMA_READ'}
out=R/'TAR_CSV_FULL_STRUCTURE.jsonl';rows=[]
for fid in sorted({k[0] for k in targets}):
 with tarfile.open(src[fid]['input_path'],'r|*') as tar:
  for member in tar:
   key=(fid,member.name)
   if key not in targets:continue
   t=time.time();counts=collections.Counter();header=None;error=None;line_count=0
   try:
    raw=tar.extractfile(member);lines=(b.decode('utf-8-sig' if line_count==0 else 'utf-8',errors='replace') for b in iter(raw.readline,b''))
    for row in csv.reader(lines):
     line_count+=1
     if header is None:header=row
     counts[len(row)]+=1
   except Exception as e:error=type(e).__name__+': '+str(e)
   rows.append({'container_file_id':fid,'member_path':member.name,'member_bytes':member.size,'complete':error is None,'error':error,'header_fields':header,'row_count_including_header':line_count,'column_count_distribution':dict(counts),'replacement_character_in_header':any('\ufffd' in x for x in (header or [])),'elapsed_seconds':round(time.time()-t,3),'source_values_emitted':False,'parser_code_version':'tar-csv-full-row-width-v1'})
tmp=out.with_suffix('.tmp')
with tmp.open('w',encoding='utf-8',newline='\n') as f:
 for row in rows:f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
tmp.replace(out)
keys=[(x['container_file_id'],x['member_path']) for x in rows]
checks={'target_count_182':len(targets)==182,'row_count_182':len(rows)==182,'unique_exact_target_set':len(keys)==len(set(keys)) and set(keys)==set(targets),'all_complete':all(x['complete'] for x in rows),'all_have_header':all(x['header_fields'] for x in rows),'bytes_match':sum(x['member_bytes'] for x in rows)==943670889}
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'members':len(rows),'bytes':sum(x['member_bytes'] for x in rows),'rows_including_headers':sum(x['row_count_including_header'] for x in rows),'members_with_width_variation':sum(len(x['column_count_distribution'])>1 for x in rows)},'scope':'Full sequential CSV parse and row-width distribution for every TAR CSV member; values not retained or emitted.','command':f'python -B {__file__}'}
(R/'TAR_CSV_STRUCTURE_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))
