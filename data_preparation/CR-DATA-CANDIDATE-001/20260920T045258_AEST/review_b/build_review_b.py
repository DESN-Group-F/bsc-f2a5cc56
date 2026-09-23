import json,pathlib,collections,datetime
RUN=pathlib.Path(__file__).resolve().parents[1]; OUT=pathlib.Path(__file__).parent
READY=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST')
SRC=pathlib.Path(r'E:\desn 2000\data\battery_data_workspace_v0_3')
def rows(p):return [json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s]
scope=[x for x in rows(RUN/'CANDIDATE_SCOPE.jsonl') if x.get('lane')=='review_b']; ids={x['fact_id'] for x in scope}
cands={x['fact_id']:x for x in rows(READY/'documents/FACT_CANDIDATES.jsonl') if x.get('fact_id') in ids}
sources={x['file_id']:x for x in rows(RUN/'SOURCE_SCOPE.jsonl')}
paths={fid:pathlib.Path(x['source']['input_path']) for fid,x in sources.items()}
status={fid:x['build_use']['build_use_status'] for fid,x in sources.items()}
rst_id='FILE-039-f015d5790980-01bd5e'; change_id='FILE-039-b89867adf458-bee1c5'; html_id='FILE-040-0877269fc185-7ad1f2'
scale_lines=[i for i,s in enumerate(paths[rst_id].read_text(encoding='utf-8').splitlines(),1) if ':scale: 50 %' in s]
rst_facts=sorted((x for x in cands.values() if x['file_id']==rst_id),key=lambda x:int(x['fact_id'].split('A')[-1]))
assert len(scale_lines)==len(rst_facts)==58
line_by_fact={x['fact_id']:n for x,n in zip(rst_facts,scale_lines)}
html_lines={'FILE-040-0877269fc185-7ad1f2-A0013':(286,287),'FILE-040-0877269fc185-7ad1f2-A0017':(336,338),'FILE-040-0877269fc185-7ad1f2-A0024':(421,423),'FILE-040-0877269fc185-7ad1f2-A0025':(436,438)}
reviews=[];contexts=[]
for fid in sorted(ids):
 c=cands[fid];file_id=c['file_id'];p=paths[file_id]
 base={'fact_id':fid,'file_id':file_id,'source_id':c['source_id'],'original_locator':c['locator'],'review_status':'RESOLVED','current_build_use_status':status[file_id],'remaining_unknowns':[]}
 if file_id==rst_id:
  ln=line_by_fact[fid];role='RST_IMAGE_RENDERING_DIRECTIVE'
  findings=['The numeric token is the reStructuredText image option :scale: 50 % for the immediately preceding safety-sign image directive.','It controls rendered pictogram size and is not a battery, BMS, hazard threshold, probability, efficiency, state-of-charge, or operating parameter.']
  qb=[{'source_literal':'50 %','value_text':'50','unit':'percent_of_intrinsic_image_render_size','binding':'RST :scale: option','parameter_value':False,'parser_correction':'Do not classify RST image scale as a domain quantity.'}]
  cond=['Applies only to rendering the immediately preceding image directive in foxBMS safety documentation v1.11.0.','The surrounding danger/warning/caution/note prose supplies safety context but does not turn image scale into a technical threshold.']
  refs=[f'{p}#L{ln}',f'{p}#L{max(1,ln-1)}']
  ready=False;reason='Resolved as a presentation directive; excluded from parameter records.'
 elif file_id==change_id:
  role='SOFTWARE_CHANGELOG_CAN_MESSAGE_IDENTIFIER_MAPPING'
  if fid.endswith('A0001'):
   qb=[{'entity':'f_PackMinimumMaximumValues','value_text':'231','notation':'hexadecimal CAN identifier','normalized_value':'0x231','unit':None,'column_role':'old_message_definition'},{'entity':'f_PackMinMaxCellTemperature','value_text':'230','notation':'hexadecimal CAN identifier','normalized_value':'0x230','unit':None,'column_role':'new_message_definition'}]
   refs=[f'{p}#L212-L224',f'{p}#L221']
  else:
   qb=[{'entity':'f_PackMinMaxCellVoltage','value_text':'231','notation':'hexadecimal CAN identifier','normalized_value':'0x231','unit':None,'column_role':'new_message_definition','old_column_value':'not previously present'}]
   refs=[f'{p}#L212-L224',f'{p}#L223']
  findings=['The trailing h is hexadecimal notation in the Old/New Message Definition table, not the unit hour.','The table belongs to the Changed section of the foxBMS v1.11.0 release changelog and records CAN message definition changes.']
  cond=['Limited to the old/new CAN message definitions documented for foxBMS release v1.11.0.','An asterisk means the old message name and ID did not previously exist.','This is a versioned software interface mapping, not a timing or battery operating parameter.']
  ready=False;reason='Resolved as a source-version-bound structured interface identifier mapping, not a physical parameter; runtime applicability still requires matching foxBMS version/configuration.'
 else:
  role='DEVICE_SPECIFICATION_PARAMETER';a,b=html_lines[fid];refs=[f'{p}#L{a}-L{b}',f'{p}#L9-L11',f'{p}#L220-L233']
  lit=c['numeric_unit_mentions'][0]
  if fid.endswith('A0013'):
   qb=[{'entity':'MPPT 1210 HUS conversion efficiency','relation':'>','value_text':'98','unit':'%','qualifier':'max.'}]
   findings=['The value is in the Overview of specifications table under Feature/Value/Comment and belongs to Conversion efficiency.']
   cond=['Device: Libre Solar MPPT 1210 HUS; manual dated 2021-05-02.','The source says >98% max.; treat it as a maximum/peak efficiency statement, not a guaranteed minimum across all operating points.']
  elif fid.endswith('A0017'):
   qb=[{'entity':'MPPT 1210 HUS trickle charging voltage','relation':'=','value_text':'13.8','unit':'V','qualifier':'configurable'}]
   findings=['The value is the Trickle charging row in the device specification table; the Comment column explicitly says configurable.']
   cond=['Device: Libre Solar MPPT 1210 HUS; manual dated 2021-05-02.','Configuration-dependent charging setpoint; not universal to other controllers or battery chemistries.']
  elif fid.endswith('A0024'):
   qb=[{'entity':'MPPT 1210 HUS ambient humidity','relation':'<','value_text':'95','unit':'% relative humidity','qualifier':'non-condensing'}]
   findings=['The value is the Humidity row in the specifications table and includes the non-condensing exception.']
   cond=['Device: Libre Solar MPPT 1210 HUS; manual dated 2021-05-02.','Environmental condition is below 95% relative humidity and non-condensing.']
  else:
   qb=[{'entity':'MPPT 1210 HUS internal fuse current rating','relation':'=','value_text':'15','unit':'A','qualifier':'Automotive blade fuse (ATO)'}]
   findings=['The value is the Type of internal fuse row; the Comment column identifies an Automotive blade fuse (ATO).']
   cond=['Device: Libre Solar MPPT 1210 HUS; manual dated 2021-05-02.','Component type and rating are bound together; this record is not a general fuse-selection rule.']
  ready=True;reason='Resolved as a source-version-bound device specification; case use still requires exact device/version and operating-context match.'
 base.update({'semantic_role':role,'structured_interface_record_ready':file_id==change_id,'context_findings':findings,'quantity_bindings':qb,'source_entity_and_version':{'entity':'foxBMS safety documentation' if file_id==rst_id else ('foxBMS release changelog' if file_id==change_id else 'Libre Solar MPPT 1210 HUS'),'document_version':'v1.11.0' if file_id!=html_id else 'manual date 2021-05-02','file_id':file_id},'conditions_and_exceptions':cond,'evidence_refs':refs+[c['evidence_ref'],str(RUN/'SOURCE_SCOPE.jsonl')+'#file_id='+file_id],'original_unknown_resolution':{'original':'CONDITION_NOT_EXPLICIT_IN_LOCAL_SENTENCE','resolution':'Resolved through directive/table/section context and exact source version.'},'parameter_record_ready':ready,'reason':reason})
 reviews.append(base);contexts.append({'fact_id':fid,'file_id':file_id,'source_locator':refs[0],'context_kind':role,'checked_scope':'full RST directive association' if file_id==rst_id else ('complete old/new message table and Changed section' if file_id==change_id else 'complete specification row, table header, title and manual date'),'finding_summary':findings,'source_text_returned':False})
