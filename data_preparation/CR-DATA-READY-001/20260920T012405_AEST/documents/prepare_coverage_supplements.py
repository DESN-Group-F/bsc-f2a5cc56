import json,hashlib,re
from html.parser import HTMLParser
from pathlib import Path
from pypdf import PdfReader
BASE=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
IN=BASE/'coverage'/'suppl'; OUT=BASE/'documents'; DER=OUT/'derived'/'coverage_supplements'; DER.mkdir(parents=True,exist_ok=True)
def jl(p):return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
class Text(HTMLParser):
 def __init__(self):super().__init__();self.skip=0;self.parts=[];self.tag=''
 def handle_starttag(self,t,a):self.tag=t;self.skip+=t in ('script','style','svg')
 def handle_endtag(self,t):self.skip-=t in ('script','style','svg')
 def handle_data(self,d):
  if not self.skip and d.strip():self.parts.append((self.tag,' '.join(d.split())))
old=[x for x in jl(OUT/'SUPPLEMENT_READINESS.jsonl') if not x['supplement_id'].startswith('SUP-COVER-')]; added=[]
for p in sorted(IN.iterdir()):
 if not p.is_file():continue
 sid='SUP-COVER-'+p.stem; sha=hashlib.sha256(p.read_bytes()).hexdigest(); refs=[]
 base={'supplement_id':sid,'input_path':str(p),'input_sha256':sha,'source_use_evidence':str(BASE/'coverage'/'SUPPLEMENT_MANIFEST.jsonl')+'#local_path='+str(p),'limitations':[]}
 if p.suffix.lower()=='.html':
  h=Text();h.feed(p.read_text(encoding='utf-8',errors='replace')); op=DER/(p.stem+'.locators.jsonl'); n=0
  with op.open('w',encoding='utf-8') as f:
   for i,(tag,text) in enumerate(h.parts,1):
    if tag in ('h1','h2','h3','h4','p','li') and any(k in text.lower() for k in ['heat','capacity','temperature','energy','battery','measurement','uncertainty','joule','kelvin']):
     n+=1; f.write(json.dumps({'supplement_id':sid,'locator':'html_text_node:'+str(i),'tag':tag,'text':text},ensure_ascii=False)+'\n')
  openstax=p.name.startswith('OPENSTAX')
  base.update({'readiness':'HUMAN_REFERENCE_LOCATORS_ONLY_NOT_LLM_OR_RAG' if openstax else 'LOCALLY_CHECKED_REFERENCE_LOCATORS','artifact_refs':[str(op)],'locator_count':n,'rag_or_index_status':'PROHIBITED_BY_EXPLICIT_SOURCE_TERM' if openstax else 'NOT_ADMITTED','limitations':['OpenStax page contains an explicit restriction against unlicensed LLM/generative-AI ingestion; locators are retained for human reference only.'] if openstax else ['NASA attribution and any third-party material restrictions remain attached; no redistribution or RAG permission is inferred.']})
 elif p.suffix.lower()=='.pdf':
  rd=PdfReader(p); op=DER/(p.stem+'.pages.jsonl')
  with op.open('w',encoding='utf-8') as f:
   for n,pg in enumerate(rd.pages,1):f.write(json.dumps({'supplement_id':sid,'page_number':n,'text':pg.extract_text() or ''},ensure_ascii=False)+'\n')
  lim=['NIST/DOE attribution and source notices remain attached; third-party material, if any, is not relicensed. Layout-dependent use requires original-page review.']
  if 'DOE_HDBK_1011_92' in p.name:lim.append('DOE-HDBK-1011-92 is cancelled/archived historical foundational material; it is not a current operating standard.')
  base.update({'readiness':'LOCALLY_CHECKED_PAGE_TEXT_READY','artifact_refs':[str(op)],'page_count':len(rd.pages),'rag_or_index_status':'NOT_ADMITTED','distribution_note':'Distribution A' if p.name.startswith('DOE_') else None,'limitations':lim})
 else:
  op=DER/p.name; op.write_bytes(p.read_bytes()); count=len(jl(p)) if p.suffix.lower()=='.jsonl' else 1
  page_companion='_PAGES' in p.stem
  ids=[]
  if p.suffix.lower()=='.jsonl':
   for x in jl(p):
    for k in ('fact_id','evidence_id','id'):
     if x.get(k):ids.append(x[k]);break
  base.update({'readiness':'LOCALLY_CHECKED_DERIVED_PAGE_COMPANION' if page_companion else 'LOCALLY_CHECKED_STRUCTURED_FACT_PACKAGE','artifact_refs':[str(op)],'record_count':count,'logical_record_ids':ids,'rag_or_index_status':'NOT_ADMITTED','limitations':['Derived page/fact package retains its cited-source and use limitations; it is not an independent authority.']})
 added.append(base)
with (OUT/'SUPPLEMENT_READINESS.jsonl').open('w',encoding='utf-8') as f:
 for x in old+added:f.write(json.dumps(x,ensure_ascii=False)+'\n')
(OUT/'COVERAGE_SUPPLEMENT_RUN.json').write_text(json.dumps({'new_physical_files':len(added),'total_physical_supplement_files':len(old)+len(added),'openstax_human_only':sum(x['readiness'].startswith('HUMAN') for x in added),'new_records':[{k:x.get(k) for k in ['supplement_id','readiness','locator_count','page_count','record_count']} for x in added]},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'added':len(added),'total':len(old)+len(added)}))
