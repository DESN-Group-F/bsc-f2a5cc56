# RAG、原件保护与数据适配

## 1. 当前输入的事实边界

用户确认源数据位于`E:\desn 2000\data\battery_data_workspace_v0_3`。当前依据ADR-EXEC-001把该目录作为只读输入，已核对EXT-AUDIT-01的报告与台账状态，但不把审计历史结果冒充本轮执行。当前审计记录300份原件、约112.44GB冻结快照、RAG准入0；逐用途解析与外发状态仍需保持原记录。

当前可复用现有审计清单做metadata routing、current-state视图、权限sidecar和pilot候选，不重复全量hash或扫描。用途许可明确后，可在bsc派生目录准备portable chunks/spec seed/experiment subset；不能在本地建立目标RAG或执行查询验证。服务器传输前形成明确allowlist并核对版本、hash和来源，不根据目录名直接准入。

### 1.1 本地到服务器的传输边界

不得把整个`data`目录直接上传服务器。每次传输必须使用独立manifest记录source ID、相对路径、hash、大小、用途、ai_context/indexing/evaluation/training许可、敏感性、批准依据和目标bundle。RAG来源、公开评测输入、私有oracle及未来训练候选必须形成不同bundle；服务器接收端先核对manifest和hash，再允许后续任务读取。

## 2. 资料生命周期不是单一approved字段

建议分开：
- acquisition：DISCOVERED / PRESENT / FETCH_FAILED；原始文件hash和来源。
- parse：NOT_PARSED / TEXT_OK / NEEDS_VISUAL_REVIEW / FAILED；页码和解析工具版本。
- use_grants：human_reference、ai_context、indexing、training、evaluation、redistribution；ALLOW / DENY / UNKNOWN及依据。
- scientific_review：UNREVIEWED / CHECKED_FOR_SCOPE / CONFLICTED / WITHDRAWN。
- local_status：NOT_LOCAL / PUBLIC_LOCAL_GUIDANCE / LOCAL_APPROVED / UNKNOWN。

“允许模型在本次研究中读资料”“内容已被核对”“学校批准某种作业”互不等价。允许研究用途但未被本地批准的资料可用于适当的科学/工程解释，必须标范围；不能为追求谨慎把所有非本地资料排除后让模型永远无内容可答。

## 3. 分类与隔离

长期库分为规范/厂商/科学/案例集合。PROJECT_META和EVAL_ONLY不进入操作知识索引；训练种子、DPO、生成答案、批注评分不作RAG资料。案例来源保留reported_action与verified_recommendation区别。

导入范围只接受显式source IDs/允许路径；目录scan不是index。文件名启发式只能提示分类，最终使用字段或manifest控制。对放入data中的旧企划书、历史种子、基准答案设置负向测试，不能只靠排除一个测试目录名。

## 4. 提取与切片（服务器执行）

Markdown/HTML：保存标题层级、原始定位，移除导航但不丢正文限制。
PDF：优先pypdf按页提取；检查空文本、乱码、阅读次序和数值单位。扫描页不视为没有内容；以NEEDS_VISUAL_REVIEW排队，可由已验证视觉adapter或人工处理。表格保留表头、脚注、列、单位和父文段；未核对的关键数值不得作为具体操作限制。
DOCX：保留段落/标题/表格定位，版本改动后locator重新生成；本轮不执行宏。
CSV/JSON：区分资料目录、业务快照、测量时序和测试标签，不把所有行转成自然语言段落索引。
图片：原图hash＋页/框坐标＋解析状态＋人工确认，避免仅保存模型的图片摘要。

初始chunk目标约400–800个embedding tokens、少量重叠，仅为调优起点。不能拆掉“仅在……时”“不得”“除外”等前提；公式变量定义与单位必须可一起取得。长章节用child召回＋有限parent扩展，不整个文件塞入上下文。

## 5. 混合检索（服务器执行与测试）

1. QueryPlanner保留原查询，并可生成最多2个查找式，不改变电池型号、单位、数值和否定词。
2. Exact lookup优先定位资产ID、型号、规范编号/版本；使用参数化SQL，不执行模型生成SQL。
3. Sparse：SQLite FTS5，英文字词与中文策略实测；可采用显式分词后unicode61。trigram可作为子串通道，但小于3字符不能当成完整召回方案。[W3]
4. Dense：真实embedding，检索前按用途/权限/source set取allowed chunk IDs，再计算对应向量相似度；不先把无权文本发给重排或生成器。
5. RRF：按各路排名融合，初始k=60，两路各top20；不直接相加不同量纲分数。可选reranker查看top12，再按上下文预算选择证据。
6. 引用验证：与run所用index/source snapshot匹配，确实存在且用户可访问。格式通过不代表语义支持通过；关键内容仍需评估。

每次记录query、rewrite、filters、candidate IDs、各路ranks、选择/排除理由、耗时、错误和最终evidence IDs。没有结果按库范围报告，而不是“没有任何标准”。检索服务异常、只有无权结果、尚未解析必须有不同reason code。

## 6. 索引一致性与未来迁移

最小索引为NumPy浮点数组＋chunk ID顺序＋manifest。使用allow_pickle=False，只加载可信生成文件；向量维度、行数、ID唯一性、hash、模型revision匹配必须检查。[W13]

先写临时新版本，再以manifest指针切换；失败保留旧版本，不能让数据库chunk与新旧vector映射错位。删除/撤回由在线allowed-ID过滤立即生效，离线再重建；历史回放只使用仍允许访问的内容。

当真实数据量、内存或延迟证明精确检索不足，创建ADR选择pgvector/Qdrant等适配器。未完成这项基准前，不提前部署第二个数据库服务。变更向量库或重排模型必须重新跑检索对照。

## 7. 最小可用资料选取

首个服务器闭环只选少量经批准传输且明确可用的文档，覆盖至少一个实际技术问题；不要求先为所有历史外部入口填满审核平台。记录未传输/未接收/未准入/待解析资料的具体原因。资料不足的任务仍可用题设、通用知识或已有科学依据解释其可支持部分，不伪装本地结论。
