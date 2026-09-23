# 模型核心架构与依赖边界

> **Historical technical proposal.** Retained as optional design background. Current responsibilities, sequencing and task-specific acceptance follow [the team guide](TEAM_PROJECT_GUIDE.md) and [project instructions](../AGENTS.md). Start from [PROJECT_START.md](../PROJECT_START.md). Execution and source-use restrictions remain governed by [the execution boundary](LOCAL_SERVER_EXECUTION_BOUNDARY.md) and [execution policy](../config/execution_policy.json). This older proposal does not assign work, choose a platform, impose a project-wide gate or waive source restrictions. Owner-specific locations are in [the data locator](../data/README.md).

本文件为v0.3技术设计及v0.3.2执行边界，不是已经存在或已经测试的组件。采用单进程模块化API服务、轻量Web界面、独立模型服务，避免多智能体/消息总线/微服务集群的初始成本。

## 0. 历史执行拓扑

```text
当前 checkout（每台工作站自行配置）
  └─ 文档／源码／合同／配置／manifest／测试定义
        │ 仅在用户批准的传输manifest内
        ▼
服务器执行工作区（路径与系统待定）
  ├─ 环境与模型probe
  ├─ 数据接收核验、迁移、解析、索引
  ├─ 应用、工具、模型和全部测试
  └─ 未来经单独批准的微调
        │ 原始日志、run manifest、hash、结果
        ▼
本地 outputs/server_runs/（未来回传，不自动索引）
```

该记录阶段处理拓扑上方的文件准备和受控本地数据准备，未启动T00或连接服务器。源工作区作为只读输入，portable seed及脚本写入当时的checkout。标记`PREPARED_LOCALLY_UNVERIFIED`与`DEFINED_NOT_RUN`是该历史执行阶段的状态证据，不自动约束当前工作流。

## 1. 源码布局（本地准备，服务器执行）

```text
src/bsc_core/
  domain/          # source, evidence, observation, case, hypothesis, analysis
  ports/           # model, retrieval, repository, asset/site/identity/telemetry/business
  application/     # run lifecycle, ingest, case update, report
  retrieval/       # literal/model-ID, sparse, dense, RRF, applicability, citations
  tools/           # unit conversion, formula DSL, time-series, specification comparison
  harness/         # context assembly, tool loop, budgets, validation, fallback, trace
  adapters/        # sqlite, numpy index, HTTP model, fixtures, disabled business
  safety/          # emergency presentation, action limits, permission checks
  evaluation/      # replay, graders, ablations, diagnostic oracle, failure attribution
apps/api/          # FastAPI transport: jobs, uploads, runs, evidence, feedback
apps/web/          # React/TS: analyst workbench, citations, state, run diagnostics
```

依赖方向为UI/API → application → domain/ports；具体provider在adapters中。领域层不直接依赖某模型服务或向量数据库。工具不得绕过Port访问任意路径或网络。

## 2. 单次运行算法（服务器实现后执行）

1. 生成server run_id、固定actor/workspace以及配置版本；用户不能通过提示赋予新role。
2. 应急入口始终可用；检测明显紧迫信号时立即发送受控卡片事件，不等待完整检索。
3. 识别任务intent、模块、目标；调节表达深度但不改安全边界。EDUCATION可无case_id。
4. 建立case snapshot：只把用户明确陈述记录为REPORTED；已有测量附观察时刻和质量，不把模型摘要提升成事实。
5. 装配当前可见证据：会话附件和长期库分开；exact ID、稀疏、dense各有调用记录；权限先过滤。
6. Qwen选择直接答复、少量追问或获准工具。工具由网关核验名称、参数、case revision、input hash与计算预算。
7. 记录tool request/result。超时保留FAILED/UNKNOWN，不由模型猜返回；重复同输入可复用已验证缓存，但需版本一致。
8. 更新候选原因、支持/反证、预测模型与前提。C4仅指当前完整搜索未找到直接依据；不抹掉其他基础知识。
9. 形成ModelAnalysisProposal；程序校验结构、引用存在/权限/版本、tool结果来源、关键事实状态和范围。
10. 提供专业回答与可展开的依据。AnalysisEnvelope中的run状态、调用状态、执行回执和模型identity由server生成。
11. 保存运行记录与失败归因候选，支持用户纠错和下一轮重评；不自动创建训练标签。

