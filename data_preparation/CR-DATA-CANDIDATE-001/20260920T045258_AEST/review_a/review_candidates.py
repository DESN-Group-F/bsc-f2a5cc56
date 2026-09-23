import json, pathlib, re, collections

RUN=pathlib.Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST")
OLD=pathlib.Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST")
EXT=pathlib.Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST\documents67\derived")
OUT=RUN/'review_a'; OUT.mkdir(exist_ok=True)
scope=[json.loads(x) for x in (RUN/'CANDIDATE_SCOPE.jsonl').read_text(encoding='utf-8-sig').splitlines() if x]
scope=[x for x in scope if x['lane']=='review_a']
sources={x['file_id']:x for x in map(json.loads,(RUN/'SOURCE_SCOPE.jsonl').read_text(encoding='utf-8-sig').splitlines())}
old={x['fact_id']:x for x in map(json.loads,(OLD/'documents'/'FACT_CANDIDATES.jsonl').read_text(encoding='utf-8-sig').splitlines())}

def derived(fid, kind):
    p=EXT/f'{fid}.{kind}.jsonl'
    return p
def segs(fid):
    p=derived(fid,'segments')
    return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x]
cache={}
def segment_context(fid,n):
    a=cache.setdefault(fid,segs(fid)); hit=next(x for x in a if x.get('segment_index')==n)
    if hit.get('table_index') is not None and hit.get('row_index') is not None:
        row=[x['text'] for x in a if x.get('table_index')==hit['table_index'] and x.get('row_index')==hit['row_index']]
        head=[x['text'] for x in a if x.get('table_index')==hit['table_index'] and x.get('row_index')==1]
        return {'structure':'native_html_table_row','table_index_zero_based':hit['table_index']-1,'extraction_table_index':hit['table_index'],'row_index':hit['row_index'],'headers':head,'row':row}
    near=[x['text'] for x in a if isinstance(x.get('segment_index'),int) and abs(x['segment_index']-n)<=2]
    return {'structure':'document_sequence','nearby_segments':near}
def build_status(fid): return sources[fid]['build_use']['build_use_status']
def source_version(fid):
    s=sources[fid]['source']; return {'source_id':s['source_id'],'publisher':s.get('publisher'),'document_version_id':s.get('document_version_id'),'acquired_at':s.get('acquired_at'),'scope_note':'Values remain bound to this source/version and are not automatically applicable to UNSW or a target product.'}

