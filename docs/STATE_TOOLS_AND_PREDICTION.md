# 状态、分析工具、诊断与预测合同

## 1. 最小状态

Observation保存对象ID、字段、值与单位、basis、observed_at、recorded_at、source_ref、quality、uncertainty。basis采用REPORTED/OBSERVED/MEASURED/DOCUMENTED/DERIVED/HYPOTHESIS。未知用null，NULL不是零、正常或不存在。

CaseSnapshot保存活动目的、资产配置引用、地点、用户表达层次、事实集合、未知、冲突、假设、当前来源与工具引用、revision。模型可以提出fact更新，但写入时类型与来源由应用核验。用户给出的测量转述应保存“reported measurement”，不能自动当仪器直接采集的可信测量。

Hypothesis记录候选原因、支持/反证、未可辨识变量、需要的信息和版本。不能把“风险需要立即关注”和“唯一根因已证实”混成一个标签。没有概率模型时不生成故障概率百分比；可按证据支持度描述候选优先核查次序，并说明不是统计概率。

## 2. 建议首批工具

| 工具ID | 输入 | 输出 | 必须拒绝/标记的情况 |
|---|---|---|---|
| evidence.search | query、filters、source snapshot | evidence packet＋retrieval status | 无权资料、未准入、服务错误不能伪装无标准 |
| evidence.read | evidence_id、version | 原文、定位、范围 | 任意路径或跨项目读取 |
| state.read_case | case_id、revision | case snapshot | 无权或不存在，不返回虚构记录 |
| state.read_assets | asset ids、as_of | 资产/场所快照 | 最新记录不等于实时测量 |
| units.convert | value、from、to、quantity kind | value＋unit＋conversion metadata | 量纲不匹配，绝对温度/温差含义不清 |
| math.calculate | 受限表达式AST、带单位变量 | 数值、单位、方法、限制 | 任意代码/文件/网络、过大表达式、非有限结果 |
| electric.ohmic_power | I、R及单位/假设 | P=I²R结果 | 参数缺失；负电阻等域外条件；不得据P直接推温度 |
| series.validate | 数据object_id、列映射、时区、单位 | 缺失、重复/逆序时刻、间隔、质量标签 | 不静默填0、排序或插值改变原数据 |
| series.integrate | 验证后数据、符号约定、缺点/间隔政策 | Ah/Wh等积分、覆盖窗口与误差限制 | 不跨未允许的数据空洞积分；不把积分直接称SOH |
| spec.compare | 带证据字段、任务要求、规则引用 | 匹配/冲突/未知与依据 | 不以插头、同品牌或同电压单一条件做总体适配认证 |
| predictor.run | method_id、revision、input refs、horizon | 预测包或NOT_AVAILABLE | 未注册模型、不适用工况、无校准/验证、参数无出处 |

工具各有schema、执行预算、input hash、code version、result ref和真实status。独立参考测试要验证函数，不用调用同一个待测函数产生“真值”。Pint负责单位表达能力，不证明物理模型正确。[W7]

## 3. 数值例子：只验证计算边界

原始假设给定I=2 A、R=0.5 Ω，P=2 W；R改为1 Ω、I固定则P=4 W。独立参考算术可检查结果，但不能由此推断温度翻倍、真实电池风险翻倍或可继续使用。量化误差、真实内阻和热模型不在该题已知条件中。

给出明确1小时恒定1 A电流时，积分电量为1 Ah；有缺采样或正负约定未知时，工具必须说明未完整计算/条件缺失。不要自动把净电量当做设备实际容量或安全状态。

以上是合成数学fixture，不是充电、测试或安全阈值建议。

## 4. PredictorPort完整返回

predicted_quantity、time_horizon、observation_window、input_snapshot_hash、method_id/version、parameter_refs、assumptions、applicability_status、result、uncertainty_method/interval、validation_reference、invalidating_conditions、status。

未经验证的物理近似只可标BOUNDED_CALCULATION/SCENARIO_REASONING。VALIDATED_PREDICTOR必须有明确method和验证范围。软件运行成功与domain_validated分开；NOT_AVAILABLE是诚实状态，不妨碍另外提供定性分析。

PyBaMM等模型包含具体热、电化学假设，接入时逐模型建立参数、适用边界和验证说明。[W9] 当前只保留接口，不默认安装或将用户实时电池套入示例参数。

## 5. 方案的证据链

每个建议包含objective、basis refs、preconditions、actions、who_can_perform、incompatibilities、residual_uncertainty、reevaluation_triggers。方案等级为MATCHED_GUIDANCE/ADAPTED_PLAN/HYPOTHESIS_PLAN。

没有本地程序的科学解释不需要作业批准；具体电池危险处置不能靠通用知识自动产生可执行SOP。unknown不等于全部拒绝：可解释机制、提出安全获取证据的方式、整理专业交接信息和已知控制方向。紧迫时先呈现已有适用应急信息，不让求证过程延误。
