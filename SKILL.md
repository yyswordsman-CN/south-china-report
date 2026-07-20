---
name: south-china-report
description: "把 Excel/CSV/Parquet/SQLite/DuckDB/SQL 等业务数据转化为结论驱动、可审计、静态自包含的叙事型 HTML 报告。用于经营分析、销售分析、月报、旬报、季报、年报、专题复盘、区域/渠道/品类/客户分析、executive brief 或 audit pack；报告主体随数据适配，不限定华南。包含数据画像、可比期口径、目标/结构/贡献/量价/统计洞察、PAC 叙事、图表路由、响应式模板和交付门禁。不适用于高频运营监控看板、纯明细工作簿、PPT、Excel 或交互式 BI。"
---
# South China Report — 通用数据分析报告叙事设计系统 V3

> 技能标识 `south-china-report` 为稳定兼容 ID；用户可见名称与触发描述按通用经营报告定位表达。当前内容版本 V3.3.0，完整历史见 `CHANGELOG.md`。
>
> **环境依赖**：Node >=18、Python >=3.11；经验证依赖锁定在 `package-lock.json` 与 `requirements.txt`，截图需 Playwright+Chromium。缺依赖时按文内降级路径执行并标注未验证。
>
> 报告不是仪表盘。仪表盘是给人"扫"的，报告是给人"读"的。
> 如果产出物和 FineBI 看板没区别，那就失败了。

---

## 快速上手 · 30 秒执行主线

> 首次使用先读这一屏抓主线；细节在 §1 Working Model 逐步展开，完整加载顺序见 §9。

**做什么**: 任意业务/经营数据 → 讲故事型静态自包含 HTML 报告 (不是看板/PPT/Excel/交互式 BI)。**报告主体(机构/区域/业务线/品类等)随数据内容自动适配, 不预设任何区域或组织**。

**最短主线** (每步对应 §1 步骤，别跳步)：

1. 定**风格档** (未指定即紧凑；叙事标准需显式选择) + **报告类型** → 步骤 0
2. 有数据源先跑 `prep-source.py` `profile`→`build` 出 `metrics.json`，**数字从它抄不手敲** (`BLOCKED` 只出修数建议不出结论)；再跑 `stat-insights.py` 出 `insights.json`，**问题发现/趋势结论从它引用** → 步骤 4
3. 提炼 Governing Thought + 拆 2–4 章 PAC 故事弧 (现象→归因→对策) → 步骤 1-2
4. Read 对应模板 (**CSS 唯一真相源**) → 步骤 6；有合规 `report-spec.json` 时走确定性渲染器，暂无规格时保留人工模板兼容路径 → 步骤 7
5. 选图**必过** `chart-selection-guide.md` §0 意图路由表 (禁止倒序选图) → 步骤 8
6. 交付前跑 4 组 Gate: 成品静态校验 → 静态数字覆盖/真值 → 离线内联+严格复检 → 离线版运行时数字合同与四视口 DOM/AX/Tab/对比度截图 Gate，并逐张自看 → 步骤 9

**必读 3 份** (其余按需查)：本文件 + 对应模板 + `audience-visual-contract.md`。
**五条红线**：数据至上 · 零 Emoji · 饼图/环形默认禁用 · 报告≠看板 · 交付物无运行时切换。
> 注意拦截力边界：成品模式会硬阻断 Emoji、数字排版未覆盖、图表无高度、占位符/待校验状态和未确认审计 PASS；`--strict-offline` 还会硬阻断任何外部或相对资源。饼图/双轴/弱 Hero 标题等仍是 **P1 非阻断项**，所以 `exit 0` 只代表当前模式无 P0，不代表可交付；P1 须人工清零或书面说明。

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
| **紧凑销售报告风 (默认)** | `data-density="compact"` / `--density: 0.6` | 版式重组为信息密集: Hero 收为 masthead 横幅(结论居左+核心数字居右)、KPI 换行加密、内容列加宽、Pull Quote 转左线 callout、表格密集行。**信息预算上调**: KPI 5-8 / Chapter 3-6 / 密集图表形态(子弹阵列/Small Multiples/Sparkline表格)优先 —— **紧凑≠简陋, 密度靠形态不靠删内容** (见 `chart-selection-guide.md` §7)。**注**: 完整版式重组仅 `scroll-narrative` 模板提供; bento/audit 的 compact 仅间距收紧 (二者本就是高密度 Bento/审计布局)。 | 销售月报/旬报快速扫读、打印存档、移动端长图；未指定风格时使用 |
| **叙事标准风 (显式可选)** | `--density: 1` / 移除 `data-density` | 大留白、慢节奏、强 Hero 沉浸 (100vh)、章节间 80px 呼吸、标题尺度饱满 | 用户明确要求沉浸式高管月报/年报、战略叙事或对外汇报 |

