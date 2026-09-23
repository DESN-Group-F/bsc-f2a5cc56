import json, re, shutil
from pathlib import Path

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
OUT=RUN/'documents'; DER=OUT/'derived'; DER.mkdir(parents=True,exist_ok=True)
HIST=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
SRC=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3")
lanes=[HIST/'documents67',HIST/'existing233'/'documents']

def rows(p):
 return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
man=[]; q={}
for lane in lanes:
 man += rows(lane/'PROCESSING_MANIFEST.jsonl')
 q.update({x['file_id']:x for x in rows(lane/'QUALITY_FINDINGS.jsonl')})
assert len(man)==70 and len({x['file_id'] for x in man})==70
scope={x['file_id']:x for x in rows(HIST/'INPUT_SCOPE.jsonl')}

UNIT=re.compile(r'(?i)(?<!\w)(?:[-+]?\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*[-+]?\d+(?:\.\d+)?)?)\s*(?:°?C|K|V|mV|A|mA|Ah|mAh|Wh|kWh|W|kW|Hz|kHz|Ω|ohm|%|mm|cm|m|kg|g|h|hr|hours?|min|minutes?|s|seconds?|kPa|MPa|psi)(?!\w)')
COND=re.compile(r'(?i)\b(?:at|under|when|where|if|unless|between|from|to|maximum|minimum|nominal|typical|recommended|shall|must|do not|avoid|limit|temperature|voltage|current|capacity|charge|discharge|storage|transport|test)\b')
FOOT=re.compile(r'(?i)(?:\bnote\b|\bfootnote\b|\*|†|\[[a-z0-9]+\])')

def best_content(m):
 fid=m['file_id']; outs=[Path(x) for x in m.get('derived_outputs',[])]; candidates=[]
 for p in outs:
  if p.exists() and any(z in p.name for z in ['pages.jsonl','pages_text_no_images.jsonl','segments.jsonl']): candidates.append(p)
 if candidates:
  p=candidates[0]; rr=rows(p); out=[]
  for i,r in enumerate(rr,1):
   t=(r.get('text') or '').strip()
   if t: out.append({'locator':('page:'+str(r.get('page_number'))) if r.get('page_number') else 'segment:'+str(r.get('segment_index',i)),'kind':r.get('kind','page_text'),'text':t})
  return out,str(p),'REUSED_BOUND_EXTRACTION'
 rp=(m.get('profile') or {}).get('reused_extraction_path')
 if rp and Path(rp).exists():
  text=Path(rp).read_text(encoding='utf-8',errors='replace')
  parts=[x.strip() for x in re.split(r'\n\s*\n|(?=^#{1,6}\s)',text,flags=re.M) if x.strip()]
  return [{'locator':'paragraph:'+str(i),'kind':'paragraph','text':t} for i,t in enumerate(parts,1)],rp,'REUSED_BOUND_EXTRACTION'
 # bounded manufacturer records intentionally retain facts/rules, not a full-text copy
 for p in outs:
  if p.exists() and ('fact_candidates' in p.name or 'rule_candidates' in p.name):
   for r in rows(p):
    t=(r.get('text') or r.get('literal') or r.get('line_text') or r.get('context') or '').strip()
    if t: candidates.append((p,r,t))
 if candidates and isinstance(candidates[0],tuple):
  out=[]
  for i,(p,r,t) in enumerate(candidates,1): out.append({'locator':'page:'+str(r.get('page_number','unknown'))+'/candidate:'+str(i),'kind':'bounded_fact_or_rule','text':t})
  return out,';'.join(sorted({str(x[0]) for x in candidates})),'BOUNDED_FACT_EXTRACTION'
 return [],None,'NO_READABLE_CONTENT_ARTIFACT'