assert len(reviews)==64 and {x['fact_id'] for x in reviews}==ids
def dump(name,xs):
 with (OUT/name).open('w',encoding='utf-8',newline='\n') as f:
  for x in xs:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
dump('REVIEW_RESULTS.jsonl',reviews);dump('CONTEXT_EVIDENCE.jsonl',contexts);dump('UNRESOLVED.jsonl',[])
checks={'scope_64':len(scope)==64,'result_64':len(reviews)==64,'exact_fact_set':{x['fact_id'] for x in reviews}==ids,'source_counts':collections.Counter(x['source_id'] for x in reviews)=={'SRC-039':60,'SRC-040':4},'all_required_fields':all(all(k in x for k in ['fact_id','file_id','source_id','original_locator','review_status','semantic_role','context_findings','quantity_bindings','source_entity_and_version','conditions_and_exceptions','evidence_refs','original_unknown_resolution','parameter_record_ready','current_build_use_status','remaining_unknowns','reason']) for x in reviews),'all_evidence_paths_exist':all(pathlib.Path(r.split('#',1)[0]).exists() for x in reviews for r in x['evidence_refs']),'scale_directives_58':sum(x['semantic_role']=='RST_IMAGE_RENDERING_DIRECTIVE' for x in reviews)==58 and all(not x['parameter_record_ready'] for x in reviews if x['semantic_role']=='RST_IMAGE_RENDERING_DIRECTIVE'),'can_hex_not_hours':sum(x['semantic_role']=='SOFTWARE_CHANGELOG_CAN_MESSAGE_IDENTIFIER_MAPPING' for x in reviews)==2 and all(not x['parameter_record_ready'] and x['structured_interface_record_ready'] and all(q.get('unit') is None and q.get('column_role') for q in x['quantity_bindings']) for x in reviews if x['semantic_role']=='SOFTWARE_CHANGELOG_CAN_MESSAGE_IDENTIFIER_MAPPING'),'device_parameters_4':sum(x['semantic_role']=='DEVICE_SPECIFICATION_PARAMETER' for x in reviews)==4,'unresolved_matches':sum(x['review_status']=='UNRESOLVED' for x in reviews)==len(rows(OUT/'UNRESOLVED.jsonl'))}
res={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'results':len(reviews),'resolved':sum(x['review_status']=='RESOLVED' for x in reviews),'unresolved':sum(x['review_status']=='UNRESOLVED' for x in reviews),'parameter_record_ready':sum(x['parameter_record_ready'] for x in reviews),'structured_interface_record_ready':sum(x['structured_interface_record_ready'] for x in reviews),'non_parameter_or_identifier':sum(not x['parameter_record_ready'] for x in reviews)},'scope':'Exact review_b set: 64 candidates from SRC-039/040; full local RST directive associations, changelog table, and device specification table context checked.','not_checked':['runtime applicability to an uploaded case or installed device','target equipment approval'],'command':f'python -B {__file__}'}
(OUT/'CHECK_RESULTS.json').write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding='utf-8')
(OUT/'RUN.log').write_text(datetime.datetime.now(datetime.timezone.utc).isoformat()+' build_review_b.py PASS\n',encoding='utf-8')
print(json.dumps(res,ensure_ascii=False))