> **核心机制**: 两种档位共享同一套视觉主体(品牌渐变/语义色/三角色字体/Token)与全部质量 Gate。紧凑风仅通过 `<html lang="zh-CN" data-density="compact">` 一个属性触发：除 spacing Token 以 `calc(Npx * 0.6)` 收紧外，模板还内置一层组件级版式重组(Hero masthead / KPI 加密 / Pull Quote 左线 callout / 表格密集行，见模板末尾"紧凑销售报告风"区块)。详见 `references/design-tokens.md` §2.6。
>
> **调用时机**: 用户未指定风格时直接采用紧凑风；只有明确要求大留白、沉浸式叙事或叙事标准风时才移除 `data-density`。最终 HTML 不提供任何运行时切换控件。

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
| 0 | **风格档位**？紧凑风(密集扫读) / 叙事标准风(大留白沉浸) |      可选      | 紧凑销售报告风     |
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

核心结论必须绑定 Evidence Pack，不把 AI 猜测写成事实。默认以 `prep-source.py` 产出的 quality.md + metrics.json 充当 Evidence Pack；若当前环境恰好具备其他证据质量 Skill，可在不改变本地口径的前提下叠加使用。

**有数据源时 (Excel/CSV/Parquet/SQLite/DuckDB/SQL) — 走 `scripts/prep-source.py`**，别手工聚合、别手敲数字：

```bash
# ① 画像: 看字段角色 + 自动建议分析骨架(哪些维度成章) + 产出 map.draft.json
python3 scripts/prep-source.py profile <源> --out-map map.draft.json [--sheet S | --sqlite db --table T | --sql "..."]
# 默认不打印字段原始样例；仅在确认终端/上下文安全时显式加 --show-samples
# ② 改好 map → 清洗+聚合+校验 → metrics.json（通用度量、比较、结构/分布/趋势与适用性）
python3 scripts/prep-source.py build --map map.json --out metrics.json [--baseline-metrics prior.metrics.json]
# ③ 统计洞察：按指标方向与方法适用性输出趋势/异常/结构/集中度 → insights.json
python3 scripts/stat-insights.py metrics.json --out insights.json
```

