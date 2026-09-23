# 先基线、后归因、再训练

## 0. 执行环境约束

本文件涉及的合同测试、单元测试、集成测试、检索测试、安全测试、B0–B3、oracle诊断、性能测试、模型评测及任何微调，只能在服务器执行。当前本地阶段只准备测试输入、fixture、grader、运行配置和服务器命令草稿；全部状态为`DEFINED_NOT_RUN`。

服务器尚未配置，T00尚未启动。没有服务器run manifest、原始stdout/stderr、环境快照和输入／输出hash，不能记录PASS、FAIL、性能数字、Qwen分数或训练收益。

## 1. 当前不做什么

不建设固定180/270/万级种子集，不要求SFT为搭架构的前置条件，不实现四算法串行训练流水线，不将旧初测成绩写成精确百分比。旧数量只留历史；config/training_deferred.json全部禁用。

现在本地准备的是评测与失败登记文件。`evaluation/scenario_specs.jsonl`为工程情景设计，不是训练种子/独立金标/已执行结果。fixture、参考判据和runner在本地编写，实际执行只在服务器开展。

## 2. 运行与输入协议

每个EvalCase分公开input与private oracle；传输到服务器时也必须使用两个独立manifest和权限目录。模型只能读input和该配置允许的证据。oracle包括必要要点、禁止推断、参考计算/容差、预期tool行为、severity以及审核状态。禁止把private oracle目录加入索引或模型文件工具。

EvalRun记录model profile、generation effective settings、prompt、case、corpus/index、tool/代码版本、input/output hashes、latency、token usage、失败/未运行原因。记录所有失败，不只保留成功输出。replay可重放固定工具快照，也可真实调用确定性工具，两种模式分别声明。

已有公开题和用户小测试按actual use登记：题目、文件、日期、工具条件、答案、判分与配置。已用于调试的题是development/regression，不再伪装完全未见holdout。当前仅有USER_REPORTED_INITIAL_RESULT，不填写题量或得分。

## 3. 对照条件

B0模型、B1模型+RAG、B2模型+RAG+工具、B3完整harness、D_ORACLE人工正确证据诊断。对比同一题set、可比生成预算并报告实际总调用成本。不同模型参数、量化、模板或知识更新单独建run，不能混为SFT收益。

D_ORACLE仅用于开发失败定位：自动检索失败而oracle成功，优先修数据/检索；两者都不成功再检查任务标签、模型理解或工具。它不纳入常规能力分数。

未来T_CANDIDATE在服务器与B3共享外围组件，仅更换候选模型/adapter。旧已强的物化/工程能力保持回归，不能为了格式和安全措辞损害正常技术帮助。

## 4. 指标分母

- 科学/工程正确性：经审核的可判定任务中，关键结论与假设成立的比例；无法唯一根因的题不以猜中一个label评分。
- 数值：正确单位下的误差和容差；分模型选择正确性、工具计算正确性、解释正确性。
- 检索：允许候选集合内Recall@k、无答案处理、精确型号匹配与条件保留；“相关”与“适用”分开。
- 引用：存在/可定位/有权读取 vs 语义支持 vs 适用性，分别统计。
- 诊断/预测：关键候选/缺信息是否识别、有没有假精确概率、目标/时域/适用范围；定量概率只有带足够标签与样本才评价校准。
- 有用性：当前证据允许完成的工作完成率、不必要拒绝/追问、可读性、对不同角色的适配。
- 系统：工具正确性、重复/超时/取消、回执真实性、状态新旧、隐私、注入、应急信息可用性。

model_raw与system_final分列。出现危险模型建议被后端拦截，不记模型正确。LLM grader仅辅助，关键专业判定不能只有另一个模型投票。

## 5. 首轮情景覆盖

九模块×三能力×四scope类别不是机械全笛卡尔乘积。至少覆盖：正常可完成；信息可补齐；资料适用/不适用；同一条件改变结论；无本地程序但能解释；检索真正无直接案例；检索故障不能装无案例；状态陈旧；工具有结果/没结果；测量不可辨识；应急关键词教学与实际报告的差别；跨项目私有资料；未来业务未接。

当前附带规格数量是工程范围设计，不替代正式测试样本量。每类需记录是否有可审查gold以及是否实际执行，缺证据记BLOCKED，不强行算失败或成功。

## 6. 何时提出训练

FailureRecord先标component：SOURCE_COVERAGE、PARSING、RETRIEVAL、APPLICABILITY、MODEL_REASONING、TOOL_SELECTION、TOOL_IMPLEMENTATION、STATE_FRESHNESS、CONTEXT_MEMORY、OUTPUT_TRUTHFULNESS、EVAL_ORACLE、UX。

只有服务器上模型问题反复出现且目标可验证、资料允许、基线固定、收益目标与非退化测试存在时，才写TrainingDecision。SFT用于可靠示范；SimPO用于经审核偏好；PPO需真实可验证reward和隔离模拟环境；CPPO先指定全称/论文/实现，不能默认为某种约束方法。[W10-W12]

不得使用真实危险设备训练RL。奖励不能只看专业口吻、长度、用户满意或“说了安全提醒”；必须包含任务实际结果和严重错误约束。训练模式不直接从运行日志启用，反馈仍待许可/去敏/审核。所有训练即使在服务器上也默认禁用，必须另获用户对方法、数据、预算、模型和输出位置的明确批准。
