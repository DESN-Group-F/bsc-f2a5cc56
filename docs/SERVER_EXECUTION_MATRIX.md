# T00–T06 服务器执行矩阵

**状态：PLANNED_COMMANDS_NOT_IMPLEMENTED / NOT_RUN**  
**适用决策：ADR-EXEC-001**

本文件定义未来执行位置和证据，不授权当前启动。服务器详情、传输manifest、依赖安装及计算预算未确认，因此所有命令入口只定义职责，不伪造可运行命令。

## 1. 共通入口门禁

任何任务开始前必须具备：

- 已确认的`config/server.json`，不得提交secret；
- 已批准并核验hash的`server_transfer_manifest.json`；
- 唯一server profile ID、code bundle hash和run ID；
- code、RAG、eval-public、eval-private、training-candidate的目录／权限隔离；
- 原始stdout/stderr、环境快照、退出码和artifact hash输出位置；
- 用户对连接、传输、依赖安装、下载及计算预算所需的明确授权。

任一门禁缺失，对应任务状态为`BLOCKED_BEFORE_EXECUTION`，不能自行回退到本地执行。

## 2. 任务矩阵

|任务|本地只准备|未来执行环境|服务器实际动作|必须回传的证据|当前状态|
|---|---|---|---|---|---|
|T00|路径别名、manifest模板、未知项清单|经批准的本地源清单步骤 + 服务器预检|核验传输快照；记录OS/Python/Node/GPU/CUDA/磁盘/网络；探测SQLite FTS5；定位Qwen服务和旧初测归档条件|环境快照、接收清单、hash核验、model endpoint状态、阻塞项|NOT_STARTED|
|T01|工程骨架、ModelPort、HTTP/Mock adapter、probe定义|SERVER_ONLY|安装锁定依赖；启动或连接Qwen；执行probe及adapter测试|实际served ID、revision、量化、模板、effective generation、capability结果、原始日志|NOT_STARTED|
|T02|Schema、ORM模型、迁移与合同测试定义|SERVER_ONLY|创建隔离SQLite；执行迁移、回滚和合同／revision／隔离测试|数据库版本、迁移日志、测试结果、数据库artifact hash|NOT_STARTED|
|T03|准入流程、解析器、locator与fixture|SERVER_ONLY|仅对批准RAG bundle解析；执行PDF/DOCX/文本、失败及视觉待核用例|source snapshot、解析报告、locator样例、失败记录、无eval泄漏证据|NOT_STARTED|
|T04|FTS/精确检索代码、查询fixture、trace格式|SERVER_ONLY|建FTS5索引；运行型号、中文短词、无结果、故障、权限和引用测试|index manifest、查询trace、测试结果、错误reason code|NOT_STARTED|
|T05|受限数学AST、单位与I²R工具、独立参考fixture|SERVER_ONLY|执行单位、绝对温度/温差、域外输入、非有限数值和独立参考测试|工具版本、输入hash、原始测试输出、失败用例|NOT_STARTED|
|T06|API/UI/运行harness、端到端fixture与验收说明|SERVER_ONLY|真实Qwen + 批准来源 + 定位引用 + 成功工具 + 持久化run；另跑Mock分离用例|真实run_id、model profile、source/index snapshot、tool execution、数据库记录、UI/API证据、原始日志|NOT_STARTED|

## 3. 命令登记规则

真实命令只有在对应入口实际实现后才能写入README。每条命令登记以下状态之一：

- `PLANNED_NOT_IMPLEMENTED`
- `PREPARED_LOCALLY_UNVERIFIED`
- `SERVER_EXECUTED_FAILED`
- `SERVER_EXECUTED_PASSED`
- `BLOCKED_BEFORE_EXECUTION`

禁止提前写出“可运行”“通过”或虚构命令输出。服务器命令应从项目根运行，不依赖本地Windows绝对路径；路径通过配置和manifest注入。

## 4. 测试分层

服务器测试报告至少分开：

1. 静态／合同测试；
2. 单元测试；
3. 数据库与解析集成测试；
4. 检索与权限测试；
5. API/UI/取消/失败恢复测试；
6. Mock软件测试；
7. 真实Qwen端到端测试；
8. B0–B3及oracle评测；
9. 性能与资源报告；
10. 未来训练前后对照（当前禁用）。

任何一层未运行都写`NOT_RUN`，不能从另一层通过推断本层通过。

## 5. 微调边界

T00–T19和T21不自动授权微调。T20只在服务器基线与失败记录足够后形成TrainingDecision。训练执行仍需用户再次确认算法全称／实现、模型、数据manifest、许可、去敏、预算、checkpoint位置和冻结评测；批准后也只能在服务器运行。