- **DuckDB 统一加载**：一个接口吃 Excel/CSV/Parquet/SQLite/DuckDB/任意 SQL —— 数据源可以是文件也可以是库。
- **骨架建议**：`profile` 按字段角色映射到覆盖面清单 (`audience-visual-contract.md` §2)，直接给出章节草稿；无目标字段会提示"达成类降级"。
- **数据至上纪律**：报告里每个数字**从 `metrics.json` 抄，不手敲**；`data_status=BLOCKED` (如维度跨年编码变更/占比不合) 时**只出修数建议，不出结论**。
- 无 pandas/duckdb 时降级：让用户预聚合或走 DuckDB，仍须手工核对占比和与达成分母。
- **度量合同不猜**：新项目必须用 `roles.measures[]` 声明字段、语义类型、维度轴/时间轴聚合、单位、存储尺度、方向、可加性、权重覆盖、主指标与必需性。库存等半可加度量必须声明 `time_aggregation`；比率优先声明 `numerator_field/denominator_field`，百分比必须声明 `storage_scale=fraction|percent`。没有金额绝不能阻断报告；旧 `roles.amount/qty` 仅作兼容。完整格式见 `references/semantic-data-contract.md`。
- **分析范围不预设同比**：`analysis_scope.mode` 支持 `period|snapshot`；日历环比 `mom/qoq/wow`、等长滚动窗 `previous_equal_window`、完整上一日历期 `previous_calendar_period|previous_complete_period`、上一期同阶段 `same_stage_previous_period`、同比和自定义基线语义彼此分离。无时间字段用 `snapshot`，继续做结构、分布、排名、异常和组间差异，只跳过趋势/PVM。
- **Schema 与粒度是硬合同**：显式声明 `schema.business_grain/primary_key/fields`；必需字段、必需类型、业务粒度、主键或单位漂移才按 Schema 级 BLOCKED，可选字段缺失只 WARN 并关闭依赖模块。SQL 结果必须同时披露查询哈希、结果行数、结果 schema hash 与结果快照 hash。
- **完整度与重复按主指标门禁**：有明确日志频率时用 `caliber.expected_observations` 声明当期/基期应有观测数（`rows|distinct_dates`），默认完整率 <90% BLOCKED。锁定分析范围的主指标空值、完全重复行或重复值影响度默认 >5% BLOCKED；脚本不自动去重，必须先确认业务键。
- **目标/Benchmark/组间比较不猜**：统一写入顶层 `references[]`，必须绑定具体 `measure` 与 `unit`，可声明标量、区间、容差、方向规则、字段聚合/粒度和参考组；输出以 `metrics.references[]` 为真源。旧 `analysis_scope` 目标项、`measure.target_field/benchmark` 与 `caliber.target_*` 仅作适配，不再维护第二套计算。
- **跨运行漂移锁**：需要冻结基线时配置 `drift_lock.baseline_metrics`（或 CLI `--baseline-metrics`），同时比对语义合同、结果 schema、行数与结果快照；结果是否预期变化必须用 `expected_result_change` 明示，越阈值或未授权的 schema/语义变化 BLOCKED。
- **产品不再只识别**：`map.roles.product` 会输出产品排名、增长/下滑双榜和贡献度，均受 `period_lock` 约束。
- **方法适用性显式化**：PVM、MK、TopN、Pareto、HHI 等先写 `method_applicability.status/reason_code` 再计算；不满足就 `SKIPPED`。HHI/Top5 没有业务政策阈值时只作描述性集中度，不得输出风险等级。
- **方向语义贯穿**：`higher_is_better/lower_is_better/neutral` 同时驱动问题识别、变化文案、语义色和斜率图；低优指标下降才是有利，`neutral` 不涂红绿。斜率图必须传入真实两期标签并动态计算轴域。

### 步骤 5: Anti-Default 预检

对照 `references/anti-default-discipline.md` §3 Pre-Build 检查清单

### 步骤 6: 加载模板

读取对应模板 — 它是骨架也是 **CSS 唯一真相源**:

- 叙事报告 → `templates/scroll-narrative-skeleton.html`
- 决策简报 → `templates/bento-brief.html`
- 审计包 → `templates/audit-pack.html`

### 步骤 7: 创建报告文件

有符合 `references/report-spec-contract.md` 的规格时，优先由确定性渲染器生成报告：

```bash
node "<SKILL_ROOT>/scripts/render-report.mjs" \
  --metrics "目标/metrics.json" \
  --insights "目标/insights.json" \
  --spec "目标/report-spec.json" \
  --out "目标/report.html"
```

它只接受白名单组件和安全真源路径，自动生成 Evidence 与运行时数字合同；输入不完整、路径越界、裸业务数字、未知组件或目标文件已存在时阻断，且不留下最终文件。同一输入必须逐字节复现。渲染成功仍不替代步骤 9 的四组 Gate。

暂无规格或需要模板尚未覆盖的高级版式时，使用人工兼容路径，拷贝模板到目标位置作为编辑基础：

```bash
# 叙事报告
cp "<SKILL_ROOT>/templates/scroll-narrative-skeleton.html" "目标/report.html"

# 决策简报
cp "<SKILL_ROOT>/templates/bento-brief.html" "目标/brief.html"

# 审计包
cp "<SKILL_ROOT>/templates/audit-pack.html" "目标/audit.html"

# 三份模板出厂均为紧凑风，无需额外切换。
# 仅当用户明确选择「叙事标准风」时移除密度属性：
sed -i '' 's| data-density="compact"||' "目标/report.html"
```