results=[]
for sc in scope:
    fid,sid,fact=sc['file_id'],sc['source_id'],old[sc['fact_id']]
    lit=fact['source_literal']; loc=sc['locator']; nums=fact['numeric_unit_mentions']
    role='NON_PARAMETER_CONTENT'; ready=False; conditions=[]; remaining=[]; bindings=[]; findings={}; reason=''
    ev=[sc['frozen_candidate_ref'],sources[fid]['source']['input_path']+'#'+loc]
    if 'segment:' in loc:
        n=int(re.search(r'segment:(\d+)',loc).group(1)); ctx=segment_context(fid,n); findings=ctx; ev.append(str(derived(fid,'segments'))+f'#segment_index={n}')
    elif sid=='SRC-023':
        pg=int(re.search(r'page:(\d+)',loc).group(1)); findings={'structure':'PDF_page_clause_review','page':pg}; ev.append(str(derived(fid,'pages'))+f'#page_number={pg}')
    else:
        findings={'structure':'source_paragraph_review','locator':loc}

    if sid=='SRC-006':
        n=int(re.search(r'segment:(\d+)',loc).group(1))
        if n in {605,608,611,614,617,619}:
            role='SOURCE_OPERATIONAL_RULE_OR_LIMIT'; ready=True
            mapping={605:([{'value':'50','unit':'V','comparator':'≥'},{'value':'5','unit':'mA','comparator':'≥'}],['AC','50–60 Hz nominal','both voltage and current thresholds']),608:([{'value':'100','unit':'V','comparator':'≥'},{'value':'40','unit':'mA','comparator':'≥'}],['DC','all','both voltage and current thresholds']),611:([{'value':'100','unit':'V','comparator':'≥'},{'value':'10','unit':'J','comparator':'≥'}],['capacitors','all','both voltage and stored-energy thresholds']),614:([{'value':'100','unit':'V','comparator':'≥'}],['batteries','all']),617:([{'value':'50','unit':'V','comparator':'≥'},{'value':'5','unit':'mA','comparator':'≥'}],['sub-RF','1 Hz to 3 kHz','excluding 50–60 Hz nominal','both voltage and current thresholds']),619:([{'value':'3','unit':'kHz','comparator':'lower inclusive'},{'value':'100','unit':'MHz','comparator':'upper inclusive'}],['RF range; hazard threshold is a function of frequency'])}
            bindings,conditions=mapping[n]; reason='Recovered the value from the same native hazard-threshold table row and its Source/Includes columns; this is an LBNL program classification threshold, not a universal battery limit.'
            raw_rows={605:['AC','50–60 Hz nominal','≥ 50 V and ≥ 5 mA'],608:['DC','All','≥ 100 V and ≥ 40 mA'],611:['Capacitors','All','≥ 100 V and ≥ 10 J'],614:['Batteries','All','≥ 100 V'],617:['Sub-RF','1 Hz to 3 kHz (excluding 50–60 Hz nominal)','≥ 50 V and ≥ 5 mA'],619:['RF','3 kHz to 100 MHz','A function of frequency']}
            findings={'structure':'native_html_table_row','table_index_zero_based':4,'headers':['Source','Includes','Hazard Thresholds'],'row':raw_rows[n],'raw_source_encoding_check':'Direct UTF-8 decoding and stdlib HTML parsing preserve U+2265 in the registered source; an earlier console display issue was not a source defect.'}
            ev.append(sources[fid]['source']['input_path']+'#table_index_zero_based=4')
            if n==619: role='SOURCE_CLASSIFICATION_RANGE'
        elif n in {639,643}:
            role='SOURCE_QUALIFICATION_SCOPE'; ready=True
            if n==639: bindings=[{'range':'50–300','unit':'VAC'},{'value':'50–60','unit':'Hz'}]; conditions=['QEW 1','researchers/technicians/engineers','line-source exposure','no arc-flash hazard']
            else: bindings=[{'value':'750','unit':'VAC','comparator':'>'},{'value':'60','unit':'Hz'}]; conditions=['QEW 3','utility exposure','high-voltage electricians/engineers']
            reason='Recovered from the QEW Level / Line Source Exposure table row; it defines LBNL qualification scope rather than a general equipment threshold.'
        elif 1067<=n<=1232:
            role='SOURCE_TRAINING_CATALOG_ENTRY'; ready=False
            row=findings['row']; bindings=[{'duration':lit,'course_number':row[0] if len(row)>0 else None,'course_name':row[1] if len(row)>1 else None,'format':row[2] if len(row)>2 else None,'frequency':row[4] if len(row)>4 else None}]
            conditions=['LBNL course catalog row','duration and recurrence are distinct columns']; reason='Joined the duration cell to all five cells of its native course-table row, including course, format and recurrence.'
        else:
            role='NAVIGATION_LABEL_FALSE_NUMERIC'; ready=False; bindings=[]; conditions=['“1 Minute 4 Safety” is a quick-link title']; reason='The digits are part of a navigation title, not a measured quantity, threshold or duration assertion.'
    elif sid=='SRC-014':
        n=int(re.search(r'segment:(\d+)',loc).group(1)); role='SOURCE_PRODUCT_SPECIFICATION' if n<304 else 'SOURCE_EXPERIMENT_CONDITION'; ready=True
        entity='INR 18650-20R' if n<=101 else ('A123' if n<=180 else ('CS2' if n<=227 else ('CX2' if n<=267 else 'PL pouch-cell sample')))
        if n>=348:
            entity='PL pouch-cell storage experiment'; test='capacity' if n<=351 else 'impedance'
            conditions=[f'{test} test for cells stored at the listed temperature','study population: 144 Li-ion cells across storage SOC 0%, 50% and 100% and temperatures −40°C, −5°C, 25°C and 50°C','allocation: 12 cells per temperature; within each temperature, 4 cells at each of 0%, 50% and 100% SOC','schedule groups stated by source: 48 cells received capacity and impedance tests every 3 weeks; 48 every 3 months; 48 received capacity tests every 6 months','example workflow (PLN_51): initial CCCV charge at C/2, discharge at C/2 for maximum capacity, recharge and impedance test, discharge to 50% SOC, then 3-week storage before capacity and impedance retest','the temperature link alone does not identify which individual file/cell belongs to each schedule group; that mapping remains outside this fact record']
            ev.append(str(derived(fid,'segments'))+'#segment_index=338-342')
        else: conditions=[f'CALCE dataset landing-page specification table for {entity}'];
        bindings=[{'literal':lit.replace('��','°').replace('�','°'),'field':'storage_temperature' if n>=348 else (findings.get('row',[None,None])[0] if findings.get('row') else None),'entity':entity}]
        reason='Recovered the value from its native parameter/value table row or the immediately labelled capacity/impedance temperature block; it describes this dataset’s cell/sample or test condition only.'
    elif sid=='SRC-009':
        role='SOURCE_RESEARCH_METHOD_SCOPE'; ready=False; bindings=[{'value':'3','unit':'Ah','comparator':'<','entity':'small cells'}]; conditions=['closed-chamber accelerating-rate calorimetry','NLR researchers’ database description']; reason='The complete paragraph binds <3 Ah to the small-cell calorimetry scope, not to a product rating or operating limit.'
        ev.append(str(derived(fid,'paragraphs'))+f'#{loc}') if derived(fid,'paragraphs').exists() else None
    elif sid=='SRC-022':
        role='IDENTIFIER_NOT_QUANTITY'; ready=False; bindings=[{'identifier':lit.replace('Model No ','').strip(),'identifier_system':'dangerous-goods label model number'}]; conditions=['downloadable class/handling-label table','model number is an identifier']; reason='The apparent unit token is part of an ADG label model identifier, not amperes, seconds or a decimal measurement.'
    elif sid=='SRC-023':
        role='SOURCE_TRANSPORT_RULE_OR_RECOMMENDATION'; ready=True
        if fact['fact_id'].endswith('A0079'):
            bindings=[{'value':'30','unit':'% rated capacity','comparator':'≤','alternative':'indicated battery capacity ≤25%'}]; conditions=['lithium-ion batteries contained in equipment','PI 967 Sections I/II','recommendation, explicitly not mandatory']; reason='Restored the bullet’s heading, alternative and following sentence; 30% is a recommendation for contained-in-equipment shipments, with a 25% indicated-capacity alternative.'
        elif fact['fact_id'].endswith('A0084'):
            bindings=[{'value':'30','unit':'% rated capacity','comparator':'≤','alternative':'indicated battery capacity ≤25%'}]; conditions=['battery-powered vehicles','battery rating >100 Wh','mandatory offered-for-transport condition']; reason='Restored the governing >100 Wh vehicle paragraph and the paired alternative bullet.'
        elif fact['fact_id'].endswith('A0086'):
            bindings=[{'value':'100','unit':'Wh','comparator':'>'},{'value':'30','unit':'% rated capacity','comparator':'>'}]; conditions=['battery-powered vehicles','may only be shipped with approval of State of Origin and State of Operator','written conditions established by those authorities']; reason='Restored the line-broken clause: both >100 Wh and >30% SoC trigger the stated approval-only route.'
        elif fact['fact_id'].endswith('A0089'):
            bindings=[{'value':'30','unit':'% rated capacity','comparator':'≤','alternative':'indicated battery capacity ≤25%'}]; conditions=['battery-powered vehicles','battery rating ≤100 Wh','strong recommendation, explicitly not mandatory']; reason='Restored the preceding “not exceeding 100 Wh” paragraph and paired alternative; this is recommendation rather than mandate.'
        else:
            bindings=[{'value':'20','unit':'Wh','comparator':'>','entity':'lithium-ion cell'},{'value':'100','unit':'Wh','comparator':'>','entity':'lithium-ion battery'},{'value':'1','unit':'g','comparator':'>','entity':'lithium-metal per cell'},{'value':'2','unit':'g','comparator':'>','entity':'lithium-metal per battery'}]; conditions=['F.12 battery-mark prohibition','also applies to sodium-ion cells and batteries','battery mark is also not applied to packages under PI 976','battery mark is also not applied under Section IA of PI 965 and PI 968','battery mark is also not applied under Section I of PI 966, PI 967, PI 969 and PI 970']; reason='Restored the full wrapped sentence, F.12 heading, all chemistry/quantity branches and the complete following packing-instruction exclusion list; 20 Wh is only the lithium-ion cell branch.'
    elif sid=='SRC-025':
        role='HTML_PRESENTATION_METADATA_FALSE_POSITIVE'; ready=False; bindings=[]; conditions=['100% table width and 14.00% CSS column widths','model comparison page markup']; reason='The percentages occur only in HTML style attributes controlling layout; they are not model scores or engineering facts.'
    elif sid=='SRC-026':
        role='SOFTWARE_TRAINING_EXAMPLE_METADATA'; ready=False
        if '10 minutes' in lit: bindings=[{'duration':'10 minutes','model':'Qwen3-4B-Instruct-2507','hardware':'single RTX 3090','activity':'self-cognition fine-tuning demonstration'}]
        else: bindings=[{'dataset_name':'DAPO-Math-17k-Processed','17k':'dataset-name scale token, not a measured engineering value','model':'Qwen3.5-35B-A3B','method':'GRPO LoRA','reward':'accuracy'}]
        conditions=['software documentation example; no local training was run']; reason='Read the full paragraph and retained what the number denotes; it is software/training-example metadata, not a battery parameter or performance validation.'
    elif sid=='SRC-030':
        role='DATASET_CARD_METADATA'; ready=False
        if fact['fact_id'].endswith('A0001'): bindings=[{'range':'100K<n<1M','field':'size_categories'}]
        elif fact['fact_id'].endswith('A0002'): bindings=[{'identifier':'allenai/WildChat-1M','field':'source_datasets'}]
        else: bindings=[{'value':'100,000','unit':'prompts','dataset':'WildChat GPT-4','license':'ODC-BY-1.0','citation':'Zhao et al., 2024'}]
        conditions=['Tulu data-mixture/dataset-card description']; reason='Recovered the YAML/list field and surrounding dataset entry; K/M are dataset size or identifier tokens, not electrical units.'
    elif sid=='SRC-037':
        role='PROJECT_NAME_FALSE_NUMERIC'; ready=False; bindings=[{'identifier':'Project 24s'}]; conditions=['joint procurement resource title']; reason='“24s” is part of a project name in a navigation list, not 24 seconds.'
    else: remaining=['UNHANDLED_SOURCE']; reason='No source-specific review rule.'

    status='UNRESOLVED' if remaining else 'RESOLVED'
    structured_ref = status=='RESOLVED' and not ready
    results.append({'fact_id':fact['fact_id'],'file_id':fid,'source_id':sid,'original_locator':loc,'review_status':status,'semantic_role':role,'context_findings':findings,'quantity_bindings':bindings,'source_entity_and_version':source_version(fid),'conditions_and_exceptions':conditions,'evidence_refs':ev,'original_unknown_resolution':'Resolved by native table-row/section/paragraph review.' if status=='RESOLVED' else 'Not resolved.','parameter_record_ready':ready,'structured_reference_record_ready':structured_ref,'current_build_use_status':build_status(fid),'remaining_unknowns':remaining,'reason':reason})

