import importlib.util,json,tempfile
from pathlib import Path
import numpy as np, h5py, openpyxl

DS=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\datasets")
OUT=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST\audits\doc_reviews_data"); OUT.mkdir(parents=True,exist_ok=True)
spec=importlib.util.spec_from_file_location('reader',DS/'read_ready_data.py'); rd=importlib.util.module_from_spec(spec); spec.loader.exec_module(rd)
results=[]
def check(name,ok,evidence): results.append({'check_id':name,'status':'PASS' if ok else 'FAIL','evidence':evidence})
with tempfile.TemporaryDirectory(dir=OUT) as td:
 t=Path(td)
 jp=t/'nf.json'; jp.write_bytes(b'{"native_null":null,"nan":NaN,"pos":Infinity,"neg":-Infinity,"string":"NaN"}')
 j=rd.json_tagged_events(jp,100)
 vals={x['path']:(x['type'],x['value']) for x in j['events']}
 check('JSON_DISTINCT_NONFINITE_AND_NULL',vals.get('native_null')==('null',None) and vals.get('nan')==('string','__IEEE_NAN__') and vals.get('pos')==('string','__IEEE_POSITIVE_INFINITY__') and vals.get('neg')==('string','__IEEE_NEGATIVE_INFINITY__') and vals.get('string')==('string','NaN'),{'events':j['events'],'counts':j['nonfinite_counts_seen'],'complete':j['complete']})
 strict=rd.json_structure(jp); check('JSON_STRICT_REJECTS_BARE_NONFINITE',strict['status']=='NONSTANDARD_JSON_REQUIRES_DECLARED_NORMALIZER',strict)
 cp=t/'time.csv'; cp.write_text('Test_Time,Value,Blank\n0,1,\n1,2,\n0.5,3,\n',encoding='utf-8')
 cr=list(rd.csv_rows(cp,10)); check('CSV_STREAM_PRESERVES_ORDER_AND_BLANK_AS_NULL',[x['Test_Time'] for x in cr]==['0','1','0.5'] and all(x['Blank'] is None for x in cr),{'rows':cr})
 seg_ok=[x['_reader_segment_id'] for x in cr]==[0,0,1] and [x['_reader_test_time_backstep'] for x in cr]==[False,False,True] and [x['Test_Time'] for x in cr]==['0','1','0.5']
 check('CSV_TIME_RESET_OPERATION_AVAILABLE',seg_ok,{'rows':cr,'expected_segment_ids':[0,0,1],'expected_backsteps':[False,False,True]})
 xp=t/'formula.xlsx'; wb=openpyxl.Workbook(); ws=wb.active; ws.append(['header','value']); ws.append(['formula','=1+1']); wb.save(xp); wb.close()
 xr=rd.xlsx_structure(xp); formula_ok=xr[0].get('formula_count')==1 and xr[0].get('formula_cells')==['B2'] and xr[0].get('formula_execution') is False
 check('XLSX_REPORTS_FORMULAS_BEYOND_FIRST_ROW',formula_ok,{'fixture_formula_cell':'B2','reader_result':xr})
 hp=t/'sample.h5'
 with h5py.File(hp,'w') as h: h['matrix']=np.arange(6,dtype=np.int16).reshape(2,3); h['scalar']=np.array(7,dtype=np.int32)
 hd=rd.mat73_directory(hp); hs=rd.mat73_slice(hp,'matrix',1,1); hscalar=rd.mat73_slice(hp,'scalar',0,1)
 check('HDF_DIRECTORY_AND_BOUNDED_SLICE',any(x['path']=='matrix' and x['shape']==[2,3] for x in hd) and hs['values']==[[3,4,5]] and hscalar['values']==7,{'directory':hd,'slice':hs,'scalar':hscalar})
 nt=t/'values.3'; nt.write_text('1\t2\n3\tbad\n',encoding='utf-8'); nr=rd.numeric_text_profile(nt)
 check('NUMERIC_SUFFIX_CONTENT_PROFILE',nr['lines']==2 and nr['field_width_counts']=={2:2} and nr['nonnumeric_tokens']==1 and nr['units']=='UNKNOWN',nr)

# Execute the shipped reader on every MCOS NPZ and compare metadata to its contract.
contracts=[json.loads(x) for x in (DS/'MCOS_NUMERIC_EXPORTS.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
npz=[]
for c in contracts:
 meta=rd.npz_metadata(c['artifact_path']); expected={x['name']:(x['length'],x['dtype'],x['nan_count']) for x in c['columns']}
 actual={k:(v['shape'][0] if len(v['shape'])==1 else None,v['dtype'],v['nan_count']) for k,v in meta.items()}
 npz.append({'file_id':c['file_id'],'variable_name':c['variable_name'],'match':expected==actual,'keys':sorted(meta)})
check('MCOS_NPZ_READER_CONTRACT_MATCH',len(npz)==11 and all(x['match'] for x in npz),{'tables':npz})

# One real registered CSV exercises the declared stream reader without a full 19GB rescan.
fr=[json.loads(x) for x in (DS/'FILE_READINESS.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]
csvrec=next(x for x in fr if x.get('format_family')=='CSV')
sample=list(rd.csv_rows(csvrec['input_path'],3))
check('REGISTERED_CSV_READER_SMOKE',bool(sample) and isinstance(sample[0],dict),{'file_id':csvrec['file_id'],'input_path':csvrec['input_path'],'rows_read':len(sample),'fields':list(sample[0])})
csvall=[x for x in fr if x.get('format_family')=='CSV']
csv_policy=all(any('CSV_TIMESERIES' in y for y in x.get('data_contract_refs',[])) and 'unit_dependent_calculation' in x.get('disabled_capabilities',[]) for x in csvall)
check('CSV_140_BINDINGS_AND_UNKNOWN_UNIT_POLICY',len(csvall)==140 and csv_policy,{'csv_records':len(csvall),'all_contract_bound_and_unit_calculation_disabled':csv_policy})

(OUT/'STABLE_READER_CHECKS.json').write_text(json.dumps({'checks':results,'pass_count':sum(x['status']=='PASS' for x in results),'fail_count':sum(x['status']=='FAIL' for x in results)},ensure_ascii=False,indent=2,default=str)+'\n',encoding='utf-8')
print(json.dumps({'checks':len(results),'pass':sum(x['status']=='PASS' for x in results),'fail':[x['check_id'] for x in results if x['status']=='FAIL']}))
