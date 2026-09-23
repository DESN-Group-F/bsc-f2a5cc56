# 实施任务

当前执行`local_preparation_tasks.json`中的LP00–LP05，允许受控本地数据准备和服务器交接材料。T00及`tasks.json`中的T01–T21全部保持NOT_STARTED。

CR-DATA-ROUTE-001不得原样执行；必须使用`CR_DATA_ROUTE_001_EXECUTION_OVERLAY.md`。Phase A可分配，Phase B因逐文件解析用途状态为UNKNOWN而暂时阻塞。

服务器、传输、secret、依赖与预算门禁得到用户确认后，才可启动T00；随后在服务器执行T01–T06并完成一条有引用和工具的真实Qwen专业闭环。P2/P3也在服务器按依赖推进。T20仅依据服务器失败证据形成未来训练决定，不自动启动训练。

本地源码只能标`PREPARED_LOCALLY_UNVERIFIED`，本地测试定义只能标`DEFINED_NOT_RUN`，本地数据加工不产生query PASS/FAIL。继承的辅助校验或文件存在不意味着活动项目任务已完成。