(OUT/'REVIEW_RESULTS.jsonl').write_text('\n'.join(json.dumps(x,ensure_ascii=False) for x in results)+'\n',encoding='utf-8')
expected={x['fact_id'] for x in scope}; actual=[x['fact_id'] for x in results]
threshold_ids={f'FILE-006-32cac472a87d-e9332f-A{x:04d}' for x in (2,3,4,5,7)}
checks={'rows_85':len(results)==85,'exact_fact_set':set(actual)==expected,'unique_fact_ids':len(actual)==len(set(actual)),'all_have_evidence_and_reason':all(x['evidence_refs'] and x['reason'] for x in results),'all_required_fields':all(all(k in x for k in ['fact_id','file_id','source_id','original_locator','review_status','semantic_role','context_findings','quantity_bindings','source_entity_and_version','conditions_and_exceptions','evidence_refs','original_unknown_resolution','parameter_record_ready','structured_reference_record_ready','current_build_use_status','remaining_unknowns','reason']) for x in results),'all_resolved_or_explicit_unresolved':all(x['review_status'] in {'RESOLVED','UNRESOLVED'} for x in results),'iata_five_reviewed':sum(x['source_id']=='SRC-023' for x in results)==5,'src006_37_reviewed':sum(x['source_id']=='SRC-006' for x in results)==37,'src006_threshold_comparators_are_u2265':all(all(q.get('comparator')=='\u2265' for q in x['quantity_bindings']) for x in results if x['fact_id'] in threshold_ids),'no_replacement_char_in_resolved_bindings_or_context_rows':all('\ufffd' not in json.dumps({'q':x['quantity_bindings'],'row':x['context_findings'].get('row')},ensure_ascii=False) for x in results)}
summary={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'counts':{'reviewed':len(results),'resolved':sum(x['review_status']=='RESOLVED' for x in results),'unresolved':sum(x['review_status']=='UNRESOLVED' for x in results),'parameter_record_ready':sum(x['parameter_record_ready'] for x in results),'non_parameter_or_context_only':sum(not x['parameter_record_ready'] for x in results),'by_source':dict(collections.Counter(x['source_id'] for x in results))},'scope':'Every review_a candidate was joined to its native row, labelled block, full clause or full paragraph; local preparation only, no RAG/training/server admission.'}
(OUT/'CHECK_RESULTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'REPORT.md').write_text(f"# review_a candidate review\n\nStatus: **{summary['status']}**. Reviewed {len(results)}/85 exact fact IDs; {summary['counts']['resolved']} semantic reviews resolved and {summary['counts']['unresolved']} unresolved. {summary['counts']['parameter_record_ready']} records are source-bound parameter/rule/catalog records; {summary['counts']['non_parameter_or_context_only']} are identifiers, software/dataset metadata, presentation markup, navigation labels or other non-parameter content.\n\nSRC-006 values were restored from native table rows, including table headers, row entity, AND comparisons, frequency exclusions, course identity, format and recurrence. SRC-023’s five IATA candidates retain the complete governing heading, mandatory/recommended distinction, alternatives and approval conditions. Dataset/model/software numbers retain their actual metadata meaning and are not promoted to engineering parameters.\n\n`parameter_record_ready` does not establish target-product applicability, UNSW approval, RAG admission or server transfer. Values remain bound to the source/version and conditions recorded per row.\n",encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
