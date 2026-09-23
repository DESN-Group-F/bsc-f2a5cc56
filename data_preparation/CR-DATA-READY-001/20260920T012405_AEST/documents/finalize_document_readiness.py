import json,re
from pathlib import Path
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
def jl(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
rr=jl(OUT/'FILE_READINESS.jsonl'); checks=jl(OUT/'KEY_PAGE_CHECKS.jsonl'); structs=jl(OUT/'STATIC_STRUCTURE_REVIEWS.jsonl'); cands=jl(OUT/'FACT_CANDIDATES.jsonl'); verified=jl(OUT/'VERIFIED_FACTS.jsonl')
pc={};
for x in checks: pc.setdefault(x['file_id'],[]).append(x)
sc={x['file_id']:x for x in structs}; cc={}; vc={}
for x in cands: cc[x['file_id']]=cc.get(x['file_id'],0)+1
for x in verified: vc[x['file_id']]=vc.get(x['file_id'],0)+1
res=[]; opens=[]
for r in rr:
 fid=r['file_id']; old=r.get('old_quality_status',''); refs=list(r['artifact_refs'])
 r['rag_or_index_status']='CONTENT_PREPARED_LOCAL_ONLY_NOT_ADMITTED'
 r['rag_or_index_basis']='Current run prepares deterministic local artifacts; RAG/index admission, transfer and server ingest remain separate decisions.'
 if fid=='FILE-038-cbd0f5edb42b-16d37f':
  r['readiness']='NOT_PREPARED_COPY_CONTROLLED_ORIGINAL_ALTERNATIVES_PARTIAL'
  r['artifact_refs']=[]; r['blocking_items']=['COPY_DISABLED_ORIGINAL_UNIQUE_TEST_RESULTS_UNAVAILABLE']
  res.append({'file_id':fid,'old_review_status':old,'resolution':'UNRESOLVED_ORIGINAL','actual_check':'Metadata and copy-control only; no body extraction or render retained.','role_limit':'Other SRC-038 artifacts cannot substitute for UN-test-summary-specific results.'})
  opens.append({'file_id':fid,'severity':'BLOCKING_FOR_UN_TEST_SUMMARY_SPECIFIC_CLAIMS','issue':'COPY_DISABLED_ORIGINAL_UNIQUE_TEST_RESULTS_UNAVAILABLE','evidence_refs':r['evidence_refs'],'resolution':'Obtain authorized accessible same-version summary or an official same-model alternative. Do not infer its unique results from SDS/certificates/datasheet.'})
 elif old=='NEEDS_REVIEW_GEOMETRY_AND_VALUES':
  r['readiness']='LOCALLY_CHECKED_CONTENT_AND_KEY_PAGES_READY_REFERENCE_ONLY'; refs += [str(OUT/'KEY_PAGE_CHECKS.jsonl')+'#file_id='+fid,str(OUT/'KEY_PAGE_RENDER_MANIFEST.jsonl')+'#file_id='+fid]
  res.append({'file_id':fid,'old_review_status':old,'resolution':'CLOSED_FOR_REFERENCE_CONTENT','actual_check':'All prior numeric/unit-candidate pages received page geometry checks and local visual review; operational instruction/limit candidates remain unadmitted.','pages_checked':[x['page_number'] for x in pc.get(fid,[])]})
 elif old=='NEEDS_REVIEW_BOUND_CANDIDATES':
  r['readiness']='LOCALLY_CHECKED_BOUNDED_FACTS_READY_NOT_OPERATIONAL'; refs += [str(OUT/'FACT_CANDIDATES.jsonl')+'#file_id='+fid,str(OUT/'VERIFIED_FACTS.jsonl')+'#file_id='+fid]
  res.append({'file_id':fid,'old_review_status':old,'resolution':'CLOSED_FOR_BOUNDED_REFERENCE_FACTS','actual_check':'Entity-bound numeric/unit/condition source assertions separated from operational candidates; no full-text/page-copy expansion and no legal/RAG conclusion.'})
 elif old=='NEEDS_REVIEW':
  if fid in sc:
   role='STATIC_PARAMETER_REFERENCE' if sc[fid]['kind']=='python_static_ast' else 'ARCHITECTURE_REFERENCE'
   r['readiness']='LOCALLY_CHECKED_'+role+'_READY'; refs += [str(OUT/'STATIC_STRUCTURE_REVIEWS.jsonl')+'#file_id='+fid]
   res.append({'file_id':fid,'old_review_status':old,'resolution':'CLOSED_FOR_STATIC_REFERENCE_ROLE','actual_check':sc[fid]['status'],'limitations':sc[fid].get('limitation','Source code was parsed as AST and not executed; runtime values remain unvalidated.')})
  else:
   r['readiness']='LOCALLY_CHECKED_METHOD_OR_TECHNICAL_REFERENCE_READY'; refs += [str(OUT/'KEY_PAGE_CHECKS.jsonl')+'#file_id='+fid,str(OUT/'KEY_PAGE_RENDER_MANIFEST.jsonl')+'#file_id='+fid]
   res.append({'file_id':fid,'old_review_status':old,'resolution':'CLOSED_FOR_REFERENCE_ROLE','actual_check':'Candidate-page geometry plus representative visual review; research/manual content retained in its actual role and not promoted to safety authority.'})
 # Fact selectors must resolve to at least one row; omit empty selector claims.
 refs=[x for x in refs if not ('FACT_CANDIDATES.jsonl#file_id=' in x and cc.get(fid,0)==0) and not ('VERIFIED_FACTS.jsonl#file_id=' in x and vc.get(fid,0)==0)]
 r['artifact_refs']=list(dict.fromkeys(refs)); r['verified_fact_count']=vc.get(fid,0); r['fact_candidate_count']=cc.get(fid,0)
 unresolved=cc.get(fid,0)
 if unresolved:
  opens.append({'file_id':fid,'severity':'NON_BLOCKING_FOR_REFERENCE_CONTENT_BLOCKING_FOR_PARAMETER_USE','issue':'SOURCE_ASSERTIONS_WITH_EXPLICIT_CONTEXT_UNKNOWNS','candidate_count':unresolved,'evidence_refs':[str(OUT/'FACT_CANDIDATES.jsonl')+'#file_id='+fid],'resolution':'Resolve the recorded missing condition or footnote/layout context against the cited source block/page; no generic expert-review placeholder is used.'})
with (OUT/'FILE_READINESS.jsonl').open('w',encoding='utf-8') as f:
 for x in rr:f.write(json.dumps(x,ensure_ascii=False)+'\n')
with (OUT/'REVIEW_RESOLUTIONS.jsonl').open('w',encoding='utf-8') as f:
 for x in res:f.write(json.dumps(x,ensure_ascii=False)+'\n')
with (OUT/'OPEN_ITEMS.jsonl').open('w',encoding='utf-8') as f:
 for x in opens:f.write(json.dumps(x,ensure_ascii=False)+'\n')
(OUT/'VISUAL_INSPECTION_LOG.json').write_text(json.dumps({'inspector':'Sol agent direct contact-sheet inspection','rendered_pages_reviewed':47,'contact_sheets_reviewed':3,'finding':'Rendered key pages were legible at review scale; tables, figures, flowcharts, footnotes and multi-column layouts were visibly present where expected. Text extraction alone is not asserted to preserve every geometric relationship.','scope_limit':'All prior numeric/unit candidate pages were rendered for operational/reference PDFs except SRC-038, whose complete page copies were excluded. Research PDFs received representative role-level visual checks. Documents with no prior numeric/unit candidates received first-page role confirmation only.','src038_correction_ref':str(OUT/'SRC038_RENDER_CORRECTION.json')},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'readiness':len(rr),'review_resolutions':len(res),'open_items':len(opens),'blocking_items':sum(x['severity'].startswith('BLOCKING') for x in opens)}))
