"""Merge bounded mapping evidence; check identities and claims, never read raw bodies."""
from pathlib import Path
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json

RUN = Path(__file__).resolve().parent
STATUSES = {
    'STRUCTURE_IDENTIFIED', 'PROVISIONAL_METADATA_ONLY',
    'UNKNOWN_RESTRICTED', 'UNKNOWN_INSUFFICIENT_EVIDENCE',
}
BASIS_KINDS = {'OBSERVED_THIS_RUN', 'REUSED_EXISTING_EVIDENCE', 'METADATA_INFERENCE'}
FORMAT_LABELS = {
    'text/html': 'HTML', 'application/pdf': 'PDF', 'text/markdown': 'Markdown',
    'text/x-rst': 'RST', 'text/x-python': 'Python source',
    'application/xml': 'XML', 'text/plain': 'Text',
}
REQUIRED = {
    'file_id', 'technical_format', 'semantic_type', 'structure_variant',
    'structure_signature', 'mapping_status', 'profile', 'evidence_refs',
    'basis', 'limitations', 'unknowns', 'content_access',
}


def read_rows(path):
    return [json.loads(x) for x in path.read_text(encoding='utf-8-sig').splitlines() if x.strip()]


def write_json(name, value):
    (RUN / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def write_rows(name, values):
    (RUN / name).write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in values), encoding='utf-8')


def key(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False)


def cell(value):
    return str(value).replace('|', '\\|').replace('\n', ' ')