> **风格档位 (V3.3.0)**: 三份模板的 `<html>` 均已烘焙 `data-density="compact"`，复制后就是默认紧凑成品。叙事标准风是显式退回档，仅在用户明确要求时移除该属性。**交付物不含任何页面内切换控件**。`validate-report.mjs` 的「密度轴」项会回报实际档位，据此确认默认或显式退回是否生效。
>
> 注: macOS 的 `sed -i` 需空串参数 (`-i ''`); Linux 用 `sed -i`。

### 步骤 8: 填充内容

1. 替换 `<title>` 和 Hero 标题为 Governing Thought；**报告主体(机构/区域/业务线/期间)从数据中读取自动填充** —— 模板里的方括号占位符必须全部替换，**严禁把示例文字当默认值交付**。
2. 填写模板内 `#south-china-report-meta` JSON 契约：`schema_version="1.0"`、`generator.name/version`、`requested_period`、适用的 `data_cutoff`、`source.path/source.sha256`、`report_mode`、`key_metrics`、`metrics_sha256` 和 `insights_sha256` 均为必填。`period` 必须给真实当前/比较截止日；无时间 `snapshot` 必须显式写 `data_as_of=null`、`comparison_as_of=null`、`completeness="snapshot"`、`like_for_like=false`，禁止伪造日期。文件源的安全标签和指纹可取 `metrics.meta.source_path/source_sha256`；任何 `[...]` 占位值都会阻断成品交付。SQL 的查询哈希不能冒充结果快照，必须同时披露 `result_snapshot_rows/result_schema_sha256/result_snapshot_sha256`。
3. 页面所有可见业务数字必须使用 `data-metric="metrics.json点分路径"`；章节号、日期、页码等非业务数字必须用 `data-number-exempt="具体原因"` 显式豁免，不允许默默漏过。
4. 填写唯一 `#south-china-report-evidence-contract`，并用 `data-evidence-id` 把 Hero、Chapter 标题/导语、Pull Quote、Insight、Closing 与 `metrics|insights` 真源路径绑定。无证据的原因只能写为 `hypothesis`，且 DOM 必须显式声明 `data-claim-kind="hypothesis"`。完整规则见 `references/evidence-contract.md`。
5. 页面存在 ECharts 时必须填写唯一、默认 `version: 2` 的 `#south-china-report-runtime-contract`：标量系列可用等长 `metrics` 简写；坐标、递归树和 custom 嵌套结构必须用 JSON Pointer `bindings/exemptions` 覆盖每个数值/null 叶子。运行时会从 `echarts.getInstanceByDom()` 反查全部实例，容器任意命名也不能逃逸合同。完整规则见 `references/runtime-metrics-contract.md`。
6. 按 §3 布局结构填充 Chapter，每个 Chapter 遵循 §6 叙事规则。
7. **选图必须走引擎**：每个 Chapter 先过 `chart-selection-guide.md` §0 意图路由表，紧凑档优先取 §7 密集形态；再从 `references/chart-patterns.md` 取代码 + `scripts/echarts-corporate-themes.js` 主题。
8. 图表遵守 `chart-selection-guide.md` §6 IBCS 语义：时间=横轴/分类=水平条形、实际实心/计划空心/预测斜纹、三段式口径副标题、红绿只表差异。
9. 组件使用 `references/component-patterns.md` 中的代码片段。

### 步骤 9: 校验 + 预览

有 `report-spec.json` 时优先一条命令完成完整交付链：

```bash
node "<SKILL_ROOT>/scripts/build-report.mjs" \
  --metrics "目标/metrics.json" \
  --insights "目标/insights.json" \
  --spec "目标/report-spec.json" \
  --out-dir "目标/report-build"
```

该命令在 staging 内顺序执行下列七段流程，全部通过后才原子发布目录。失败只保留带 `build-summary.json` 和逐步日志的诊断目录，不触碰既有成功目录。`--skip-snapshot` 仅供开发，必须返回 `3 / UNVERIFIED`，不能冒充成品。

人工 HTML 兼容流程或单步诊断时，逐段运行：

