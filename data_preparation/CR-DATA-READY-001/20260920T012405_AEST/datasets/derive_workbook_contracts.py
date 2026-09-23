import json,pathlib,re,collections
R=pathlib.Path(__file__).parent
def load(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
out=[]
for w in load(R/'CONTAINER_WORKBOOK_PROFILES.jsonl'):
 for s in w['sheets']:
  grid=s['first_20_nonempty_rows']; candidates=[]
  for i,r in enumerate(grid):
   vals=r['cells']; non=[x for x in vals if x not in (None,'')]; strings=sum(not re.fullmatch(r'[-+]?\d+(\.\d+)?([eE][-+]?\d+)?',str(x).strip()) for x in non)
   later=[]
   for q in grid[i+1:i+4]:later += [x for x in q['cells'] if x not in (None,'')]
   numeric=sum(bool(re.fullmatch(r'[-+]?\d+(\.\d+)?([eE][-+]?\d+)?',str(x).strip())) for x in later)
   score=strings*2+min(numeric,10)+(3 if any(re.search(r'(?i)(time|current|voltage|capacity|temperature|cycle|sample|mass|heat|force|strain|stress)',str(x)) for x in non) else 0)
   candidates.append((score,r,numeric,strings))
  candidates.sort(key=lambda x:x[0],reverse=True)
  best=candidates[0] if candidates else None
  doc=s['role']=='documentation_or_disclaimer' or bool(re.search(r'(?i)(^info$|sample\s*info|disclaimer|readme|instruction)',s['sheet'])) or not best or best[2]==0 and best[3]<2
  metadata=bool(re.search(r'(?i)(cell\s*&?\s*test\s*info|cell\s*info)',s['sheet']))
  status='NON_DATA_SHEET' if doc else ('HEADER_SELECTED' if best[0]>4 else 'AMBIGUOUS_HEADER')
  header_rows=[best[1]['row']] if best and not doc else [] ; fields=best[1]['cells'] if best and not doc else None; method='scored_header_row_with_following_numeric_rows'
  if s['sheet'].lower()=='electric conductivity':
   header_rows=[3,5];fields=['Material','Cathode electronic conductivity (S/m)','Anode electronic conductivity (S/m)'];status='HEADER_SELECTED';method='explicit_two_row_title_unit_and_column_header_structure'
  out.append({'container_file_id':w['container_file_id'],'member_path':w['member_path'],'sheet':s['sheet'],'sheet_locator':'sheet='+s['sheet'],'sheet_role':'documentation_or_disclaimer' if doc else ('metadata_sheet' if metadata else 'data_or_analysis_sheet'),'contract_status':status,'selected_header_rows':header_rows,'selected_fields':fields,'selection_method':method,'selection_score':best[0] if best else None,'numeric_cells_in_next_three_nonempty_rows':best[2] if best else 0,'unit_or_quantity_cells':s['unit_or_quantity_cells'],'formula_count':s['formula_count'],'formula_cells':s['formula_cells'],'merged_ranges':s['merged_ranges'],'candidate_grid_ref':str(R/'CONTAINER_WORKBOOK_PROFILES.jsonl')+f'#container_file_id={w["container_file_id"]}&member_path={w["member_path"]}'})
with (R/'CONTAINER_WORKBOOK_CONTRACTS.jsonl').open('w',encoding='utf-8',newline='\n') as f:
 for x in out:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
print(json.dumps({'sheets':len(out),'statuses':dict(collections.Counter(x['contract_status'] for x in out))}))
