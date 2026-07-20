# Audience Visual Contract — 报告前端设计合同

## 快速导航

- [1. 受众分层](#1-受众分层)
- [2. 信息架构](#2-信息架构)
- [3. 布局选择](#3-布局选择)
- [4. Bento 规则](#4-bento-12-列规则)
- [5. 图表政策](#5-图表政策)
- [6. 合同模板](#6-visual-contract-模板)

本文件把研究文档中的前端设计原则压缩成运行时约束。生成 HTML 报告前先填写合同，再写页面。

## 1. 受众分层

| 层级 | 第一读者 | 前端目标 | 信息预算 | 默认布局 |
|:---|:---|:---|:---|:---|
| L1 decision | 大区总经理、经营管理层 | 3 分钟内判断风险、机会和动作优先级 | 3-5 个核心指标，3-4 张主图，2-3 条行动 | Bento Brief 或 Scroll Narrative 首屏 |
| L2 tactical | 战区经理、品类/渠道负责人 | 找到责任范围、原因假设和下一步动作 | 5-8 条行动，6-8 张分析图，关键表格 | Scroll Narrative + Action Board |
| L3 analysis | 分析师、项目 owner | 复算口径、追明细、二次分析 | 明细表、字段口径、审计记录 | Audit Pack / Analysis Workbook |

规则：同一份报告可以服务多层，但第一屏只能服务一个第一读者。其他层级放在后续章节或明细区。

**密度轴修正 (V2.4)**：上表信息预算为叙事标准档口径。紧凑销售报告档 (`data-density="compact"`) 预算**上调**——KPI 5-8 个、Chapter 3-6 个、每章图表组件 ≤3 且密集形态 (子弹阵列/Small Multiples/Sparkline 表格/热力表) 算 1 个；明细表可上浮进章节。**紧凑 ≠ 简陋：密度靠换密集图表形态实现，禁止砍归因图和达成图**。图表形态选择详见 `chart-selection-guide.md` §7。

**经营分析报告覆盖面清单 (V2.4.1 — 别只建到章节下限)**：销售/经营复盘类报告默认应覆盖以下多面，每面成一章 (数据支持时)，月报/半年报/年报默认 **4-5 章**，勿停在 3 章：
1. **总量与量价** — 总额同比 + 量价拆解 (瀑布图证明"量增/量退、价升/价降"，别只在文案里断言)
2. **结构升级** — 结构机/高端机渗透率趋势 + 分战区/渠道结构
3. **渠道结构** — 各渠道份额趋势与同比 (谁在补谁的缺口)
4. **区域/战区** — 排名 + 同比 + 两极分化
5. **趋势** — 优先**同期对比(YoY)**：x=1-12月、叠 2-3 年，季节峰谷与同比差距一眼可读；**避免用连续多年单折线** (把季节性画成随机噪声)。
> 判据仍是"少胜于多"：每章须带独立 Evidence Pack 与决策含义，不为凑数拆章；但也不要把 4 个维度的故事压成 1 章导致"太薄"。

## 2. 信息架构

- 高管视图遵循倒金字塔：What changed -> So what -> Why -> Now what。
- 首屏左上区域放最重要结论或主风险，不放装饰性标题。
- 报告只保留 3-5 个独立信息区块；超过这个数量要分章节、折叠或下沉到明细。
- 信任机制必须可见：数据日期、来源、审计状态、口径边界、导出/明细入口至少出现一种。
- **Data Contract 必答项 (V3.2)**：① 主指标/辅助度量的维度轴/时间轴聚合、单位、存储尺度、方向、可加性和权重覆盖？② period 还是 snapshot，选择日历环比、等长窗、上一完整期、同阶段、同比或自定义基线？③ `references[]` 的目标/Benchmark/区间/组间比较绑定哪个度量与单位？④ 业务粒度、主键、必需/可选字段、类型和单位？⑤ 是否用 `drift_lock` 与已确认基线核对语义/schema/行数/结果？完整格式见 `semantic-data-contract.md`。

### 2.1 指标甄选原则 (V2.4 — 选 KPI 先过这四关)

| 原则 | 规则 | 反例 |
|:---|:---|:---|
| **伴生制衡** | 数量类核心指标必须搭配质量/效率类伴生指标, 防单指标误导 | 只看"新客数"不看获客成本 → 不计成本冲量; 只看"签收额"不看毛利率/达成率 |
| **无对比即无分析** | 每个核心指标至少带一类对比基准: 时间(同比/环比) / 结构(跨战区/渠道) / 目标(达成/Benchmark) | 裸数字"签收 8,639 台"没有任何基准 = 无法判断好坏 |
| **认知上限** | 单一视图核心指标 ≤7 (工作记忆上限); 紧凑档 5-8 靠分组分行消化, 不靠读者硬记 | 首屏平铺 12 个 KPI, 读者反而抓不到重点 |
| **第一性指标随阶段演进** | 核心指标跟随业务阶段选取: 破局期看量 → 渗透期看额与获客效率 → 存量期看利润率/留存/效率 | 存量博弈期首屏还挂"订单量增速"当头号指标 |

## 3. 布局选择

| 场景 | 布局 | 采用条件 | 禁忌 |
|:---|:---|:---|:---|
| 一屏决策简报 | 12 列 Bento | 飞书延展页、日报速览、高管周会、风险预警 | 均等 KPI 卡片墙 |
| 长专题复盘 | Scroll Narrative | 月报、季报、专题分析、需要讲清原因和动作 | 把所有数据堆在首屏 |
| 日常运营监控 | Sidebar + Dense Table | 高频刷新、筛选、下钻 | 大 Hero、营销式文案 |
| 审计/口径包 | Audit Pack | 证明数据可信和可复算 | 视觉包装盖过口径 |

## 4. Bento 12 列规则

- 使用 12 列网格；常用跨度为 3、4、6、8、12。
- Hero Tile 必须最大，承载最大风险或最大机会。
- Metric Tile 只放能改变判断的指标，不凑数量。
- Action Tile 不超过 3 条动作；每条包含对象、动作、时限、验证指标。
- Audit Strip 横跨全宽，展示来源、刷新、审计、边界。
- 移动端降为单列；长标题允许换行，不靠缩小字体硬塞。

## 5. 图表政策

| 分析意图 | 推荐图表 | 默认禁用 |
|:---|:---|:---|
| 时间趋势 | 折线图、面积图、Small Multiples | 饼图 |
| 排名对比 | 水平条形图、点阵图 | 饼图、倾斜长标签柱图 |
| 占比构成 | 100%堆叠条形图、Treemap | 饼图/环形 (>3 类默认禁用) |
| 目标 vs 实际 | 子弹图、进度条、差距条 | 双 Y 轴 |
| 增量归因 | 瀑布图、PVM Bridge | 普通柱图堆解释 |
| 相关性 | 散点图、气泡图 | 暗示因果的双轴图 |

硬规则：3D 图禁止；柱状/条形图零基线；双 Y 轴默认拆成上下双图；图表标题必须是结论句。

## 6. Visual Contract 模板

```yaml
visual_contract:
  first_reader: L1 decision / L2 tactical / L3 analysis
  decision_job: 这份页面要让读者决定什么
  scan_path: f_pattern / scroll_story / dense_table
  layout_model: bento_12col / scroll_narrative / operational_sidebar / audit_pack
  primary_tile_or_hero: 最大风险或最大机会
  info_budget:
    kpis: 3-5
    main_charts: 3-4
    actions: 2-3 for L1, 5-8 for L2
  chart_policy:
    banned: [3d, misleading_dual_axis, truncated_bar_axis, complex_pie]
    preferred:
      trend: line_or_area
      ranking: horizontal_bar_or_dot_plot
      composition: stacked_bar_or_treemap
      target_gap: bullet_or_progress
  trust_mechanism:
    - data_date
    - source_note
    - audit_status
    - evidence_pack
    - export_or_detail_path
  responsive_check:
    desktop_1360: required
    mobile_390: required_for_brief_or_mobile_delivery
```