readiness=[]; index=[]; fact_candidates=[]; facts=[]; opens=[]
for m in sorted(man,key=lambda x:x['file_id']):
 fid=m['file_id']; content,basis,method=best_content(m); oldq=q.get(fid,{})
 outp=DER/(fid+'.content.jsonl')
 if content:
  with outp.open('w',encoding='utf-8') as f:
   for c in content:
    rec={'file_id':fid,'source_id':m['source_id'],**c,'source_binding':basis,'content_class':'SOURCE_TEXT_LOCAL_ONLY'}
    f.write(json.dumps(rec,ensure_ascii=False)+'\n'); index.append({**{k:rec[k] for k in ['file_id','source_id','locator','kind','source_binding']},'artifact_ref':str(outp)+'#file_id='+fid+'&locator='+rec['locator']})
 # Facts require a unit-bearing literal and a condition/applicability cue in the same local block.
 nfact=0
 for c in content:
  for si,s in enumerate(re.split(r'(?<=[.!?])\s+|\n+',c['text']),1):
   ums=UNIT.findall(s)
   if not ums or not COND.search(s): continue
   s=' '.join(s.split())
   if len(s)>900 or len(s)<12: continue
   nfact+=1
   fact={'fact_id':fid+'-F'+str(nfact).zfill(4),'file_id':fid,'source_id':m['source_id'],'locator':c['locator']+'/sentence:'+str(si),'source_literal':s,'numeric_unit_literals':ums,'condition_present_same_context':True,'applicable_entity':m.get('document_family_id') or m['source_id'],'entity_basis':'document_family_binding','footnote_or_note_cue':bool(FOOT.search(s)),'verification_status':'LOCALLY_CHECKED_SOURCE_BINDING','use_status':'REFERENCE_FACT_REQUIRES_CASE_APPLICABILITY_CHECK','limitations':['Literal, unit and condition co-located; scientific applicability/currentness is limited by the source record and is not target-site approval.']}
   fact_candidates.append(fact)
   # Operational instructions and limits remain candidates pending expert/context review.
   if not re.search(r'(?i)\b(?:shall|must|do not|avoid|maximum|minimum|limit|never|prohibited|required)\b',s):
    facts.append({**fact,'verification_status':'VERIFIED_DESCRIPTIVE_SOURCE_ASSERTION','parameter_admission':'NOT_ADMITTED_AS_OPERATIONAL_THRESHOLD'})
 is_copy=fid=='FILE-038-cbd0f5edb42b-16d37f'
 if is_copy:
  alt=[x['file_id'] for x in man if x['source_id']=='SRC-038' and x['file_id']!=fid]
  readiness_status='SUBSTITUTED_PARTIAL_COPY_CONTROL_PRESERVED'; arts=[]
  limitations=['Encrypted PDF permits printing but disables copying; no正文 extraction or control bypass was performed.','Same-source product page/datasheet/certificates provide partial alternative evidence but do not establish that this UN test-summary original was processed.']
  opens.append({'file_id':fid,'issue':'COPY_DISABLED_ORIGINAL_NOT_TEXT_PREPARED','blocking_for':'claims unique to the UN test summary','available_alternatives':alt,'resolution':'Obtain an authorized accessible copy or verify required claims against an independent official source.'})
 elif content:
  readiness_status='LOCALLY_CHECKED_CONTENT_READY' if oldq.get('quality_status') not in ['NEEDS_REVIEW_GEOMETRY_AND_VALUES','NEEDS_REVIEW'] else 'CONTENT_READY_VISUAL_OR_SEMANTIC_REVIEW_PENDING'
  arts=[str(outp)]
  limitations=list(m.get('limitations',[]))
 else:
  readiness_status='PREPARATION_FAILED_NO_CONTENT'; arts=[]; limitations=['No readable bound extraction was found.']
  opens.append({'file_id':fid,'issue':'NO_READABLE_CONTENT_ARTIFACT','blocking_for':'document content use','resolution':'Create an authorized bound extraction.'})
 sc=scope[fid]; ip=SRC/sc['relative_path']; sha=sc.get('sha256_registered') or m.get('registered_sha256') or (m.get('document_version_id') or '').removeprefix('sha256-')
 basis_refs=basis.split(';') if basis else []
 readiness.append({'file_id':fid,'source_id':m['source_id'],'input_path':str(ip),'input_sha256':sha,'role':m.get('semantic_role'),'readiness':readiness_status,'artifact_refs':arts,'evidence_refs':[x for x in basis_refs+[m.get('decision_ref') or m.get('local_action_decision_ref')] if x],'content_method':method,'content_locator_count':len(content),'verified_fact_count':sum(1 for x in facts if x['file_id']==fid),'fact_candidate_count':nfact,'old_quality_status':oldq.get('quality_status'),'requirement_support':m.get('requirement_support'),'limitations':limitations,'blocking_items':['COPY_DISABLED_ORIGINAL'] if is_copy else ([] if content else ['NO_CONTENT'])})

def dumpj(name,obj): (OUT/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def dumpjl(name,obj):
 with (OUT/name).open('w',encoding='utf-8') as f:
  for x in obj:f.write(json.dumps(x,ensure_ascii=False)+'\n')
dumpjl('FILE_READINESS.jsonl',readiness); dumpjl('CONTENT_INDEX.jsonl',index); dumpjl('FACT_CANDIDATES.jsonl',fact_candidates); dumpjl('VERIFIED_FACTS.jsonl',facts); dumpjl('OPEN_ITEMS.jsonl',opens)
dumpj('PREPARATION_RUN.json',{'objects':len(readiness),'content_ready_or_partial':sum(x['readiness']!='PREPARATION_FAILED_NO_CONTENT' for x in readiness),'content_index_rows':len(index),'fact_candidate_rows':len(fact_candidates),'verified_descriptive_fact_rows':len(facts),'copy_control_exceptions':sum('COPY_DISABLED_ORIGINAL' in x['blocking_items'] for x in readiness)})
print(json.dumps(json.loads((OUT/'PREPARATION_RUN.json').read_text(encoding='utf-8'))))
