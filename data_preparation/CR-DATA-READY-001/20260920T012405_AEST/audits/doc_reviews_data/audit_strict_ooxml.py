import json,zipfile,io,importlib.util,xml.etree.ElementTree as ET
from pathlib import Path
B=Path(r'E:/desn 2000/bsc/data_preparation/CR-DATA-READY-001/20260920T012405_AEST');D=B/'datasets';O=B/'audits'/'doc_reviews_data'
def jl(p):return [json.loads(x) for x in open(p,encoding='utf8') if x.strip()]
src={x['file_id']:x for x in jl(B/'SOURCE_OBJECTS.jsonl')}; prof={(x['container_file_id'],x['member_path']):x for x in jl(D/'CONTAINER_WORKBOOK_PROFILES.jsonl')}; con=jl(D/'CONTAINER_WORKBOOK_CONTRACTS.jsonl');strict=json.loads((D/'WORKBOOK_PACKAGE_CHECKS.json').read_text())['strict_rows']
s=importlib.util.spec_from_file_location('rr',D/'read_ready_data.py');rr=importlib.util.module_from_spec(s);s.loader.exec_module(rr)
checks=[]
for x in strict:
 key=(x['file_id'],x['member_path']);
 with zipfile.ZipFile(src[x['file_id']]['input_path']) as oz:raw=oz.read(x['member_path'])
 with zipfile.ZipFile(io.BytesIO(raw)) as wz:
  root=ET.fromstring(wz.read('xl/workbook.xml'));decl=[e.attrib.get('name') for e in root.iter() if e.tag.endswith('}sheet')]
 got=rr.xlsx_structure_stream(io.BytesIO(raw)); pr=prof[key]['sheets']; cs=[q for q in con if (q['container_file_id'],q['member_path'])==key]
 checks.append({'file_id':x['file_id'],'member_path':x['member_path'],'declared_sheets':decl,'reader_sheets':[q['sheet'] for q in got],'profile_sheets':[q['sheet'] for q in pr],'contract_sheets':[q['sheet'] for q in cs],'all_nonempty':all(q['first_20_nonempty_rows'] for q in got),'strict_flag':all(q['strict_namespace_compatibility'] for q in got),'formula_count':sum(q['formula_count'] for q in got),'unit_cells':sum(len(q['unit_or_quantity_cells']) for q in got),'status':'PASS' if decl==[q['sheet'] for q in got]==[q['sheet'] for q in pr]==[q['sheet'] for q in cs] and all(q['first_20_nonempty_rows'] for q in got) and all(q['strict_namespace_compatibility'] for q in got) else 'FAIL'})
out={'checks':checks,'pass_count':sum(x['status']=='PASS' for x in checks),'fail_count':sum(x['status']=='FAIL' for x in checks)};(O/'STRICT_OOXML_RECHECK.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'pass':out['pass_count'],'fail':out['fail_count'],'formulas':sum(x['formula_count'] for x in checks),'unit_cells':sum(x['unit_cells'] for x in checks)}))
