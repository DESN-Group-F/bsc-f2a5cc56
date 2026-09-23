# CR-DATA-MAP-001：数据 Mapping 与后续方案评定任务卡

版本：1.0。依据：本轮用户已确认先完成 Mapping，再评定处理方式，并授权由主窗口指挥子代理。本文是本轮执行范围，不是资料用途批准。

执行分工：依据用户本轮补充要求，MAP-01/02/03 明确使用 `gpt-5.6-sol`，只传任务卡与必要进度，不复制完整对话；主窗口承担协调、合并与复核。原继承 Astra 的三个代理已中断，未交付产物。后续同类范围明确的子任务默认使用 Sol，遇到无法解决的证据冲突或复杂设计问题再评估升级，不将换模型等同于已测得用量节省。

本轮优先于旧 LP04“校准后继续批量加工”的工作顺序；既有产物与记录保留。当前只执行 MAP-00 至 MAP-04。METHOD-01/02 单独列卡，在 Mapping 固定版本后开展，不在本轮混入。

## 共同输入、输出与边界

- 活动项目：`E:/desn 2000/bsc`；源工作区 `E:/desn 2000/data/battery_data_workspace_v0_3` 只读。
- 初始范围：Phase A `20260919T185236_AEST_phase_a/ROUTING_MANIFEST.jsonl` 中的300份原件。复用现有审计、文件台账、用途记录、提取记录及 `20260919T200403_local_processing_05`，不重新全盘扫描、全量哈希或全量解压。
- 本轮目录：`data_preparation/CR-DATA-MAP-001/20260919T233638_AEST/`。统一输入为该目录的 `INPUT_SCOPE.jsonl`，各子代理只写自己的 `documents/`、`datasets/` 或 `lineage/` 子目录；共享输入及最终主表由主窗口管理。
- 原件、容器成员、派生产物分别登记和计数；文件登记覆盖率与结构识别率分开。按格式、内容语义、结构变体分类，不以文件扩展名或旧 DOC_RAG/SPEC_DB 标签代替实际结构。
- 允许为分类做必要的本地结构探查。优先复用现有证据；新内容访问先核对具体对象及本地动作的既有用途依据。RAG未准入本身不否定已有本地加工依据；本地依据也不授权外传、模型上下文或新用途。只把结构摘要送回主窗口，不回传源正文。
- 沿用已记录来源用途结论，不新作法律判断或扩大用途。未知、限制、格式问题分开记录，不能用 UNKNOWN 隐藏可检查却未检查的对象。
- 禁止工具选型、方案性能比较、生产式批量提取、正式RAG/数据库部署、模型调用、服务器连接、上传、训练、安装依赖和扩大下载。旧模型评测问题/答案不在本轮范围。
- 用已有隔离 Python 执行结构探查时使用 `-B`，避免在只读源目录写缓存。只读源脚本可用于理解已有记录，不能运行会重建源台账或全量处理的入口。

## MAP-00｜统一范围与输出约定（主窗口）

目标：冻结本轮输入清单身份，关联已有登记，划分互斥文件责任范围。

交付：`INPUT_SCOPE.jsonl`、`INPUT_SNAPSHOT.json`、`TASK_STATUS.json`。其中快照仅重算小型台账/合同哈希，不重算原始大文件哈希。

验收：原件300条且file_id唯一；每条能关联来源登记；MAP-01/02恰好分割这300条。引用历史检查不得标为本轮重做。

## MAP-01｜文档、规格与开发资料的实际结构（子代理 documents）

输入范围：统一输入中 `assigned_lane=documents` 的全部对象，包含HTML/PDF/Markdown/RST/文本/图示/源码等；不执行源码。

工作：逐对象区分指南、产品规格、论文、技术项目文档、许可/方法等语义；识别正文、列表、参数表、混合版式、原生文本/扫描/未知等结构。对当前可检查对象做必要结构探查；依据不足对象只使用既有元数据，写清未知。不能从“存在表格”推定表格是产品参数，也不能把项目架构文档当硬件规格。

交付：`documents/MAPPING_FRAGMENT.jsonl`、`documents/NOTES.md`、实际探查脚本和运行记录。每个分配file_id恰好一条，使用下方共同字段。

验收：每类结论有文件级证据和检查范围；格式/内容/结构分开；不将同扩展名自动当同结构；不把文本抽取成功等同于内容正确。

## MAP-02｜实验数据、表格与容器结构（子代理 datasets）

输入范围：统一输入中 `assigned_lane=datasets` 的全部对象，包含CSV/XLSX/JSON/MAT/归档及分卷等。

