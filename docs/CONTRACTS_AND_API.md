# 核心合同、API与最小持久化

> **Historical technical proposal.** Retained as optional design background. Current work and task-specific acceptance follow [the team guide](TEAM_PROJECT_GUIDE.md) and [project instructions](../AGENTS.md). Start from [PROJECT_START.md](../PROJECT_START.md). Execution and source-use restrictions remain governed by [the execution boundary](LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](../config/execution_policy.json). This older proposal does not assign work, choose a platform, impose a project-wide gate or waive source restrictions. Data locations are in [the data locator](../data/README.md).

该历史本地阶段只准备了本文件、Schema与实现草稿，未启动API、数据库或迁移，也未执行合同测试。本地文件存在不等于接口已实现。

## 1. 可信边界

`ModelAnalysisProposal`由模型生成，必须允许没有case_id的教育问题。内容包括intent、模块/能力、scope判断、事实/假设、候选原因、预测/建议、引用、问题与限制。禁止approved、compliant、safe等普遍认证字段和执行回执。

`AnalysisEnvelope`由后端生成，包含request/run ID、真实model profile、case revision、retrieval状态、校验结果、actual tool executions、存储结果和可见回答。模型提供的相同字段不具备信任地位。完整原始候选可隔离保存用于误差评价，不能绕过校验给出真实动作。

合同版本0.3；旧AssistantProposal/Envelope需通过显式adapter映射，不能就地覆盖旧历史记录。修改字段要版本化并测试兼容性。

## 2. 必须持久化的最小对象

| 对象 | 最少内容 |
|---|---|
| SourceRecord | stable ID、原始位置/哈希、类型、版本/时间、适用范围、允许用途、审核状态 |
| EvidenceSpan | source revision、页/节/表格定位、text、父片段、解析质量、scope与ACL |
| IndexManifest | chunk顺序映射、source snapshot、embedding和分词/切片版本、文件hash |
| CaseSnapshot | case ID、revision、目标、对象/场所、observations、unknowns、conflicts |
| Observation | 字段/值/单位、basis、来源、观测/记录时间、质量、被替代关系 |
| AnalysisRun | input/profile/case/evidence/tool/prompt版本、raw/final结果、时延、token、status |
| ToolExecution | call ID、工具与代码版本、输入hash、output ref、result status、实际时刻 |
| Recommendation | plan kind、条件、证据/假设、行动建议、残余不确定性与复评触发 |
| Feedback/FailureRecord | 用户反馈或评分、经核验类别、关联run、修正与所属改进组件 |
| EvalRun | case set、模型/外围配置、未运行/成功/失败/评分状态；oracle另库存放 |

先用少量规范表+JSON字段即可；额外人员、完整采购、废物和审批数据由未来ports提供。存储实际对象ID和准确版本，不只存最终聊天字符串。

## 3. API规格（历史实现提案）

| 方法/路径 | 目的与限制 |
|---|---|
| GET /health | 不泄漏secret的组件健康与已接通状态 |
| GET /v1/model-profile | 实际模型配置和经测试的能力，未知保留 |
| GET /v1/capabilities | 已实现/已验证/不可用范围，不返回统一万能true |
| POST /v1/attachments | 受限上传为session object；不自动长期入库 |
| GET /v1/sources | 源登记、解析/允许用途/适用性状态 |
| POST /v1/source-import-jobs | 本地管理员选择source set导入；不是任意URL/路径读取 |
| POST /v1/retrieval/query | authorized scope内检索，返回status与证据，记录snapshot |
| GET /v1/evidence/{id} | 再校验权限，返回定位与对应版本；不返回任意磁盘路径 |
| POST /v1/cases | 创建研究case；is_synthetic/来源真实记录 |
| POST /v1/cases/{id}/observations | expected_revision；更新报告/测量事实，409冲突 |
| POST /v1/runs | 输入请求与附件/case IDs，立即返回run ID；核心分析异步执行 |
| GET /v1/runs/{id} | 当前AnalysisEnvelope，未完成不伪造最终状态 |
| GET /v1/runs/{id}/events | SSE事件：进度/证据/工具/应急/最终结果，token权限及cancel |
| POST /v1/runs/{id}/cancel | 取消后禁止继续发布旧结果；保留已发生事实 |
| POST /v1/feedback | 保存待核验反馈，不能直入训练 |
| POST /v1/eval-runs | 仅研究操作者，在隔离eval配置下运行，oracle不可进入模型上下文 |
| GET /v1/eval-runs/{id} | 聚合各组件分数与原始run引用，未评分不默认为0/通过 |
| GET /v1/emergency-card/{site_id} | 公开非敏感受控卡；独立静态可用副本；未配置明确显示 |

401/403真实身份问题；404未知/无权对象；409版本冲突；422合同/单位/条件不合法；503未接通依赖。统一错误包括code、message、retryable、component；错误消息不泄漏私有文件与token。

## 4. 模型请求字段

用户输入不能自己指定admin、source grant或business approval。persona是表达深度，不是可信role。case IDs/附件IDs均在服务器核验归属。generation override仅允许实验配置，记入profile，客户端不能开启未批准的工具或外发。

## 5. 工具与外部Port

`contracts/tool_registry.json`定义设计中的12个工具；当前未实现，status=PLANNED。模型工具调用与API路由不是同一概念，用户能启动资料导入不代表模型有此权限。

未来AssetReadPort/SiteReadPort/IdentityPort/CompetencyReadPort/TelemetryReadPort以可信上下文读取。库存查询支持受限的site/project/state过滤、分页与as_of，不需要用户先知道全部资产ID；筛选参数由schema与服务器权限校验，不接受自由SQL。BusinessActionPort当前固定返回NOT_CONNECTED，不能把模拟preview当真实执行。保持接口可测试即可，不搭完整后台。

## 6. JSON Schema能做与不能做

Schema能检查字段、枚举和部分引用前提。不能验证真实身份、资料适用性、工程方案充分性或预测正确性。v0.3还需要semantic validators：C4须成功完成检索；数值概率只来自有效predictor result；引用访问与版本一致；工具结果确实存在；case freshness；明确模拟环境。对应软件测试是团队后续候选实现，须由当前工作流选择。
