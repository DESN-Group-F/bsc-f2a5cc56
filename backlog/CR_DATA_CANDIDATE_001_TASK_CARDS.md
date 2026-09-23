# CR-DATA-CANDIDATE-001 — 重开 207 条候选的上下文与语义复核

用户继续授权完成数据准备。上轮总控误将“本句无条件”的 201 条标记作为可直接保留的未知，未完成跨表头/段落的条件关联便宣布完成。本轮修正这一验收错误，不搭建 RAG、数据库或模型服务。

运行目录：`E:/desn 2000/bsc/data_preparation/CR-DATA-CANDIDATE-001/20260920T045258_AEST`。
冻结输入：`E:/desn 2000/bsc/data_preparation/CR-DATA-READY-001/20260920T012405_AEST`。只复核 `documents/FACT_CANDIDATES.jsonl` 的精确 207 个 fact_id，不覆盖任何前轮快照，不重扫大型实验数据。

## 验收规则

1. 207 条来自 16 份文件；保留一对一原始 fact_id，复合量可在同一记录内展开，不能靠去重或删除减少待办。
2. 对可开展内容核验的记录，回到完整段落、表格行/列头、前提、例外和脚注。禁止仅截取邻近句、套模板说明“可能缺条件”或因为关键词匹配就宣布语义通过。
3. 分开处理工作状态、语义角色、参数记录是否完整及相应用途许可。研究结果、说明示例、软件元数据、运算误识别与具体参数不是同一事物。完整来源条件也不等于已适用于当次产品或获得 UNSW 批准。
4. 每条结论必须有可定位的原始上下文证据及审阅理由；保留数值、单位、范围/比较符号、实体、版本、条件与例外。不能推测单位/条件，不能把复核任务简单改名为“参考资料”而跳过内容核验。
5. 仅在实际检查后确认原文缺信息、无法取得所需内容或存在明确适用的动作限制时，记录未解决项及受影响功能。这些项仍算未解决，不能靠登记假称核验完成；总控分别报告已完成审阅数、语义已解决数及未解决数。
6. SRC-038 的 58 条另行核对具体本地动作依据；不得将旧泛化 AI 标签自动当成本地读取禁令，也不得把本地读取许可升级为模型/RAG许可。无依据时不将受限正文放入模型上下文、不渲染或提取大段正文，不绕过复制控制。
7. 禁止修改源文件、源 `.venv`、系统环境或旧运行。使用现有运行时，`python -B`；本轮无需安装依赖。派生产物只写新运行；所有数值证据留在本地工件，回传摘要不倾倒原文。
8. 非原作者必须审计每条结论的证据、语义和精确集合；严重问题由作者修正后复审。抽查可以校准方法，但不能代表全部 207 条内容核验。

## 共用输出

每条 `REVIEW_RESULTS.jsonl` 至少包含：`fact_id`, `file_id`, `source_id`, `original_locator`, `review_status`（`RESOLVED` 或 `UNRESOLVED`）, `semantic_role`, `context_findings`, `quantity_bindings`, `source_entity_and_version`, `conditions_and_exceptions`, `evidence_refs`, `original_unknown_resolution`, `parameter_record_ready`, `current_build_use_status`, `remaining_unknowns`, `reason`。

`parameter_record_ready` 只表明可构成来源限定的参数记录，不表示运行时适用或准入。非参数内容也需说明实际是什么。`UNRESOLVED` 必须给出已检查的位置和具体剩余障碍；不能为关闭任务而强制 `RESOLVED`。

各作者另交 `CHECK_RESULTS.json` 与 `REPORT.md`，检查结果记录实际命令、范围和限制。审计交 `ITEM_AUDIT.jsonl`、`CHECK_RESULTS.json`、`REPORT.md`；每条对应 fact_id。

## 分工

- DOC Sol：`review_a/`，85 条，来源不属于 SRC-038/039/040。优先重建 LBNL 表格上下文、IATA 条款完整结构，区分数据门户的研究说明及模型/软件说明。
- DATA Sol：`review_b/`，64 条，SRC-039/040；核对 RST 表格、版本变更和设备手册，识别原解析器误认的单位/数值。只写本 lane。
- COVER Sol：先在 `rights_review/` 判断 SRC-038 的 58 条允许何种具体本地核验，向总控报告；随后审计 A/B。只写 `rights_review/`、`audits/`，不覆盖作者结果。禁止未经核对扩张或缩小许可。
- 总控：精确集合、动作边界、SRC-038 的后续处理、必要的独立原文核查与最终验收。所有完成声明以本轮实际结果为准。
