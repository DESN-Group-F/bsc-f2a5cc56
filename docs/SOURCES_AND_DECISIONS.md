# 来源、设计决策与旧版差异

本文件区分已有规划、用户最新确认和本版新设计。所有技术栈、阈值/预算、任务与字段均为设计，不能当作学校批准或运行实测。

## 用户确认 [U]

先做模型、RAG、数据库、工具和harness；四类规范适用/偏差情景；物化、工程与治理并重；完整业务接口化；已有外部资料和基础初测；训练安排暂缓。v0.3.2新增确认：源数据在本地明确工作区，可本地完成受控分流与portable seed准备；本阶段不启动T00，目标数据库/RAG测试和任何未来微调在服务器执行。当前仅审阅EXT-AUDIT-01元数据和审计材料，没有读取模型初测内容。

## 本会话材料

- **L1** `PROJECT_PLAN(1).md`：保留九模块、证据与回执分层，变更当前范围和训练优先级。SHA-256 `b8f082ab6b17ac3918f5b485545ebe8b7516a7022750e73be5fc18d2062cebe8`。不附原件。
- **L2** `DATA_BLUEPRINT(1).md`：保留六类数据通道；旧包数量不代表当前data状态。SHA-256 `ba03f76303e29eaacf365456c2b203c883f58db28585336343a2dc57e056cda0`。不附原件。
- **L3** `CR_PCENG_001_Codex_Task_Card.md`：吸收物化/工程能力；种子数量及仅文档同步阶段被v0.3替代。SHA-256 `1953cfd225584a770f203810f6fc81ae31f7623b071de5783c1147ce492157ae`。不附原件。

## 本版工程决策（不是既有事实）

D01：局部模型核心而非完整信息系统。D02：SQLite取代旧计划本轮PostgreSQL以减少原型部署负担；通过Port保留迁移。D03：先字面/精确检索再真实embedding和可选重排。D04：不把每个请求变成审批案例。D05：C1–C4与紧迫性分开，unknown/no-results不等于无标准。D06：当前不生产固定规模种子、不训练。D07：不移动已有资料，不将测试、企划书和生成任务当安全原文。D08：角色呈现与真实授权分开。D09：实际Qwen运行在服务器接入，Mock不算模型成绩。D10：指标/时延和扩量由服务器基线决定。D11（v0.3.2）：当前阶段可在明确只读源工作区做元数据分流和用途许可明确的portable seed准备，不启动T00；目标数据库/RAG测试与任何未来微调只在服务器执行。

## 本次核查的原始技术来源

### W1 · Qwen3.8-27B official repository file page

https://huggingface.co/Qwen/Qwen3.8-27B/tree/main

核查日期：2026-09-19。官方仓库文件页可核查标识；模型卡主入口本次首次读取cache miss，未读取本地权重或验证runtime。

### W2 · vLLM OpenAI-compatible serving

https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/

核查日期：2026-09-19。HTTP协议和generation_config行为参考；不保证本机所有功能已兼容。

### W3 · SQLite FTS5

https://www.sqlite.org/fts5.html

核查日期：2026-09-19。全文检索、bm25与trigram；运行环境须probe编译支持与中文行为。

### W4 · Qwen3-Embedding-0.6B

https://huggingface.co/Qwen/Qwen3-Embedding-0.6B

核查日期：2026-09-19。候选embedding身份与使用说明；未下载未实测。

### W5 · Qwen3-Reranker-0.6B

https://huggingface.co/Qwen/Qwen3-Reranker-0.6B

核查日期：2026-09-19。候选重排模型；默认不启用。

### W6 · FastAPI manual server

https://fastapi.tiangolo.com/deployment/manually/

核查日期：2026-09-19。应用服务候选；依赖版本需锁定。

### W7 · Pint documentation

https://pint.readthedocs.io/en/stable/

核查日期：2026-09-19。单位工具参考；单位正确不证明物理模型正确。

### W8 · pypdf text extraction

https://pypdf.readthedocs.io/en/stable/user/extract-text.html

核查日期：2026-09-19。原生PDF提取与局限；不是扫描页/表格自动正确的保证。

### W9 · PyBaMM thermal models

https://docs.pybamm.org/en/stable/source/examples/notebooks/models/thermal-models.html

核查日期：2026-09-19。专用热模型候选及假设；本轮不安装，不作为通用风险预测器。

### W10 · Proximal Policy Optimization Algorithms

https://arxiv.org/abs/1707.06347

核查日期：2026-09-19。未来PPO方法背景，未选定或实现训练。

### W11 · SimPO

https://arxiv.org/abs/2405.14734

核查日期：2026-09-19。未来偏好优化候选，未选定。

### W12 · CPPO Completion Pruning Policy Optimization

https://arxiv.org/abs/2503.22342

核查日期：2026-09-19。说明CPPO存在该具体用法；不假设就是用户所指方法。

### W13 · NumPy load

https://numpy.org/doc/stable/reference/generated/numpy.load.html

核查日期：2026-09-19。安全读取向量文件；明确allow_pickle=False。

### W14 · OpenAI Codex AGENTS.md

https://developers.openai.com/codex/guides/agents-md/

核查日期：2026-09-19。项目级指导文件读取参考；不更改用户全局配置。
