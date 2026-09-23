# 本地准备、服务器交接与迁移

## 1. 当前活动目录

活动项目位于 `E:\desn 2000\bsc`。原 v0.3 交接包、`data`、历史资料包、模型初测目录和旧企划书保持原位。当前只修改活动项目内的文件，不覆盖原始交接包。

当前阶段为 `LOCAL_DATA_PREPARATION_ONLY`，执行边界见 `LOCAL_SERVER_EXECUTION_BOUNDARY.md`。本阶段不启动T00。

## 2. 本地允许的准备工作

- 编写或修改文档、源码、合同、Schema、配置样例和backlog。
- 编写服务器运行脚本、数据库迁移、测试fixture和grader，但不执行。
- 准备code、RAG、eval-public、eval-private及future-training的manifest模板。
- 只读使用明确源工作区及EXT-AUDIT-01台账做metadata routing、current-state视图和权限sidecar。
- 对逐用途许可明确的对象准备portable chunks、规格seed和实验子集；派生产物写入bsc，不改原件。
- 执行确定性准备脚本时记录为`PREPARATION_RUN`，不得记录为项目测试或查询验证。
- 人工检查文件差异和生成文件哈希；这不是项目测试。

本地源码状态统一为`PREPARED_LOCALLY_UNVERIFIED`；测试状态统一为`DEFINED_NOT_RUN`。

## 3. 本地当前禁止执行

- 不运行 `scripts/validate_handoff.py`、unittest或未来项目测试。
- 不重新无差别盘点整个data或冻结快照，不读取模型初测目录。
- 不启动API/UI/目标数据库，不执行迁移、目标索引、查询验证或评测；准备性解析仅限许可明确对象。
- 不启动或probe本地模型，不连接服务器，不上传文件。
- 不下载模型，不生成训练数据，不运行任何微调。

继承的v0.3测试报告只作为基线历史，不能代表活动项目当前状态。

## 4. 服务器配置门禁

`config/server.example.json`只是一份待填写模板。下列字段在用户提供并确认前保持null或UNKNOWN：

- host alias、访问方式、操作系统和服务器工作目录；
- Python、Node、GPU、GPU数量、CUDA、磁盘和网络限制；
- Qwen服务或权重位置、served model ID、revision、量化、模板和有效生成参数；
- secret注入方式；
- 依赖安装、模型下载、外部网络和计算预算权限；
- 结果回传位置与保留策略。

不得把secret写入JSON样例、命令、日志或prompt。

## 5. 数据传输门禁

服务器不接收整个`E:\desn 2000\data`目录。传输前必须有用户批准的manifest，逐文件记录相对路径、hash、大小、source ID、用途、许可状态、敏感性和目标bundle。

至少分为：

- `code_bundle`
- `rag_source_bundle`
- `eval_public_inputs`
- `eval_private_oracle`
- `training_candidate_bundle`（当前禁用）

公开评测输入和私有oracle必须分开传输和授权。训练许可不能从RAG、evaluation或一般研究阅读许可推导。

## 6. 服务器执行与结果回传

服务器执行顺序和证据要求见 `SERVER_EXECUTION_MATRIX.md`。每次运行至少保存：

- 唯一run ID和任务ID；
- server profile、环境快照与代码bundle hash；
- 实际命令及起止时间；
- 输入manifest和输入hash；
- 原始stdout/stderr、退出码和未运行原因；
- 产生的数据库、索引、模型或报告artifact及其hash；
- Mock/真实Qwen、测试/训练的明确模式；
- PASS/FAIL/BLOCKED/NOT_RUN状态及判定依据。

结果回传到活动项目的 `outputs/server_runs/` 或后续用户指定目录。运行日志、评测答案和模型输出不得自动进入RAG或训练。

## 7. 启动T00

只有ADR-EXEC-001列出的服务器、传输、secret、预算和结果回传门禁全部满足，并由用户明确决定开始后，T00才从`NOT_STARTED`变更状态。完成本地准备不等于完成T00。