```bash
# ① 成品静态校验（exit 0=当前模式无 P0；P1 仍须处理）
node scripts/validate-report.mjs 目标/report.html

# ② 数字一致性 + 覆盖率: 所有可见数字须 data-metric 或 data-number-exempt
node scripts/verify-numbers.mjs 目标/report.html metrics.json --insights insights.json

# ③ 离线交付: 内联外链后用严格离线档复检（重复生成时显式加 --force）
node scripts/make-offline.mjs 目标/report.html && node scripts/validate-report.mjs 目标/report.offline.html --strict-offline

# ④a 在浏览器渲染后复核最终 DOM 与全部 ECharts series.data
node scripts/verify-runtime.mjs 目标/report.offline.html metrics.json

# ④b 对严格离线版做四视口截图 + DOM/AX/Tab/对比度/出站网络 Gate，并逐张看
node scripts/snapshot.mjs 目标/report.offline.html 目标/shots/
```

- **运行时数字 Gate 是硬闸门**：只对严格离线版运行；最终 DOM 数字与 ECharts `getOption()` 的全部非空系列必须进入 metrics 合同。Playwright/Chromium 缺失时返回未验证，不能用静态 Gate 冒充通过。
- **截图 Gate 是硬闸门**：只对严格离线版运行，固定验收 1440/1360 桌面端与 430/390 移动端，并对每个 `data-snap` 区块出图。`data-snap` 必须唯一且只用安全 ID；脚本会冻结动画、等 ECharts 稳定并自动阻断出站网络、横向溢出、DOM 语义、AX Tree、真实 Tab 顺序、焦点可见性、WCAG AA 对比度及 console/page/resource 错误。
- **必须自己看这些图**：图表无空白/undefined/NaN、文字无截断/重叠、移动端无横向滚动、分区图可独立看懂。**没看过截图 = 没完成**。
- 自动 AX Tree 是面向读屏器的结构检查，但不等于真实 VoiceOver/NVDA 会话；自动 Tab/对比度也不替代认知可用性、图表替代说明与强合规人工验收。
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
| 3 | **数据至上**          | metrics.json 单一真源 + 质量审计 + 数字覆盖 Gate | 同一指标在文案/图表/表格中数字一致？       |
| 4 | **排版即信任**        | 8pt 网格 + 等宽数字 + 语义色                          | 数字列 `tabular-nums`？间距是 8pt 倍数？ |
| 5 | **三层受众**          | Hero(5s) → 故事(3min) → 明细(按需)                  | 高管/经理/分析师各自获取所需？             |
| 6 | **前端合同先行**      | 先定受众、布局、图表和信任机制，再写 CSS              | 页面像决策工具，而不是普通模板？           |

---

## §3 Scroll Narrative 布局

> 默认阅读路径：Hero 给结论 → KPI Strip 给全局 → 2–4 个 Chapter 用 PAC 论证 → Data Detail 供复算 → Closing CTA 给行动。

- Hero 高度按报告价值决定：年报/季报可 100vh，月报/专题 60–80vh，日报和移动长图不使用沉浸 Hero。
- 叙事段落宽度约 960px，图表/表格宽度约 1200px；具体以已选模板 CSS 为准。
- 每个核心 section 设置唯一 `data-snap`，进入交付 Gate 后分区验收。

---

## §4 视觉系统 V3

> 完整视觉合同只在需要时读取 `references/design-tokens.md` 与 `references/motion-recipes.md`；已选模板的 `:root` 是实现真源。

- 字体三角色：Display 用于 Hero/章节/KPI 大数，Editorial 用于正文，Data 用于表格数字和图表标注。
- 色彩三层：`--brand-*` 管品牌，`--semantic-*` 管增长/风险/机会，`--surface-*`/`--text-*`/`--border-*` 管界面。所有字面色必须登记到 Token。
- 动效只服务层级与叙事；模板仅保证基础 reveal/stagger，复杂 Recipe 需按 reference 接线；`prefers-reduced-motion` 必须即时显示。
- 间距采用 **4pt 最小刻度 + 8pt 主布局网格**：边框/微调允许 4px 倍数，>12px 的布局间距优先 8px 倍数。

---

## §5 叙事组件词汇表

