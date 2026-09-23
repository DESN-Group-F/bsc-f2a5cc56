import json,re
from pathlib import Path
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\documents")
def jl(p): return [json.loads(x) for x in p.read_text(encoding='utf-8').splitlines() if x.strip()]
fr={x['file_id']:x for x in jl(OUT/'FILE_READINESS.jsonl')}; pagechecks={(x['file_id'],int(x['page_number'])) for x in jl(OUT/'KEY_PAGE_CHECKS.jsonl')}
NUM=r'[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+))(?:\.\d+)?(?:[eE][+-]?\d+)?'
UNIT=r'(?:°\s?C|deg(?:ree)?s?\s+C|K|kV|mV|V|µA|uA|mA|A|µAh|uAh|mAh|Ah|mWh|Wh|kWh|µW|uW|mW|W|kW|Hz|kHz|MΩ|kΩ|mΩ|Ω|ohms?|%|µm|um|mm|cm|km|m|µg|ug|mg|kg|g|ms|s|sec(?:ond)?s?|min(?:ute)?s?|h|hr|hours?|Pa|kPa|MPa|bar|psi)'
MENTION=re.compile(r'(?i)(?<![\w.])(?P<value>'+NUM+r'(?:\s*(?:-|–|—|to)\s*'+NUM+r')?)\s*(?P<unit>'+UNIT+r')(?!\w)')
COND=re.compile(r'(?i)\b(?:at|under|when|where|if|unless|between|from|during|after|before|nominal|typical|rated|recommended|temperature|voltage|current|capacity|charge|discharge|storage|transport|test|per|with|without|for)\b')
INCIDENT=re.compile(r'(?i)\b(?:incident|explosion occurred|occurred|was reported|were reported|injur(?:y|ies|ed)|event|investigation found)\b')
RESEARCH=re.compile(r'(?i)\b(?:model|dataset|training|experiment|benchmark|accuracy|loss|method|equation|algorithm|sample|epoch|parameter)\b')
RULE=re.compile(r'(?i)(?:\b(?:shall|must|do not|never|prohibited|required|should|recommended|may not|may only|maximum|minimum|limit|exceed|exceeds|exceeded|exceeding)\b|\bnot\s+exceeding\b|\bno\s+more\s+than\b|\bnot\s+more\s+than\b|\bless\s+than\b|\bgreater\s+than\b)')
SPEC=re.compile(r'(?i)\b(?:nominal|rated|capacity|voltage|current|energy|mass|weight|dimension|temperature|resistance|power|frequency|conversion efficiency)\b')
FOOT=re.compile(r'(?i)(?:\bnote\b|\bfootnote\b|\*|†|\[[a-z0-9]+\])')

