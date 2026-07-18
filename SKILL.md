---
name: south-china-report
description: "通用型数据分析报告叙事设计系统 V2.10。用于月报、旬报、季报、年报、专题复盘等讲故事型 HTML 数据报告的设计与生成——报告主体(机构/区域/业务线/产品/渠道/客户等)由数据内容自动决定并适配, 不绑定任何特定区域或组织。融合 Anti-Default 克制纪律、三角色字体、语义色三层架构、动效 Recipe 系统、密度轴(叙事标准风/紧凑报告风双档)与自动化校验。Invoke when the user needs a narrative HTML data report, business/sales analysis report, executive brief, or audit pack, or mentions 数据分析报告/经营分析/月报/旬报/季报/年报/专题复盘/区域分析/渠道分析/品类分析/客户分析. 不适用于高频运营监控看板(operational_monitor)、纯明细分析工作簿(analysis_workbook)；产物为静态自包含 HTML(非 PPT/Excel/交互式 BI 平台)。"
---
# South China Report — 通用数据分析报告叙事设计系统 V2

> 技能标识 `south-china-report` 为稳定 ID (不随内容版本改); 内容版本见 §11, 当前 V2.10; 2026-07 起目录名去除版本后缀, 曾用名 south-china-report-V2。
>
> **环境依赖**: 依赖 node>=18 (校验/截图/数字一致性/离线内联; 截图另需 Playwright+Chromium) 与 python3+duckdb+pandas (数据管线)。缺依赖时按文内降级路径执行并标注未验证。
>
> 报告不是仪表盘。仪表盘是给人"扫"的，报告是给人"读"的。
> 如果产出物和 FineBI 看板没区别，那就失败了。

---

## 快速上手 · 30 秒执行主线

> 首次使用先读这一屏抓主线；细节在 §1 Working Model 逐步展开，完整加载顺序见 §9。

**做什么**: 任意业务/经营数据 → 讲故事型静态自包含 HTML 报告 (不是看板/PPT/Excel/交互式 BI)。**报告主体(机构/区域/业务线/品类等)随数据内容自动适配, 不预设任何区域或组织**。

**最短主线** (每步对应 §1 步骤，别跳步)：

1. 定**风格档** (叙事标准/紧凑) + **报告类型** → 步骤 0
2. 有数据源先跑 `prep-source.py` `profile`→`build` 出 `metrics.json`，**数字从它抄不手敲** (`BLOCKED` 只出修数建议不出结论)；再跑 `stat-insights.py` 出 `insights.json`，**问题发现/趋势结论从它引用** → 步骤 4
3. 提炼 Governing Thought + 拆 2–4 章 PAC 故事弧 (现象→归因→对策) → 步骤 1-2
4. Read 对应模板 (**CSS 唯一真相源**) → 步骤 6；紧凑档 `sed` 一行切换 → 步骤 7
5. 选图**必过** `chart-selection-guide.md` §0 意图路由表 (禁止倒序选图) → 步骤 8
6. 交付前跑 4 道 Gate: `validate-report.mjs` → 截图逐张自看 → `verify-numbers.mjs` → 离线内联 → 步骤 9

**必读 3 份** (其余按需查)：本文件 + 对应模板 + `audience-visual-contract.md`。
**五条红线**：数据至上 · 零 Emoji · 饼图/环形默认禁用 · 报告≠看板 · 交付物无运行时切换。
> 注意拦截力边界：validator **自动硬阻断(exit 1)的只有 Emoji/tabular-nums/图表高度三项 P0**；饼图/双轴/弱 Hero 标题等只给 **P1 WARN 不阻断**，`exit 0` **不代表可交付**——P1 须人工逐条 review 清零或书面说明理由。

---

## §0 设计哲学

### 美学锚点

本系统定位为**叙事沉浸式数据体验**——

| 维度             | 学习对象                  | 本系统的表达                               |
| :--------------- | :------------------------ | :----------------------------------------- |
| **叙事力** | Apple Newsroom            | Governing Thought + Chapter + PAC 叙事闭环 |
| **数据感** | The Pudding               | 图表服务叙事，数据点必须回答 "So What"     |
| **设计感** | Airbnb Design             | 三角色字体 + 8pt 网格 + 语义色 + 克制动效  |
| **专业感** | McKinsey Global Institute | Action Title + Evidence Pack + 可执行 CTA  |
| **工程感** | Carbon Design System      | Token 驱动 + 自动化校验 + 组件版式表       |

### 双风格档位 (V2.4)

本系统提供两种**风格档位**, 在 **调用 Skill 的对话阶段（步骤 0）由用户选定一种**, 生成出的 HTML 即为最终产物（风格已烘焙进 `<html data-density>` 属性，交付物不含任何运行时切换机制）:

| 档位 | 密度参数 | 视觉特征 | 典型场景 |
| :--- | :--- | :--- | :--- |
| **叙事标准风 (默认)** | `--density: 1` | 大留白、慢节奏、强 Hero 沉浸 (100vh)、章节间 80px 呼吸、标题尺度饱满 | 高管月报/年报/战略叙事、对外汇报、沉浸式阅读 |
| **紧凑销售报告风** | `data-density="compact"` / `--density: 0.6` | 版式重组为信息密集: Hero 收为 masthead 横幅(结论居左+核心数字居右)、KPI 换行加密、内容列加宽、Pull Quote 转左线 callout、表格密集行。**信息预算上调**: KPI 5-8 / Chapter 3-6 / 密集图表形态(子弹阵列/Small Multiples/Sparkline表格)优先 —— **紧凑≠简陋, 密度靠形态不靠删内容** (见 `chart-selection-guide.md` §7)。**注**: 完整版式重组仅 `scroll-narrative` 模板提供; bento/audit 的 compact 仅间距收紧 (二者本就是高密度 Bento/审计布局)。 | 销售月报/旬报快速扫读、打印存档、移动端长图 |

> **核心机制**: 两种档位共享同一套视觉主体(品牌渐变/语义色/三角色字体/Token)与全部质量 Gate。紧凑风仅通过 `<html lang="zh-CN" data-density="compact">` 一个属性触发：除 spacing Token 以 `calc(Npx * 0.6)` 收紧外，模板还内置一层组件级版式重组(Hero masthead / KPI 加密 / Pull Quote 左线 callout / 表格密集行，见模板末尾"紧凑销售报告风"区块)。详见 `references/design-tokens.md` §2.6。
>
> **调用时机**: 风格在 §1 步骤 0 确认需求时选定（见下方需求澄清表 #0），选定后直接生成对应风格的最终 HTML —— 不在页面内提供任何切换控件。