复核/修复次数、工具轮数与token预算可配置；预算耗尽可以PARTIAL，不允许延迟直到假装完整。风险相关结论未经校验时不直接流式当动作指令发布。

## 3. 模型Provider适配

接口至少具备 `probe() -> ModelCapabilities`、`generate(ModelRequest) -> ProviderResult`、`cancel(run_id)`。probe记录served model id、base provenance、上下文上限、图像、原生tool calling、结构化输出、流式、实际generation defaults。字段无法查到就写UNKNOWN，不推断。

优先复用服务器上经确认的现有HTTP服务。不同vLLM/其他服务的可选参数必须集中在adapter，不把某一家extra_body散落在业务代码。支持服务端chat template时发送结构化messages，不再手工重复应用模板；若未来使用Transformers适配则明确只应用一次。native tools不支持时可做schema计划协议，但需在服务器建立单独profile与对比。

`model_generation_config`记录用户当前配置以及实际effective值。不能因为包里没有推理参数就擅自温度0、缩短历史或关闭推理；也不能默认服务忽略了参数。识别量化、adapter、模板或processor变化时新建profile。

Mock的provider_type=MOCK，日志/结果/页面明确显示，不允许出现在真正Qwen基准统计里。失败时只能返回错误或继续非模型功能，不能悄悄切成Mock。

## 4. 上下文与记忆

会话记忆只保留已知信息和分析历史，不作为新证据。参考组成：用户目标＋必要对话＋case factual snapshot＋关键未知/冲突＋evidence packet＋工具定义＋关联结果。长历史压缩后保留引用和事实类型；不能将历史猜测变成摘要中的既成事实。

一轮固定case revision和index manifest。并发补充使旧结论标SUPERSEDED，计算可保留为历史但不可说是新状态。身份/使用权限撤回立即使新检索与引用下载失效；旧结果显示撤回，不靠冻结快照绕过当前授权。

## 5. 分析与行动

ModelAnalysisProposal是模型分析，不含可信批准/合规/硬件控制字段。它可建议查询、进一步观察已有数据、联系相应角色、遵循有效方案或提出待验证的工程候选。

Envelope是可信运行包装，报告真实tool outcomes、warnings、retrieval health、source snapshot、case revision、model profile和运行状态。

本地保存会话/分析由application负责。BusinessActionPort默认DISABLED；真实批准系统未接入，不创建模拟“已获UNSW批准”的事件。外部通知与设备控制不在tool allowlist。

## 6. 基础安全与运维

服务器测试应用默认绑定服务器的127.0.0.1，使用注入的session token，严格CORS/Origin、Host检查、防目录穿越和输出HTML转义。远程访问方式须单独确认，不默认开放LAN。文件读取只允许注册object_id；拒绝UNC路径、file:// URL、symlink/junction和归档逃逸。网络只连接用户配置且授权的provider；链接导入默认关闭，禁止模型任意抓取。

解析器在服务器独立进程并设置大小/页数/时间/内存预算，关闭宏和外部实体，禁止执行PDF/数据包代码。模型服务不能访问eval答案目录。建议先程序化工具，不启用任意代码sandbox；以后增加时另作隔离设计。

SQLite WAL用于单环境低并发，应用通过短事务、唯一request key和revision检查管理状态；不能将整个长LLM请求放在数据库写事务内。后台工作初期使用数据库job表与单worker，无需Redis。审计失败阻断声称“已保存”的结果，但不阻断应急信息读取。

备份通过一致快照/SQLite备份API，不直接复制正在变更的db文件；验证恢复后index manifest与case引用一致。敏感日志最小化，保留期限由负责人配置，不虚构学校规定。