reviewed=[]; verified=[]; unresolved=[]
for fid,r in sorted(fr.items()):
 p=OUT/'derived'/(fid+'.content.jsonl')
 if not p.exists(): continue
 seq=0
 for block in jl(p):
  for sn,s in enumerate(re.split(r'(?<=[.!?])\s+|\n+',block.get('text','')),1):
   text=' '.join(s.split())
   mentions=[{'literal':m.group(0),'value_text':m.group('value'),'unit':m.group('unit'),'start':m.start(),'end':m.end()} for m in MENTION.finditer(text)]
   if not mentions: continue
   seq+=1; loc=block['locator']+'/sentence:'+str(sn)
   page=None
   pm=re.match(r'page:(\d+)',block['locator']); page=int(pm.group(1)) if pm else None
   role=(r.get('role') or '').lower()
   if r['source_id']=='SRC-001' and re.search(r'(?i)38\.1\s*kWh',text): semantic='INCIDENT_OR_EVENT_DESCRIPTION'
   elif 'research' in role or r['source_id'] in ('SRC-033','SRC-034'): semantic='RESEARCH_OR_METHOD_ASSERTION'
   elif RULE.search(text): semantic='SOURCE_OPERATIONAL_RULE_OR_LIMIT'
   elif INCIDENT.search(text): semantic='INCIDENT_OR_EVENT_DESCRIPTION'
   elif RESEARCH.search(text): semantic='RESEARCH_OR_METHOD_ASSERTION'
   elif SPEC.search(text): semantic='PRODUCT_OR_TECHNICAL_SPECIFICATION'
   else: semantic='DESCRIPTIVE_QUANTITATIVE_ASSERTION'
   sentence_cond=bool(COND.search(text)) or semantic=='SOURCE_OPERATIONAL_RULE_OR_LIMIT'; block_cond=bool(COND.search(block.get('text',''))); cond=sentence_cond or block_cond
   foot=bool(FOOT.search(text)); replacement='�' in text
   if semantic=='INCIDENT_OR_EVENT_DESCRIPTION': cond=True
   layout='NOT_APPLICABLE_TEXT_SOURCE' if page is None else ('KEY_PAGE_GEOMETRY_CHECKED' if (fid,page) in pagechecks else 'TEXT_EXTRACTION_ONLY')
   unknown=[]
   if not cond: unknown.append('CONDITION_NOT_EXPLICIT_IN_LOCAL_SENTENCE')
   if replacement: unknown.append('TEXT_REPLACEMENT_CHARACTER_PRESENT')
   if foot and page is not None and layout!='KEY_PAGE_GEOMETRY_CHECKED': unknown.append('FOOTNOTE_OR_NOTE_GEOMETRY_NOT_CHECKED')
   if semantic=='SOURCE_OPERATIONAL_RULE_OR_LIMIT' and not re.search(r'[.!?;:]\s*$',text) and re.search(r'(?i)(?:\band\b|\bor\b|\bof\b|\bto\b|\bwith\b|state\s+of\s+charge)\s*$',text): unknown.append('TRUNCATED_OR_FRAGMENTARY_CLAUSE')
   status='SOURCE_ASSERTION_CHECKED' if not unknown else 'CANDIDATE_WITH_EXPLICIT_UNKNOWNS'
   cstatus='NOT_APPLICABLE_EVENT_DESCRIPTION' if semantic=='INCIDENT_OR_EVENT_DESCRIPTION' else ('EXPLICIT_IN_SAME_SENTENCE' if sentence_cond else ('EXPLICIT_IN_SAME_PAGE_OR_PARAGRAPH_BLOCK' if block_cond else 'UNKNOWN_NOT_STATED_IN_LOCAL_BLOCK'))
   rec={'fact_id':fid+'-A'+str(seq).zfill(4),'file_id':fid,'source_id':r['source_id'],'locator':loc,'source_literal':text,'numeric_unit_mentions':mentions,'semantic_class':semantic,'condition_status':cstatus,'applicable_entity':r.get('role') or r['source_id'],'entity_binding':'FILE_ID_SOURCE_ID_AND_DOCUMENT_ROLE','version_binding':r['input_sha256'],'footnote_or_note_cue':foot,'layout_check_status':layout,'verification_status':status,'case_use_status':'SOURCE_CLAIM_CHECKED_CASE_APPLICABILITY_STILL_REQUIRED' if status=='SOURCE_ASSERTION_CHECKED' else 'NOT_READY_FOR_PARAMETER_USE','unknowns':unknown,'evidence_ref':str(p)+'#file_id='+fid+'&locator='+block['locator']}
   reviewed.append(rec); (verified if status=='SOURCE_ASSERTION_CHECKED' else unresolved).append(rec)

with (OUT/'REVIEWED_FACT_ASSERTIONS.jsonl').open('w',encoding='utf-8') as f:
 for x in reviewed:f.write(json.dumps(x,ensure_ascii=False)+'\n')
with (OUT/'VERIFIED_FACTS.jsonl').open('w',encoding='utf-8') as f:
 for x in verified:f.write(json.dumps(x,ensure_ascii=False)+'\n')
with (OUT/'FACT_CANDIDATES.jsonl').open('w',encoding='utf-8') as f:
 for x in unresolved:f.write(json.dumps(x,ensure_ascii=False)+'\n')

# explicit regression/calibration cases for number grammar
cases={'25,000kg':('25,000','kg'),'-40 °C':('-40','°C'),'2.5-4.2 V':('2.5-4.2','V'),'1.2e3 mA':('1.2e3','mA'),'+10.5%':('+10.5','%')}
cal=[]
for text,expected in cases.items():
 m=MENTION.search(text); cal.append({'input':text,'parsed':(m.group('value'),m.group('unit')) if m else None,'expected':expected,'pass':bool(m) and (m.group('value'),m.group('unit'))==expected})
(OUT/'FACT_REVIEW_RUN.json').write_text(json.dumps({'classified_assertions':len(reviewed),'classification_method':'DETERMINISTIC_RULES_OVER_LOCAL_SENTENCE_PLUS_DOCUMENT_ROLE; NOT A CLAIM OF MANUAL REVIEW OF ALL ROWS','source_assertions_checked':len(verified),'candidates_with_unknowns':len(unresolved),'semantic_class_counts':{k:sum(x['semantic_class']==k for x in reviewed) for k in sorted({x['semantic_class'] for x in reviewed})},'numeric_parser_calibration':cal,'all_calibration_pass':all(x['pass'] for x in cal)},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print((OUT/'FACT_REVIEW_RUN.json').read_text())