### 克制六律

> 完整定义和检查清单 → `references/anti-default-discipline.md`

1. **功能色克制** — 一份报告最多 4 种情感色
2. **动效克制** — 动效只用于传达层级，不做装饰
3. **图表克制** — 一个 Chapter 最多 2 个图表组件
4. **装饰克制** — 无 3D、无投影卡片、无浮动元素
5. **密度克制** — 一屏最多 5 个独立信息区块
6. **文案克制** — Pull Quote 只能是洞察/反转

### Anti-Default 核心禁令

| 禁止                       | 替代方案                                          |
| :------------------------- | :------------------------------------------------ |
| 均等 KPI 卡片墙            | KPI Strip 横向一行 / Hero Tile + 小 Tile 权重差异 |
| 所有报告都 100vh 居中 Hero | 匹配报告类型: 日报=无 Hero, 月报=60-80vh          |
| 描述性图表标题             | Action Title: "[对象]+[变化]+[方向]"              |
| 空话 CTA                   | 可执行: "对象+动作+期限+验证指标"                 |

---

## §1 Working Model — 开始之前

接到报告任务后，在写任何代码之前完成以下步骤：

### 需求澄清（模糊需求时必做）

> 如果用户已给出完整数据+核心发现+行动建议，可跳过直接进步骤 0。

| # | 问题                                                |      必答      | 默认值             |
| :- | :-------------------------------------------------- | :------------: | :----------------- |
| 0 | **风格档位**？叙事标准风(大留白沉浸) / 紧凑风(密集扫读) |      可选      | 叙事标准风         |
| 1 | **报告类型**？月报/季报/年报/专题/简报/审计包 | **必答** | —                 |
| 2 | **第一读者是谁**？高管/战区经理/分析师        | **必答** | —                 |
| 3 | **有哪些数据**？Excel/数据库/已有洞察         |      可选      | 用户提供的全部数据 |
| 4 | **核心发现一句话**？                          |      可选      | Agent 从数据中提炼 |
| 5 | **行动建议有哪些**？                          |      可选      | Agent 从归因中推导 |

### 步骤 0: 报告类型与模板匹配

| 报告类型                | 使用模板                       | 本 Skill 是否适用       |
| :---------------------- | :----------------------------- | :---------------------- |
| `strategic_narrative` | `scroll-narrative-skeleton.html`      | **是 (核心适用)** |
| `presentation`        | `scroll-narrative-skeleton.html`      | **是**            |
| `executive_brief`     | `bento-brief.html` (V2 新增) | 适用 (简报变体)         |
| `operational_monitor` | 不使用本 Skill                 | 否                      |
| `audit_pack`          | `audit-pack.html` (V2 新增)  | 适用 (审计变体)         |
| `analysis_workbook`   | 不使用本 Skill                 | 否                      |

### 步骤 1: Governing Thought

用一句话提炼这份报告的核心发现——

- 正例: "逆势突围，结构领跑" / "量价齐升，但渠道集中度风险显现"
- 反例: "2026年2月经营分析" (描述标签，不是核心发现)

### 步骤 2: 故事弧线

拆解 2–4 个 Chapter，每个 Chapter 讲一个子故事，用 PAC 闭环（现象→归因→对策）

### 步骤 3: Visual Contract

加载 `references/audience-visual-contract.md`，确认:

- 第一读者层级 (L1 决策 / L2 战术 / L3 分析)
- 信息预算 (KPI 数量 / 图表数量 / 行动数量)
- 阅读路径 (f_pattern / scroll_story / dense_table)
- 图表政策和信任机制

### 步骤 4: 证据包确认

核心结论来自 `report-insight-quality` Evidence Pack，不把 AI 猜测写成事实。无 `report-insight-quality` 等姊妹技能时，以 `prep-source.py` 产出的 quality.md + metrics.json 充当 Evidence Pack。

**有数据源时 (Excel/CSV/Parquet/SQLite/DuckDB/SQL) — 走 `scripts/prep-source.py` (V2.6)**，别手工聚合、别手敲数字：

```bash
# ① 画像: 看字段角色 + 自动建议分析骨架(哪些维度成章) + 产出 map.draft.json
python3 scripts/prep-source.py profile <源> [--sheet S | --sqlite db --table T | --sql "..."]
# ② 改好 map → 清洗+聚合+校验 → metrics.json (含 total/各维度YoY/占比/集中度/趋势)
python3 scripts/prep-source.py build <源> --map map.json --out metrics.json
# ③ 统计洞察 (V2.10): 趋势显著性/异常月/断崖引擎/贡献分解/HHI → insights.json + 问题清单
python3 scripts/stat-insights.py metrics.json --out insights.json
```

