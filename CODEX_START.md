# Codex 当前执行指令 — BSC Model Core v0.3.2

活动项目目录为 `E:\desn 2000\bsc`。原 v0.3 交接包、模型初测目录和历史文件保持原位。明确源工作区`E:\desn 2000\data\battery_data_workspace_v0_3`只读，禁止修改、移动或上传；其他data目录不扫描。

开始前读取 `AGENTS.md`、`docs/LOCAL_SERVER_EXECUTION_BOUNDARY.md`、`config/execution_policy.json`、`IMPLEMENTATION_PLAN.md`、`backlog/local_preparation_tasks.json` 和 `backlog/tasks.json`。

## 当前只执行本地数据准备阶段 LP

1. T00 保持 `NOT_STARTED`。不探测本地模型，不运行项目测试、应用、目标数据库/RAG、查询验证、模型或评测命令。
2. 本地可准备或修改设计、源码草稿、合同、配置、manifest、服务器脚本和测试fixture；可在明确只读源工作区做元数据分流，并仅对用途许可明确的对象准备portable seed。
3. 本地源码统一标记 `PREPARED_LOCALLY_UNVERIFIED`；测试统一标记 `DEFINED_NOT_RUN`。不得报告 PASS、性能数字或模型分数。
4. 原件不可改写；派生数据写入bsc下`data_preparation/`。权限未知时只登记UNKNOWN和阻塞，不读取正文或推断准入。
5. 准备服务器执行边界：代码包、RAG资料、公开评测输入、私有oracle和未来训练候选数据必须隔离。
6. 服务器地址、系统、GPU/CUDA、模型位置、访问方式、传输许可、依赖安装、网络及预算保持 UNKNOWN，直到用户提供并确认。
7. 当前不连接服务器、不上传资料、不下载模型、不运行训练。

## 本地准备阶段交付

- 服务器配置样例与执行策略。
- code/RAG/eval-public/eval-private/training-candidate 的 manifest 模板和隔离规则。
- T00–T06 的服务器执行矩阵：命令草稿、输入、依赖、预期产物、原始日志和判定证据。
- 可在服务器运行的源码、迁移和测试定义，但不在本地执行。
- 本地source routing、rights sidecar、portable seed候选、血缘和服务器导入计划；内容加工受逐用途许可门禁。
- 明确的未知项、阻塞项、传输许可和计算授权清单。
- `READY_FOR_SERVER_HANDOFF_REVIEW` 状态；不能将其写成 T00 或实现完成。

## 后续但当前禁止执行

用户明确确认服务器和传输门禁后，才启动 T00。全部单元、合同、集成、检索、UI、端到端、Qwen、性能和评测测试在服务器执行。任何未来微调同样只在服务器执行，并继续受 T20、数据许可、预算和单独用户批准控制。
