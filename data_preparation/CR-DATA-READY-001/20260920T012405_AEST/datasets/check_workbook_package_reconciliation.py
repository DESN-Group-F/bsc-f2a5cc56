import io, json, pathlib, re, sys, zipfile
import read_ready_data

R=pathlib.Path(__file__).parent;RUN=R.parent
def load(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
src={x['file_id']:x for x in load(RUN/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets'}
profiles=load(R/'CONTAINER_WORKBOOK_PROFILES.jsonl');rows=[];issues=[]
for p in profiles:
    fid=p['container_file_id'];member=p['member_path']
    with zipfile.ZipFile(src[fid]['input_path']) as outer:data=outer.read(member)
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        wbxml=package.read('xl/workbook.xml');declared=len(re.findall(br'<sheet\b',wbxml));strict=b'http://purl.oclc.org/ooxml/' in wbxml
    actual=len(p['sheets'])
    row={'file_id':fid,'member_path':member,'scope':'container_member','declared_sheet_count':declared,'reader_sheet_count':actual,'strict_ooxml':strict,'nonempty_sheet_count':sum(bool(s['first_20_nonempty_rows']) for s in p['sheets']),'formula_count':sum(s['formula_count'] for s in p['sheets']),'unit_or_quantity_cell_count':sum(len(s['unit_or_quantity_cells']) for s in p['sheets']),'status':'PASS' if declared==actual and actual>0 else 'FAIL'};rows.append(row)
    if row['status']=='FAIL':issues.append(row)
standalone=[x for x in src.values() if (x.get('representation') or '').upper()=='XLSX']
for o in standalone:
    path=pathlib.Path(o['input_path'])
    with zipfile.ZipFile(path) as package:
        wbxml=package.read('xl/workbook.xml');declared=len(re.findall(br'<sheet\b',wbxml));strict=b'http://purl.oclc.org/ooxml/' in wbxml
    actual_rows=read_ready_data.xlsx_structure(path);actual=len(actual_rows)
    row={'file_id':o['file_id'],'member_path':None,'scope':'standalone_file','declared_sheet_count':declared,'reader_sheet_count':actual,'strict_ooxml':strict,'nonempty_sheet_count':sum(bool(s['first_20_nonempty_rows']) for s in actual_rows),'formula_count':sum(s['formula_count'] for s in actual_rows),'unit_or_quantity_cell_count':sum(len(s['unit_or_quantity_cells']) for s in actual_rows),'status':'PASS' if declared==actual and actual>0 else 'FAIL'};rows.append(row)
    if row['status']=='FAIL':issues.append(row)
with (R/'WORKBOOK_PACKAGE_RECONCILIATION.jsonl').open('w',encoding='utf-8',newline='\n') as f:
    for row in rows:f.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+'\n')
strict_rows=[x for x in rows if x['strict_ooxml']]
result={'status':'PASS' if not issues else 'FAIL','checks':{'all_102_workbooks_covered':len(rows)==102,'declared_equals_reader_for_every_workbook':not issues,'all_have_at_least_one_sheet':all(x['reader_sheet_count']>0 for x in rows),'four_strict_container_members_read':sum(x['strict_ooxml'] and x['scope']=='container_member' for x in rows)==4},'counts':{'container_workbooks':len(profiles),'standalone_workbooks':len(standalone),'total_workbooks':len(rows),'declared_sheets':sum(x['declared_sheet_count'] for x in rows),'reader_sheets':sum(x['reader_sheet_count'] for x in rows),'strict_workbooks':len(strict_rows),'formulas':sum(x['formula_count'] for x in rows),'unit_or_quantity_cells':sum(x['unit_or_quantity_cell_count'] for x in rows)},'strict_rows':strict_rows,'issues':issues,'scope':'OOXML workbook.xml declared sheet count reconciled to the safe reader for all 91 container workbook members and all 11 standalone XLSX files; formulas and unit/quantity labels located without calculation.','not_checked':['Formula calculation','external link execution','scientific validity of workbook calculations'],'command':f'python -B {__file__}'}
(R/'WORKBOOK_PACKAGE_CHECKS.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False));sys.exit(0 if result['status']=='PASS' else 1)
