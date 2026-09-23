import json,hashlib,re
from pathlib import Path
from pypdf import PdfReader

IN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\public_supplements")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
DER=OUT/'derived'/'supplements'; DER.mkdir(parents=True,exist_ok=True)
manifest=[]; index=[]
for p in sorted(IN.iterdir()):
 if not p.is_file(): continue
 sha=hashlib.sha256(p.read_bytes()).hexdigest()
 rec={'supplement_id':'SUP-'+p.stem,'input_path':str(p),'input_sha256':sha,'artifact_refs':[],'limitations':[]}
 if p.suffix.lower()=='.pdf':
  reader=PdfReader(p); op=DER/(p.stem+'.pages.jsonl'); matches=[]; chars=0
  with op.open('w',encoding='utf-8') as f:
   for n,page in enumerate(reader.pages,1):
    text=page.extract_text() or ''; chars+=len(text)
    row={'supplement_id':rec['supplement_id'],'page_number':n,'text':text,'text_character_count':len(text)}
    f.write(json.dumps(row,ensure_ascii=False)+'\n')
    low=text.lower()
    if any(k in low for k in ['lithium','battery','volt','ampere','measurement uncertainty','international system of units']):
     matches.append(n); index.append({'supplement_id':rec['supplement_id'],'locator':'page:'+str(n),'artifact_ref':str(op)+'#page_number='+str(n),'matched_topics':[k for k in ['lithium','battery','volt','ampere','measurement uncertainty','international system of units'] if k in low]})
  rec.update({'readiness':'LOCALLY_CHECKED_PAGE_TEXT_READY','page_count':len(reader.pages),'text_character_count':chars,'matched_page_count':len(matches),'artifact_refs':[str(op)],'limitations':['Page text is prepared; original visual layout, equations and table geometry require page-level inspection before layout-dependent use.']})
 else:
  data=json.loads(p.read_text(encoding='utf-8')); op=DER/p.name; op.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  rec.update({'readiness':'LOCALLY_CHECKED_STRUCTURED_REFERENCE_READY','artifact_refs':[str(op)],'top_level_type':type(data).__name__,'limitations':['Semantic applicability remains limited to the scope stated in the structured source.']})
 manifest.append(rec)
with (OUT/'SUPPLEMENT_READINESS.jsonl').open('w',encoding='utf-8') as f:
 for x in manifest:f.write(json.dumps(x,ensure_ascii=False)+'\n')
with (OUT/'SUPPLEMENT_CONTENT_INDEX.jsonl').open('w',encoding='utf-8') as f:
 for x in index:f.write(json.dumps(x,ensure_ascii=False)+'\n')
(OUT/'SUPPLEMENT_RUN.json').write_text(json.dumps({'supplements':len(manifest),'pdfs':sum(x.get('page_count',0)>0 for x in manifest),'total_pdf_pages':sum(x.get('page_count',0) for x in manifest),'topic_locator_rows':len(index)},indent=2)+'\n',encoding='utf-8')
print((OUT/'SUPPLEMENT_RUN.json').read_text())
