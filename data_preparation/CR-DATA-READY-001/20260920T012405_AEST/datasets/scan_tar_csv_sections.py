import collections,csv,json,pathlib,re,tarfile,time,itertools
R=pathlib.Path(__file__).parent;RUN=R.parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl')}
targets={(x['container_file_id'],x['member_path']):x for x in load(R/'TAR_CSV_FULL_STRUCTURE.jsonl')}
section_re=re.compile(r'^\[(Summary|End Summary|Protocol|End Protocol|Data|End Data)\]$',re.I);unit_re=re.compile(r'(?i)(?:\(([^)]+)\)|\b(?:volt|amp|ohm|degc|°c|second|minute|hour|m?v|m?a|a?h|w?h|w|s)\b)')
def numeric_ratio(row):
 vals=[x.strip() for x in row if x.strip()]
 if not vals:return 0.0
 n=0
 for x in vals:
  try:float(x);n+=1
  except ValueError:pass
 return n/len(vals)
rows=[]
for fid in sorted({k[0] for k in targets}):
 with tarfile.open(src[fid]['input_path'],'r|*') as tar:
  for member in tar:
   key=(fid,member.name)
   if key not in targets:continue
   start=time.time();sections=[];current=None;line_no=0;error=None;data_header=None;data_header_row=None;data_start=None;unit_rows=[];post_header=[];data_widths=collections.Counter();data_rows=0;blank_data_rows=0;malformed_width_rows=0;malformed_row_numbers=[];low_numeric_ratio_rows=0;last_valid_data_row=None;valid_after_malformed=False
   try:
    raw=tar.extractfile(member);probe=raw.read(min(member.size,1024*1024))
    try: probe.decode('utf-8-sig',errors='strict'); encoding='utf-8-sig'; encoding_basis='first_1MiB_strict_utf8'
    except UnicodeDecodeError: encoding='cp1252'; encoding_basis='first_1MiB_failed_utf8_cp1252_fallback'
    prefix_lines=probe.splitlines(keepends=True)
    if prefix_lines and not prefix_lines[-1].endswith((b'\n',b'\r')):
     prefix_lines[-1]+=raw.readline()
    lines=(b.decode(encoding,errors='strict') for b in itertools.chain(prefix_lines,iter(raw.readline,b'')))
    for row in csv.reader(lines):
     line_no+=1;non=[x.strip() for x in row if x.strip()];marker=section_re.fullmatch(non[0]) if len(non)==1 else None
     if marker:
      if current:current['end_row']=line_no-1;current['row_count']=current['end_row']-current['start_row']+1
      current={'section_name':marker.group(1),'start_row':line_no,'end_row':None,'row_count':None,'column_count_distribution':collections.Counter()};sections.append(current);continue
     if current:current['column_count_distribution'][len(row)]+=1
     if current and current['section_name'].strip().lower()=='data':
      if data_header is None and len(non)>1 and numeric_ratio(row)<0.5:
       data_header=[x.strip() for x in row];data_header_row=line_no;continue
      if data_header is not None and data_start is None:
       if numeric_ratio(row)>=0.5:
        data_start=line_no;data_rows=1;data_widths[len(row)]+=1
       else:
        post_header.append((line_no,[x.strip() for x in row]))
      elif data_start is not None and current and current['section_name'].strip().lower()=='data':
       if not non: blank_data_rows+=1; continue
       if len(row)!=len(data_header):malformed_width_rows+=1;malformed_row_numbers.append(line_no);continue
       if malformed_row_numbers:valid_after_malformed=True
       data_rows+=1;data_widths[len(row)]+=1;last_valid_data_row=line_no
       if numeric_ratio(row)<0.5: low_numeric_ratio_rows+=1
    if current:current['end_row']=line_no;current['row_count']=current['end_row']-current['start_row']+1
    unit_rows=[{'row':n,'declarations':[x for x in r if x and unit_re.search(x)]} for n,r in post_header if any(x and unit_re.search(x) for x in r)]
   except Exception as e:error=type(e).__name__+': '+str(e)
   for s in sections:s['column_count_distribution']=dict(s['column_count_distribution'])
   embedded=[{'field':x,'unit_tokens':[m.group(0) for m in unit_re.finditer(x)]} for x in (data_header or []) if unit_re.search(x)]
   rows.append({'container_file_id':fid,'member_path':member.name,'member_bytes':member.size,'status':'SECTION_CONTRACT_READY' if not error and data_header and data_start and not valid_after_malformed else 'SECTION_CONTRACT_ERROR','error':error,'encoding':encoding if not error else None,'encoding_basis':encoding_basis if not error else None,'sections':sections,'data_section_name':'Data','data_header_row':data_header_row,'data_header_fields':data_header,'data_start_row':data_start,'last_valid_data_row':last_valid_data_row,'data_row_count':data_rows,'data_column_count_distribution':dict(data_widths),'blank_data_rows_excluded':blank_data_rows,'trailing_malformed_records_excluded':malformed_width_rows,'malformed_record_row_numbers':malformed_row_numbers,'valid_data_after_malformed_record':valid_after_malformed,'low_numeric_ratio_rows':low_numeric_ratio_rows,'unit_declaration_rows':unit_rows,'embedded_unit_declarations':embedded,'units_policy':'Only literal declarations are recorded; no calibration or inferred units.','preamble_sections':[s['section_name'] for s in sections if s['section_name'].strip().lower()!='data' and s['start_row']<(data_header_row or 10**18)],'tail_sections':[s['section_name'] for s in sections if s['start_row']>(data_start or 10**18)],'source_values_emitted':False,'parser_code_version':'tar-sectioned-csv-contract-v2','elapsed_seconds':round(time.time()-start,3)})
out=R/'TAR_CSV_SECTION_CONTRACTS.jsonl';tmp=out.with_suffix('.tmp')
with tmp.open('w',encoding='utf-8',newline='\n') as f:
 for row in rows:f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
tmp.replace(out)
keys=[(x['container_file_id'],x['member_path']) for x in rows];checks={'target_count_182':len(targets)==182,'row_count_182':len(rows)==182,'unique_exact_target_set':len(keys)==len(set(keys)) and set(keys)==set(targets),'all_section_contract_ready':all(x['status']=='SECTION_CONTRACT_READY' for x in rows),'all_data_headers_non_summary':all(x['data_header_fields'] and x['data_header_fields']!=['[Summary]'] for x in rows),'all_data_start_after_header':all(x['data_start_row']>x['data_header_row'] for x in rows),'all_section_boundaries_closed':all(all(s['end_row']>=s['start_row'] for s in x['sections']) for x in rows),'all_data_widths_match_header':all(not x['valid_data_after_malformed_record'] for x in rows),'all_encoding_explicit':all(x.get('encoding_basis') for x in rows)}
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'members':len(rows),'sections':sum(len(x['sections']) for x in rows),'data_rows':sum(x['data_row_count'] for x in rows),'members_with_literal_unit_declarations':sum(bool(x['unit_declaration_rows'] or x['embedded_unit_declarations']) for x in rows),'members_with_tail_sections':sum(bool(x['tail_sections']) for x in rows)},'scope':'Full section-boundary and data-row scan for all 182 TAR CSV members; retains section names, actual header fields, literal unit declarations and row/width counts only.','command':f'python -B {__file__}'}
(R/'TAR_CSV_SECTION_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False))


