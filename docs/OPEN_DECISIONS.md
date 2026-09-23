# 未决事项

> **Historical decision register.** Retained as optional background. Current responsibilities and task-specific criteria follow [the team guide](TEAM_PROJECT_GUIDE.md) and [project instructions](../AGENTS.md). Start from [PROJECT_START.md](../PROJECT_START.md). Execution and source-use restrictions remain governed by [the execution boundary](LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](../config/execution_policy.json). Older entries do not automatically assign work, choose a platform, impose a project-wide gate or waive source restrictions.

|ID|事项|当前状态|解决时点|
|---|---|---|---|
|O01|服务器Qwen端点/权重、served_id、模板、量化和有效参数|UNKNOWN|服务器T01真实运行前；本地仅准备adapter|
|O02|源工作区数量、现有manifest/索引、用途允许与传输情况|EXT_AUDIT_METADATA_INSPECTED_CONTENT_NOT_REVIEWED|本地Phase A复用审计；正文加工和传输仍逐用途门禁|
|O03|服务器访问、OS、GPU/显存/CUDA、Python/Node、存储及联网限制|UNKNOWN|T00启动门禁，禁止擅自连接或安装|
|O04|旧初测的具体题目、输出和判分|USER_REPORTED_GOOD_RESULT|评测归档；不得补分数|
|O05|embedding是否已有、CPU/GPU资源|UNCONFIRMED|P2 dense前；稀疏检索可先行|
|O06|本地场所/人员/应急卡|NOT_CONFIRMED|真实现场使用前；研究模式不强制虚构|
|O07|CPPO全称、论文与实现|UNRESOLVED|仅未来训练研究，不阻塞当前架构|
|O08|最终评测指标、样本量和非退化门槛|TO_DEFINE_FROM_BASELINE|正式比较前冻结，不用旧配额凑数|
|O09|资料与日志保留/删除及隐私条件|TO_CONFIRM|真实敏感内容接入前|
|O10|本地到服务器的数据传输方式、允许范围和审批人|NOT_APPROVED|T00前；禁止上传整个data目录|
|O11|服务器secret注入、日志脱敏和回传方式|UNCONFIGURED|任何服务器连接前|
|O12|服务器依赖安装、模型下载和计算预算|NOT_APPROVED|安装或昂贵作业前|
|O13|服务器运行产物、原始日志和hash的保留位置|TO_CONFIRM|首次服务器执行前|
|O14|文档、规格、实验三条pilot的精确样本及解析/派生许可|BLOCKED_PENDING_PURPOSE_DECISION|CR-DATA-ROUTE-001 Phase B前；Phase A可继续|

上表保留当时的未决状态，不自动继续任务或建立全局门禁。服务器事实、真实批准或测试结果不得由任何工具或团队成员代填；当前处理方法和阻塞关系由负责工作流确认。
