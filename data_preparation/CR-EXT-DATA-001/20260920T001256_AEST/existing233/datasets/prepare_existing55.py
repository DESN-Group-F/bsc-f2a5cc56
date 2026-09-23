from __future__ import annotations
import json, re, time, zipfile
from collections import Counter
from pathlib import Path
import h5py, openpyxl

RUN=Path(r"E:\desn 2000\bsc\data_preparation\CR-EXT-DATA-001\20260920T001256_AEST")
SOURCE=Path(r"E:\desn 2000\data\battery_data_workspace_v0_3"); OUT=RUN/"existing233"/"datasets"
OLD=Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-MAP-001\20260919T233638_AEST\datasets")
def jl(p):return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
def dump(p,r):p.write_text("".join(json.dumps(x,ensure_ascii=False,sort_keys=True)+"\n" for x in r),encoding="utf-8")

def workbook(path,fid):
    wb=openpyxl.load_workbook(path,read_only=True,data_only=False,keep_links=False); sheets=[]
    try:
        for ws in wb.worksheets:
            rows=nonempty=formulas=errors=0; max_cols=0; candidate=[]; type_counts=Counter()
            for row in ws.iter_rows():
                rows+=1;max_cols=max(max_cols,len(row)); vals=[c.value for c in row]
                non=[v for v in vals if v is not None];nonempty+=len(non)
                if non and len(candidate)<10:candidate.append([str(v)[:200] for v in non[:100]])
                for v in non:
                    if isinstance(v,str) and v.startswith("="):formulas+=1;type_counts["formula"]+=1
                    elif isinstance(v,str) and v.startswith("#"):errors+=1;type_counts["error_like_string"]+=1
                    else:type_counts[type(v).__name__]+=1
            fields=max(candidate,key=len,default=[])
            sheets.append({"sheet_name":ws.title,"rows_iterated":rows,"max_columns_iterated":max_cols,"nonempty_cells":nonempty,"formula_cells":formulas,"error_like_string_cells":errors,"cell_type_counts":dict(type_counts),"fields":fields})
    finally:wb.close()
    return {"file_id":fid,"structure":"xlsx_complete_cell_metadata","sheets":sheets,"values_retained":False,"formulas_evaluated":False,"units_verified":False,"conditions_verified":False,"scope":"all workbook cells iterated; only field candidates and aggregate quality retained"}

def mat_hdf(path,fid):
    counts=Counter(); dtypes=Counter(); ranks=Counter(); compressions=Counter(); paths=[]; root=[]; error=None; complete=False
    try:
        with h5py.File(path,"r") as h:
            root=list(h.keys())
            def visit(name,obj):
                counts["group" if isinstance(obj,h5py.Group) else "dataset"]+=1
                if len(paths)<1000:paths.append({"path":name,"kind":"group" if isinstance(obj,h5py.Group) else "dataset","shape":list(obj.shape) if isinstance(obj,h5py.Dataset) else None,"dtype":str(obj.dtype) if isinstance(obj,h5py.Dataset) else None})
                if isinstance(obj,h5py.Dataset):dtypes[str(obj.dtype)]+=1;ranks[len(obj.shape)]+=1;compressions[str(obj.compression)]+=1
            h.visititems(visit);complete=True
    except Exception as exc:error=f"{type(exc).__name__}: {exc}"
    return {"file_id":fid,"structure":"mat73_hdf5_complete_directory_aggregate","complete_directory_enumeration":complete,"error":error,"root_keys":root,"node_counts":dict(counts),"dtype_counts":dict(dtypes),"rank_counts":dict(ranks),"compression_counts":dict(compressions),"first_1000_path_metadata":paths,"array_values_read":False,"units_verified":False,"conditions_verified":False}

def json_shape(value,depth=0):
    if depth>=8:return {"type":type(value).__name__,"deeper":"not expanded"}
    if isinstance(value,dict):return {"type":"object","keys":sorted(value.keys()),"children":{k:json_shape(v,depth+1) for k,v in value.items()}}
    if isinstance(value,list):return {"type":"array","length":len(value),"item_shapes":[json_shape(x,depth+1) for x in value[:3]]}
    return {"type":type(value).__name__}

