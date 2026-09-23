# 当前活动项目状态

**状态日期：2026-09-19**

- 当前阶段：`LOCAL_CONTROLLED_DATA_PROCESSING`
- 当前决策：`ADR-EXEC-001`
- LP00–LP02：`COMPLETED`（执行边界、传输模板、服务器执行矩阵）
- LP03 / CR-DATA-ROUTE-001 Phase A：`COMPLETED_LOCAL_ROUTING_PREPARED`
  - 原运行：`20260919T185236_AEST_phase_a`
  - 完成时间：`2026-09-19T19:11:00.227+10:00`
  - 输出：`data_preparation/CR-DATA-ROUTE-001/20260919T185236_AEST_phase_a`
  - 静态一致性检查：32项满足、0 issues；仅格式、数量、路径与内部一致性检查，不是项目测试
  - 服务器测试定义：18项，全部`DEFINED_NOT_RUN`
- LP04：`IN_PROGRESS_FIRST_CALIBRATED_BATCH_COMPLETED`
  - 复用Phase A，不重复全量审计
  - 先核对既有依据；按新资料结构小样校准后继续同类合格批次
  - 允许解析/转换测试、字段合同、数值一致性及临时文件/数据库查询，结果须注明范围
  - 当前有效运行：`20260919T200403_local_processing_05`
  - 输出：`data_preparation/CR-DATA-ROUTE-001/20260919T200403_local_processing_05`
  - 24个对象实际处理；同一清单对Phase A 300/300个对象给出处理、暂缓、受限或独立路线状态
  - 4份文档生成375条可追溯记录；MPPT 1210 HUS生成36条参数；12份foxBMS资料纠正为参考架构/项目文档；1份Libre Solar PDF提取件因`.pnum`污染未复用
  - 完整流式读取5个SRC-017 CSV、1,867,719行／285,511,342 bytes；保留5,000条真实限定记录
  - 数据质量事项：`FILE-017-52b8706c7e1f-d201dd`有2,213个`Internal_Resistance`空值和1个`Temperature`空值；保持`null`并记录原始行样例，未补零；另记录8次`Test_Time`回退
  - 本地处理检查：17 `PASSED`、0 `FAILED`；聚焦单元测试：7/7 `PASSED`。范围仅限本地解析、合同、数值汇总及临时查询
  - 运行后独立完整性核对：7个JSON与14个JSONL均可解析，26个artifact索引项大小/SHA-256一致，SQLite `integrity_check=ok`
- LP05：`NOT_STARTED`
- T00：`NOT_STARTED`
- T01–T21：`NOT_STARTED`
- 本地数据处理检查：`ALLOWED_WITH_EXACT_SCOPE`（正式系统/模型/部署验收仍在服务器）
- 服务器测试：`18 DEFINED_NOT_RUN / NOT_CONFIGURED / NOT_EXECUTED`
- 微调：`DEFERRED / NOT_RUN`
- Qwen 服务器端点：`UNKNOWN`
- 数据传输许可及范围：`NOT_APPROVED / NOT_READY_FOR_DATA_TRANSFER`
- 只读源工作区：`E:\desn 2000\data\battery_data_workspace_v0_3`
- EXT-AUDIT-01输入：8个必需文件与3个可选文件均已定位
- Phase A历史权利字段快照：300/300 parsing UNKNOWN；300/300 external transfer UNKNOWN；RAG admitted 0；human reviewed 0。它只是旧字段映射，不是“300份均无本地处理依据”的结论
- 既有`ai_processing`依据对账：233个对象为`ALLOWED`，其中当前处理24个、同结构实验暂缓189个、独立开发知识20个；当前候选另有56个用途决定待定、7个明确限制，治理/训练评测独立路线4个
- 继承项目／服务器测试执行数：`0`；本轮本地数据处理单元测试：`7`；集成数据处理检查：`17`
- T00启动：`NO`
- Phase A closeout：`20260919T192120_AEST_phase_a_closeout`；portable转换草稿已改为先验证可信gate，再打开／哈希结构化输入；精确动作固定为`reuse_existing_derivative`
- v0.3.2相关JSON格式审阅：10个可解析、0个解析错误（仅文件格式检查，不是项目测试）
- Phase A原运行哈希与大小：由原运行`LINEAGE_MANIFEST.json`及closeout复核保留；原运行目录不在closeout中改写
- 活动副本全仓库哈希清单：`NOT_FROZEN`；仅对本任务产物和修改文件记录精确哈希
- 中间运行`01`–`04`均被`05`取代并保留：依次对应参数分类修正、清单覆盖补齐、异常检查扩展，以及发现2,214个真实源空值后的处理口径修正；没有将失败检查隐藏为通过

`reports/handoff_validation.json`、`reports/helper_unit_tests.txt` 和 `reports/VALIDATION_SCOPE.json` 是继承自原 v0.3 交接包的基线历史，不是当前活动副本修改后的测试结果。

当前首批真实本地加工已经完成，LP04仍继续。一个合并决定请求是：如需扩展到56个用途待定对象，请责任人按`SUMMARY.md`列出的精确来源组确认本地`ai_processing`用途或提供替代来源；7个明确限制对象不自动放行。该请求不阻止继续处理189个已有依据的实验对象。项目没有声称正式应用、目标RAG/权威数据库、Qwen、服务器验收或训练已经完成；T00仍未启动。
