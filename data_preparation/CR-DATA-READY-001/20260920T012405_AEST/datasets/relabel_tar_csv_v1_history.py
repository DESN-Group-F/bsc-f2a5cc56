import json,pathlib
R=pathlib.Path(__file__).parent;p=R/'TAR_CSV_FULL_STRUCTURE.jsonl';out=[]
for line in p.read_text(encoding='utf-8-sig').splitlines():
 x=json.loads(line);x['first_record']=x.pop('header_fields',None);x['historical_interpretation']='The first CSV record is [Summary], not the measurement header; use TAR_CSV_SECTION_CONTRACTS.jsonl for semantic sections.';x['parser_version']='tar-csv-full-row-width-v1-history';out.append(x)
tmp=p.with_suffix('.tmp');tmp.write_text(''.join(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n' for x in out),encoding='utf-8');tmp.replace(p)
q=R/'TAR_CSV_STRUCTURE_CHECKS.json';c=json.loads(q.read_text(encoding='utf-8'));c['status']='HISTORICAL_PASS';c['scope']='Historical full row-width scan. first_record=[Summary] is a syntactic record, not a semantic data header. Superseded for section semantics by TAR_CSV_SECTION_CONTRACTS.jsonl.';c.get('checks',{}).pop('all_have_header',None);c.setdefault('checks',{})['all_have_first_record']=all(x.get('first_record') for x in out);q.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
