import json, pathlib, collections, datetime, urllib.parse

ROOT=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-READY-001\20260920T012405_AEST')
OUT=ROOT/'datasets'; OUT.mkdir(exist_ok=True)
EXT=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST')
MAP=pathlib.Path(r'E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST\datasets')
CARD=pathlib.Path(r'E:\desn 2000\bsc\backlog\CR_DATA_READY_001_TASK_CARDS.md')

def rows(p):
    if not p.exists(): return []
    return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
def dump(name, xs):
    p=OUT/name
    with p.open('w',encoding='utf-8',newline='\n') as f:
        for x in xs: f.write(json.dumps(x,ensure_ascii=False,sort_keys=True)+'\n')
    return str(p)
objs=[x for x in rows(ROOT/'SOURCE_OBJECTS.jsonl') if x['lane']=='datasets']
assert len(objs)==230
csv={x['file_id']:x for x in rows(EXT/'existing233/CSV_PREPARATION_MANIFEST.jsonl')}
p35={x['file_id']:x for x in rows(EXT/'datasets67/PROCESSING_MANIFEST.jsonl')}
e55={x['file_id']:x for x in rows(EXT/'existing233/datasets/PREPARATION_MANIFEST.jsonl')}
full={x['file_id']:x for x in rows(EXT/'datasets67/FULL_SCAN_RESULTS.jsonl')}
mat_review={x['file_id']:x for x in rows(EXT/'existing233/mat5_review/REVIEW_MANIFEST.jsonl')}
mcos={x['file_id'] for x in rows(OUT/'MCOS_DECODE_RESULTS.jsonl') if x.get('status')=='DECODED_RAW_PROPERTY_MAP'}
mcos_exports=rows(OUT/'MCOS_NUMERIC_EXPORTS.jsonl'); mcos_export_ids={x['file_id'] for x in mcos_exports if x.get('status')=='EXPORTED_NUMERIC_NPZ'}
gap_resolution_ids={x['container_file_id'] for x in rows(OUT/'CONTAINER_GAP_RESOLUTIONS.jsonl')}
gap_resolution_rows=rows(OUT/'CONTAINER_GAP_RESOLUTIONS.jsonl')
gap_resolutions={(x['container_file_id'],x['member_path']):x for x in gap_resolution_rows}
tar_resolution_ids={x['container_file_id'] for x in rows(OUT/'TAR_GZIP_MEMBER_RESOLUTIONS.jsonl')}
json_schema_container_ids={x['container_file_id'] for x in rows(OUT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl') if x.get('complete')}
workbook_container_ids={x['container_file_id'] for x in rows(OUT/'CONTAINER_WORKBOOK_CONTRACTS.jsonl')}
nested_mat_container_ids={x['container_file_id'] for x in rows(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl')}
hdf_contract_ids={x['file_id'] for x in rows(OUT/'HDF5_BATCH_CONTRACTS.jsonl')}
tar_json_container_ids={x['container_file_id'] for x in rows(OUT/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl') if x.get('complete')}
tar_csv_container_ids={x['container_file_id'] for x in rows(OUT/'TAR_CSV_SECTION_CONTRACTS.jsonl') if x.get('status')=='SECTION_CONTRACT_READY'}
src17=r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-017\project_metadata.json#objective'
src18=r'E:\desn 2000\data\battery_data_workspace_v0_3\collection\raw\science\SRC-018\project_metadata.json#objective'
reader=str(OUT/'read_ready_data.py')
readiness=[]; open_items=[]
for o in objs:
    fid=o['file_id']; fmt=(o.get('representation') or pathlib.Path(o['input_path']).suffix.lstrip('.')).upper()
    ev=[str(ROOT/'SOURCE_OBJECTS.jsonl')+'#file_id='+fid, str(CARD)+'#READY-DATA']
    artifacts=[]; limitations=[]; q=[]; status='READY_WITH_DECLARED_LIMITS'; action='METADATA_BOUND_SAFE_READER'
    if fid in csv:
        c=csv[fid]; artifacts=c.get('evidence_refs',[]); ev+=artifacts
        status='READY_WITH_QUALITY_FLAGS'; action='REUSE_FULL_FILE_PROFILE_AND_STREAM_READER'; q=c.get('quality_flags',[])
        limitations=['CSV units are not established by headers; unit-dependent calculations are blocked until an authoritative mapping is supplied.','Segment Test_Time at observed backsteps; preserve blanks as missing.']
        ev += [src17] if o['source_id']=='SRC-017' else []
    elif fid in p35:
        p=p35[fid]; ev += [str(EXT/'datasets67/PROCESSING_MANIFEST.jsonl')+'#file_id='+fid]
        artifacts=[str(EXT/'datasets67/SCHEMA_CATALOG.jsonl')+'#file_id='+fid]
        action=p.get('actual_local_action'); q=[p.get('quality_status')]
        if fid in full: artifacts += [str(EXT/'datasets67/FULL_SCAN_RESULTS.jsonl')+'#file_id='+fid]
        limitations=list(p.get('limitations',[]))
    elif fid in e55:
        p=e55[fid]; ev += [str(EXT/'existing233/datasets/PREPARATION_MANIFEST.jsonl')+'#file_id='+fid]
        artifacts=[str(EXT/'existing233/datasets/SCHEMA_CATALOG.jsonl')+'#file_id='+fid]
        action=p.get('actual_local_action'); limitations=list(p.get('limitations',[]))
    else:
        status='BLOCKED_NO_PREPARATION_EVIDENCE'; action='NONE'
    if fid in mat_review:
        status='READY_WITH_NUMERIC_NPZ_UNKNOWN_UNITS' if fid in mcos_export_ids else ('READY_WITH_DECODED_MCOS_TABLE_CONTRACT' if fid in mcos else 'BLOCKED_OPAQUE_MCOS_SCHEMA'); action='MAT_IO_RAW_PROPERTY_DECODE_AND_NUMERIC_NPZ_EXPORT'
        artifacts += [str(EXT/'existing233/mat5_review/REVIEW_MANIFEST.jsonl')+'#file_id='+fid,str(OUT/'MCOS_DECODE_RESULTS.jsonl')+'#file_id='+fid,str(OUT/'MCOS_TABLE_CONTRACTS.jsonl')+'#file_id='+fid,str(OUT/'MCOS_NUMERIC_EXPORTS.jsonl')+'#file_id='+fid]
        artifacts += [x['artifact_path'] for x in mcos_exports if x['file_id']==fid and x.get('artifact_path')]
        limitations += ['MCOS tables were decoded in raw property mode and exported as numeric NPZ with pickle disabled. VariableUnits and VariableDescriptions were empty; units remain unknown. Prior enormous shapes were invalid ASCII-name misparses. No object methods were executed.']
        if fid not in mcos: open_items.append({'open_item_id':'MCOS-'+fid,'file_id':fid,'severity':'BLOCKING','issue':'OPAQUE_MCOS_SCHEMA_UNRESOLVED','evidence_refs':artifacts[-1:]})
    if o['source_id']=='SRC-018': ev.append(src18)
    if fmt in ('ZIP_ARCHIVE','TAR_GZIP_ARCHIVE'):
        status='READY_WITH_MEMBER_SCHEMAS_AND_READER_LIMITS'
        if fmt=='ZIP_ARCHIVE':
            artifacts += [str(OUT/'CONTAINER_MEMBER_SCHEMAS.jsonl')+'#container_file_id='+fid]
            if fid in gap_resolution_ids: artifacts += [str(OUT/'CONTAINER_GAP_RESOLUTIONS.jsonl')+'#container_file_id='+fid]
        else:
            artifacts += [str(OUT/'TAR_MEMBER_SCHEMAS.jsonl')+'#container_file_id='+fid]
            if fid in tar_resolution_ids: artifacts += [str(OUT/'TAR_GZIP_MEMBER_RESOLUTIONS.jsonl')+'#container_file_id='+fid]
            if fid in tar_json_container_ids: artifacts += [str(OUT/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl')+'#container_file_id='+fid,str(OUT/'TAR_JSON_GZ_SCHEMA_CHECKS.json')]
            if fid in tar_csv_container_ids: artifacts += [str(OUT/'TAR_CSV_SECTION_CONTRACTS.jsonl')+'#container_file_id='+fid,str(OUT/'TAR_CSV_SECTION_CHECKS.json'),str(OUT/'TAR_CSV_READER_CHECKS.json')]
        if fid in json_schema_container_ids: artifacts += [str(OUT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl')+'#container_file_id='+fid]
        if fid in workbook_container_ids: artifacts += [str(OUT/'CONTAINER_WORKBOOK_CONTRACTS.jsonl')+'#container_file_id='+fid,str(OUT/'WORKBOOK_PACKAGE_RECONCILIATION.jsonl')+'#file_id='+fid]
        if fid in nested_mat_container_ids:
            artifacts += [str(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl')+'#container_file_id='+fid,str(OUT/'MAT_SCHEMA_CHECKS.json')]
        limitations.append('Members have format-specific header/schema coverage. Code, images and filesystem metadata are classified and not executed. Bounded schema coverage does not prove scientific applicability.')
    elif 'JSON' in fmt and status!='BLOCKED_OPAQUE_MCOS_SCHEMA': status='READY_WITH_NONFINITE_POLICY'
    elif fmt=='XLSX': status='READY_WITH_FORMULA_AND_SEMANTIC_LIMITS'
    elif fmt=='MATLAB_DATA' and fid not in mat_review:
        status='READY_NATIVE_HDF5_REFERENCED_FIELDS' if fid in hdf_contract_ids else 'READY_NATIVE_HDF5_DIRECTORY'
        if fid in hdf_contract_ids:
            artifacts += [str(OUT/'HDF5_BATCH_CONTRACTS.jsonl')+'#file_id='+fid,str(OUT/'HDF5_READER_CHECK_RESULTS.json')]
    elif fmt=='BINARY': status='READY_AS_STREAMED_NUMERIC_TEXT_WITH_UNKNOWN_UNITS'
    field_refs=[]
    if o['source_id'] in ('SRC-012','SRC-013'):
        disabled=['unit_dependent_calculation_outside_NASA_declared_fields'];field_refs=[str(OUT/'FIELD_CONTRACTS.jsonl')+'#contract_id=NASA_PCOE_BATTERY_FIELDS']
    else: disabled=['unit_dependent_calculation_without_field_evidence']
    if o['source_id'] not in ('SRC-017','SRC-018'): disabled.append('protocol_matched_scientific_inference')
    blocks=['OPAQUE_MCOS_SCHEMA_UNRESOLVED'] if status=='BLOCKED_OPAQUE_MCOS_SCHEMA' else []
    cm='CSV_TIMESERIES' if fid in csv else ('JSON_SAFE_READ' if 'JSON' in fmt else 'XLSX_SAFE_READ' if fmt=='XLSX' else 'MAT_SAFE_READ' if 'MATLAB' in fmt else 'ZIP_SAFE_READ' if fmt in ('ZIP_ARCHIVE','TAR_GZIP_ARCHIVE') else 'NUMERIC_SUFFIX_SAFE_READ')
    historical_action=action
    if fmt in ('ZIP_ARCHIVE','TAR_GZIP_ARCHIVE'):
        action='COMPLETE_MEMBER_INVENTORY_AND_FORMAT_SPECIFIC_FULL_SCHEMA_READ'
        prepared_representation='container_inventory_with_json_path_types_workbook_contracts_and_nested_mat_struct_schemas'
    elif fid in hdf_contract_ids:
        action='HDF5_REFERENCE_MATRIX_AND_BOUNDED_NUMERIC_READER_VALIDATION'
        prepared_representation='native_hdf5_mat_with_exact_batch_field_cell_cycle_reader'
    elif fid in mcos:
        action='PASSIVE_MCOS_PROPERTY_DECODE_AND_SAFE_NUMERIC_NPZ_EXPORT'
        prepared_representation='decoded_mcos_table_contract_and_pickle_free_numeric_npz'
    elif 'JSON' in fmt:
        action='FULL_STREAM_SYNTAX_SCHEMA_AND_NONFINITE_PROFILE'
        prepared_representation='immutable_nonstandard_json_with_typed_event_reader'
    elif fmt=='XLSX':
        action='FULL_WORKBOOK_SHEET_HEADER_FORMULA_PROFILE'
        prepared_representation='read_only_workbook_contract'
    elif fmt=='BINARY':
        action='FULL_STREAM_NUMERIC_TEXT_STRUCTURE_PROFILE'
        prepared_representation='numeric_text_stream_with_unknown_units'
    elif fid in csv:
        prepared_representation='csv_full_profile_with_segmented_time_reader'
    else:
        prepared_representation=fmt.lower()
    entry=str(OUT/'decode_mcos.py') if fid in mcos else (str(OUT/'hdf5_batch_reader.py') if fid in hdf_contract_ids else reader)
    readiness.append({'file_id':fid,'source_id':o['source_id'],'role':'dataset','input_path':o['input_path'],'input_sha256':o['registered_sha256'],'observed_bytes':o['observed_bytes'],'document_family_id':o.get('document_family_id'),'document_version_id':o.get('document_version_id'),'format_family':fmt,'prepared_representation':prepared_representation,'readiness_status':status,'readiness':status,'blocking_items':blocks,'disabled_capabilities':disabled,'verified_field_contract_refs':field_refs,'historical_action':historical_action,'actual_action':action,'quality_flags':[x for x in q if x],'reader_entrypoint':entry,'data_contract_refs':[str(OUT/'DATA_CONTRACTS.jsonl')+'#contract_id='+cm],'artifact_refs':artifacts,'evidence_refs':ev,'limitations':limitations,'source_mutated':False})

# Reuse complete inventories, preserving what was and was not content-read.
members=[]
probes={(x['container_file_id'],x['member_path']):x for x in rows(OUT/'ZIP_MEMBER_PROBES.jsonl')}
zip_schemas={(x['container_file_id'],x['member_path']):x for x in rows(OUT/'CONTAINER_MEMBER_SCHEMAS.jsonl') if x.get('member_path') is not None}
tar_schemas={(x['container_file_id'],x['member_path']):x for x in rows(OUT/'TAR_MEMBER_SCHEMAS.jsonl') if x.get('member_path') is not None}
json_member_keys={(x['container_file_id'],x['member_path']) for x in rows(OUT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl') if x.get('complete')}
workbook_member_keys={(x['container_file_id'],x['member_path']) for x in rows(OUT/'CONTAINER_WORKBOOK_PROFILES.jsonl')}
nested_mat_rows=rows(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl')
nested_mat_member_keys={(x['container_file_id'],x['nested_archive_member']) for x in nested_mat_rows}
nested_mat_inner_keys={(x['container_file_id'],x['nested_archive_member']+'!/'+x['mat_member']) for x in nested_mat_rows}
rda_rows=rows(OUT/'rda_supplement/RDA_MEMBER_READINESS.jsonl')
rda_by_key={(x['outer_file_id'],x['canonical_member_locator']):x for x in rda_rows}
image_rows=rows(OUT/'image_supplement/MEMBER_PROFILES.jsonl')
image_by_key={(x['container_file_id'],x['member_path']):x for x in image_rows}
tar_json_keys={(x['container_file_id'],x['member_path']) for x in rows(OUT/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl') if x.get('complete')}
tar_csv_keys={(x['container_file_id'],x['member_path']) for x in rows(OUT/'TAR_CSV_SECTION_CONTRACTS.jsonl') if x.get('status')=='SECTION_CONTRACT_READY'}
for origin,p in [('pending35',EXT/'datasets67/CONTAINER_COMPONENTS.jsonl'),('mapped_existing',MAP/'CONTAINER_COMPONENTS.jsonl')]:
    component_rows=rows(p);component_counts=collections.Counter((x.get('container_file_id'),x.get('parent_member_path'),x.get('member_path','')) for x in component_rows)
    for i,x in enumerate(component_rows):
        fid=x.get('container_file_id'); raw_path=x.get('member_path','');parent=x.get('parent_member_path');path=(parent+'!/'+raw_path) if parent else raw_path
        pr=probes.get((fid,raw_path)) if not parent else None; isdir=bool(x.get('is_directory') or x.get('directory') or (pr and pr['directory']))
        selector_fields={'container_file_id':fid,'member_path':raw_path}
        if parent:selector_fields['parent_member_path']=parent
        selector=urllib.parse.urlencode(selector_fields)
        schema=(zip_schemas.get((fid,raw_path)) or tar_schemas.get((fid,raw_path))) if not parent else None
        base_status='EXCLUDED_DIRECTORY' if isdir else (schema.get('read_status') if schema else (pr.get('read_status') if pr else ('BOUNDED_CONTENT_OBSERVED' if x.get('member_content_read') or x.get('content_sampled') else 'DIRECTORY_METADATA_ONLY')))
        if '/._' in path or path.startswith('._'): base_status='EXCLUDED_NON_DATA_RESOURCE_FORK'
        if schema and schema.get('read_status')=='CLASSIFIED_BY_SUFFIX' and schema.get('role')=='non_data_asset_or_code':base_status='CLASSIFIED_NON_DATA_ASSET_OR_CODE_NOT_EXECUTED'
        schema_ref=(str(OUT/'CONTAINER_MEMBER_SCHEMAS.jsonl') if (fid,path) in zip_schemas else str(OUT/'TAR_MEMBER_SCHEMAS.jsonl'))+'#'+selector if schema else None
        historical_ref=[str(p)+'#'+selector] if component_counts[(fid,parent,raw_path)]==1 else []
        old_error=schema.get('error') if schema else (pr.get('error') if pr else None)
        resolution=gap_resolutions.get((fid,raw_path)) if not parent else None
        current_error=None if base_status=='EXCLUDED_NON_DATA_RESOURCE_FORK' or resolution and resolution.get('resolution_status') else old_error
        resolution_ref=[str(OUT/'CONTAINER_GAP_RESOLUTIONS.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':fid,'member_path':raw_path})] if resolution else []
        members.append({'member_id':f'{fid}:{i}','container_file_id':fid,'member_path':path,'parent_member_path':parent,'inner_member_path':raw_path if parent else None,'member_kind':'directory' if isdir else 'file','member_role':schema.get('role') if schema else ('nested_member' if parent else None),'declared_or_suffix_format':x.get('member_format') or pathlib.Path(raw_path).suffix.lower() or None,'detected_format':pr.get('detected_format') if pr else None,'uncompressed_bytes':x.get('uncompressed_bytes'),'compressed_bytes':x.get('compressed_bytes'),'content_read':bool(schema and schema.get('bytes_read')) or bool(pr and pr.get('bytes_read')) or bool(x.get('member_content_read') or x.get('content_sampled')),'bytes_read':schema.get('bytes_read',0) if schema else (pr.get('bytes_read',0) if pr else 0),'readiness_status':base_status,'reader_entrypoint':None,'execution_status':'NEVER_EXECUTED','historical_error':old_error,'error':current_error,'evidence_refs':historical_ref+([str(OUT/'ZIP_MEMBER_PROBES.jsonl')+'#'+selector] if pr else [])+([schema_ref] if schema_ref else [])+resolution_ref,'inventory_origin':origin})

for m in members:
    key=(m['container_file_id'],m['member_path'])
    if key in json_member_keys:
        m['readiness_status']='FULL_STREAM_PATH_TYPE_SCHEMA';m['content_read']=True;m['bytes_read']=m.get('uncompressed_bytes')
        m['evidence_refs'].append(str(OUT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'member_path':key[1]}))
    if key in workbook_member_keys:
        m['readiness_status']='FULL_WORKBOOK_SHEET_HEADER_FORMULA_CONTRACT';m['content_read']=True
        m['evidence_refs'].append(str(OUT/'CONTAINER_WORKBOOK_PROFILES.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'member_path':key[1]}))
    if key in nested_mat_member_keys:
        m['readiness_status']='FULL_ALL_STRUCT_ELEMENTS_SCHEMA';m['content_read']=True
        for row in nested_mat_rows:
            if (row['container_file_id'],row['nested_archive_member'])==key:
                m['evidence_refs'].append(str(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'nested_archive_member':key[1],'mat_member':row['mat_member']}))
    if key in nested_mat_inner_keys:
        m['readiness_status']='FULL_ALL_STRUCT_ELEMENTS_SCHEMA';m['content_read']=True;m['error']=None
        nested,inner=key[1].split('!/',1)
        m['evidence_refs'].append(str(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'nested_archive_member':nested,'mat_member':inner}))
    if m.get('parent_member_path') and key not in nested_mat_inner_keys:
        suffix=(m.get('declared_or_suffix_format') or '').lower()
        if m['member_kind']=='directory' or suffix in ('','<none>'):
            m['readiness_status']='NESTED_DIRECTORY_INVENTORIED';m['error']=None
        elif suffix in ('.txt','.html','.rmd'):
            m['readiness_status']='NESTED_DOCUMENT_SIGNATURE_AND_ROLE_IDENTIFIED';m['error']=None
        elif suffix=='.m':
            m['readiness_status']='NESTED_SOURCE_TEXT_IDENTIFIED_NOT_EXECUTED';m['error']=None
        elif suffix=='.rda':
            m['readiness_status']='NESTED_RDA_PENDING_SUPPLEMENT';m['error']=None
    if key in rda_by_key:
        rr=rda_by_key[key];m['readiness_status']=rr['status'];m['content_read']=True;m['error']=None;m['reader_entrypoint']=rr['reader_entrypoint'];m['member_role']='data'
        m['evidence_refs'].append(str(OUT/'rda_supplement/RDA_MEMBER_READINESS.jsonl')+'#'+urllib.parse.urlencode({'outer_file_id':rr['outer_file_id'],'nested_archive_member':rr['nested_archive_member'],'inner_member_path':rr['inner_member_path']}))
    if key in image_by_key:
        ir=image_by_key[key];m['readiness_status']=ir['readiness_status'];m['content_read']=True;m['bytes_read']=ir.get('bytes_read',m.get('bytes_read'));m['error']=ir.get('error');m['member_role']=ir.get('role');m['detected_format']=ir.get('actual_format')
        if ir['readiness_status']=='READY_NATIVE_IMAGE_FRAMES_WITH_CALIBRATION_LIMITS':m['reader_entrypoint']=str(OUT/'image_supplement/native_image_reader.py')
        m['evidence_refs'].append(str(OUT/'image_supplement/MEMBER_PROFILES.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'member_path':key[1]}))
    if key in tar_json_keys:
        m['readiness_status']='FULL_STREAM_PATH_TYPE_SCHEMA';m['content_read']=True;m['error']=None;m['reader_entrypoint']=reader;m['member_role']='data'
        m['evidence_refs'].append(str(OUT/'TAR_JSON_GZ_FULL_SCHEMAS.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'member_path':key[1]}))
    if key in tar_csv_keys:
        m['readiness_status']='FULL_SECTIONED_CSV_DATA_CONTRACT';m['content_read']=True;m['error']=None;m['reader_entrypoint']=str(OUT/'read_sectioned_tar_csv.py');m['member_role']='data'
        m['evidence_refs'].append(str(OUT/'TAR_CSV_SECTION_CONTRACTS.jsonl')+'#'+urllib.parse.urlencode({'container_file_id':key[0],'member_path':key[1]}))
    resolution=gap_resolutions.get((key[0],key[1]))
    if resolution and resolution.get('resolution_status')=='SCHEMA_READ_WORKBOOK':
        m['readiness_status']='RESOLVED_MISLABELED_OOXML_WORKBOOK_SCHEMA';m['content_read']=True;m['error']=None

contracts=[
 {'contract_id':'CSV_TIMESERIES','formats':['CSV'],'reader':reader,'mode':'stream_rows','missing_policy':'preserve blanks/null; never coerce to zero','nonfinite_policy':'reject or flag nonfinite numeric values','time_policy':'split at Test_Time backsteps; never integrate across resets','units_policy':'unknown unless authoritative source metadata explicitly supplies field units; block unit-dependent calculations','protocol_refs':[src17,src18]},
 {'contract_id':'JSON_SAFE_READ','formats':['JSON'],'reader':reader,'mode':'json-events streams typed events; json-structure offers strict validation','nonfinite_policy':'bare NaN/Infinity/-Infinity are returned as dedicated typed nonfinite events, distinct from native strings and objects; source is not rewritten','schema_artifact':str(OUT/'CONTAINER_JSON_FULL_SCHEMAS.jsonl'),'source_immutable':True},
 {'contract_id':'XLSX_SAFE_READ','formats':['XLSX'],'reader':reader,'mode':'read_only workbook metadata/cells with sheet-role and selected-header contracts','formula_policy':'report every formula cell found across each used worksheet; never calculate formulas, execute macros, or follow external links','schema_artifact':str(OUT/'CONTAINER_WORKBOOK_CONTRACTS.jsonl'),'units_policy':'only explicit unit cells are observed declarations; scientific use still requires the applicable field contract'},
 {'contract_id':'MAT_SAFE_READ','formats':['MAT'],'reader':reader,'mode':'hdf5_batch_reader resolves exact HDF5 reference fields with element/byte bounds; read_nested_mat reads bounded numeric fields from all observed nested Level5 struct variants; numeric NPZ with allow_pickle=False is used for decoded MCOS tables','object_policy':'never invoke MATLAB object methods; passive MCOS raw-property decoding is allowed','hdf5_contract':str(OUT/'HDF5_BATCH_CONTRACTS.jsonl'),'nested_struct_contract':str(OUT/'NESTED_MAT_STRUCT_SCHEMAS_V2.jsonl'),'mcos_artifact':str(OUT/'MCOS_TABLE_CONTRACTS.jsonl')},
 {'contract_id':'ZIP_SAFE_READ','formats':['ZIP','TGZ','GZ'],'reader':reader,'mode':'complete member inventory plus format-specific full JSON path/type schemas, workbook sheet/header/formula contracts, and all-element nested MAT struct schemas where applicable','extraction_policy':'no bulk extraction; no execution; path traversal rejected','coverage_note':'non-data members are role-classified; scientific applicability is governed separately by field contracts'},
 {'contract_id':'TAR_SECTIONED_CSV_READ','formats':['SECTIONED_CSV_IN_TAR'],'reader':str(OUT/'read_sectioned_tar_csv.py'),'mode':'bounded rows from the Data section after exact contract header verification','section_policy':'Summary and Protocol are preamble; Data contains the measurement header and conforming rows; later sections are excluded','units_policy':'only literal units embedded in the actual header are exposed; no calibration or unit inference','schema_artifact':str(OUT/'TAR_CSV_SECTION_CONTRACTS.jsonl'),'source_immutable':True},
 {'contract_id':'NUMERIC_SUFFIX_SAFE_READ','formats':['0','1','2','3','4','5','6'],'reader':reader,'mode':'stream numeric text','units_policy':'unknown absent authoritative declaration'}]
for x in readiness:
    if x['file_id'] in tar_csv_container_ids: x['data_contract_refs'].append(str(OUT/'DATA_CONTRACTS.jsonl')+'#contract_id=TAR_SECTIONED_CSV_READ')

# No unresolved structural decoder failure remains. Scientific fit and unsupported unit
# calculations remain disabled capabilities on the affected fields rather than hidden gaps.
dump('FILE_READINESS.jsonl',readiness); dump('MEMBER_READINESS.jsonl',members); dump('DATA_CONTRACTS.jsonl',contracts); dump('OPEN_ITEMS.jsonl',open_items)
summary={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'file_rows':len(readiness),'member_rows':len(members),'status_counts':dict(collections.Counter(x['readiness_status'] for x in readiness)),'format_counts':dict(collections.Counter(x['format_family'] for x in readiness)),'blocking_open_items':len(open_items),'source_objects':str(ROOT/'SOURCE_OBJECTS.jsonl'),'historical_run':str(EXT)}
(OUT/'BUILD_RESULTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))

