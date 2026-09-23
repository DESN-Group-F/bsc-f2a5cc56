import json,pathlib
R=pathlib.Path(__file__).parent
xs=[json.loads(x) for x in (R/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
depthmax=0;trunc=0;fields=set()
def walk(x,d=0):
 global depthmax,trunc
 if isinstance(x,dict):
  if 'struct_fields' in x:depthmax=max(depthmax,d);fields.update(x['struct_fields'])
  if x.get('depth_limit_reached') and x.get('unexpanded_struct_or_object'):trunc+=1
  for k,v in x.items():walk(v,d+1 if k in ('fields','element_variants') else d)
 elif isinstance(x,list):
  for v in x:walk(v,d)
for x in xs:walk(x['variables'])
res={'status':'PASS' if len(xs)==66 and all(x['status']=='FULL_ALL_STRUCT_ELEMENTS_SCHEMA' for x in xs) and trunc==0 and {'Capacity','Current_load','Rectified_Impedance','Re','Rct'}.issubset(fields) else 'FAIL','records':len(xs),'max_depth_observed':depthmax+1,'depth_definition':'variable root=1; nested struct fields increment depth','depth_truncations':trunc,'field_union':sorted(fields),'required_variant_fields_present':{k:k in fields for k in ['Capacity','Current_load','Rectified_Impedance','Re','Rct']},'reader_smoke_test':str(R/'READER_NESTED_MAT_TEST.log')}
(R/'MAT_SCHEMA_CHECKS.json').write_text(json.dumps(res,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(res))
