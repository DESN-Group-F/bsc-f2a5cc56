import json, subprocess, re
from pathlib import Path
import pdfplumber
from PIL import Image,ImageOps,ImageDraw

OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
HIST=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
SRC=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
POP=Path(r"C:\Users\S.W\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe")
VIS=OUT/'derived'/'visual_review'; VIS.mkdir(parents=True,exist_ok=True)

def rows(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
man=[]
for lane in [HIST/'documents67',HIST/'existing233'/'documents']:
 man+=rows(lane/'PROCESSING_MANIFEST.jsonl')
by={x['file_id']:x for x in man}
scope={x['file_id']:x for x in rows(HIST/'INPUT_SCOPE.jsonl')}
ids=['FILE-004-5f9d367d8b03-3c9822','FILE-005-fe1b9e40cf58-23b3da','FILE-022-7478c4afee07-e9fe8f','FILE-023-498cc96c406b-1255ea','FILE-036-fdcac43b50e7-5f27cc','FILE-044-1bca8cb22f8d-b07511','FILE-045-c175ae2c5171-f1c1e6','FILE-046-16285900cb1e-14339f','FILE-033-33a4e757c19d-602c0c','FILE-034-92cb3a2b7136-5d2d70','FILE-040-74c92ba472d0-881681']
records=[]; thumbs=[]
for fid in ids:
 m=by[fid]; src=SRC/scope[fid]['relative_path']
 cand=[]
 for p in [*Path(HIST/'documents67'/'derived').glob(fid+'*numeric*'),*Path(HIST/'existing233'/'documents'/'derived').glob(fid+'*numeric*')]:
  for x in rows(p):
   if x.get('page_number'): cand.append(int(x['page_number']))
 with pdfplumber.open(src) as pdf:
  pages=[]
  for p in [1]+cand:
   if 1<=p<=len(pdf.pages) and p not in pages: pages.append(p)
  pages=pages[:2]
  for pno in pages:
   page=pdf.pages[pno-1]; words=page.extract_words() or []; tables=page.extract_tables() or []
   bottom=[w for w in words if float(w.get('top',0))>=page.height*.78]
   rec={'file_id':fid,'source_id':m['source_id'],'page_number':pno,'page_count':len(pdf.pages),'word_count':len(words),'image_count':len(page.images),'detected_table_count':len(tables),'table_shapes':[[len(t),max([len(r) for r in t] or [0])] for t in tables],'bottom_region_word_count':len(bottom),'footnote_marker_candidates':sum(1 for w in bottom if re.fullmatch(r'(?:\*+|\d+|[a-z])',w.get('text',''),re.I)),'geometry_status':'LOCALLY_CHECKED_PAGE_GEOMETRY'}
   records.append(rec)
   prefix=VIS/(fid+'-p'+str(pno))
   subprocess.run([str(POP),'-f',str(pno),'-l',str(pno),'-r','110','-png','-singlefile',str(src),str(prefix)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
   im=Image.open(str(prefix)+'.png').convert('RGB'); im.thumbnail((480,620)); canvas=Image.new('RGB',(500,660),'white'); canvas.paste(im,((500-im.width)//2,25)); ImageDraw.Draw(canvas).text((10,635),fid+' p'+str(pno),fill='black'); thumbs.append(canvas)
cols=4; rowsn=(len(thumbs)+cols-1)//cols
sheet=Image.new('RGB',(cols*500,rowsn*660),(220,220,220))
for i,im in enumerate(thumbs): sheet.paste(im,((i%cols)*500,(i//cols)*660))
sheet.save(VIS/'contact_sheet.png')
with (OUT/'PDF_VISUAL_REVIEW.jsonl').open('w',encoding='utf-8') as f:
 for x in records:f.write(json.dumps(x)+'\n')
(OUT/'PDF_VISUAL_RUN.json').write_text(json.dumps({'pdfs':len(ids),'pages_rendered':len(records),'contact_sheet':str(VIS/'contact_sheet.png'),'scope':'First page plus first numeric-candidate page where distinct; not complete-page visual verification for all pages.'},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'pdfs':len(ids),'pages':len(records),'sheet':str(VIS/'contact_sheet.png')}))
