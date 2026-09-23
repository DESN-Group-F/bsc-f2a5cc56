# CR-LITHIUM-COVERAGE-001 — 执行与审计任务卡

用户已于 2026-09-21 授权执行锂电池覆盖核查与必要补充，要求节约 token、尽量委派子代理。使用 Sol，短上下文，回传计数/缺口/文件位置，不重复倾倒正文。

运行目录：`E:/desn 2000/bsc/data_preparation/CR-LITHIUM-COVERAGE-001/20260921T043456_AEST`。
已有准备输入：`CR-DATA-READY-001/20260920T012405_AEST`，最新候选解释：`CR-DATA-CANDIDATE-001/20260920T045258_AEST`。两者只读，原源工作区也只读。

## 目标与范围

落实已批准的 `CR_LITHIUM_COVERAGE_001_SCOPE.md`：给出实际型号、化学体系、形态、单体/电池包/系统及生命周期任务的覆盖与缺口，按主要缺口定向补充可追溯材料。优先 UNSW 课程/实验室及常见便携设备/工具/轻型交通相关数据；储能和其他场景保留适用范围，不因资源易得而排除。此排序是执行假设，不声称用户给过具体资产清单。

充电锂离子主要体系及圆柱、方形、软包均应列入矩阵；一次锂电池与特殊体系另列，LTO 负极体系不要与正极体系混为同一维度。品牌、尺寸、系列、商品完整型号与实验样本 ID 分开，型号别名/版本分别可追溯。既有型号清单与新发现资料共同构成当前盘点，不能宣称市场全集或型号覆盖率。

公开权威网页与体积适中的 PDF 的定向获取、事实整理属于本次用户授权的必要补充；不得广泛爬取站点、下载大型实验包、执行下载代码、绕过登录/复制控制或修改任何环境。每个新增下载文件记录 URL、日期、hash、大小及原始版本信息；每件默认不超过 20 MB、每作者默认不超过 100 MB，超出先报告总控重新选择来源。下载存在 `sources/`，派生事实与原件分离。用已有 bundled Python `C:/Users/S.W/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe -B`，不安装依赖、不写 `.pyc`。

来源权限按具体动作判断：公开可读、非商业研究、内部非逐字事实整理、原文进入 RAG、训练及再分发分开。不能把普通版权自动当作禁止阅读或事实核验，也不能把用户授权或网页公开当成厂家授予的通用许可。保持既有明确限制。遇到新来源明确的 AI/复制/访问限制，记录证据，暂停该受影响动作并报告；其他来源继续。

## 分工

- EXISTING Sol，`existing/`：用已有小型索引、审阅产物、原数据集声明中获准内容，建立已有型号/系列/样本身份及资料深度清单，核查别名与证据绑定；绝不重扫 112 GB。不得将研究样本、尺寸或品牌算商品型号。输出 `MODEL_EVIDENCE.jsonl`、`COVERAGE_FINDINGS.json`、`REPORT.md` 和实际 `CHECK_RESULTS.json`。后续非原作者审计补充产品资料。
- PRODUCTS Sol，`products/`：在覆盖矩阵全部维度登记的前提下，定向查找官方厂家来源，尽可能补齐跨厂家/主要体系/三种形态的有效具体型号资料。优先已有实验型号的原厂关联、关键数据缺口及跨体系缺口；可从 Molicel、Panasonic、Samsung SDI、LG Energy Solution、Murata、EVE、Lishen、CATL、BYD、Toshiba SCiB、A123 等官方入口核查。此名单是搜索候选，不保证全部有可取得型号数据。型号集合在找到材料后不得掩盖失败目标。每个型号记录身份、声明的化学体系（未知不能推断）、形态、数值事实的单位/条件/版本、页/表定位、来源质量和用途边界。不得用代理商页冒充原厂。输出 `SEARCH_TARGETS.jsonl`、`SOURCE_REGISTER.jsonl`、`MODEL_FACTS.jsonl`、`OPEN_GAPS.jsonl`、`REPORT.md`、检查结果与可复现脚本。先报目标与方案，再继续实做；无需等待总控逐项批准公开小文件获取。
- SCOPE/AUDIT Sol，`scope/`、`background/`、`audits/`：先独立建立需求矩阵和验收规则，基于已确认场景与用户重点，避免按能找到什么来定义需求。复用已有公开权威背景材料，针对真实缺口少量补充化学体系/系统/生命周期参考；每项证据标清原始适用范围。检查 PRODUCTS 的来源动作判断与 EXISTING 结果，独立审计每个最终接收的新型号记录和背景对应关系；不得只验 schema 或抽查后声称逐条。自己的背景产物由另一作者审计。
- 总控：维护任务范围和看板、组织交叉审计、合并当前视图、复核明显异常及作最终决定。原作者不得自行验收。

## 共用最小字段与质量规则

MODEL_EVIDENCE/MODEL_FACTS 每条至少有 `record_id`、`manufacturer`、`model_label`、`identity_kind`（EXACT_MODEL/FAMILY/SERIES/SAMPLE_ID/UNKNOWN）、`canonical_identity`、`aliases`、`chemistry`、`form_factor`、`system_level`、`source_refs`、`document_version`、`facts`、`conditions_and_limits`、`content_depth`、`use_status`、`remaining_gaps`。无法取得的字段明确 UNKNOWN。`facts` 的每个量必须保留字段、值、单位、比较符或范围、条件、具体证据位置；一个 catalogue 行不能自动成为完整操作参数档案。

来源登记保留 `source_id/url/publisher/acquired_at/local_path/sha256/bytes/version/authority_basis/use_decision/evidence_refs`。网页可以保留必要公开快照；未下载或下载失败不能标为已保存。完整正文不回传聊天，受限正文不复制到衍生知识语料。

检查覆盖：精确身份去重、引用文件/页表可定位、值/单位/条件与原文一致、内容深度与声称功能一致、来源使用状态不被升级。原文不声明的字段不能通过常识、型号相似或其他电芯参数补齐。

输出必须分开：已完成实际核查、尚未解决、已有但有用途限制、不属于当前可承诺能力；不能只通过列清单就宣布型号覆盖充分。无依据的“全覆盖”“全部可入 RAG”“所有产品可诊断”均不得作为验收结论。