> 完整 CSS/JS、适用场景和类名合同按需读取 `references/component-patterns.md`、`references/table-patterns.md`、`references/chart-selection-guide.md` 与 `references/chart-patterns.md`。

- 叙事层：Hero / KPI Strip / Chapter / Editorial / Pull Quote / Insight / Closing CTA。
- 数据层：Super KPI / Heat Table / Rank Bar / Growth-Decline Dual Ranking / Sparkline Table / Audit Strip / Data Detail。
- 图表层：YoY 折线 / 瀑布 / 子弹 / 赛马条形 / Small Multiples / Treemap；必须先过意图路由再取代码。
- 模板未内置的组件不得只写类名；须从 reference 引入完整样式或另行实现并验证。

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

> **`presentation-mode.js` 使用边界**：脚本已适配 scroll-narrative、bento-brief 和 audit-pack 三套模板，会从 `.hero/.chapter/.data-detail-section/.closing` 或对应简报/审计区块收集分页。仅在需要全屏翻页汇报时引入；常规滚动阅读报告不需要。改动模板核心 section 类名后必须重跑 presentation smoke。

---

## §8 质量保障体系 V3

### 自动化校验

```bash
node scripts/validate-report.mjs <report.html>
node scripts/verify-numbers.mjs <report.html> <metrics.json> --insights <insights.json>
node scripts/verify-runtime.mjs <report.offline.html> <metrics.json>
node scripts/snapshot.mjs <report.offline.html> <shots-dir>
```

校验项目:

- **P0 阻断**: Emoji / 分析范围与比较完整性 / 必需 Schema、单位、主指标空值与重复量级 / 双哈希真源链 / Evidence ID / 数字排版覆盖 / 图表合同 / 占位符与待校验状态 / 未确认审计 PASS；严格离线模式另外阻断所有外部与相对资源
- **P0 运行时真值**: 最终 DOM 数字、全部 ECharts 图/非空系列与 `metrics.json` 合同逐点一致；运行错误和出站网络同样阻断
- **P0 无障碍/布局**: 四视口 DOM 语义、AX Tree、真实 Tab 顺序、焦点可见性、WCAG AA 对比度、横滚/重叠/空图自动检查
- **P1 警告**: Token 完整性 / Token 引用完整性 (未定义且无 fallback 的 `var()` 引用) / Hero 标题质量 / Chapter 标题质量 / 字体三角色
- **P2 建议**: 间距纪律 / Anti-Default 模式 / Pull Quote 质量

### Top-12 人工自检

> 完整 52 项 Quality Gate → `references/mckinsey-quality-gate.md`
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
- 1440/1360/430/390 四视口必须无文字重叠、图表空白、标签溢出
- 最终 DOM 与全部 ECharts 业务数据必须通过运行时 metrics 合同
- 报告、insights 与 metrics 必须通过双 SHA-256 真源链；所有核心结论必须绑定 Evidence ID
- `prefers-reduced-motion` 必须降级为即时显示
- 交付前必跑 `validate-report.mjs`；`exit 0` 只表示当前模式无 P0，饼图/双轴/弱 Hero 标题等 P1 仍须清零或记录例外。只有开发模板本身时才可使用 `--template-mode`，交付成品禁止使用该参数。
- 有数据源必走 `prep-source.py`，数字从 `metrics.json` 取值，`BLOCKED` 不出结论；交付前必须对严格离线版跑 `snapshot.mjs` 并逐张自看截图

---

## §9 资源索引