- **DuckDB 统一加载**：一个接口吃 Excel/CSV/Parquet/SQLite/DuckDB/任意 SQL —— 数据源可以是文件也可以是库。
- **骨架建议**：`profile` 按字段角色映射到覆盖面清单 (`audience-visual-contract.md` §2)，直接给出章节草稿；无目标字段会提示"达成类降级"。
- **数据至上纪律**：报告里每个数字**从 `metrics.json` 抄，不手敲**；`data_status=BLOCKED` (如维度跨年编码变更/占比不合) 时**只出修数建议，不出结论**。
- 无 pandas/duckdb 时降级：让用户预聚合或走 DuckDB，仍须手工核对占比和与达成分母。
- **V2.8 补强**：`map.roles.id` 可选指定单据列做重复行/重复单号检测；`map.caliber.granularity: month|xun` 支持旬粒度 YoY 锁定；数量列坏值率超阈值会在 warnings 与 `pvm._caveat` 中提示。
- **V2.9 补强**：金额列**空单元格**(稀疏但合法, 如仅已结单填额)不再误判坏值——与数量列同口径, 只有"非空但无法解析"才计入 5% 坏值率阈值；`trend` 当年缺月写 `null`(前端断线)不再补 `0`(避免半程数据折线掉零误导)；`profile` 检测到**时间跨度 <2 年**会自动降级——不建议 YoY/量价瀑布章节, 改提示"结构占比+排名(双榜)+集中度", 与 `build` 的 `len(yrs)>=2` 对齐, **单期/单月数据不再被诱导搭无同比数据支撑的章节**。
- **V2.10 统计洞察层**：`build` 之后跑 `stat-insights.py`(零新依赖)——Mann-Kendall 趋势显著性(**p<0.05 才许写"趋势性下滑", 否则措辞按波动**)、稳健 Z 异常月、维度断崖/引擎/结构位移/**增速贡献分解**(谁拖了总增速几个 pp)、HHI 集中度、量价象限、按影响金额排序的**问题清单**。"问题发现"类章节的证据从 `insights.json` 引用, 不再由 Agent 徒手扫描；`BLOCKED` 时脚本拒跑(脏数据上不做统计), 可比月 n<8 只报方向不判显著。

### 步骤 5: Anti-Default 预检

对照 `references/anti-default-discipline.md` §3 Pre-Build 检查清单

### 步骤 6: 加载模板

`view_file` 加载对应模板 — 它是骨架也是 **CSS 唯一真相源**:

- 叙事报告 → `templates/scroll-narrative-skeleton.html`
- 决策简报 → `templates/bento-brief.html`
- 审计包 → `templates/audit-pack.html`

### 步骤 7: 创建报告文件

拷贝模板到目标位置，作为编辑基础：

```bash
# 叙事报告
cp "<SKILL_ROOT>/templates/scroll-narrative-skeleton.html" "目标/report.html"

# 决策简报
cp "<SKILL_ROOT>/templates/bento-brief.html" "目标/brief.html"

# 审计包
cp "<SKILL_ROOT>/templates/audit-pack.html" "目标/audit.html"

# 若步骤 0 选了「紧凑风」: 拷贝后一行切换 (避免手改 <html> 漏改)
sed -i '' 's|<html lang="zh-CN">|<html lang="zh-CN" data-density="compact">|' "目标/report.html"
```

> **风格档位 (V2.4)**: 紧凑风只需上面 `sed` 一步把 `<html>` 改为 `data-density="compact"` —— 风格即烘焙进产物, 用户收到的就是紧凑风的最终 HTML。叙事标准风无需改动 (默认 `density=1`)。**交付物不含任何页面内切换控件**, 风格选择仅在对话阶段完成一次。改完后 `validate-report.mjs` 的「密度轴」项会回报实际档位 (紧凑档已启用 / 叙事标准档), 据此确认切换是否生效。
>
> 注: macOS 的 `sed -i` 需空串参数 (`-i ''`); Linux 用 `sed -i`。

### 步骤 8: 填充内容

1. 替换 `<title>` 和 Hero 标题为 Governing Thought；**报告主体(机构/区域/业务线/期间)从数据中读取自动填充** —— 模板里的 `[报告主体]`/`[机构]`/`[业务线]`/`[期间]` 占位符必须全部替换为数据对应的真实主体, **严禁把示例文字当默认值交付**
2. 按 §3 布局结构填充 Chapter，每个 Chapter 遵循 §6 叙事规则
3. **选图必须走引擎**: 每个 Chapter 先过 `chart-selection-guide.md` §0 意图路由表 (业务问题→意图→图表)，紧凑档优先取 §7 密集形态；再从 `references/chart-patterns.md` 取代码 + `scripts/echarts-corporate-themes.js` 主题
4. 图表遵守 `chart-selection-guide.md` §6 IBCS 语义: 时间=横轴/分类=水平条形、实际实心/计划空心/预测斜纹、三段式口径副标题、红绿只表差异
5. 组件使用 `references/component-patterns.md` 中的代码片段

### 步骤 9: 校验 + 预览

```bash
# ① 静态校验 (P0 必须全 PASS 才 exit 0: Emoji/tabular-nums/图表高度; 禁用图表=P1、离线自包含=P2, 均非阻断)
node scripts/validate-report.mjs 目标/report.html

# ② 截图 Gate (V2.6) —— 自动截图 + 你必须逐张看
node scripts/snapshot.mjs 目标/report.html 目标/shots/

# ③ 数字一致性 (有 metrics.json 必跑): data-metric 绑定值 vs metrics.json
node scripts/verify-numbers.mjs 目标/report.html metrics.json

# ④ 离线交付 (飞书/内网/截图场景): 内联外链后用严格离线档复检
node scripts/make-offline.mjs 目标/report.html && node scripts/validate-report.mjs 目标/report.offline.html --strict-offline
```

- **截图 Gate 是硬闸门**：产出 `desktop.png`(1440整页)/`mobile.png`(430整页)/`snap-<id>.png`(每个 `data-snap` 区块)。`scroll-narrative` 模板已内置 `data-snap` 示范 (`hero`/`chapter-01`/`chapter-02`/`closing`)——**新增 `<section>` 照样加 `data-snap="唯一id"`，删/改 section 时同步维护 id**，否则该区块不出分区图。脚本已在截图前**强制 `.reveal`→visible + 等 ECharts 渲染**，解决叙事档整页截图空白。
- **必须自己看这些图**：图表无空白/undefined/NaN、文字无截断/重叠、移动端无横向滚动、分区图可独立看懂。**没看过截图 = 没完成**。
- 无 Playwright/Chromium 时：脚本明确报"截图未验证"，此时诚实标注"未做截图核对及原因"，不假装验证过。

对照 `references/mckinsey-quality-gate.md` 按报告类型执行对应 Gate。

### 步骤 10: 迭代

- **90% 的调整改 inline style**: 字号 `font-size`、间距 `gap`/`padding`、颜色 `color`
- **结构性变更** (增删 Chapter、换布局模型): 回退到步骤 2 重新规划
- **数据更新**: 只改数据绑定部分，不动 CSS 结构

> **Gate**: 未完成步骤 1-6 就开始写 HTML = 质量缺陷。

---

## §2 五大核心原则 + 第六原则

| # | 原则                        | 执行要求                                              | 检验                                       |
| :- | :-------------------------- | :---------------------------------------------------- | :----------------------------------------- |
| 1 | **Governing Thought** | 一份报告一个统领性思想，Hero 标题体现                 | 能否一句话说清核心发现？                   |
| 2 | **图表服务叙事**      | 先有故事再选图表。图表是论据不是展品                  | 删掉图表叙事是否断裂？断裂=保留，不断=删   |
| 3 | **数据至上**          | 单一数据源 + 审计先行 (详见 `output-quality-guard`) | 同一指标在文案/图表/表格中数字一致？       |
| 4 | **排版即信任**        | 8pt 网格 + 等宽数字 + 语义色                          | 数字列 `tabular-nums`？间距是 8pt 倍数？ |
| 5 | **三层受众**          | Hero(5s) → 故事(3min) → 明细(按需)                  | 高管/经理/分析师各自获取所需？             |
| 6 | **前端合同先行**      | 先定受众、布局、图表和信任机制，再写 CSS              | 页面像决策工具，而不是普通模板？           |

---

## §3 Scroll Narrative 布局

> 战略叙事报告的默认布局。报告像一篇好文章，有开头、论证、结尾。

```
┌─────────────────────────────────┐
│ HERO (60-100vh)                 │ ← 品牌渐变 + Governing Thought + 核心数字动画
│ "逆势突围，结构领跑"              │    动效: Recipe hero (L2 叙事节奏)
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ KPI STRIP (横向一行)             │ ← 3–5 关键指标 + 同比箭头，快速扫视
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ CHAPTER 1                       │ ← Action Title + 叙事段落(PAC) + Editorial Block
│   Pull Quote                    │ ← 金句: 洞察/反转，不是数据复述
│   Full-Width Chart + 标注       │ ← 图表上方必须有结论标题
│                                 │    动效: Recipe editorial / cascade
└─────────────────────────────────┘
         ↓ 呼吸空间 (--space-20 = 80px+)
┌─────────────────────────────────┐
│ CHAPTER 2                       │ ← 同上结构，讲第二个子故事
│   Insight Cards                 │ ← 洞察卡: "为什么" 不是 "是什么"
│   Comparison Block (V2)         │ ← 对比块: 动效 Recipe comparison
└─────────────────────────────────┘
         ↓ ...更多 Chapter (≤4)
┌─────────────────────────────────┐
│ DATA DETAIL                     │ ← 高密度表格。动效: Recipe reveal-only
│                                 │    不在叙事主线上
└─────────────────────────────────┘
┌─────────────────────────────────┐
│ CLOSING (深色背景)               │ ← 行动号召: 编号行动项(对象+动作+期限+标签)
└─────────────────────────────────┘
  ↑ Scroll Progress Bar 固定于顶部
  ↑ 所有 Section 加 .reveal 实现 scroll-triggered fade-in
```

**高度策略**: 年报/季报/PPT 级报告可使用 100vh Hero；月报/专题复盘可用 60-80vh；日报、异常报告、移动端长图不使用沉浸式 Hero。

**宽度策略**: 叙事段落 `max-width: 960px` (编辑式阅读) / 图表表格 `max-width: 1200px` (宽版展示)

---

## §4 视觉系统 V2

> **Token 主参考**: `templates/scroll-narrative-skeleton.html` 的 `:root` 块 (语义/品牌 Token 的规范来源)。三套模板各自维护 `:root`; 图表色板 `--chart-1..6` 已对齐一致, `--content-width` 等按模板定位 (宽屏叙事 vs 一屏简报) 允许差异。
> 完整 Token 定义 → `references/design-tokens.md`

### 三角色字体 (V2 核心升级)

| 角色                | Token                | 字体                                 | 用途                              | 禁止场景 |
| :------------------ | :------------------- | :----------------------------------- | :-------------------------------- | :------- |
| **Display**   | `--font-display`   | Plus Jakarta Sans + Noto Sans SC 900 | Hero 数字/Chapter 标题/KPI 大数字 | 正文段落 |
| **Editorial** | `--font-editorial` | DM Sans + Noto Sans SC 400-500       | 正文/叙事段落/Insight/Pull Quote  | KPI 数字 |
| **Data**      | `--font-data`      | JetBrains Mono                       | 表格数字/图表标注/KPI 变化值      | 叙事文案 |

> 禁止在同一行混用 Display 和 Editorial 字体。

> **V2.1–V2.3 增量**（排版 Token / 毛玻璃材质 / 三信号无障碍 / 密度轴）已固化进三套模板，Token 细节见 `references/design-tokens.md` §2.3·§2.5·§2.6·§4.5·§10，动效降级见 `references/motion-recipes.md` §8，完整变更叙述见 `CHANGELOG.md`。

### 色彩三层架构 (V2 核心升级)

```
第一层: 品牌色 (--brand-*)    → Hero/Closing 渐变 + 章节号 + 链接
第二层: 语义色 (--semantic-*) → 增长=绿 / 风险=红 / 机会=蓝 / 中性=灰
第三层: 界面色 (--surface-*、--text-*、--border-*) → 跟随 Light/Dark 模式
```

| 层级 | Token 前缀                                             | 何时使用                          |
| :--- | :----------------------------------------------------- | :-------------------------------- |
| 品牌 | `--brand-deepest/deep/mid/accent/light/faint/muted`  | Hero 渐变、表头、链接、图表辅助色 |
| 语义 | `--semantic-growth/risk/opportunity/warning/neutral` | 同比箭头、Badge、图表颜色映射     |
| 界面 | `--surface-primary/secondary/tertiary`               | 背景色                            |
| 文字 | `--text-primary/secondary/tertiary/inverse`          | 文字色                            |
| 边框 | `--border-default/emphasis/subtle`                   | 卡片/表格/分隔线                  |
| 图表 | `--chart-1` 到 `--chart-6`                         | ECharts 系列色                    |

> **换色**: 通过 `visual-theme-engine` 替换 `--brand-*` 变量值即可，Token 名不变。
> 语义色 (第二层) 不随品牌主题变。

### 动效系统 (V2 核心升级)

> 完整 Recipe 定义 → `references/motion-recipes.md`
> **实现现状 (V2.6 修正)**: 模板 JS 目前内置的是基础 `.reveal` 入场 (scroll 模板) 与 stagger (bento)。下表 `cascade/editorial/comparison` 的完整触发逻辑需按 `motion-recipes.md` 自行接线, 未全部烘焙进模板——把它当"目标规范"而非"开箱即用行为"。

| Recipe          | 触发方式                      | 行为                                     | 适用区域          |
| :-------------- | :---------------------------- | :--------------------------------------- | :---------------- |
| `cascade`     | 默认                          | `.reveal` 逐个 stagger 入场，60ms 间隔 | 普通 Chapter      |
| `hero`        | `.hero` 自动                | 慢节奏 stagger + CountUp                 | Hero Banner       |
| `editorial`   | `.editorial` 自动           | 左文先入 → 右数据后入                   | Editorial Block   |
| `comparison`  | `data-animate="comparison"` | 左右分别滑入                             | Before/After 对比 |
| `reveal-only` | Data Detail 自动              | 简单 fade-up，无 stagger                 | 数据明细区域      |

**动效纪律**: 叙事主线 = L1+L2 动效 / Data Detail = L1 only / `prefers-reduced-motion` 必须降级

### Motion Tokens

| Token                            | 用途                     |
| :------------------------------- | :----------------------- |
| `--ease-productive`            | 功能性过渡 (hover/focus) |
| `--ease-expressive`            | 入场动效 (scroll-reveal) |
| `--duration-fast` (150ms)      | Hover 交互               |
| `--duration-slow` (500ms)      | Scroll Reveal            |
| `--duration-dramatic` (1200ms) | CountUp 数字动画         |
| `--stagger-normal` (60ms)      | cascade 元素间隔         |

---

## §5 叙事组件词汇表

> 大部分组件 CSS 已在 `templates/scroll-narrative-skeleton.html` 内置; `.skpi` 见 `component-patterns.md` §1.7。
> 下表标注"模板未内置"的组件, CSS 在 references 中, 拷贝进报告 `<style>` 后使用; 仅 Timeline 无任何出厂样式需自写。
> 组件变体和代码模板 → `references/component-patterns.md` (V2 合并)

### 叙事层组件 (Scroll Narrative)

| 组件                       | CSS Class                | 角色       | 使用规则                                                                       |
| :------------------------- | :----------------------- | :--------- | :----------------------------------------------------------------------------- |
| **Hero Banner**      | `.hero`                | 开篇定调   | 全幅深色渐变 + Governing Thought + 核心数字 CountUp                            |
| **KPI Strip**        | `.kpi-strip`           | 指标概览   | 横向一行 3–5 项。**不是卡片网格**                                       |
| **Super KPI Card**   | `.skpi`                | 高密指标   | **V2.4 紧凑档 KPI 首选**。单卡 9 指标: 主锚大数字+达成/同比/环比胶囊+年累静音行+双基线 Sparkline。≤4 张/报告。代码见 `component-patterns.md` §1.7 |
| **Chapter**          | `.chapter`             | 章节开篇   | `.chapter-number` + `.chapter-title`(Action Title) + `.chapter-lead`     |
| **Editorial Block**  | `.editorial`           | 文数并排   | 左文右数 grid。动效 Recipe: editorial                                          |
| **Pull Quote**       | `.pull-quote`          | 金句强调   | 必须是**洞察或反转**，禁止复述数据                                       |
| **Full-Width Chart** | `.full-chart-section`  | 图表展示   | `.full-chart-title`(结论标题) + `.chart-container` + `.chart-annotation` |
| **Insight Card**     | `.insight-card`        | 洞察卡片   | `.insight-card-icon`(growth/risk/opportunity) + 解释"为什么"                 |
| **Comparison Block** | `.comparison`          | 对比展示   | CSS 见 `component-patterns.md` §1.4 (模板未内置)。左右对比，动效 Recipe: comparison |
| **Metric Highlight** | `.metric-highlight`    | 单指标沉浸 | CSS 见 `component-patterns.md` §1.5 (模板未内置)。全宽区域 + 大数字 + 归因说明  |
| **Timeline Strip**   | `.timeline`            | 时间叙事   | **无内置 CSS, 需自写**。里程碑/事件标注                                      |
| **Callout Box**      | `.callout-box`         | 边栏注释   | CSS 见 `table-patterns.md` §4 (类名 `.callout`, 模板未内置)。补充说明/方法论/口径 |
| **Data Detail**      | `.data-detail-section` | 全量数据   | 高密度表格。动效 Recipe: reveal-only                                           |
| **Closing CTA**      | `.closing`             | 行动号召   | 深色渐变 + 编号行动项(对象+动作+期限)                                          |

### 数据层组件 + 图表组件

> 完整 CSS/JS 代码 → `references/component-patterns.md`
> 图表选型 + ECharts 模板 → `references/chart-selection-guide.md` + `references/chart-patterns.md`

**数据层**: Heat Table / Rank Bar / Progress / Sparkline Row / Badge System / Audit Strip / **增长下滑双榜 (§1.8)** / **章节锚点导航 (§1.9)**
**图表层**: 面积图+标注 / 瀑布图 / 子弹图 / 赛马条形图 / Treemap / 高密度表格 / YoY 同期对比折线

> **销售报告常用组合** (V2.5): 超级 KPI 卡/KPI Strip → YoY 同期对比 + 量价瀑布 → 结构渗透 + **型号增长下滑双榜** → 渠道堆叠 → 客户集中度 → 战区排名 + **战区×月热力表**。多章 (≥4) 加 **锚点导航**。

---

## §6 叙事规则

### 叙事合同

每个 Chapter 在进入页面前必须先写清:

```yaml
chapter_id: C1
action_title: 结论句
evidence_pack: F-001
so_what: 这个发现影响什么决策
chart_role: 证明趋势/比较差异/解释构成/拆解归因
action: 对象 + 动作 + 时限 + 验证指标
```

没有 `evidence_pack` 的章节只能进入 Data Detail 或附录，不能进入主叙事。

### 叙事合同示例 (2-Chapter 月报)

完整 YAML 范例（governing_thought/Chapter/PAC/closing_cta 全字段）→ `references/narrative-contract-example.md`。

### Action Title 公式

```
[对象] + [关键变化] + [方向/归因]  ≤ 30字

正例: "传统渠道占比下降3.2pp，需加速渠道转型"
正例: "P系列渗透率突破35%，结构升级进入加速通道"
反例: "各渠道签收情况" (描述标签，不是叙事)
反例: "战区达成率对比" (没有方向和归因)
```

### PAC 叙事闭环 (每个 Chapter 必须)

- **P**henomenon — 发生了什么 (现象)
- **A**ttribution — 为什么发生 (归因)
- **C**ountermeasure — 怎么做 (对策)

### So What 测试

对每个数据点连续追问：

1. 这个数据说明了什么？→ 现象
2. 为什么会这样？→ 归因
3. 我们该怎么做？→ 对策
4. 这对 Governing Thought 有什么影响？→ **不影响 = 移到 Data Detail**

### Copy 纪律

| 规则              | 正确                                        | 错误            |
| :---------------- | :--------------------------------------------- | :----------------- |
| 图表标题 = 结论   | "传统渠道占比持续下降，O2O 逆势崛起"           | "各渠道签收额图"   |
| Pull Quote = 洞察 | "增速从22%降至12%，不是市场变冷，是基数在变高" | "本月签收8,639台"  |
| CTA = 可执行      | "南宁战区3日内实地走访，反馈根因"              | "加强管理"         |
| 方向性一致        | 写"增长"时数据为正                             | 写"增长"时数据为负 |

---

## §7 ECharts 速查

```javascript
// V2 配色 (使用 Token 系统)
var palette = [
    cssVar('--chart-1'), cssVar('--chart-2'), cssVar('--chart-3'),
    cssVar('--chart-4'), cssVar('--chart-5'), cssVar('--chart-6')
];

// 通用 grid (留白充足) / axisLabel / splitLine
grid: { top: 30, left: 55, right: 25, bottom: 35 }
axisLabel: { color: cssVar('--text-tertiary'), fontSize: 12, fontFamily: cssVar('--font-data') }
splitLine: { lineStyle: { type: 'dashed', color: cssVar('--border-subtle') } }

// 面积图标配渐变
areaStyle: {
    color: new echarts.graphic.LinearGradient(0,0,0,1,[
        { offset: 0, color: 'rgba(3,83,164,0.18)' },
        { offset: 1, color: 'rgba(3,83,164,0.02)' }
    ])
}
```

> 完整图表代码模板 → `references/chart-patterns.md`
> 图表选型决策树 → `references/chart-selection-guide.md`

### 脚本接线 (辅助脚本如何引入)

```html
<!-- 1. ECharts 企业主题: 引入后 init 时传主题名即可, 前 6 系列已对齐 --chart-1..6 -->
<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js"></script>
<script src="<SKILL_ROOT>/scripts/echarts-corporate-themes.js"></script>
<script>
  // 主题名: 'corporate-blue'(默认) / 'executive-dark' / 'warm-earth'
  const chart = echarts.init(document.getElementById('chart-trend'), 'corporate-blue');
  chart.setOption({ /* ... 见 chart-patterns.md ... */ });
