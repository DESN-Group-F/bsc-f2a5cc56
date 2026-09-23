"""Join completed preparation lanes; never promote structural checks to readiness."""
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json

RUN = Path(__file__).resolve().parent
LANES = [
    ('documents67', 'documents67/PROCESSING_MANIFEST.jsonl', 32),
    ('datasets67', 'datasets67/PROCESSING_MANIFEST.jsonl', 35),
    ('existing_documents', 'existing233/documents/PROCESSING_MANIFEST.jsonl', 38),
    ('existing_datasets', 'existing233/datasets/PREPARATION_MANIFEST.jsonl', 55),
    ('existing_csv', 'existing233/CSV_PREPARATION_MANIFEST.jsonl', 140),
]


def load_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def load_rows(path):
    return [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]


def save_json(name, value):
    (RUN / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def save_rows(name, rows):
    (RUN / name).write_text(''.join(json.dumps(row, ensure_ascii=False, allow_nan=False) + '\n' for row in rows), encoding='utf-8')


def artifact_paths(row, lane_directory):
    result = []
    for key in ('derived_outputs', 'evidence_refs'):
        for item in row.get(key, []):
            if isinstance(item, str):
                raw = item.split('#')[0]
                if raw and not raw.startswith(('https://', 'http://', '#')):
                    ref = Path(raw)
                    result.append(ref if ref.is_absolute() else lane_directory / ref)
    return result


def scoped_check_pass(data):
    if data.get('status') not in ('PASS', 'VALIDATION_PASS'):
        return False
    checks = data.get('checks')
    if not isinstance(checks, dict) or not checks:
        return False
    return all(value is True or (isinstance(value, dict) and value.get('pass') is True) for value in checks.values())


def expected_lane_ids(scope, lane):
    def matches(row):
        csv = Path(row['relative_path']).suffix.lower() == '.csv'
        if lane == 'documents67':
            return row['pending67'] and row['assigned_lane'] == 'documents'
        if lane == 'datasets67':
            return row['pending67'] and row['assigned_lane'] == 'datasets'
        if lane == 'existing_documents':
            return not row['pending67'] and row['assigned_lane'] == 'documents'
        return not row['pending67'] and row['assigned_lane'] == 'datasets' and (csv if lane == 'existing_csv' else not csv)
    return {fid for fid, row in scope.items() if matches(row)}


def main():
    scope_rows = load_rows(RUN / 'INPUT_SCOPE.jsonl')
    scope = {row['file_id']: row for row in scope_rows}
    external_requirements = load_rows(RUN / 'requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl')
    inputs_unchanged = []
    for entry in load_json(RUN / 'INPUT_SNAPSHOT.json')['inputs']:
        p = Path(entry['path'])
        inputs_unchanged.append({'path': str(p), 'unchanged': hashlib.sha256(p.read_bytes()).hexdigest() == entry['sha256']})
    combined = []
    checks = {'scope_300_unique': len(scope) == len(scope_rows) == 300,
              'frozen_mapping_inputs_unchanged': all(r['unchanged'] for r in inputs_unchanged)}
    per_lane = []
    missing_artifacts = []
    binding_failures = []
    for lane, relative, expected in LANES:
        path = RUN / relative
        records = load_rows(path)
        ids = [r['file_id'] for r in records]
        checks[lane + '_cardinality'] = len(ids) == len(set(ids)) == expected
        checks[lane + '_exact_frozen_set'] = set(ids) == expected_lane_ids(scope, lane)
        quality_path = path.parent / 'QUALITY_FINDINGS.jsonl'
        quality_by_id = {}
        if quality_path.exists() and lane != 'existing_csv':
            for finding in load_rows(quality_path):
                quality_by_id.setdefault(finding['file_id'], []).append(finding)
        lane_artifacts = [path]
        for name in ('SCHEMA_CATALOG.jsonl', 'CONTAINER_COMPONENTS.jsonl', 'LOCAL_ACTION_DECISIONS.jsonl'):
            candidate = path.parent / name
            if candidate.exists() and lane != 'existing_csv':
                lane_artifacts.append(candidate)
        if lane in ('datasets67', 'existing_datasets'):
            checks[lane + '_schema_catalog_exists'] = (path.parent / 'SCHEMA_CATALOG.jsonl').is_file()
        lane_statuses = Counter()
        for record in records:
            fid = record['file_id']
            original = scope[fid]
            status = record.get('preparation_status', record.get('processing_status', record.get('status', 'UNSPECIFIED')))
            lane_statuses[status] += 1
            stored_sha = record.get('registered_sha256', record.get('sha256_registered'))
            if stored_sha is not None and stored_sha != original['sha256_registered']:
                binding_failures.append(fid)
            if lane.endswith('67') != original['pending67']:
                binding_failures.append(fid + ':pending67')
            refs = artifact_paths(record, path.parent)
            for ref in refs:
                if not ref.exists():
                    missing_artifacts.append({'file_id': fid, 'path': str(ref)})
            candidate_links = [r['external_requirement_id'] for r in external_requirements if original['source_id'] in r.get('linked_source_ids', [])]
            quality_findings = quality_by_id.get(fid, [])
            quality_states = sorted({f['quality_status'] for f in quality_findings if f.get('quality_status')})
            quality_state = record.get('quality_status') or (';'.join(quality_states) if quality_states else 'NO_RECORDED_FINDINGS_IN_DECLARED_SCOPE')
            correction_path = RUN / 'existing233/mat5_review/CORRECTION.json'
            if 'OPAQUE' in status and correction_path.exists():
                refs.append(correction_path)
            combined.append({
                'file_id': fid, 'source_id': original['source_id'], 'registered_sha256': original['sha256_registered'],
                'source_relative_path': original['relative_path'], 'registered_bytes': original['bytes_registered'],
                'previously_pending67': original['pending67'], 'lane': lane, 'local_preparation_status': status,
                'quality_status': quality_state, 'quality_findings': quality_findings,
                'quality_flags': record.get('quality_flags', []),
                'quality_ref': str(quality_path) + '#file_id=' + fid if quality_path.exists() else str(path) + '#file_id=' + fid,
                'technical_format': record.get('technical_format', 'CSV' if lane == 'existing_csv' else 'SEE_FROZEN_MAPPING'),
                'lane_record_ref': str(path) + '#file_id=' + fid,
                'local_artifact_refs': [str(p) for p in refs],
                'lane_catalog_refs': [str(p) + '#file_id=' + fid for p in lane_artifacts],
                'local_action_ref': record.get('local_action_decision_ref', record.get('decision_ref', record.get('rights_and_authorization_refs', record.get('local_action_basis')))),
                'requirement_support': record.get('requirement_support'),
                'candidate_source_requirement_ids': candidate_links,
                'source_link_is_not_content_coverage_proof': True,
                'limits': record.get('limitations', record.get('limits', [])),
                'new_rag_or_training_admission': False, 'source_content_uploaded': False,
            })
        per_lane.append({'lane': lane, 'count': len(records), 'status_counts': dict(lane_statuses), 'manifest': str(path)})
    ids = [r['file_id'] for r in combined]
    checks['exact_300_union_without_duplicates'] = len(ids) == len(set(ids)) == 300 and set(ids) == set(scope)
    checks['exact_67_previously_pending'] = sum(r['previously_pending67'] for r in combined) == 67
    checks['source_and_partition_bindings'] = not binding_failures
    checks['declared_output_and_evidence_paths_exist'] = not missing_artifacts
    checks['no_unspecified_or_failed_processing_status'] = all(r['local_preparation_status'] != 'UNSPECIFIED' and 'FAILED' not in r['local_preparation_status'] for r in combined)
    for label, rel in [('documents67', 'documents67/CHECK_RESULTS.json'), ('datasets67', 'datasets67/CHECK_RESULTS.json'), ('existing_documents', 'existing233/documents/CHECK_RESULTS.json'), ('existing_datasets', 'existing233/datasets/CHECK_RESULTS.json'), ('csv', 'existing233/CSV_CHECK_RESULTS.json'), ('public_supplements', 'requirements/PUBLIC_SUPPLEMENT_CHECK_RESULTS.json')]:
        data = load_json(RUN / rel)
        checks[label + '_scoped_checks_pass'] = scoped_check_pass(data)
    copy_exceptions = [r['file_id'] for r in combined if 'COPY_DISABLED' in r['local_preparation_status']]
    opaque_objects = [r['file_id'] for r in combined if 'OPAQUE' in r['local_preparation_status']]
    checks['one_exact_copy_disabled_exception'] = copy_exceptions == ['FILE-038-cbd0f5edb42b-16d37f']
    bounded_terms = [r for r in combined if r['local_preparation_status'] == 'LOCALLY_PREPARED_BOUNDED_TERMS_AWARE']
    checks['six_terms_aware_objects_have_outputs'] = len(bounded_terms) == 6 and all(r['local_artifact_refs'] for r in bounded_terms)
    correction_path = RUN / 'existing233/mat5_review/CORRECTION.json'
    if correction_path.exists():
        correction = load_json(correction_path)
        checks['mcos_old_array_shapes_invalidated'] = correction.get('old_shapes_valid') is False
    csv_summary = load_json(RUN / 'existing233/CSV_REVIEW_SUMMARY.json')
    public_gaps = load_rows(RUN / 'requirements/PUBLIC_BASELINE_GAPS.jsonl')
    supplements = load_rows(RUN / 'requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl')
    authority = load_rows(RUN / 'requirements/SOURCE_AUTHORITY.jsonl')
    full_scans = load_rows(RUN / 'datasets67/FULL_SCAN_RESULTS.jsonl')
    constant_counts = Counter()
    for scan in full_scans:
        constant_counts.update(scan.get('nonstandard_constant_counts', {}))
    full_scan_summary = {
        'scan_records': len(full_scans), 'complete_scan_records': sum(r.get('complete') is True for r in full_scans),
        'counts_by_kind': dict(Counter(r['kind'] for r in full_scans)),
        'json_bytes_read': sum(r.get('bytes_read', 0) for r in full_scans if r['kind'] == 'FULL_JSON_STREAM'),
        'nonstandard_json_constants': dict(constant_counts),
        'tar_directory_members': sum(r.get('members', 0) for r in full_scans if r['kind'] == 'FULL_TAR_DIRECTORY'),
        'nested_zip_directory_members': sum(r.get('nested_member_rows', 0) for r in full_scans if r['kind'] == 'FULL_NESTED_ZIP_DIRECTORIES'),
        'text_lines_scanned': sum(r.get('line_count', 0) for r in full_scans if r['kind'] == 'FULL_TEXT_SCAN'),
        'limit': 'Complete directory or normalized parser-view syntax scan, not every archive payload or scientific value.'
    }
    result = {
        'status': 'PASS_WITH_EXPLICIT_GAPS' if all(checks.values()) else 'FAIL', 'checks': checks,
        'input_snapshot_checks': inputs_unchanged, 'missing_artifacts': missing_artifacts, 'binding_failures': binding_failures,
        'scope': 'Prepared-artifact coverage, partition/source bindings, frozen metadata integrity, local references and lane check results only.',
        'not_claimed': ['Full payload validation of every archive', 'Semantic correctness of every candidate parameter', 'Target-site applicability', 'RAG or database acceptance', 'Model evaluation', 'Server readiness']
    }
    summary = {
        'originals': len(combined), 'original_source_ids': len({r['source_id'] for r in combined}),
        'registered_source_records': len(authority), 'original_registered_bytes': sum(r['registered_bytes'] for r in combined),
        'previously_pending67': 67, 'lanes': per_lane,
        'local_status_counts': dict(Counter(r['local_preparation_status'] for r in combined)),
        'quality_status_counts': dict(Counter(r['quality_status'] for r in combined)),
        'requirement_support_status_counts': dict(Counter((r.get('requirement_support') or {}).get('status', 'NO_FILE_LEVEL_ASSESSMENT;SOURCE_CANDIDATES_ONLY') for r in combined)),
        'partial_or_unresolved_status_file_ids': [r['file_id'] for r in combined if any(k in r['local_preparation_status'] for k in ('PARTIAL', 'ERROR', 'FAILED', 'UNRESOLVED'))],
        'opaque_mat_schema_unresolved': opaque_objects,
        'authority_classes': dict(Counter(r['authority_class'] for r in authority)),
        'copy_disabled_exceptions': copy_exceptions, 'public_supplement_records': len(supplements),
        'pending_dataset_full_scan_summary': full_scan_summary,
        'csv_summary': csv_summary, 'overall_external_readiness': 'PARTIAL_WITH_EXPLICIT_PROCESSING_AND_COVERAGE_GAPS',
        'general_public_reference_baseline': 'PREPARED_WITH_DECLARED_LIMITS_AND_CONDITIONAL_DEPENDENCIES',
        'target_site_operational_use': 'NOT_VALIDATED',
        'site_records_are_not_a_general_public_collection_prerequisite': True,
        'next_project_stage': 'NOT_STARTED', 'completed_at_utc': datetime.now(timezone.utc).isoformat(),
    }
    save_rows('PREPARATION_MANIFEST.jsonl', sorted(combined, key=lambda r: r['file_id']))
    save_json('CHECK_RESULTS.json', result)
    save_json('COUNTS.json', summary)
    remaining = [
        {'id': 'EXT-OPEN-01', 'origin': 'PRODUCT_COVERAGE_SCOPE', 'item': '首版需要预先覆盖的化学体系、产品和活动/运输范围尚未确认。', 'action': '确认静态预置范围，或明确采用通用分析加当次上传产品资料的模式；不要求现在收集所有设备型号。每个案例仍需核对适用对象和条件。', 'input_owner': 'USER_PRODUCT_SCOPE'},
        {'id': 'EXT-OPEN-02', 'origin': 'TARGET_SITE_OR_CASE_INPUT', 'item': '目标活动的有效RMF/SWP、现场应急卡/联系人、设施和处置接收要求。', 'action': '在现场部署或具体案例涉及这些要求时取得适用记录；公共参考不能代替它们，但缺少现场记录不阻止普通科学解释或基础工具建设。', 'blocks_general_public_collection': False},
        {'id': 'EXT-OPEN-03', 'origin': 'CONTENT_USE_CONSTRAINT', 'file_ids': copy_exceptions, 'item': '一份Molicel UN test summary关闭复制权限，正文未进入派生数据。', 'action': '若首版确需对应型号证明，取得可按所需方式使用的版本；否则保留原件查看引用，不计为机器可读证据。'},
        {'id': 'EXT-OPEN-04', 'origin': 'SEMANTIC_APPLICABILITY', 'item': '表格/数值候选不是已审核规格。实验字段和完整目录不代表每个数组都已验证。', 'action': '对首版会用于阈值比较或数值计算的字段，核对单位、条件、对象、版本及时间分段；保留原始值和出处。'},
        {'id': 'EXT-OPEN-05', 'origin': 'CONDITIONAL_PUBLIC_DEPENDENCY', 'item': '运输/产品验收触发的现行规则、完整商业规则、制造商测试证明与辖区适用性。', 'action': '按已保存的PUBLIC_BASELINE_GAPS逐项触发处理，不把未进入首版的条件需求算成通用资料收集失败。', 'evidence_ref': str(RUN / 'requirements/PUBLIC_BASELINE_GAPS.jsonl')},
        {'id': 'EXT-OPEN-06', 'origin': 'OPAQUE_MAT_OBJECT_SCHEMA', 'file_ids': opaque_objects, 'item': '3个MAT Level-5文件含MCOS opaque对象，先前按普通数组推得的巨大shape无效。', 'action': '保留原件和被动结构证据；取得可信的兼容转换/源作者普通数组导出后，再核对变量、单位、条件和源对象对应关系。不得执行未知对象代码。'},
    ]
    save_rows('UNRESOLVED_ITEMS.jsonl', remaining)
    lane_labels = {'documents67': ('原未处理文档', '25份文本/定位，6份有限正文或事实定位，1份复制限制例外'),
                   'datasets67': ('原未处理数据', '完整JSON/文本结构检查与容器目录；内部schema仍有代表性读取范围'),
                   'existing_documents': ('既有文档', '复用38份准确绑定的提取件，补充定位和候选'),
                   'existing_datasets': ('既有非CSV数据', '工作簿单元格检查、JSON结构、ZIP/MAT目录；3份MCOS schema未解'),
                   'existing_csv': ('既有CSV', '140份全文件质量统计，其中5份复用既有结果')}
    table = '\n'.join('| ' + lane_labels[row['lane']][0] + ' | ' + str(row['count']) + ' | ' + lane_labels[row['lane']][1] + ' |' for row in per_lane)
    report = f'''# 外部数据准备与覆盖评估

本轮已对固定范围的 **300 份原始文件、42 个有原件来源**形成逐项处理记录，并复核全部 48 个登记来源。原先 60+7 的本地处理已纳入同一清单。**目前仍有明确的解析、候选字段复核和覆盖范围问题，不能宣称资料已全部可用；下一项目阶段未启动。** 现场记录和当次产品资料可以按案例补齐，不算这轮公共资料收集失败。

使用目的已确认：仅用于 UNSW 课程或非商业研究。旧 Mapping 保持冻结，原始工作区只读；本轮结果位于独立目录。当前检查结果为 `{result['status']}`，只说明所列本地检查通过，不代表现场安全或系统验收。

## 数据量与权威性的结论

来源中有制造商、UNSW/监管机构、科研数据发布者和软件/论文，但权威性随用途而变：厂家资料只支持对应型号/版本，UNSW 公共框架不能代替目标活动的受控程序，实验数据不能直接充当现场处置依据。目录入口和软件文档也不能算已取得的实验或产品证据。

140 份 CSV 来自同一来源，约 19.4 GB，覆盖 {csv_summary['total_rows_including_reused_profiles']:,} 行。数量充分说明已有大批实验数据，但不能证明化学体系、产品、现场活动和九个模块均已覆盖。评估已拆成 18 项具体外部需求，另把现场输入、运行后产生的数据和未来训练资料分开。

## 本轮实际处理

| 分组 | 原件数 | 实际状态 |
|---|---:|---|
{table}

CSV 扫描复用 5 份已有全文件统计，新扫 135 份；发现 {csv_summary['test_time_backsteps']} 次测试时间回退，分布于 {csv_summary['files_with_test_time_backsteps']} 份文件。内阻缺失 {csv_summary['missing_cells_by_field'].get('Internal_Resistance', 0):,} 格、温度缺失 {csv_summary['missing_cells_by_field'].get('Temperature', 0):,} 格、辅助电压缺失 {csv_summary['missing_cells_by_field'].get('Aux_Voltage', 0):,} 格。没有把缺失补成零、全局排序或修改源值；这些情况须进入后续计算的数据合同。

原先 7 份预审受限资料已逐份区分明文条件和旧推断：6 份完成有限本地正文/事实定位；1 份关闭复制权限的 PDF 保留明确例外。没有把“未找到开放许可”继续当作一律不能本地阅读。

10 份大 JSON 完整流式读取 {full_scan_summary['json_bytes_read']:,} 字节，发现 {constant_counts['NaN']:,} 个 `NaN`、{constant_counts['Infinity']:,} 个 `Infinity` 和 {constant_counts['-Infinity']:,} 个 `-Infinity`。原文件并非严格标准 JSON；本轮仅在解析视图中替换这些裸常量以核查结构，原件未改。后续数据转换必须保留非有限值类别和缺失处理规则，不能将它们视为普通有效测量。两份 TAR/GZIP 的完整目录共 {full_scan_summary['tar_directory_members']} 项，嵌套 ZIP 补全目录 {full_scan_summary['nested_zip_directory_members']} 项；目录完成不代表所有成员数值均已校验。

10 份 MAT 7.3 已完成目录枚举，数组数值未全读。另有 **3 份 MAT Level-5 的 MCOS 对象 schema 尚未解出**；先前按普通数组解析得到的巨大维度已作废，不能继续进入字段合同。具体文件及后续转换要求记录在 `UNRESOLVED_ITEMS.jsonl`，没有将它们计为完整可用数据。

公开补充资料见 `requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl`（当前 {len(supplements)} 条记录）：每项明确实际原件、版本、来源、获取时间和限制。只登记了链接或元数据的项目不计为已下载原件。单位、术语、计算原理参考与未来工具实现验证分别记录。

## 尚未闭环的事项

1. 确认首版需要静态预置的覆盖范围，或明确采用通用分析加当次上传产品资料的模式；不要求预先收集所有产品型号。道路/铁路/航空运输按实际范围触发。
2. 对确实要预置使用的资料，逐项匹配制造商规格和实验条件，复核会被用于计算或阈值比较的关键字段。现场有效程序在现场部署或对应案例涉及时取得，不把它变成普通科学解释和基础工具建设的前置审批。
3. 若范围触发运输或产品验收，按条件缺口表取得所需规则/测试证明；对复制受限对象保留可操作的替代或查看路径。
4. 处理3份MCOS对象的兼容解码/可核对导出，或在范围确定后明确它们是否确实需要进入首版数据集；未解状态继续保留。

这份准备包保留完整原件引用、已产生的派生内容和未处理范围。完整目录、结构扫描、候选抽取分别按实际范围标记，均没有自动升级为“内容全部正确”或“可直接用于安全判断”。

## 直接查看的产物

- `PREPARATION_MANIFEST.jsonl`：300 份原件的处理状态与证据引用。
- `requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl`：18 项外部需求与适用性结论。
- `requirements/PUBLIC_BASELINE_GAPS.jsonl`：公共资料补齐结果与条件依赖。
- `UNRESOLVED_ITEMS.jsonl`：剩余事项及解决方式。
- `COUNTS.json`、`CHECK_RESULTS.json`：精确计数与限定检查结果。
- 各 lane 的 `NOTES.md`/检查文件：具体读取范围、工具、异常、限制与复现说明。

未执行目标 RAG/数据库导入、Qwen 推理、模型评测、微调、服务器连接或资料上传。
'''
    (RUN / 'SUMMARY.md').write_text(report, encoding='utf-8')
    save_json('TASK_STATUS.json', {
        'tasks': [{'id': 'EXT-01', 'status': 'PUBLIC_BASELINE_PREPARED_WITH_CONDITIONAL_GAPS', 'model': 'gpt-5.6-sol'},
                  {'id': 'EXT-02', 'status': 'LOCAL_PROCESSING_RECORDED_WITH_ONE_COPY_EXCEPTION', 'model': 'gpt-5.6-sol'},
                  {'id': 'EXT-03', 'status': 'LOCAL_PROCESSING_RECORDED_SEE_EXACT_SCOPE', 'model': 'gpt-5.6-sol'},
                  {'id': 'EXT-04', 'status': result['status'], 'owner': 'root'}],
        'overall_external_readiness': summary['overall_external_readiness'], 'next_project_stage': 'NOT_STARTED',
        'remaining_items_ref': str(RUN / 'UNRESOLVED_ITEMS.jsonl')})
    index = []
    primary = ['SUMMARY.md', 'PREPARATION_MANIFEST.jsonl', 'COUNTS.json', 'CHECK_RESULTS.json',
               'UNRESOLVED_ITEMS.jsonl', 'USER_SCOPE.json', 'TASK_STATUS.json',
               'requirements/EXTERNAL_REQUIREMENT_MATRIX.jsonl', 'requirements/SOURCE_AUTHORITY.jsonl',
               'requirements/PUBLIC_BASELINE_GAPS.jsonl', 'requirements/PUBLIC_SUPPLEMENT_MANIFEST.jsonl',
               'requirements/METHOD_REFERENCE_STATUS.jsonl']
    primary.extend(relative for _, relative, _ in LANES)
    for optional in ('existing233/mat5_review/CORRECTION.json', 'existing233/mat5_review/NOTES.md', 'existing233/mat5_review/CHECK_RESULTS.json'):
        if (RUN / optional).exists():
            primary.append(optional)
    for relative in primary:
        path = RUN / relative
        data = path.read_bytes()
        index.append({'relative_path': relative, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    save_json('ARTIFACT_INDEX.json', {'scope': 'Explicit key delivery files only; raw source hashes were not recomputed.', 'files': index})
    print(json.dumps({'status': result['status'], 'originals': len(combined), 'checks': checks, 'lanes': per_lane}, ensure_ascii=False))
    if result['status'] == 'FAIL':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