| 文件                                         | 内容                                                                                 | 何时加载                       |
| :------------------------------------------- | :----------------------------------------------------------------------------------- | :----------------------------- |
| `templates/scroll-narrative-skeleton.html` | **骨架 + CSS 主参考** (完整 Token 系统)                                        | **每次新建报告必须加载** |
| `templates/bento-brief.html`               | **V2 新增** 一屏决策简报 (Bento Grid)                                          | executive_brief 类型           |
| `templates/audit-pack.html`                | **V2 新增** 数据审计包骨架                                                     | audit_pack 类型                |
| `references/design-tokens.md`              | V2 完整 Token (三层色彩/三角色字体/Motion/Dark Mode) + **§2.5 Apple §15 排版集成** + **§4.5 材质系统 (Apple §12)** + **§10 三信号无障碍 (Apple §14)** | 需要查 Token 细节时            |
| `references/component-patterns.md`         | **V2** 统一组件手册 (20+ 组件 + Badge 系统 + 工具函数)                         | 需要组件代码时                 |
| `references/audience-visual-contract.md`   | 受众分层、Bento 规则、图表政策、信任机制                                             | 生成 HTML 前必须加载           |
| `references/anti-default-discipline.md`    | **V2** 克制六律 + Anti-Default 负面清单 + Pre/Post Build 检查                  | 设计阶段必读                   |
| `references/motion-recipes.md`             | **V2** 5 种动效 Recipe + CountUp/Progress 代码                                 | 需要动效实现时                 |
| `references/mckinsey-quality-gate.md`      | **V2 升级** 52 项 Quality Gate (含 Gate 6 视觉系统 + Gate 7 自动化)            | 交付前最终检查                 |
| `references/checklist.md`                  | P0/P1 快速核对清单（当前 18 项 P0 + 6 项 P1）                                  | 生成后快速自检                 |
| `references/trigger-eval.md`               | **V2.5 新增** 触发准确性 20 用例 (should/should-not)                           | 改 description 后回归           |
| `references/runtime-metrics-contract.md`   | V2 最终 DOM / ECharts 标量、坐标、递归树与 custom 叶子合同及豁免边界           | 报告含图表时步骤 8-9 必读      |
| `references/evidence-contract.md`          | report→insights→metrics 双哈希链、Evidence ID、结论类型与假设显式标注        | 生成任何成品时必读         |
| `references/semantic-data-contract.md`     | 通用 measures、分析范围/比较、Schema/粒度、方向与方法适用性合同              | **有数据源时步骤 4 必读**  |
| `references/report-spec-contract.md`       | `report-spec.json` Schema、受控组件、路径安全、Evidence/运行时合同与 CLI 边界 | 使用确定性渲染器时必读 |
| `references/planner-contract.md`           | 规则 Planner、Agent 修订边界、draft/final 生命周期、差异/增量与迁移合同 | 自动生成或修订 Spec 时必读 |
| `references/release-process.md`            | CI、发布清单、只读比较、原子安装与恢复边界                                      | 发版或同步安装目录时           |
| `references/number-formatting.md`          | 数字格式化 + CountUp 动画规范                                                        | 需要查格式规范时               |
| `demos/density-comparison.html`            | **V2.4** 密度轴左右对比：同一份内容 叙事标准风 vs 紧凑销售报告风，调用前先看效果          | 需要向用户展示两种风格差异时   |
| `references/chart-selection-guide.md`      | **V2 升级** Agent 选图引擎(意图路由) + 决策树 + IBCS 语义规范 + 密度轴图表形态 + 受众分层策略 | **每个 Chapter 选图前必须过 §0 路由** |
| `references/chart-patterns.md`             | **V2 升级** 6 种图表代码 (瀑布图/子弹图/进度条/Small Multiples/Lollipop/Slope) | 需要图表 ECharts 代码时        |
| `references/table-patterns.md`             | 表格 + Badge + Sparkline                                                             | 需要表格组件代码时             |
| `references/narrative-contract-example.md` | 叙事合同完整 YAML 示例                                                               | 写章节合同需完整范例时         |
| `references/troubleshooting.md`            | 常见踩坑与修复                                                                       | 遇渲染/字体/图表问题时         |
| `scripts/prep-source.py`                   | 多源画像、通用度量与比较、Schema/粒度/结果快照校验 → `metrics.json`            | **有数据源时第一步** (步骤4) |
| `scripts/stat-insights.py`                 | 方向感知统计层：趋势/异常/结构/集中度/方法适用性与问题清单                     | **build 之后第二步**；问题发现章证据源 |
| `scripts/render-report.mjs`                | 校验 `report-spec.json` 并确定性生成 Evidence、运行时合同与报告 HTML           | 有合规规格时步骤 7 使用 |
| `scripts/plan-report.mjs`                  | 按主指标、方法适用性、受众和维度确定性生成带决策记录的 draft spec              | 尚无规格时先生成草稿 |
| `scripts/finalize-report-spec.mjs`         | 要求显式审阅身份与 UTC 时间，复检后把 draft 定稿为 final                       | 正式构建前必须执行 |
| `scripts/build-report.mjs`                 | staging 内编排 Renderer、离线、运行时和四视口 Gate，成功后原子发布完整报告目录 | 有合规规格时步骤 9 优先使用 |
| `scripts/build-demo.py`                    | 从模拟 CSV + map + enrichment + spec 重建数据、Renderer 双密度 HTML 与离线版 | 修改 demo 真源或发布前检查漂移 |
| `scripts/validate-report.mjs`              | 成品/模板双模式质量校验，含元数据、图表、占位符与严格离线门禁                    | 交付前运行                     |
| `scripts/verify-numbers.mjs`               | 可见数字真值、report/insights/metrics 哈希及 Evidence 路径强绑定 Gate               | 有 `metrics.json` 时交付前必跑 |
| `scripts/verify-runtime.mjs`               | 浏览器渲染后最终 DOM 与 ECharts 标量/结构化数值叶子逐点对账                     | 严格离线版交付前必跑           |
| `scripts/make-offline.mjs`                 | 受限下载、完整资源扫描、原子写入的离线单文件打包器                               | 飞书/内网/截图交付时           |
| `scripts/snapshot.mjs`                     | 四视口/分区截图及 DOM/AX/Tab/对比度 Gate，拦截渲染/资源/溢出错误                 | **交付前必跑并逐张自看**       |
| `scripts/install-skill.mjs`                | 发布清单对账、只读 dry-run/check、显式原子安装与备份恢复                         | 发版或同步 Skill 时            |
| `scripts/run-evals.mjs`                    | 报告级回归：期间、真源、模式、关键指标与机器断言；主观项标 `MANUAL`              | 回归/自测报告是否满足 eval     |
| `scripts/echarts-corporate-themes.js`      | ECharts 企业主题 (前 6 系列对齐 `--chart-1..6`) — 接线见 §7                     | 引入 ECharts 时                |
| `scripts/presentation-mode.js`             | 已适配三套模板的可选全屏翻页模式；模板 section 类名变更后需重跑 smoke | 只在全屏汇报场景引入              |
| `CHANGELOG.md`                             | 完整版本变更叙述 (§11 摘要的展开)                                                    | 需要查历史变更细节时           |

