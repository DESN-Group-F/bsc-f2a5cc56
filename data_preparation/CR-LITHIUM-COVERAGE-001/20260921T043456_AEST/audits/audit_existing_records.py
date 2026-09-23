import hashlib
import json
import re
from pathlib import Path

RUN = Path(__file__).resolve().parents[1]
MODEL = RUN / "existing" / "MODEL_EVIDENCE.jsonl"
OUT = RUN / "audits" / "EXISTING_RECORD_AUDIT.jsonl"
CHECK = RUN / "audits" / "EXISTING_CHECK_RESULTS.json"


def load_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def norm(value):
    return re.sub(r"[^a-z0-9]+", "", str(value).lower())


rows = load_jsonl(MODEL)
cache = {}


def file_rows(path):
    key = str(path)
    if key not in cache:
        if path.suffix.lower() == ".jsonl":
            cache[key] = load_jsonl(path)
        elif path.suffix.lower() == ".json":
            cache[key] = [json.loads(path.read_text(encoding="utf-8"))]
        else:
            cache[key] = []
    return cache[key]


def flatten_objects(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from flatten_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from flatten_objects(child)


def resolve(ref):
    raw_path, _, frag = ref.partition("#")
    path = Path(raw_path)
    if not path.exists():
        return path, [], False
    objects = file_rows(path)
    if not frag or not objects:
        return path, objects, True
    if frag == "sample-id-occurrence":
        return path, objects, True
    conditions = []
    for token in frag.split("&"):
        if "=" in token:
            k, v = token.split("=", 1)
            conditions.append((k, v))
        elif ":" in token:
            conditions.append(("locator", token))
    selected = []
    for obj in flatten_objects(objects):
        ok = True
        for k, v in conditions:
            if str(obj.get(k)) != v:
                ok = False
                break
        if ok:
            selected.append(obj)
    return path, selected, bool(selected)


review_path = Path(r"E:\desn 2000\bsc\data_preparation\CR-DATA-CANDIDATE-001\20260920T045258_AEST\review_restricted\REVIEW_RESULTS.jsonl")
review_rows = load_jsonl(review_path)
review_by_id = {r["fact_id"]: r for r in review_rows}

audits = []
fact_count = 0
resolved_fact_count = 0
missing_ref_total = 0

for row in rows:
    findings = []
    evidence_objects = []
    missing_refs = []
    for ref in row.get("source_refs", []):
        path, selected, resolved = resolve(ref)
        if not path.exists() or not resolved:
            missing_refs.append(ref)
        evidence_objects.extend(selected)
    if missing_refs:
        findings.append({"code": "UNRESOLVED_SOURCE_REF", "items": missing_refs})
        missing_ref_total += len(missing_refs)

    fact_results = []
    for fact in row.get("facts", []):
        fact_count += 1
        ref = fact["evidence_location"]
        path_s, _, fragment = ref.partition("#")
        path = Path(path_s)
        passed = False
        detail = ""
        if "fact_id=" in fragment:
            fid = fragment.split("fact_id=", 1)[1].split("&", 1)[0]
            evidence = review_by_id.get(fid)
            if evidence:
                pairs = {(str(q.get("value_text")), q.get("unit")) for q in evidence.get("quantity_bindings", [])}
                passed = (str(fact["value"]), fact.get("unit")) in pairs
                detail = f"fact_id={fid}; quantity_binding_match={passed}"
                if passed:
                    resolved_fact_count += 1
            else:
                detail = f"missing fact_id={fid}"
        else:
            _, selected, resolved = resolve(ref)
            text = json.dumps(selected, ensure_ascii=False)
            comparator = fact.get("comparator_or_range")
            if comparator == "SOURCE_BOUND_EQUIVALENT_REPRESENTATION":
                numbers = re.findall(r"\d+(?:\.\d+)?", str(fact["value"]))
                passed = resolved and all(number in text for number in numbers)
            elif comparator == "SOURCE_BOUND_PARAPHRASE":
                value_tokens = [t for t in re.findall(r"[A-Za-z0-9]+", str(fact["value"])) if len(t) > 2]
                required = [t for t in value_tokens if t.lower() not in {"cathode", "trace", "reported", "results", "also", "showed", "elements", "of", "by"}]
                passed = resolved and all(norm(t) in norm(text) for t in required)
            else:
                passed = resolved and norm(fact["value"]) in norm(text)
            detail = f"locator_resolved={resolved}; comparator={comparator}; value_visible={passed}"
            if passed:
                resolved_fact_count += 1
        fact_results.append({"field": fact["field"], "evidence_location": ref, "passed": passed, "detail": detail})
        if not passed:
            findings.append({"code": "FACT_EVIDENCE_MISMATCH", "field": fact["field"], "evidence_location": ref})

    combined = json.dumps(evidence_objects, ensure_ascii=False)
    if row.get("review_rows_merged"):
        joined = [review_by_id.get(fid) for fid in row["review_rows_merged"] if review_by_id.get(fid)]
        combined += json.dumps(joined, ensure_ascii=False)
        if len(joined) != len(row["review_rows_merged"]):
            findings.append({"code": "MISSING_MERGED_REVIEW_ROW"})

    identity_tokens = [row["model_label"], row["canonical_identity"], *row.get("aliases", [])]
    identity_visible = any(norm(token) and norm(token) in norm(combined) for token in identity_tokens)
    if not identity_visible and row["identity_kind"] == "SERIES":
        stop = {"battery", "cells", "cell", "commercial", "cohort", "dataset", "sample"}
        words = [w.lower() for w in re.findall(r"[A-Za-z0-9]+", row["model_label"]) if len(w) > 3 and w.lower() not in stop]
        identity_visible = bool(words) and sum(norm(w) in norm(combined) for w in words) >= min(2, len(words))
    if not identity_visible:
        findings.append({"code": "IDENTITY_NOT_VISIBLE_IN_RESOLVED_EVIDENCE"})

    if row["identity_kind"] == "SAMPLE_ID" and row["record_id"].startswith("EXIST-TRI"):
        identity_visible = identity_visible or any(norm(row["model_label"]) in norm(str(obj.get("relative_path", ""))) for obj in evidence_objects)
        findings = [f for f in findings if not (f["code"] == "IDENTITY_NOT_VISIBLE_IN_RESOLVED_EVIDENCE" and identity_visible)]

    if row["identity_kind"] == "EXACT_MODEL" and row["canonical_identity"] == "IBR18650B/BB/BC":
        findings.append({"code": "SLASH_GROUP_MUST_NOT_BE_EXACT"})
    if row["identity_kind"] == "SAMPLE_ID" and row["content_depth"] not in {
        "RESEARCH_SAMPLE_IDENTIFIER",
        "RESEARCH_SAMPLE_METADATA_AND_PROTOCOL_DECLARATION",
        "REGISTERED_RESEARCH_CELL_FILE_METADATA",
        "REGISTERED_RESEARCH_SAMPLE_FILE_METADATA",
    }:
        findings.append({"code": "SAMPLE_DEPTH_INCONSISTENT"})
    if row["content_depth"] == "SDS_MODEL_TABLE_ROW_ONLY":
        if row["chemistry"] != "UNKNOWN" or row["form_factor"] != "UNKNOWN":
            findings.append({"code": "SDS_PREFIX_OR_SIZE_INFERENCE"})
        if row["use_status"] != "NOT_ALLOWED_FOR_LOCAL_RAG__FACT_INVENTORY_ONLY":
            findings.append({"code": "SRC038_USE_UPGRADED"})

    audits.append({
        "record_id": row["record_id"],
        "identity_kind": row["identity_kind"],
        "content_depth": row["content_depth"],
        "source_ref_count": len(row.get("source_refs", [])),
        "fact_count": len(row.get("facts", [])),
        "fact_results": fact_results,
        "identity_visible_in_resolved_evidence": identity_visible,
        "status": "PASSED" if not findings else "FAILED",
        "findings": findings,
    })

OUT.write_text("".join(json.dumps(a, ensure_ascii=False, sort_keys=True) + "\n" for a in audits), encoding="utf-8")
failed = [a for a in audits if a["status"] == "FAILED"]
result = {
    "status": "PASSED" if not failed else "FAILED",
    "scope": "All EXISTING MODEL_EVIDENCE rows: source selector resolution, identity visibility, every quantitative fact against its cited evidence object, identity/depth guardrails and SRC-038 use preservation.",
    "input": str(MODEL),
    "input_sha256": hashlib.sha256(MODEL.read_bytes()).hexdigest(),
    "records_checked": len(audits),
    "records_passed": len(audits) - len(failed),
    "records_failed": len(failed),
    "facts_checked": fact_count,
    "facts_matched": resolved_fact_count,
    "unresolved_source_refs": missing_ref_total,
    "failed_record_ids": [a["record_id"] for a in failed],
    "audit_output": str(OUT),
    "audit_output_sha256": hashlib.sha256(OUT.read_bytes()).hexdigest(),
    "limitations": [
        "This checks claims against the already prepared cited evidence objects; it does not reopen restricted originals or infer missing product facts.",
        "No server, model, RAG, market-availability or site-safety acceptance is tested.",
    ],
}
CHECK.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
