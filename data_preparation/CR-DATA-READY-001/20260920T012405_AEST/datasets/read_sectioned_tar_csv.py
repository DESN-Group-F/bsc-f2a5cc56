import argparse,csv,io,json,pathlib,tarfile
ROOT=pathlib.Path(__file__).parent; RUN=ROOT.parent
def rows(p): return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
CONTRACTS={(x['container_file_id'],x['member_path']):x for x in rows(ROOT/'TAR_CSV_SECTION_CONTRACTS.jsonl')}
SOURCES={x['file_id']:x for x in rows(RUN/'SOURCE_OBJECTS.jsonl')}
def read_rows(container_file_id,member_path,row_limit=10,max_member_bytes=2_000_000_000,max_output_bytes=1_000_000,row_start=0):
 if row_limit<=0 or max_member_bytes<=0 or max_output_bytes<=0 or row_start<0: raise ValueError('limits must be positive and row_start nonnegative')
 c=CONTRACTS[(container_file_id,member_path)]
 if row_start>c['data_row_count']: raise ValueError('row_start exceeds conforming data row count')
 if c['member_bytes']>max_member_bytes: raise ValueError('member exceeds max_member_bytes')
 with tarfile.open(SOURCES[container_file_id]['input_path'],'r:*') as tf:
  for m in tf:
   if m.name!=member_path: continue
   raw=tf.extractfile(m); text=io.TextIOWrapper(raw,encoding=c['encoding'],errors='strict',newline='')
   reader=csv.reader(text);out=[];source_record_numbers=[];header=None;conforming_index=0;serialized_budget_used=0
   for record_no,row in enumerate(reader,1):
    if record_no==c['data_header_row']:
     header=[x.strip() for x in row]
     if header!=c['data_header_fields']: raise ValueError('header differs from contract')
     empty={'container_file_id':container_file_id,'member_path':member_path,'header':header,'literal_unit_declarations':c['embedded_unit_declarations'],'rows':[],'source_record_numbers':[],'row_start':row_start,'complete':False,'truncated':True,'row_limit':row_limit,'source_values_transformed':False}
     serialized_budget_used=len(json.dumps(empty,ensure_ascii=False,separators=(',',':')).encode('utf-8'))
    elif c['data_start_row']<=record_no<=c['last_valid_data_row']:
     if len(row)!=len(c['data_header_fields']): raise ValueError('data width differs from contract')
     if conforming_index<row_start: conforming_index+=1;continue
     delta=len(json.dumps(row,ensure_ascii=False,separators=(',',':')).encode('utf-8'))+len(str(record_no))+4
     if serialized_budget_used+delta>max_output_bytes:raise ValueError('serialized result exceeds max_output_bytes')
     out.append(row);source_record_numbers.append(record_no);conforming_index+=1
     serialized_budget_used+=delta
     if len(out)>=row_limit: break
   result={'container_file_id':container_file_id,'member_path':member_path,'header':header,'literal_unit_declarations':c['embedded_unit_declarations'],'rows':out,'source_record_numbers':source_record_numbers,'row_start':row_start,'complete':row_start+len(out)>=c['data_row_count'],'truncated':row_start+len(out)<c['data_row_count'],'row_limit':row_limit,'source_values_transformed':False}
   if len(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode('utf-8'))>max_output_bytes:raise ValueError('serialized result exceeds max_output_bytes')
   return result
 raise KeyError(member_path)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('container_file_id');p.add_argument('member_path');p.add_argument('--row-start',type=int,default=0);p.add_argument('--row-limit',type=int,default=10);p.add_argument('--max-member-bytes',type=int,default=2_000_000_000);p.add_argument('--max-output-bytes',type=int,default=1_000_000);a=p.parse_args()
 print(json.dumps(read_rows(a.container_file_id,a.member_path,a.row_limit,a.max_member_bytes,a.max_output_bytes,a.row_start),ensure_ascii=False,separators=(',',':')))

