import ast,json,re,subprocess,xml.etree.ElementTree as ET
from pathlib import Path
import pdfplumber
from PIL import Image,ImageDraw

OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
HIST=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
SRC=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
POP=Path(r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe")
VIS=OUT/'derived'/'key_page_review'; VIS.mkdir(parents=True,exist_ok=True)
def jl(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
scope={x['file_id']:x for x in jl(HIST/'INPUT_SCOPE.jsonl')}
q=[]
for lane in [HIST/'documents67',HIST/'existing233'/'documents']: q+=jl(lane/'QUALITY_FINDINGS.jsonl')
pending={x['file_id']:x for x in q if 'NEEDS_REVIEW' in x.get('quality_status','') and 'COPY_DISABLED' not in x.get('quality_status','')}
num={}
for root in [HIST/'documents67'/'derived',HIST/'existing233'/'documents'/'derived']:
 for p in root.glob('*numeric_unit_candidates.jsonl'):
  fid=p.name.split('.')[0]; num[fid]=jl(p)

page_checks=[]; rendered=[]
for fid in sorted(pending):
 path=SRC/scope[fid]['relative_path']; ext=path.suffix.lower()
 if ext!='.pdf': continue
 pages=sorted({int(x['page_number']) for x in num.get(fid,[]) if x.get('page_number')})
 with pdfplumber.open(path) as pdf:
  inspect=pages or [1]
  for pn in inspect:
   if not 1<=pn<=len(pdf.pages): continue
   pg=pdf.pages[pn-1]; words=pg.extract_words() or []; tables=pg.extract_tables() or []
   bottoms=[w for w in words if float(w.get('top',0))>=pg.height*.78]
   page_checks.append({'file_id':fid,'page_number':pn,'page_count':len(pdf.pages),'candidate_count':sum(int(x.get('page_number',0))==pn for x in num.get(fid,[])),'word_count':len(words),'image_count':len(pg.images),'table_count':len(tables),'table_shapes':[[len(t),max([len(r) for r in t] or [0])] for t in tables],'bottom_region_word_count':len(bottoms),'footnote_marker_candidates':sum(1 for w in bottoms if re.fullmatch(r'(?:\*+|\d+|[a-z])',w.get('text',''),re.I)),'check_scope':'ALL_PAGES_WITH_PRIOR_NUMERIC_UNIT_CANDIDATES' if pages else 'FIRST_PAGE_ROLE_CONFIRMATION_NO_PRIOR_NUMERIC_UNIT_CANDIDATES'})
   # Render every candidate page for operational/reference docs; research papers are role-only samples.
   source038=scope[fid].get('source_id')=='SRC-038'
   render=(not source038) and ((fid not in ['FILE-033-33a4e757c19d-602c0c','FILE-034-92cb3a2b7136-5d2d70']) or pn==inspect[0])
   if render:
    pre=VIS/(fid+'-p'+str(pn)); subprocess.run([str(POP),'-f',str(pn),'-l',str(pn),'-r','100','-png','-singlefile',str(path),str(pre)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    rendered.append({'file_id':fid,'page_number':pn,'path':str(pre)+'.png'})

# static-only checks for the three non-PDF reviews
struct=[]
for fid in ['FILE-028-deece5b1db57-95e105','FILE-039-2256f27ea98f-a3509d','FILE-039-864037d4f25b-66bed7']:
 p=SRC/scope[fid]['relative_path']
 if p.suffix.lower()=='.py':
  tree=ast.parse(p.read_text(encoding='utf-8',errors='replace'),filename=str(p)); assigns=[]
  for n in ast.walk(tree):
   if isinstance(n,(ast.Assign,ast.AnnAssign)):
    targets=n.targets if isinstance(n,ast.Assign) else [n.target]
    for t in targets:
     if isinstance(t,ast.Name): assigns.append({'name':t.id,'line':n.lineno,'literal_only':isinstance(getattr(n,'value',None),(ast.Constant,ast.List,ast.Tuple,ast.Dict,ast.Set))})
  struct.append({'file_id':fid,'kind':'python_static_ast','assignment_count':len(assigns),'literal_assignment_count':sum(x['literal_only'] for x in assigns),'assignment_locators':assigns[:500],'executed':False,'status':'STATIC_PARAMETER_DEFINITION_STRUCTURE_CHECKED'})
 else:
  root=ET.parse(p).getroot(); cells=root.findall('.//mxCell'); diagrams=root.findall('.//diagram')
  struct.append({'file_id':fid,'kind':'drawio_xml','diagram_count':len(diagrams),'cell_count':len(cells),'vertex_count':sum(x.get('vertex')=='1' for x in cells),'edge_count':sum(x.get('edge')=='1' for x in cells),'labeled_cell_count':sum(bool(re.sub('<[^>]+>','',x.get('value','')).strip()) for x in cells),'executed':False,'status':'STATIC_XML_GRAPH_STRUCTURE_CHECKED','limitation':'Visual routing and domain semantics were not validated; architecture reference only.'})

with (OUT/'KEY_PAGE_CHECKS.jsonl').open('w',encoding='utf-8') as f:
 for x in page_checks:f.write(json.dumps(x)+'\n')
with (OUT/'STATIC_STRUCTURE_REVIEWS.jsonl').open('w',encoding='utf-8') as f:
 for x in struct:f.write(json.dumps(x)+'\n')
with (OUT/'KEY_PAGE_RENDER_MANIFEST.jsonl').open('w',encoding='utf-8') as f:
 for x in rendered:f.write(json.dumps(x)+'\n')

# contact sheets, 16 pages each, for direct visual inspection.
for batch in range((len(rendered)+15)//16):
 items=rendered[batch*16:(batch+1)*16]; thumbs=[]
 for x in items:
  im=Image.open(x['path']).convert('RGB'); im.thumbnail((400,540)); c=Image.new('RGB',(420,580),'white'); c.paste(im,((420-im.width)//2,5)); ImageDraw.Draw(c).text((5,558),x['file_id']+' p'+str(x['page_number']),fill='black'); thumbs.append(c)
 sheet=Image.new('RGB',(1680,((len(thumbs)+3)//4)*580),(220,220,220))
 for i,im in enumerate(thumbs):sheet.paste(im,((i%4)*420,(i//4)*580))
 sheet.save(VIS/('contact_'+str(batch+1)+'.png'))
(OUT/'PENDING_REVIEW_RUN.json').write_text(json.dumps({'pending_non_copy_objects':len(pending),'pdf_objects':sum((SRC/scope[x]['relative_path']).suffix.lower()=='.pdf' for x in pending),'candidate_pages_checked':len(page_checks),'pages_rendered':len(rendered),'static_objects_checked':len(struct),'contact_sheets':(len(rendered)+15)//16},indent=2)+'\n',encoding='utf-8')
print((OUT/'PENDING_REVIEW_RUN.json').read_text())