</script>
```

> **`presentation-mode.js` 兼容性注意**: 该脚本面向 **侧边栏 + `.section` 分页布局** (operational_monitor 风格), 依赖 `.sidebar` / `.section` / `.page-header` / `.toc-sidebar` 等类名, **与本 Skill 三个模板 (`.hero` / `.chapter` / `.reveal`) 不直接兼容**。用于 scroll-narrative 汇报场景时, 需先把脚本内 `querySelector` 的选择器改成对应类 (如 `.section` → `.chapter`), 否则收集不到分页。仅在需要全屏翻页汇报时引入; 常规滚动阅读报告不需要。

---

## §8 质量保障体系 V2

### 自动化校验 (V2 新增)

```bash
node scripts/validate-report.mjs <report.html>
```

校验项目:

- **P0 阻断**: Emoji 检测 / tabular-nums 覆盖 / 图表容器高度
- **P1 警告**: Token 完整性 / Token 引用完整性 (未定义且无 fallback 的 `var()` 引用) / Hero 标题质量 / Chapter 标题质量 / 字体三角色
- **P2 建议**: 间距纪律 / Anti-Default 模式 / Pull Quote 质量

### Top-12 人工自检

> 完整 48 项 Quality Gate → `references/mckinsey-quality-gate.md`
> Anti-Default 检查清单 → `references/anti-default-discipline.md` §4

| #  | 检查项                                      | 常见失败                    |
| :- | :------------------------------------------ | :----------------------------- |
| 1  | Hero 标题 = Governing Thought               | "2026年X月经营分析"            |
| 2  | 每个 Chapter 标题是 Action Title (≤30字)   | 描述标签                       |
| 3  | PAC 闭环完整                                | 只有现象，没有归因和对策       |
| 4  | 图表上方有**结论标题**                | "各渠道签收额"                 |
| 5  | 同一指标在文案/图/表中数字一致              | 文案写"增长12%"但图表显示11.8% |
| 6  | 文案方向词与数据正负号一致                  | "增长"但数据为负               |
| 7  | 柱图 Y 轴基线 = 0                           | 截断基线夸大差异               |
| 8  | 数字等宽 `tabular-nums` + `--font-data` | 数字列不对齐                   |
| 9  | Pull Quote 是洞察或反转                     | 复述报告中已有数字             |
| 10 | Closing CTA 有对象+动作+期限                | "加强管理"(空话)               |
| 11 | 字体三角色分工正确                          | Display 用在正文段落           |
| 12 | 间距来自 `--space-*` token                | 随意的 15px、22px              |

### 硬闸门

- 使用本 Skill 前必须确认报告类型和模板匹配
- 每个核心章节必须绑定 Evidence Pack
- 双 Y 轴默认禁用；确需使用时必须写明两轴逻辑关系
- 饼图/环形默认禁用；构成用 100%堆叠条形/Treemap，仅 ≤3 类且明确要求可破例 (与 validator 一致)
- 桌面和移动端必须无文字重叠、图表空白、标签溢出
- `prefers-reduced-motion` 必须降级为即时显示
- **V2 新增**: 交付前必跑 `validate-report.mjs` —— 但它**自动硬阻断(exit 1)的仅 3 项 P0** (Emoji/tabular-nums/图表高度)；本清单其余项 (饼图/双轴/弱 Hero 标题/无重叠) validator 只给 **P1 WARN 不阻断**，`exit 0` **≠ 满足硬闸门**，须人工逐条确认清零 (这些是设计纪律而非自动门)
- **V2.6 新增**: 有数据源必走 `prep-source.py`，数字从 `metrics.json` 抄不手敲，`BLOCKED` 不出结论；交付前必跑 `snapshot.mjs` 并逐张自看截图

---

## §9 资源索引

| 文件                                         | 内容                                                                                 | 何时加载                       |
| :------------------------------------------- | :----------------------------------------------------------------------------------- | :----------------------------- |
| `templates/scroll-narrative-skeleton.html` | **骨架 + CSS 唯一真相源** (126 个 Token)                                       | **每次新建报告必须加载** |
| `templates/bento-brief.html`               | **V2 新增** 一屏决策简报 (Bento Grid)                                          | executive_brief 类型           |
| `templates/audit-pack.html`                | **V2 新增** 数据审计包骨架                                                     | audit_pack 类型                |
| `references/design-tokens.md`              | V2 完整 Token (三层色彩/三角色字体/Motion/Dark Mode) + **§2.5 Apple §15 排版集成** + **§4.5 材质系统 (Apple §12)** + **§10 三信号无障碍 (Apple §14)** | 需要查 Token 细节时            |
| `references/component-patterns.md`         | **V2** 统一组件手册 (20+ 组件 + Badge 系统 + 工具函数)                         | 需要组件代码时                 |
| `references/audience-visual-contract.md`   | 受众分层、Bento 规则、图表政策、信任机制                                             | 生成 HTML 前必须加载           |
| `references/anti-default-discipline.md`    | **V2** 克制六律 + Anti-Default 负面清单 + Pre/Post Build 检查                  | 设计阶段必读                   |
| `references/motion-recipes.md`             | **V2** 5 种动效 Recipe + CountUp/Progress 代码                                 | 需要动效实现时                 |
| `references/mckinsey-quality-gate.md`      | **V2 升级** 48 项 Quality Gate (含 Gate 6 视觉系统 + Gate 7 自动化)            | 交付前最终检查                 |
| `references/checklist.md`                  | **V2 新增** P0/P1 快速核对清单 (6 P0 阻断 + 6 P1 核心)                                            | 生成后快速自检                 |
| `references/trigger-eval.md`               | **V2.5 新增** 触发准确性 20 用例 (should/should-not)                           | 改 description 后回归           |
| `references/number-formatting.md`          | 数字格式化 + CountUp 动画规范                                                        | 需要查格式规范时               |
| `demos/density-comparison.html`            | **V2.4** 密度轴左右对比：同一份内容 叙事标准风 vs 紧凑销售报告风，调用前先看效果          | 需要向用户展示两种风格差异时   |
| `references/chart-selection-guide.md`      | **V2 升级** Agent 选图引擎(意图路由) + 决策树 + IBCS 语义规范 + 密度轴图表形态 + 受众分层策略 | **每个 Chapter 选图前必须过 §0 路由** |
| `references/chart-patterns.md`             | **V2 升级** 6 种图表代码 (瀑布图/子弹图/进度条/Small Multiples/Lollipop/Slope) | 需要图表 ECharts 代码时        |
| `references/table-patterns.md`             | 表格 + Badge + Sparkline                                                             | 需要表格组件代码时             |
| `references/narrative-contract-example.md` | 叙事合同完整 YAML 示例                                                               | 写章节合同需完整范例时         |
| `references/troubleshooting.md`            | 常见踩坑与修复                                                                       | 遇渲染/字体/图表问题时         |
| `scripts/prep-source.py`                   | **V2.6** 多源数据画像(字段→骨架建议)+ 清洗聚合校验 → metrics.json (DuckDB 吃 Excel/CSV/SQLite/DuckDB/SQL) | **有数据源时第一步** (步骤4) |
| `scripts/stat-insights.py`                 | **V2.10** 统计洞察层: MK 趋势显著性/稳健Z异常月/断崖引擎/贡献分解/HHI/量价象限 → insights.json + 问题清单 (纯标准库) | **build 之后第二步**; 问题发现章证据源 |
| `scripts/validate-report.mjs`              | **V2.6** 自动化质量校验 (含禁用图表 + 离线自包含检测)                        | 交付前运行                     |
| `scripts/verify-numbers.mjs`               | 数字一致性 Gate: data-metric vs metrics.json                                         | 有 metrics.json 时交付前必跑   |
| `scripts/make-offline.mjs`                 | 外链内联出离线单文件                                                                 | 飞书/内网/截图交付时           |
| `scripts/snapshot.mjs`                     | **V2.6** 截图 Gate (Playwright: desktop/mobile/分区 PNG, 强制 reveal 显示)   | **交付前必跑并逐张自看**       |
| `scripts/run-evals.mjs`                    | **V2.9.1** eval 回归: 对已生成报告跑 `evals.json` 机器断言(machine_checks), 主观项标 MANUAL (`--eval <id>`) | 回归/自测报告是否满足 eval     |
| `scripts/echarts-corporate-themes.js`      | ECharts 企业主题 (前 6 系列对齐 `--chart-1..6`) — 接线见 §7                     | 引入 ECharts 时                |
| `scripts/presentation-mode.js`             | 演示模式 (全屏翻页)。**依赖 `.section`/`.sidebar` 布局, 用于本 Skill 模板需改选择器 — 见 §7 警告** | 汇报场景 (需适配)              |
| `CHANGELOG.md`                             | 完整版本变更叙述 (§11 摘要的展开)                                                    | 需要查历史变更细节时           |

### 加载顺序建议

1. 先读完 `SKILL.md` (本文件) 了解设计哲学和工作流
2. §1 步骤 3 读 `references/audience-visual-contract.md` 确认受众和信息预算
3. §1 步骤 5 读 `references/anti-default-discipline.md` 做 Pre-Build 检查
4. §1 步骤 6 **Read 对应模板的 CSS** — 这是类名的唯一来源
5. 填充内容时读 `references/component-patterns.md` 查组件代码
6. 需要图表时读 `references/chart-selection-guide.md` 选型 → `references/chart-patterns.md` 取代码
7. 需要动效时读 `references/motion-recipes.md` 选 Recipe
8. 需要查 Token 细节时读 `references/design-tokens.md`
9. 生成后运行 `scripts/validate-report.mjs` → 读 `references/checklist.md` 快速自检 → 读 `references/mckinsey-quality-gate.md` 最终检查

### 生态位关系

| Skill                                           | 与本 Skill 的关系                                                 |
| :---------------------------------------------- | :---------------------------------------------------------------- |
| `frontend-design` / `design-taste-frontend` | 通用前端 Skill。本 Skill 在其基础上增加**叙事层+数据层**    |
| `visual-theme-engine`                         | 可覆盖本 Skill 的品牌色板 — 替换 `--brand-*` 值                |
| `output-quality-guard`                        | 数据准确性 + Emoji 禁令。本 Skill 补充**叙事+视觉质量检查** |
| `sales-insight-engine`                        | 提供分析数据和 Insight。本 Skill 负责"用数据讲故事"               |
| `report-insight-quality`                      | 提供 Evidence Pack 和行动建议质量 Gate；无此姊妹技能时，以 `prep-source.py` 产出的 quality.md + metrics.json 充当 Evidence Pack |
| `report-patcher`                              | 对已生成报告进行增量修正和 JS 注入                                |

### 关联 KI

| KI                                  | artifact                        | 用途                      |
| :---------------------------------- | :------------------------------ | :------------------------ |
| `annual-report-design-excellence` | narrative-frameworks.md         | PAC/金字塔/SCQA 叙事选型  |
| `annual-report-design-excellence` | advanced-visualization-specs.md | 高级图表规范 + 标杆品牌色 |

---

## §10 常见踩坑

常见踩坑与修复完整表（ECharts 渲染/打印/字体/resize/Token 对齐/动效降级/V1→V2 别名等 9 项）→ `references/troubleshooting.md`。
遇到渲染、字体、图表、动效相关的奇怪行为时优先查该表。

---

## §11 版本历史

> 一句话摘要。**完整变更叙述 → `CHANGELOG.md`**。

| 版本 | 日期    | 核心变更（详见 CHANGELOG.md）                                                        |
| :--- | :------ | :---------------------------------------------------------------------------------- |
| V1.0 | 2026-03 | 初版: Scroll Narrative 骨架 + 8 组件 + PAC 叙事                                      |
| V1.5 | 2026-04 | 增加 Visual Contract + McKinsey Quality Gate                                         |
| V2.0 | 2026-06 | 三角色字体 / 色彩三层架构 / 动效 Recipe / Anti-Default / 自动化校验                  |
| V2.1 | 2026-07 | 排版 Token 集成 Apple §15（尺寸专属 Tracking / 反向 Leading / Dynamic Type）        |
| V2.2 | 2026-07 | 材质 + 无障碍集成 Apple §12/§14（`.glass-surface` / 三信号降级 / P1 纪律锁）          |
| V2.3 | 2026-07 | 密度轴：新增「紧凑风」档位，`--density` 单点整体收紧 35%                              |
| V2.3.1 | 2026-07 | 校验器修正（密度判定 bug / 加强图表高度与 tabular-nums 检测 / 清死代码）+ 脚本去 Emoji / 图表色板对齐 Token + 文档一致性修正 |
| V2.4 | 2026-07 | **紧凑档重做为「紧凑销售报告风」**：从等比缩小升级为版式重组（Hero masthead 横幅 / KPI 加密 / 内容列加宽 / Pull Quote 左线 callout / 表格密集行），信息密集适合快速扫读；`--density` 0.65→0.6；demo 同步为新对比 |
| V2.4.1 | 2026-07 | **端到端实测修复**：真实数据(80k行)跑通全流程；修复紧凑档 scroll-reveal 致整页截图/打印空白 bug（紧凑档禁用 reveal 隐藏态）；记录"无目标数据"假设边界 |
| V2.4.2 | 2026-07 | **实测迭代**：趋势图默认改同期对比(YoY)；新增经营分析覆盖面清单(总量·量价/结构/渠道/区域/趋势, 默认 4-5 章) |
| V2.5 | 2026-07 | **借鉴业界 B2B 报告**：新增 §1.8 增长/下滑双榜 + §1.9 章节锚点导航组件；Heat Table 提示强化；实测报告加厚至 5 章(型号双榜/客户集中度/战区×月热力) |
| V2.5.1 | 2026-07 | **工程化加固**：无目标数据自动降级达成类图表(§0.1b + Data Contract 必答)；触发准确性 eval(20 用例)+收紧 description；demo 改 iframe 载入真实模板根治脱节 |
| V2.6 | 2026-07 | **借鉴 sales-report-html**：`prep-source.py` 多源数据画像(字段→骨架建议)+清洗校验→metrics.json；`snapshot.mjs` 截图 Gate；validator 增禁用图/离线检测 |
| V2.7 | 2026-07 | **综合评审修复**：PVM 价格口径改 price_mix + NaN 剔除报占比且>5%阻断 + 除零守卫防非法JSON；饼图/环形/Gauge 决策树对齐 validator 禁令；bento/audit density 0.65→0.6；补 --font-serif；§5 标注 4 个无 CSS 幽灵组件、离线检测正名 P2、动效 Recipe 实现现状。详见 CHANGELOG |
| V2.8 | 2026-07 | **缺陷修复闭环**：references 孤儿 Token 别名清理 + bento/audit 注释对齐；validator 新增 Token 引用完整性(P1)/阈值≥40/Pull Quote 覆盖 div 容器/`--strict-offline`；新增 `verify-numbers.mjs`(数字一致性 Gate) 与 `make-offline.mjs`(离线内联)；`prep-source.py` 增重复检测/旬粒度/数量坏值率上报；§5 幽灵组件登记真实 CSS 出处；SKILL.md 瘦身，§6/§10 长内容下沉至 `references/narrative-contract-example.md`、`references/troubleshooting.md`。详见 CHANGELOG |
| V2.9 | 2026-07-11 | **二轮缺陷诊断修复** (4 维并行审查: 文档一致性/脚本健全性/模板校验/使用者 RED 模拟, 去重后修复)：图表口径全库统一(饼图/环形默认禁用·≤3类破例; chart-patterns 章节号 §4/§5/§6 归位、量价 PVM 归因指向瀑布图 §1、撤下环形图/Gauge 推荐与 `recommendKpiStyle('target')`)；`prep-source.py` 金额空值≠坏值同口径、`trend` 缺月写 `null` 不补 0、`profile` 单年自动降级(不诱导无数据 YoY/瀑布)、无参干净报错；`snapshot.mjs` 动态 import 优雅降级 + 新增 `package.json`；validator 图表高度闸门覆盖 `tile-chart`/`id^=chart`(bento 不再漏检塌陷)；references 卫生(shadow/Inter/font-serif/版本 V2.5.1→V2.6/checklist 措辞)；bento 图表色走 Token；SKILL §8 禁用图表 P0→P1 归位。详见 CHANGELOG |
| V2.9.1 | 2026-07-11 | **独立盲评修复** (盲评 7.5/10 抓到 4 个自评漏掉的真缺陷, 全部复现后修)：validator `checkEmoji` 改**全文查**——修复多行 `<script>` 内图表文案 emoji 漏检 (P0 红线在图表标题处的盲区)；"红线/硬闸门"措辞**诚实化**——明确 validator 自动硬阻断仅 3 项 P0，饼图/弱标题等 P1 不阻断、`exit 0 ≠ 可交付`，须人工清零；bento `brief-footer`→`audit-strip` 重命名 (eval-3 断言与模板自洽)；新增 `scripts/run-evals.mjs` + `evals.json` machine_checks——散文断言变可执行回归 (自曝并修了 density 全文 grep 陷阱)。详见 CHANGELOG |
| V2.10 | 2026-07-18 | **统计洞察层**：新增 `stat-insights.py`(零新依赖)——Mann-Kendall 趋势显著性/稳健Z异常月/维度断崖·引擎·结构位移·增速贡献分解/HHI/量价象限/按影响金额排序的问题清单；统计诚实纪律(BLOCKED 拒跑·n<8 只报方向·不做预测·无目标不谈缺口)；合成数据植入 5 模式全命中实测。补齐外部评测指出的"统计分析深度"短板。详见 CHANGELOG |