### 加载顺序建议

1. 先读完 `SKILL.md` (本文件) 了解设计哲学和工作流
2. 有数据源先读 `references/semantic-data-contract.md` 确认度量、比较、Schema 与粒度
3. §1 步骤 3 读 `references/audience-visual-contract.md` 确认受众和信息预算
4. §1 步骤 5 读 `references/anti-default-discipline.md` 做 Pre-Build 检查
5. §1 步骤 6 **Read 对应模板的 CSS** — 这是类名的唯一来源
6. 填充内容时读 `references/component-patterns.md` 查组件代码
7. 需要图表时读 `references/chart-selection-guide.md` 选型 → `references/chart-patterns.md` 取代码
8. 需要动效时读 `references/motion-recipes.md` 选 Recipe
9. 需要查 Token 细节时读 `references/design-tokens.md`
10. 生成后跑齐步骤 9 的静态/离线/运行时/截图 Gate → 读 `references/checklist.md` 快速自检 → 读 `references/mckinsey-quality-gate.md` 最终检查

### 可选增强能力

本 Skill 不依赖任何姊妹 Skill。当前环境如具备通用主题、前端可访问性、证据质量或报告增量修补能力，可在不改变本地数据真源和四道 Gate 的前提下叠加使用；缺少时不得阻断主流程。

---

## §10 常见踩坑

常见踩坑与修复完整表（ECharts 渲染/打印/字体/resize/Token 对齐/动效降级/V1→V2 别名等 9 项）→ `references/troubleshooting.md`。
遇到渲染、字体、图表、动效相关的奇怪行为时优先查该表。

---

## §11 版本历史

> 当前版本 V3.3.0。历史变更、缺陷复现和回归证据统一维护在 `CHANGELOG.md`，不在运行时指令中重复。