def main():
    checks = []

    def check(name, passed, detail):
        checks.append({'check': name, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})

    scope = read_rows(RUN / 'INPUT_SCOPE.jsonl')
    expected = {x['file_id'] for x in scope}
    scope_by_id = {x['file_id']: x for x in scope}
    check('scope_identity', len(scope) == len(expected) == 300, {'rows': len(scope), 'unique_ids': len(expected)})
    fragments = []
    for lane in ('documents', 'datasets'):
        part = read_rows(RUN / lane / 'MAPPING_FRAGMENT.jsonl')
        actual = {x['file_id'] for x in part}
        wanted = {x['file_id'] for x in scope if x['assigned_lane'] == lane}
        check(lane + '_exact_coverage', actual == wanted and len(part) == len(actual),
              {'rows': len(part), 'expected': len(wanted), 'missing': sorted(wanted - actual), 'extra': sorted(actual - wanted)})
        fragments.extend(part)
    lineage_rows = read_rows(RUN / 'lineage/LINEAGE_FRAGMENT.jsonl')
    lineage_ids = {x['file_id'] for x in lineage_rows}
    check('lineage_exact_coverage', lineage_ids == expected and len(lineage_rows) == len(expected),
          {'rows': len(lineage_rows), 'missing': sorted(expected - lineage_ids), 'extra': sorted(lineage_ids - expected)})
    check('fragment_no_duplicate_ids', len(fragments) == len({x['file_id'] for x in fragments}), {'rows': len(fragments)})
    issues = []
    access_binding_issues = []
    missing_refs = []
    for row in fragments:
        fid = row['file_id']
        if REQUIRED - set(row):
            issues.append([fid, 'missing_fields', sorted(REQUIRED - set(row))])
        if row.get('mapping_status') not in STATUSES:
            issues.append([fid, 'invalid_mapping_status'])
        basis = row.get('basis', {})
        if basis.get('kind') not in BASIS_KINDS or not basis.get('inspection_scope'):
            issues.append([fid, 'invalid_evidence_basis'])
        access = row.get('content_access', {})
        if not all(k in access for k in ('performed_this_run', 'action', 'rights_basis_refs', 'reason')):
            issues.append([fid, 'incomplete_access_record'])
        if access.get('performed_this_run') and not access.get('rights_basis_refs'):
            issues.append([fid, 'new_content_access_without_recorded_basis'])
        if access.get('performed_this_run'):
            source = scope_by_id[fid]
            effective_id = source['prior_routing'].get('rights_record', {}).get('effective_rights_id')
            allowed = []
            for right in source.get('existing_rights_records', []):
                if right.get('ai_processing') != 'ALLOWED':
                    continue
                exact = right.get('file_id') == fid and right.get('file_sha256') == source['sha256_registered']
                recorded_group = (not right.get('file_id') and right.get('source_id') == source['source_id']
                                  and right.get('rights_id') == effective_id)
                if exact or recorded_group:
                    allowed.append(right['rights_id'])
            if not allowed:
                access_binding_issues.append({'file_id': fid, 'effective_rights_id': effective_id})
        if row.get('mapping_status') == 'STRUCTURE_IDENTIFIED':
            if not row.get('structure_signature') or not row.get('profile') or basis.get('kind') == 'METADATA_INFERENCE':
                issues.append([fid, 'identified_structure_lacks_structural_evidence'])
        if row.get('mapping_status') != 'STRUCTURE_IDENTIFIED' and not row.get('unknowns'):
            issues.append([fid, 'unidentified_without_explicit_unknown'])
        for name in ('limitations', 'unknowns', 'evidence_refs'):
            if not isinstance(row.get(name), list) or any(not isinstance(x, str) for x in row.get(name, [])):
                issues.append([fid, 'invalid_list', name])
        if not row.get('evidence_refs'):
            issues.append([fid, 'missing_evidence_refs'])
    relations = read_rows(RUN / 'lineage/RELATIONS.jsonl')
    for row in fragments + lineage_rows + relations:
        refs = list(row.get('evidence_refs', []))
        refs += row.get('content_access', {}).get('rights_basis_refs', [])
        refs += [b['evidence_ref'] for b in row.get('rights_bindings', []) if b.get('evidence_ref')]
        for ref in refs:
            path = Path(ref.split('#', 1)[0])
            if not path.is_absolute() or not path.is_file():
                missing_refs.append({'file_id': row.get('file_id', row.get('source_file_id')), 'reference': ref})
    check('mapping_contract_and_claim_consistency', not issues, issues)
    check('actual_access_has_exact_or_recorded_effective_group_basis', not access_binding_issues, access_binding_issues)
    check('evidence_files_resolve', not missing_refs, missing_refs)
    relation_ids = [r.get('relation_id') for r in relations]
    broken_relations = []
    known_relations = set(relation_ids)
    relations_by_id = {r['relation_id']: r for r in relations}
    referenced_relations = set()
    for row in lineage_rows:
        for rid in row.get('relation_ids', []):
            referenced_relations.add(rid)
            if rid not in known_relations:
                broken_relations.append({'file_id': row['file_id'], 'relation_id': rid})
            elif relations_by_id[rid]['source_file_id'] != row['file_id']:
                broken_relations.append({'file_id': row['file_id'], 'relation_id': rid, 'reason': 'wrong_source'})
    broken_relations += [{'relation_id': r['relation_id'], 'reason': 'source_outside_scope'} for r in relations if r['source_file_id'] not in expected]
    broken_relations += [{'relation_id': rid, 'reason': 'unreferenced'} for rid in known_relations - referenced_relations]
    check('relation_references', not broken_relations and None not in known_relations and len(known_relations) == len(relations),
          {'relations': len(relations), 'broken_references': broken_relations})
    components_path = RUN / 'datasets/CONTAINER_COMPONENTS.jsonl'
    components = read_rows(components_path) if components_path.exists() else []
    dataset_ids = {r['file_id'] for r in scope if r['assigned_lane'] == 'datasets'}
    component_keys = [(r['container_file_id'], r.get('member_index', r['member_path'])) for r in components]
    invalid_components = [r for r in components if r['container_file_id'] not in dataset_ids or r.get('member_content_read') is not False]
    check('container_members_separate_and_traceable', not invalid_components and len(set(component_keys)) == len(component_keys),
          {'records': len(components), 'unique_locators': len(set(component_keys)), 'invalid_records': invalid_components})
    snapshot = json.loads((RUN / 'INPUT_SNAPSHOT.json').read_text(encoding='utf-8-sig'))
    changed_inputs = []
    for item in snapshot['inputs']:
        path = Path(item['path'])
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
            changed_inputs.append(item['path'])
    check('frozen_input_ledgers_unchanged', not changed_inputs, {'checked_ledgers': len(snapshot['inputs']), 'changed': changed_inputs})
    result = {'run_id': RUN.name, 'checked_at_utc': datetime.now(timezone.utc).isoformat(),
              'scope': 'LOCAL_MAPPING_IDENTITY_CONTRACT_AND_EVIDENCE_REFERENCE_CHECKS_ONLY',
              'raw_source_hashes_recomputed': 0, 'status': 'PASS' if all(c['status'] == 'PASS' for c in checks) else 'FAIL', 'checks': checks}
    write_json('CHECK_RESULTS.json', result)
    if result['status'] != 'PASS':
        print(json.dumps({'status': 'FAIL', 'failed_checks': [c for c in checks if c['status'] == 'FAIL']}, ensure_ascii=False))
        raise SystemExit(1)

    by_id = {x['file_id']: x for x in fragments}
    lineage = {x['file_id']: x for x in lineage_rows}
    merged, gaps = [], []
    for source in scope:
        fid = source['file_id']
        item = {'mapping_version': 'CR-DATA-MAP-001/v1', **{k: source[k] for k in (
            'file_id', 'source_id', 'relative_path', 'sha256_registered', 'bytes_registered', 'assigned_lane')},
            **by_id[fid], 'lineage': lineage[fid]}
        item['format_family'] = FORMAT_LABELS.get(item['technical_format'], item['technical_format'])
        item['document_family_id'] = source['prior_routing'].get('document_family_id')
        item['document_version_id'] = source['prior_routing'].get('document_version_id')
        if item['mapping_status'] != 'STRUCTURE_IDENTIFIED':
            item['identified_scope_class'] = 'METADATA_ONLY_INTERNAL_STRUCTURE_UNINSPECTED'
        elif item['format_family'] == 'PDF':
            item['identified_scope_class'] = 'PDF_PAGE_RESOURCES_AND_SELECTED_TEXT_LAYERS'
        elif item['assigned_lane'] == 'documents':
            item['identified_scope_class'] = 'REGISTERED_DERIVED_TEXT_MARKERS'
        else:
            item['identified_scope_class'] = {
                'CSV': 'HISTORICAL_EXACT_FILE_CSV_SUMMARY' if item['basis']['kind'] == 'REUSED_EXISTING_EVIDENCE' else 'CSV_BOUNDED_HEADER',
                'XLSX': 'XLSX_BOUNDED_WORKSHEET_FIELDS',
                'MAT': 'MAT_BOUNDED_VARIABLE_DIRECTORY',
                'JSON': 'JSON_BOUNDED_KEYS_AND_TYPES',
                'ZIP': 'ZIP_CENTRAL_DIRECTORY_ONLY',
            }.get(item['format_family'], 'SEE_PER_FILE_INSPECTION_SCOPE')
        merged.append(item)
        kinds = []
        if item['mapping_status'] != 'STRUCTURE_IDENTIFIED':
            kinds.append(item['mapping_status'])
        if item['unknowns']:
            kinds.append('STRUCTURE_OR_SEMANTIC_UNKNOWN')
        if lineage[fid].get('unknowns'):
            kinds.append('LINEAGE_OR_BINDING_UNKNOWN')
        if kinds:
            gaps.append({'file_id': fid, 'source_id': source['source_id'], 'gap_types': kinds,
                         'mapping_status': item['mapping_status'], 'mapping_unknowns': item['unknowns'],
                         'lineage_unknowns': lineage[fid].get('unknowns', []),
                         'inspection_limits': item['limitations'],
                         'evidence_refs': sorted(set(item['evidence_refs'] + lineage[fid].get('evidence_refs', [])))})
    write_rows('DATA_MAPPING.jsonl', merged)
    write_rows('MAPPING_GAPS.jsonl', gaps)
    statuses = Counter(x['mapping_status'] for x in merged)
    basis = Counter(x['basis']['kind'] for x in merged)
    lanes = Counter(x['assigned_lane'] for x in merged)
    groups = defaultdict(list)
    for row in merged:
        groups[(row['format_family'], row['semantic_type'], row['structure_variant'])].append(row)
    counts = {'original_representations': len(merged), 'sources_in_scope': len({x['source_id'] for x in merged}),
              'registered_content_hashes': len({x['sha256_registered'] for x in merged}),
              'lane_counts': dict(lanes), 'mapping_status_counts': dict(statuses), 'primary_basis_counts': dict(basis),
              'identified_scope_class_counts': dict(Counter(x['identified_scope_class'] for x in merged)),
              'files_with_recorded_gaps': len(gaps), 'relation_records': len(relations),
              'container_component_records': len(components),
              'files_with_content_or_derivative_access_this_run': sum(x['content_access']['performed_this_run'] is True for x in merged),
              'registration_coverage': {'numerator': len(merged), 'denominator': 300},
              'declared_scope_structure_identification': {'numerator': statuses['STRUCTURE_IDENTIFIED'], 'denominator': 300}}
    write_json('MAPPING_COUNTS.json', counts)
    lines = ['# 实际数据类型与结构汇总', '',
             '范围：Phase A 的 300 份原件表示。以下将格式、语义与结构变体分列；原件、容器成员、派生产物不合并计数。', '',
             '“结构已识别”只适用于逐文件记录中的检查范围；容器目录、PDF 文本派生或表头均不能证明内部数据、原始版式或全量内容已核实。文档语义仍为名称/台账推断，逐条标有 semantic_basis，不能等同于内容语义核验。', '',
             '|格式|内容语义|结构变体|原件数|已识别|已识别签名数|示例 file_id|',
             '|---|---|---|---:|---:|---:|---|']
    for grouping, values in sorted(groups.items()):
        identified = [x for x in values if x['mapping_status'] == 'STRUCTURE_IDENTIFIED']
        signatures = {key(x['structure_signature']) for x in identified}
        lines.append('|' + '|'.join(cell(x) for x in (*grouping, len(values), len(identified), len(signatures), values[0]['file_id'])) + '|')
    lines.extend(['', '完整结构签名、逐文件证据与检查边界见 `DATA_MAPPING.jsonl`；未识别与关联缺口见 `MAPPING_GAPS.jsonl`。', '',
                  '识别范围分布：', '', '|检查范围|原件数|', '|---|---:|'])
    for scope_class, count in sorted(counts['identified_scope_class_counts'].items()):
        lines.append(f'|{scope_class}|{count}|')
    lines.extend(['',
                  '本表未确定处理工具、目标输出或验证方案，这些属于后续 METHOD-01/02。', ''])
    (RUN / 'TYPE_STRUCTURE_SUMMARY.md').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps({'status': 'PASS', **counts}, ensure_ascii=False))


if __name__ == '__main__':
    main()
