import json,importlib.util,hashlib
from pathlib import Path
B=Path(r'E:/desn 2000/bsc/data_preparation/CR-DATA-READY-001/20260920T012405_AEST');D=B/'datasets'/'image_supplement';O=B/'audits'/'doc_reviews_data'
xs=[json.loads(x) for x in open(D/'MEMBER_PROFILES.jsonl',encoding='utf8') if x.strip()];imgs=[x for x in xs if x.get('readiness_status')=='READY_NATIVE_IMAGE_FRAMES_WITH_CALIBRATION_LIMITS']
sel=[next(x for x in imgs if x['actual_format']=='PNG'),next(x for x in imgs if x['actual_format']=='TIFF' and x['frames'][0]['width']==496 and x['frames'][0]['height']==510),next(x for x in imgs if x['actual_format']=='TIFF' and x['frames'][0]['width']==503 and x['frames'][0]['height']==729)]
s=importlib.util.spec_from_file_location('ir',D/'native_image_reader.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r);out=[]
for x in sel:
 for chk in x['sample_decode_checks']:
  a=r.read_image_member(x['container_path'],x['member_path'],chk['frame'],max_frame_bytes=64*1024**2,maximum_member_bytes=2*1024**3);h=hashlib.sha256(a.tobytes()).hexdigest();out.append({'file_id':x['container_file_id'],'member':x['member_path'],'format':x['actual_format'],'frame':chk['frame'],'expected_shape':chk['shape'],'actual_shape':list(a.shape),'expected_dtype':chk['dtype'],'actual_dtype':str(a.dtype),'expected_sha256':chk['sha256'],'actual_sha256':h,'status':'PASS' if list(a.shape)==chk['shape'] and str(a.dtype)==chk['dtype'] and h==chk['sha256'] else 'FAIL'})
(O/'IMAGE_ACTUAL_SPOTCHECK.json').write_text(json.dumps({'checks':out,'pass_count':sum(x['status']=='PASS' for x in out),'fail_count':sum(x['status']=='FAIL' for x in out)},indent=2)+'\n');print({'pass':sum(x['status']=='PASS' for x in out),'fail':sum(x['status']=='FAIL' for x in out)})