工作：区分实验时序、汇总表、FMMEA表、参数表、来源目录/元数据及容器；逐个允许对象检查表头/工作表/结构键或已有容器清单，按实际字段和层级建立结构签名。对于大文件只读取分类所需部分，并说明无法据此判断全量一致性。JSON非标准常量、分卷、嵌套归档、MAT格式代际及权限限制分别标记。复用既有全量统计时注明历史来源，不再读取百万行或完整TGZ。

交付：`datasets/MAPPING_FRAGMENT.jsonl`、`datasets/NOTES.md`、探查脚本和运行记录。容器成员如有可得清单，另存 `datasets/CONTAINER_COMPONENTS.jsonl`，不增加原件数。

验收：每个分配对象均有记录，结构签名可追溯；容器外层识别与内部数据识别分开；未知单位/条件不猜测；不得用五份CSV的成功替其余文件背书。

## MAP-03｜来源、派生与证据范围核对（子代理 lineage）

输入范围：300份对象及关联台账，只读已有元数据，不另读原始正文。

工作：核对来源/版本/重复别名、已有提取件与本地加工输出关系、hash绑定和用途记录指针；区分原件、元数据、容器成员及派生输出。查找可复用的结构证据、具体权限/关联缺口和旧报告口径差异。只记录与本轮mapping有关的缺口，不重建整个授权台账。

交付：`lineage/LINEAGE_FRAGMENT.jsonl`（每个原件一条）、`lineage/RELATIONS.jsonl`、`lineage/NOTES.md`、核对脚本。第一次完成后向主窗口汇报，可再领取MAP-04独立审阅。

验收：每个关系有精确输入路径/记录ID；相同source_id本身不证明派生或权限关系；历史证据与本轮验证分开；不得凭全局原件数推导内容覆盖率。

## 共同 Mapping fragment 字段

每行至少包含：`file_id`、`technical_format`、`semantic_type`、`structure_variant`、`structure_signature`（结构未确定时null）、`mapping_status`、`profile`、`evidence_refs`（字符串列表）、`basis`、`limitations`、`unknowns`、`content_access`。

- `mapping_status`：`STRUCTURE_IDENTIFIED` / `PROVISIONAL_METADATA_ONLY` / `UNKNOWN_RESTRICTED` / `UNKNOWN_INSUFFICIENT_EVIDENCE`。
- `basis`：对象；至少含 `kind`（`OBSERVED_THIS_RUN` / `REUSED_EXISTING_EVIDENCE` / `METADATA_INFERENCE`）、`inspection_scope`。混合证据可加明细。
- `content_access`：对象；至少含 `performed_this_run`、`action`、`rights_basis_refs`、`reason`；仅复用台账应为false。
- `profile`：实际观察到的结构特征，例如字段名、工作表数、表格数量、容器成员类型分布、读取边界；允许null。不得写待选工具或处理方案。
- `unknowns`/`limitations`：字符串列表；未探查的内部结构和未核实语义要明确写出。
- `STRUCTURE_IDENTIFIED`仅说明声明范围的结构有证据，不代表全文件内容、领域适用性或后续工具可用性通过。

## MAP-04｜合并、覆盖核对与交接（主窗口，独立审阅由子代理支持）

交付：`DATA_MAPPING.jsonl`、`TYPE_STRUCTURE_SUMMARY.md`、`MAPPING_GAPS.jsonl`、`CHECK_RESULTS.json`、`SUMMARY.md`及产物索引。

检查：file_id集合精确等于范围清单；两份结构fragment无遗漏/重复；来源/证据引用能定位；分类计数可对账；原件/成员/派生计数分开；有理由的未知与尚未完成检查分开。输出登记覆盖率、结构识别率以及本轮观察/历史复用/元数据推断比例，全部明确分母。

固定 Mapping 版本时，未能识别的对象保留待查项，后续方案对相应类型保持待定。不得称全300份数据已有可用处理方案。

## METHOD-01｜逐类型处理方式与现成方案评定（后续，未派发）

依赖：MAP-04固定的Mapping版本。确定各类型支持的用户任务、需要保留的信息和目标输出，再比较现成工具与配置、项目适配需求、资源与部署成本。RAGFlow等仅为候选；工具声称支持、项目实测通过分别记录。

交付：逐类型方案评估表、推荐组合、替代/待定路线。不得在Mapping阶段预填选型结论。

## METHOD-02｜有覆盖依据的验证计划（后续，未派发）

依赖：METHOD-01。按实际结构变体和异常风险选择样本，明确代表范围、独立核验方法、通过条件、失败处置与扩展条件。计划与已执行结果分开；沿用现有本地/服务器执行边界。

交付：验证计划及样本—类型覆盖表。实施和批量处理是此后工作，不能从计划存在推断已通过。