def archive_declarations(path,row):
    out=[]; derived=OUT/"derived"/row["file_id"];derived.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(path) as z:
        candidates=[i for i in z.infolist() if not i.is_dir() and (Path(i.filename).name.lower().startswith(("readme","license","protocol")) or Path(i.filename).suffix.lower() in {".md",".txt"}) and i.file_size<=2*1024*1024]
        for idx,info in enumerate(candidates):
            data=z.read(info); target=derived/f"{idx:03d}_{Path(info.filename).name}";target.write_bytes(data)
            text=data.decode("utf-8",errors="replace"); lines=text.splitlines(); hits=[]
            for n,line in enumerate(lines,1):
                if re.search(r"(?i)\b(unit|volt|amp|second|temperature|protocol|cycle|cell|channel|charge|discharge)\b",line):hits.append({"line":n,"keywords":sorted(set(re.findall(r"(?i)\b(unit|volt|amp|second|temperature|protocol|cycle|cell|channel|charge|discharge)\b",line.lower()))),"statement_text_local":line[:1000]})
            out.append({"file_id":row["file_id"],"archive_member":info.filename,"derived_local_path":str(target),"line_count":len(lines),"declaration_hits":hits,"interpretation":"Keyword-indexed local statement evidence only; no unit, protocol, or independent-cell claim is inferred without explicit text."})
    return out

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    scope=[r for r in jl(RUN/"INPUT_SCOPE.jsonl") if r.get("assigned_lane")=="datasets" and not r.get("pending67") and Path(r["relative_path"]).suffix.lower()!=".csv"]
    assert len(scope)==55
    oldmap={r["file_id"]:r for r in jl(OLD/"MAPPING_FRAGMENT.jsonl")}; oldcomp=jl(OLD/"CONTAINER_COMPONENTS.jsonl"); supplement={r["file_id"]:r for r in jl(OLD/"MAT_SUPPLEMENT.jsonl")}
    manifests=[];schemas=[];findings=[];declarations=[]
    for row in scope:
        fid=row["file_id"];path=SOURCE/Path(row["relative_path"]);ext=path.suffix.lower();t=time.monotonic();evidence=[f"{RUN/'INPUT_SCOPE.jsonl'}#file_id={fid}",f"{OLD/'MAPPING_FRAGMENT.jsonl'}#file_id={fid}"]
        if ext==".xlsx":
            s=workbook(path,fid);schemas.append(s);status="PREPARED_FULL_STRUCTURE_AND_QUALITY";action="FULL_WORKBOOK_CELL_METADATA"
            if any(sh["error_like_string_cells"] for sh in s["sheets"]):findings.append({"file_id":fid,"code":"ERROR_LIKE_CELL_STRING","severity":"WARNING","detail":"Workbook contains error-like string cells; formulas were not evaluated."})
        elif ext==".mat":
            gen=oldmap[fid]["profile"]["mat_generation"]
            if gen=="MATLAB_7_3_HDF5":s=mat_hdf(path,fid);status="PREPARED_FULL_DIRECTORY" if s["complete_directory_enumeration"] else "PREPARED_PARTIAL_TECHNICAL_ERROR"
            else:s={"file_id":fid,"structure":"mat5_complete_variable_directory_reused","profile":supplement[fid]["profile"],"array_values_read":False,"units_verified":False,"conditions_verified":False};status="PREPARED_FULL_DIRECTORY"
            schemas.append(s);action="FULL_MAT_DIRECTORY_METADATA_NO_ARRAY_VALUES"
            if "PARTIAL" in status:findings.append({"file_id":fid,"code":"MAT_DIRECTORY_ENUMERATION_FAILED","severity":"ERROR","detail":s["error"]})
        elif ext==".json":
            constants=[];value=json.loads(path.read_text(encoding="utf-8-sig"),parse_constant=lambda x:constants.append(x) or None);schemas.append({"file_id":fid,"structure":"json_complete_shape","shape":json_shape(value),"nonstandard_constants":sorted(set(constants)),"values_retained":False});status="PREPARED_FULL_STRUCTURE";action="FULL_JSON_SHAPE"
        elif ext==".zip":
            rows=[c for c in oldcomp if c["container_file_id"]==fid];formats=dict(Counter(c["member_path"].rsplit(".",1)[-1].lower() if "." in c["member_path"] else "<none>" for c in rows if not c["is_directory"]));schemas.append({"file_id":fid,"structure":"zip_complete_central_directory_contract","member_count":len(rows),"member_format_counts":formats,"member_content_read":False,"contract":"Members referenced by archive path; consumer must select parser by detected member format and separately validate fields/units/conditions."});status="PREPARED_FULL_CONTAINER_DIRECTORY";action="REUSED_COMPLETE_CENTRAL_DIRECTORY"
            if row["source_id"]=="SRC-017":declarations.extend(archive_declarations(path,row))
        inv=row["inventory"]
        manifests.append({"file_id":fid,"source_id":row["source_id"],"document_family_id":inv.get("document_family_id"),"document_version_id":inv.get("document_version_id"),"relative_path":row["relative_path"],"technical_format":ext[1:].upper(),"processing_status":status,"actual_local_action":action,"elapsed_seconds":round(time.monotonic()-t,3),"evidence_refs":evidence,"units_verified":False,"conditions_verified":False,"applicability_status":"UNKNOWN_UNTIL_CHEMISTRY_DEVICE_AND_PROTOCOL_MATCH","limitations":["No array values or workbook row values retained in catalog.","Directory/schema preparation does not establish scientific applicability or downstream permission."]})
    # The second SRC-017 ZIP is in pending35; extract only its small declaration files into this evidence bundle as explicitly requested.
    for row in jl(RUN/"INPUT_SCOPE.jsonl"):
        if row["file_id"]=="FILE-017-af4e7ee540be-9057bf":declarations.extend(archive_declarations(SOURCE/Path(row["relative_path"]),row))
    dump(OUT/"PREPARATION_MANIFEST.jsonl",manifests);dump(OUT/"SCHEMA_CATALOG.jsonl",schemas);dump(OUT/"QUALITY_FINDINGS.jsonl",findings);dump(OUT/"SRC017_ARCHIVE_DECLARATIONS.jsonl",declarations)
    result={"objects":len(manifests),"status_counts":dict(Counter(x["processing_status"] for x in manifests)),"format_counts":dict(Counter(x["technical_format"] for x in manifests)),"schema_rows":len(schemas),"quality_findings":len(findings),"src017_declaration_files":len(declarations)};(OUT/"RUN_RESULTS.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8");print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=="__main__":main()
