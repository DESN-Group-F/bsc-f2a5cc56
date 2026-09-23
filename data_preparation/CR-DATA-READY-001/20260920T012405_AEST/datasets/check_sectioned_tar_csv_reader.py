import csv,hashlib,io,json,pathlib,tarfile
from read_sectioned_tar_csv import CONTRACTS,SOURCES,read_rows
R=pathlib.Path(__file__).parent
k=min((z for z in CONTRACTS if CONTRACTS[z]['member_bytes']>5_000_000),key=lambda z:CONTRACTS[z]['member_bytes']);c=CONTRACTS[k];start=c['data_row_count']-2
x=read_rows(*k,row_limit=2,row_start=start);end=read_rows(*k,row_limit=2,row_start=c['data_row_count'])
with tarfile.open(SOURCES[k[0]]['input_path'],'r:*') as tf: raw=tf.extractfile(tf.getmember(k[1])).read()
raw_lines=raw.splitlines(keepends=True);first=x['source_record_numbers'][0]-1;last=x['source_record_numbers'][-1]
byte_offset=sum(map(len,raw_lines[:first]));direct=list(csv.reader(io.StringIO(b''.join(raw_lines[first:last]).decode(c['encoding']))))
value_hash=lambda rs:hashlib.sha256(json.dumps(rs,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
checks={'bounded_nonzero_start_two_rows':len(x['rows'])==2 and x['row_start']==start,'source_record_numbers_exact':[start+c['data_start_row'],start+c['data_start_row']+1]==x['source_record_numbers'],'crosses_first_1mib_source_region':byte_offset>1024*1024,'direct_raw_csv_value_hash_equal':value_hash(direct)==value_hash(x['rows']),'near_end_complete':x['complete'] and not x['truncated'],'exact_end_empty_complete':end['rows']==[] and end['complete'] and not end['truncated'],'compact_serialized_result_within_limit':len(json.dumps(x,ensure_ascii=False,separators=(',',':')).encode())<=1_000_000,'header_exact_contract':x['header']==c['data_header_fields'],'row_width_exact':all(len(r)==len(x['header']) for r in x['rows']),'degree_symbol_preserved':any('°C' in f for f in x['header']),'values_untransformed':x['source_values_transformed'] is False}
for name,args in [('negative_limit',dict(row_limit=-1)),('negative_start',dict(row_start=-1)),('past_end',dict(row_start=c['data_row_count']+1)),('member_bound',dict(row_limit=2,max_member_bytes=1)),('output_bound',dict(row_limit=2,max_output_bytes=1))]:
 try: read_rows(*k,**args);checks[name+'_rejected']=False
 except ValueError: checks[name+'_rejected']=True
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'fixture':{'container_file_id':k[0],'member_path':k[1],'member_bytes':c['member_bytes'],'header_sha256':hashlib.sha256(json.dumps(x['header'],ensure_ascii=False).encode()).hexdigest(),'row_start':start,'source_record_numbers':x['source_record_numbers'],'source_byte_offset':byte_offset,'value_sha256':value_hash(x['rows']),'rows_read':len(x['rows'])},'scope':'Actual bounded nonzero-offset read after the first 1 MiB of one registered sectioned CSV; direct raw csv.reader values are compared by hash and values are not stored.','command':f'python -B {__file__}'}
(R/'TAR_CSV_READER_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result))
