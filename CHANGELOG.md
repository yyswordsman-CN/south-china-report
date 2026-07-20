# CHANGELOG — south-china-report

> 详细变更叙述。`SKILL.md` §11 只保留当前版本说明，细节全部下沉到这里。

---

## V3.3.0 — 2026-07-20 — 通用确定性 Renderer、规则 Planner 与三模板发布

- **Schema 先行规格**：新增 `schemas/report-spec.schema.json` 与合同文档，用统一 `report`、`narrative`、受控 `components`、`actions`、`output` 结构表达报告；Demo 金样和财务、人员、库存、质量、服务、调查六类泛化规格进入 Schema 回归。
- **确定性核心渲染器**：新增 `scripts/render-report.mjs` 与模块化渲染内核，校验 `metrics.json` / `insights.json` 的双 SHA、数据状态、安全路径、唯一 ID、单位/方向/比较标签和数字绑定，再从带确定性锚点的 scroll-narrative 模板生成 Evidence、运行时合同与 HTML。默认拒绝覆盖，使用临时文件原子发布，相同输入逐字节复现。
- **Fail-closed 回归**：新增合同、负向与端到端测试，覆盖未知组件、路径缺失/原型链键、重复 ID、Evidence 缺失、非法 hypothesis、脚本注入、错误单位/方向/比较标签、裸业务数字、原子覆盖和既有 Gate 兼容。
- **R2 一条命令交付链**：新增 `scripts/build-report.mjs`，在隔离 staging 中顺序编排 Renderer、在线 validator、静态数字、离线内联、严格离线 validator、运行时真值和四视口截图；每步保存结构化状态、原因码、日志和产物指纹，七段全过后才原子发布目录。失败保留诊断但不触碰既有成功目录；`--skip-snapshot` 明确返回 `3 / UNVERIFIED`。
- **运行时发现与修复**：完整链首次识别出图表标题/说明使用 `chart-*` ID 会被运行时 Gate 误认为额外图表容器；现改用独立标签前缀，生成报告的三张真实图表及全部运行时叶子完成对账。
- **R3 跨业务泛化**：财务、人员、库存、质量、服务工单、评分调查六类夹具现在从 CSV 重建 metrics/insights 后执行完整七段 Gate；可见文本禁止回流战区/渠道/产品/客户/销售默认词，snapshot 使用显式 null 日期并跳过时间模块，所有跳过项保留 `reason_code`。
- **方向与压力边界**：DOM 指标和条形/斜率图从 metrics 的 `direction/favorable` 同源生成语义状态与颜色；水平条形图恢复零基线，极端值与其余对象使用独立零基线并明示不可跨区比较，高基数按类别数扩展高度并在移动端收紧长标签。百分比、负数、零值、极端值和 HHI 无政策描述性边界进入机器回归。
- **本机浏览器隔离**：运行时与截图 Gate 可选读取 `SCR_CHROMIUM_EXECUTABLE`，在并行任务会清理共享无头 Chromium 时指向受控浏览器；未设置时继续使用 Playwright 默认 Chromium，不改变 CI 行为。
- **R4 Demo 真源迁移**：`build-demo.py` 现在从 CSV + map + enrichment + spec 重建数据、标准/紧凑在线 HTML 和离线 HTML；spec 为叙事结构真源，Renderer 为 HTML 真源。新增迁移金丝测试，锁定业务基线、双密度逐字节重建、4 章/4 图/3 行动和 Evidence 不退化。旧定制 PVM 瀑布图经审阅改为通用数量趋势图，量价归因值仍纳入 Evidence 合同；V3.2 手工 HTML 保留在 `demo-report/legacy/` 一个版本周期作对照/回退。
- **R5 规则 Planner**：新增基于主指标、`method_applicability`、受众和可用维度的确定性 draft Spec 生成；决策逐项标记 evidence、hypothesis 或 unsupported。Agent 只允许修订 draft 的叙事字段，不能修改 Renderer、组件或生命周期门禁。
- **草稿与正式态**：Renderer 默认拒绝 draft，审阅预览必须显式 `--allow-draft` 并带可见草稿标识；`finalize-report-spec.mjs` 要求审阅人和 UTC 时间，重新通过 Schema 与 Evidence 校验后才生成 final。
- **三模板 Renderer**：`report.type` 自动匹配 scroll narrative、bento brief 和 audit pack，三类产物共享双 SHA、Evidence、静态数字、严格离线、运行时和四视口 Gate。
- **差异、增量与迁移**：新增结构化 Spec diff、字节一致时不改写的增量渲染、版本化组件注册表及 legacy Spec 迁移复检工具。
- **发布边界**：版本升级为 V3.3.0；全量回归、发布清单、安装副本同步与远端发布回执共同作为发布证据。

## V3.2.0 — 2026-07-19 — P2 口径消歧、参考统一与跨运行漂移锁

- **日历比较语义拆分**：`mom/qoq/wow` 现在严格表示上一月/季/ISO 周，且会校验期间粒度；`previous_equal_window` 保留紧邻等长滚动窗，`previous_calendar_period/previous_complete_period` 表示完整上一日历期，`same_stage_previous_period` 支持部分期对上一日历期同阶段。旧 `period_over_period` 继续兼容但不再承载含混的“环比”语义。
- **按轴可加性与比率合同**：度量新增 `dimension_aggregation/time_aggregation`，库存、余额等可按“同日跨维求和、跨日取期末/最后非空”聚合；新增 `ratio + numerator_field/denominator_field`，百分比强制声明 `storage_scale=fraction|percent`，加权平均输出权重覆盖率并按阈值阻断/跳过。
- **统一参考合同**：新增顶层 `references[]`，统一目标、Benchmark、参考区间、容差和组间比较，绑定度量、单位、方向规则、字段聚合、业务粒度与频率；输出以 `metrics.references[]` 为真源。旧目标/比较入口统一适配，`metrics.target` 只保留兼容投影。
- **跨运行漂移锁**：新增 `drift_lock` 与 `--baseline-metrics`，同时比对语义合同 hash、结果 schema hash、行数变化和结果快照 hash；支持 WARN/BLOCK 行数阈值、`expected_result_change` 预期声明，以及经审阅的 schema/语义迁移开关。构建输出机器可读 `drift_report`，不会自动覆盖基线。
- **回归覆盖**：新增 P2 专项测试，覆盖月/季/ISO 周日历边界、等长窗、部分期同阶段、期末库存、可复算缺陷率、fraction 百分比、权重覆盖不足、标量/区间/组间/legacy 参考，以及预期/非预期结果变化、行数与语义漂移。六类泛化夹具同步补齐百分比存储尺度，既有 P0/离线/运行时/渲染压力/安装门禁继续全量执行。

## V3.1.0 — 2026-07-19 — P1 跨业务语义层与泛化回归

- **通用度量语义层**：新增 `roles.measures[]`，显式声明语义类型、聚合、单位、方向、可加性、权重、主指标和必需性；支持金额、数量、人数、时长、得分、比率、库存和缺陷率。`amount/qty` 继续兼容，但没有金额不再 BLOCKED。
- **通用分析范围与比较合同**：`analysis_scope` 支持 period/snapshot，以及同比、环比/等长上一期、上一完整期、自定义基线、目标、Benchmark、组间比较和无比较。无时间快照保留结构、分布、排名、异常与组间差异，只机器跳过趋势/PVM。
- **适用性与方向语义**：PVM、MK、TopN、Pareto、HHI 统一输出 `method_applicability` 和跳过原因；HHI/Top5 无显式业务政策只输出描述性集中度。新增方向感知斜率图 helper，真实两期标签、动态轴域和 `higher/lower/neutral` 语义色不再硬编码。
- **Schema、粒度与 SQL 快照**：新增必需/可选字段、业务粒度、主键、类型、单位和聚合合同；必需 Schema/单位漂移 BLOCKED，可选字段只关闭依赖模块。SQL 输出查询哈希、结果行数、结果 schema hash 与结果快照 hash，能识别同 SQL 文本下的数据变化。
- **跨业务与渲染压力门禁**：新增财务、人员、库存、质量、服务工单、评分调查六类无敏感数据夹具；覆盖禁用默认销售术语、长标签/高基数、极端值、负数、百分比、低优指标、紧凑布局、动态轴域与四视口截图。既有 P0、严格离线、运行时数字与安装门禁继续纳入全量 `npm test`。
- **兼容边界**：旧销售演示仍使用 `amount/qty` 兼容输出；演示中 HHI/Top5 的风险分级改为构建脚本显式传入演示政策阈值，避免把默认启发式伪装成通用业务政策。

## V3.0.0 — 2026-07-19 — 工业化报告 Skill 主版本基线

- **主版本升级**：将产品版本从 V2.12.0 提升为 V3.0.0，正式把累计完成的数据可信链、默认紧凑风、结构化运行时数字合同、四视口无障碍 Gate、CI 与可恢复安装体系定义为新一代稳定基线。
- **版本呈现统一**：Skill 主标题、首屏版本、README、使用指南、依赖声明、触发维护契约、演示报告和包元数据统一为 V3.0.0，避免主标题仍写“V2”造成版本倒退观感。
- **协议边界不混淆**：产品版本升级为 V3，不改变 `#south-china-report-runtime-contract` 的协议版本；运行时合同继续使用向后兼容的 schema `version: 2`，避免无必要的协议破坏。
- **兼容性**：技能稳定 ID 仍为 `south-china-report`，调用方式和 V2.12.0 已验证的数据/报告行为保持兼容；本次是主版本定位与版本真源统一，不虚构额外功能增量。
- **P0 · 期间完整性**：`prep-source.py` 新增必填 `data_as_of/comparison_as_of`，未完整期自动锁定上年同一日历截止日，基期覆盖不足即 BLOCKED；可用 `expected_observations` 声明两期应有行数/不重日期数，默认完整率下限 90%。
- **P0 · 金额空值与重复量级**：锁定可比范围内金额空值、完全重复行及重复绝对金额占比都进入质量元数据，任一默认超过 5% 即 BLOCKED；不自动去重，避免猜测业务键。
- **P0 · 全 ECharts 实例反查**：`verify-runtime.mjs` 与 `snapshot.mjs` 不再依赖 `.chart-container`/`chart-*` 命名，而是遍历 DOM 并用 `echarts.getInstanceByDom()` 发现全部实例；静态验证器对任意 `echarts.init()` 强制要求唯一运行时合同。
- **P0 · 产物双哈希链**：`stat-insights.py` 将实际输入 `metrics.json` 的 SHA-256 写入 `insights.meta.metrics_sha256`；报告 meta 强制 schema/generator/data_cutoff/`metrics_sha256`/`insights_sha256`，`verify-numbers` 与 `run-evals` 对实际文件字节逐链校验。
- **P0 · Evidence ID**：成品必须提供唯一 `#south-china-report-evidence-contract`，Hero/Chapter/Pull Quote/Insight/Closing 等核心结论必须绑定实存的 `metrics|insights` 路径。无证据原因只允许作 `hypothesis`，必须写明原因、验证需求并在 DOM 显式标注。

## V2.12.0 — 2026-07-19 — P2 工程化、运行时真值与无障碍闭环

- **运行时数字真值 Gate**：新增 `verify-runtime.mjs`，在阻断网络的 Chromium 中执行严格离线报告，复核最终可见 DOM。运行时合同升级为向后兼容 V2：标量保留等长 `metrics` 简写；坐标对、递归树和任意 custom 嵌套结构通过 RFC 6901 JSON Pointer 将每个数值/null/完整格式化数值字符串叶子逐一映射到 `metrics.json`。遗漏、重复、越界、原型链键、非有限值和无理由豁免均 fail-closed；支持精确多指针共享豁免理由，不支持通配符或子树吞并。
- **无障碍专项自动化**：`snapshot.mjs` 从基础属性检查升级为四视口 DOM 语义、Chromium AX Tree、真实 Tab 可达性、焦点可见性与 WCAG AA 计算对比度 Gate；同时保留出站网络、布局、页面错误和原子截图发布门禁。三套模板和标准/紧凑 demo 均进入真实页面回归，并修复标题层级、深浅底语义色和文字对比度。
- **多源 E2E 金样**：新增同一业务金样的 Excel、SQLite、DuckDB 三源端到端测试，实际调用 `prep-source.py profile/build`，校验字段角色、期间、业务聚合结果与跨源投影完全一致。
- **CI 与可恢复安装**：新增 GitHub Actions（Python 3.11 / Node 22 / Chromium）、`release-profile.json`、版本/发布清单检查及 `install-skill.mjs`。安装默认只读；显式 `--apply` 才会 staging + 原子替换，保留旧目录备份并在发布后复检失败时恢复。
- **版本与合同文档**：新增运行时 metrics 合同和发布流程说明；Quality Gate 从 48 项扩展到 52 项，快速清单扩展为 14 项 P0 + 6 项 P1；默认紧凑风保持不变。

**本机回归证据**：`npm test` 全绿，包括 31 个 Python 数据测试、31 个 validator 回归、三模板 × 四视口无障碍、双 demo × 四视口截图、离线/网络/原子写入、运行时真值与安装备份 smoke；运行时 fixture 覆盖 V1 标量兼容及 V2 坐标、树、custom、格式化标签、遗漏/错值/重复/非法指针负例。双 demo 各 4 张图的 55 个业务数值叶子逐点匹配，1 个辅助系列与 21 个视觉常量逐项说明豁免。`release:check` 覆盖 84 个发布文件。真实 Codex 安装目录仅执行 `--dry-run`，确认存在漂移且未写入任何文件。

**诚实边界**：AX Tree 自动检查面向读屏器结构，但不等于真实 VoiceOver/NVDA 全流程；自动 Tab/对比度不替代认知可用性、图表替代说明和强合规人工验收。运行时 V2 覆盖全部 `series.data` 数值叶子，但仍不解析 `dataset.source`、`markPoint/markLine` 或 `renderItem` 内临时生成且未落入 `series.data` 的数值。真实安装目录本次只做 `--dry-run`，未经授权不覆盖。

## V2.11.1 — 2026-07-19 — 紧凑风切为出厂默认

- 三套模板的 `<html>` 均默认携带 `data-density="compact"`；未指定风格时直接生成紧凑版。
- 叙事标准风保留为显式可选档，用户明确要求大留白或沉浸式叙事时移除 `data-density`。
- 同步更新 Skill 工作流、使用指南、设计 Token、Agent 默认提示词和密度对比 Demo；模板回归新增“紧凑默认”硬断言。

## V2.11.0 — 2026-07-19 — P0/P1 可信链、离线交付与响应式专项修复

本版依据项目全维评审与独立红队负向探针实施，不以模型自评分作为发布证据。修复范围覆盖数据源到报告成品的完整链路：

- **期间与真源 fail-closed**：`map.caliber.period` 真正驱动月/旬/季/半年/全年/自定义区间；未确认期间、无时间列、解析失败、时区未声明或当期净额不可用时均 BLOCKED，并停止输出可误用的派生数字。map 相对路径只按 map 所在目录解析，CLI 覆盖不再丢失 sheet/table，也不会回退到 cwd 同名文件。
- **目标口径与数量/金额防错配**：目标必须显式声明 `target_measure=amount|qty`；`auto` 仅接受锁定期间唯一目标值，多行目标必须声明聚合、粒度和频率。支持 period/month/xun/quarter/half/year 目标频率；数量目标用数量 actual，金额目标用金额 actual。数量列不再被 profile 冒充金额，`amount==qty` 全局阻断。
- **数据质量与隐私**：文件源输出安全标签、SHA-256 和指纹范围，不暴露本机绝对路径；SQL 只记录查询哈希并明确“非数据快照”。profile 默认不打印字段样例或 SQL 正文，须显式 `--show-samples`。客户集中度增加金额覆盖率，覆盖不足或负净额时停止风险分级；目标少量坏值也必须披露。
- **统计层 fail-closed**：`metrics` 增稳定 `schema_version=1.0`；`stat-insights.py` 拒绝缺失/未知状态与旧结构，原子写出结果；YoY 序列跳过基期非正和当期负值，PVM caveat 禁止生成强量价结论，HHI/Top5 阈值可配置。
- **验证器与 eval 加固**：成品必须有唯一且完整的 `#south-china-report-meta`；递归占位、非法 SHA、原型链路径、审计类名换序、template 伪 DOM、隐藏正确值掩盖错值、数字豁免滥用、静态 module/importmap 与主动协议等负例均已纳入回归。可见静态 DOM 数字默认要求 100% 绑定或叶子级有理由豁免。
- **离线、截图与无障碍**：离线器支持更多 HTML/CSS/srcset 资源并 fail-closed 处理模块依赖，限制协议、主机、私网、重定向、超时和体积；既有输出必须 `--force` 才原子替换。截图改为 1440/1360/430/390 四视口 staging 发布，失败不留半成品；阻断出站网络、布局溢出、页面错误和基础无障碍缺陷。三模板已适配演示模式与移动端宽表。
- **演示与可复现环境**：标准/紧凑 demo 补报告契约、源指纹与全量静态数字覆盖，新增 demo 专属 eval。`build-demo.py` 把 `demo_sales.csv + map.json + enrichment.json` 固化为可审计的数据输入，区分可复算证据与人工行动假设；两份在线 HTML 明确作为人工叙事真源。`--check` 逐字节阻断 metrics/insights/在线 meta 漂移，并用在线 SHA-256 阻断陈旧离线包。版本统一到 V2.11.0，锁定 Node/Python 依赖，补数据、验证器、离线、快照、无障碍、网络和演示模式测试链。

**已知边界**：静态数字 Gate 不解析 JavaScript 运行时注入或 ECharts Canvas/SVG option 内部数字，完整 chart-option→metrics 映射仍是独立后续项；基础无障碍 Gate 不替代完整键盘路径、读屏器与颜色对比度专项验收；自定义 `--allow-host` 的 DNS 重绑定风险需在高安全环境使用网络隔离或固定出口进一步约束。

## V2.10.1 — 2026-07-18 — Codex 独立审计修复 (7 项指控 → 逐条复现 → 6 修 1 加固)

**背景**：Codex 对 HEAD 做独立代码审计, 综合 6.5/10 (工程质量 4.8), 列出 7 项 P0。逐条对源码复现核实: 5 条实锤、1 条实锤但威胁模型有限、1 条属文档化设计但默认值过软。本版全部修复。与 Fable 5 评审 (8.5, 架构/纪律镜头) 的分歧属评审镜头差异——安全级行级审计确实抓到了架构评审漏掉的缺陷, 两份评审并存记录。

- **`prep-source.py` 基年相邻性 (最重)**：`yrs[-1]/yrs[-2]` 会把 2024+2026 (缺 2025) 静默标成"同比"且状态 OK。修复: 相邻性检查——`gap != 1` 时 WARN"口径为跨期对比而非同比, 措辞禁用 YoY", `meta.yoy` 增 `adjacent` 布尔 + `caliber_note`。回归: 2024+2026 合成数据 → WARN + `adjacent:false`; demo (2025+2026) → `adjacent:true` 无警告。
- **`snapshot.mjs` 动画中间帧**：等待 900ms < CountUp 2000ms, 可截到数字中间值。修复: PREP 注入 `*{animation:none!important;transition:none!important}` 并把全部 `[data-to]` 元素直接写成终值 (toLocaleString+suffix)——不赌时序。回归: hero 截图稳定为终值 6,372。
- **`snapshot.mjs` 路径穿越**：`data-snap` id 未消毒直接拼文件名, 含 `../` 可写出 outDir。修复: 文件名白名单消毒 `[^A-Za-z0-9_-] → _`, 空 id 跳过。
- **`verify-numbers.mjs` 零绑定放行**：零 data-metric 曾 `exit 0`——完全未接线的报告能"通过数字 Gate"。修复: 默认 `exit 1` 判未通过, 新增 `--allow-unbound` 显式逃生口 (不推荐)。回归: 无绑定文件默认 FAIL、带 flag 放行、demo 两版 (49/51 处) 照常通过。
- **`run-evals.mjs` shell 注入面**：`execSync` 拼字符串, JSON.stringify 引号包裹挡不住双引号内 `$()`/反引号展开 (威胁模型=本地自用 CLI, 有限但该修)。修复: 改 `execFileSync('node', [script, ...args])` 全程无 shell, 顺删无用 `q()`。回归: eval#1 对紧凑版 5/5 PASS, validator/verify 子进程调用正常。
- **`audit-pack.html` 出厂假图章**：模板自带"审计结果: ALL PASS"+固定时间戳, 忘改占位 = 交付假审计。修复: 顶层图章改 warn 态"[待校验 — 按实际结果回填]", 时间改占位, 注释声明各 Section 的 PASS/MATCH 均为示例必须回填。
- **demo 报告虚构归因**：C1 lead 把"春节错期与大客户提货推迟"写成事实语气 (模拟数据无此支撑, 违反自家数据至上纪律)。修复: 两版均改为"归因需结合业务事件核实——本演示不虚构原因"; 重跑双版本 4 道 Gate 全绿, 离线版重建。

**未修 (记录理由)**：Codex 若干 P1 (紧凑档图表 grid 挤压/斜率图轴域硬编码/HHI 阈值假设等) 属 demo 专用代码或已有文档化设计取舍, 经复核当前产物截图无实际劣化, 记录不改; strict-offline 覆盖面待下轮专项核。

---

## V2.10 — 2026-07-18 — 统计洞察层 (`stat-insights.py`): 补"分析深度"短板

**动机**：外部评测(Fable 5 通读评分)指出"统计分析深度"为最弱维度(5.5/10)——此前"异常识别/趋势判断"依赖 Agent 对 metrics.json 的自由发挥, 无统计学依据、无可执行脚本。本版把该能力从"靠提示词"升级为"技能原生"。

**新增 `scripts/stat-insights.py`** (纯 Python3 标准库, 零新依赖)：读 `metrics.json` → `insights.json` + `insights.md` 摘要:
- **趋势显著性**: Mann-Kendall 检验(双侧正态近似+并列修正)跑在**跨年逐月 YoY 增速序列**上(规避原始月序列的季节性污染), 回答"下滑是趋势还是波动"; p<0.05 才允许报告写"趋势性下滑"。
- **异常月检测**: 稳健 Z 分数(median/MAD, MAD=0 退化均值绝对偏差), |z|>=2.5 判异常月。
- **连续下滑**: YoY 序列末端连续负增长月数, >=3 进问题清单。
- **维度扫描**: 断崖(YoY<=-15% 且份额>=2%)/引擎(YoY>=+15%)/结构位移(份额变动>=1.5pp, 基期份额由 amount_base_wan/total_base_wan 反推)/**增速贡献分解**(各成员对总增速的拉动/拖累 pp, 排序输出"谁拖了几个点")。阈值均 CLI 可调。
- **集中度**: 各维度 HHI(0.10/0.18 通用分级) + 客户 Top5/帕累托复述与风险分级(沿用 prep-source 的 Top5>45% 判高)。
- **量价象限**: 依据 period.pvm 判量价齐升/量增价减/量减价升/量价齐跌, 透传 price_mix 口径 _note/_caveat。
- **问题清单**: 汇总以上发现, 含影响金额的按 |万| 降序; 每条带 action_frame 提示按 PAC 补对策——**脚本不代拟具体业务动作**。

**统计诚实纪律** (与"数据至上"对齐, 全部实测验证):
- metrics.json 为 `BLOCKED` → 拒绝运行 exit 2 ("脏数据上不做统计")。
- 可比月 n<8 → Mann-Kendall 只报方向不判显著(小样本正态近似不可靠), 输出 note 要求报告措辞用"方向上/初步"。
- 无 trend(单年数据) → 跳过趋势/异常/连续下滑, 与 prep-source 单年降级一致。
- 不做预测外推、无目标数据不谈达成缺口。

**实测**: 合成 30 个月数据植入 5 个已知模式(增速持续放缓/2026-02 崩塌月/南区断崖/东区引擎/客户 Top5=50%), 全部命中(MK p<0.001 显著下行、异常月 1 个、断崖 -37.1% 拖累与位移 -7pp、象限量价齐跌); BLOCKED 拒跑与 n=6 降级路径各自验证通过。

**接线**: SKILL.md 步骤 4 增"③ 统计洞察"、§9 索引加行、§11 版本表; 问题发现类章节的证据从 insights.json 引用。

---

## V2.9 — 2026-07-11 — 二轮缺陷诊断修复 (4 维并行审查 → 去重修复)

**方法**：派 4 个并行 agent 从**文档一致性 / 脚本健全性 / 模板校验 / 使用者 RED 模拟**四维审查 V2.8 残留缺陷，交叉验证去重后修复；脚本改动均 RED→GREEN 留证据，全量回归三模板 validator exit 0。使用者 RED 模拟(扮演首次拿到 skill 生成报告的 agent)贡献了以往工程审查未覆盖的头号缺陷。

**图表口径全库统一 (文档漂移根治)**：
- **chart-patterns 章节号归位 + PVM 幽灵**：`chart-selection-guide.md` 原把 Lollipop 标 §4/Slope 标 §5、并声称"PVM(§6)"为带代码组件——实际 chart-patterns 是 §4 Small Multiples / §5 Lollipop / §6 Slope、**根本无 PVM 代码**(grep 零命中)。修正为正确 §4/§5/§6 编号, 索引表补 Small Multiples；量价(PVM)归因改为**指向 §1 瀑布图组件实现**(PVM 是瀑布图应用, 非独立组件), 决策树"三因素归因"同步。根治"agent 去 §6 找 PVM 代码却落到 Slope"。
- **饼图/环形/Gauge 口径统一到"默认禁用·≤3类破例"**(与 validator 一致)：修 `SKILL.md`(超过6类改)、`mckinsey-quality-gate.md`(最多5-6片)、`audience-visual-contract.md`(超5-6片)、`anti-default-discipline.md`(超5类 / ≤5片除外) 共 5 处旧口径；`component-patterns.md` 撤下环形图(结构首选改 100%堆叠条形)、Gauge 环形仪表(标注禁用 + 达成改超级KPI卡/子弹图)、`recommendKpiStyle('target')` 由 `'gauge'` 改 `'super-kpi'`——消除"推荐被 validator 拦下的图"这一自相矛盾。
- **`SKILL.md` §8 校验严重度归位**：禁用图表由误标 P0(阻断) 改 P1(非阻断, 与 validator emit 实际一致)；明确 P0 仅 Emoji/tabular-nums/图表高度三项触发 exit 1。

**数据管线加固 (`prep-source.py`, 均 RED→GREEN; clean fixture 产出字节完全一致)**：
- **金额空值≠坏值**：空单元格(稀疏但合法, 如仅已结单填额)不再计入坏值率, 与数量列同口径, 分母改非空原始值——修复"金额稀疏数据被误 BLOCKED"(实测 10% 纯空: RED BLOCKED→GREEN WARN)。
- **`trend` 缺月写 `null`** (前端断线)不补 `0`——修复"当年半程数据折线掉零误导"(实测 2025 仅 1-3 月: RED `[…,0.0×9]`→GREEN `[…,null×9]`, YoY 仍锁同期)。
- **`profile` 单年自动降级**：时间跨度 <2 年时不再建议 YoY/量价瀑布(与 `build` 的 `len(yrs)>=2` 对齐), 改提示结构+排名+集中度——根治"单期/单月数据被诱导搭无同比数据支撑的章节"(RED 模拟头号 P0)。
- 无数据源入参由 `os.path.splitext(None)` traceback 改干净 `SystemExit`。
- 回归: 三档闸门(OK/BLOCKED×2)、旬粒度、重复检测均不变。

**截图 Gate 与离线交付 (`snapshot.mjs` + 新增 `package.json`)**：
- `snapshot.mjs` 顶层 `import 'playwright'` 改**动态 `await import` + try/catch**——无 Playwright 环境从"未捕获 `ERR_MODULE_NOT_FOUND` 崩溃"改为打印"截图未验证"降级信息 + 退出码 3(既有未验证约定), 兑现文档承诺的优雅降级。
- 新增 `package.json`：`type:module`、`engines.node>=18`、playwright 入 `optionalDependencies` + `setup:screenshots`(`npx playwright install chromium`)——补上此前缺失的安装指引；纯浏览器 `.js` 与 `.mjs` 直接 `node` 运行不受影响(实测)。

**校验器盲区 (`validate-report.mjs`)**：
- 图表高度 P0 闸门 `checkChartContainers` 由"仅认 `class=chart-container`"扩展到 `.tile-chart`/`id^=chart`/`echarts.init()` 引用容器——修复"bento 图表(挂 tile-chart)塌 0 高度也放行"盲区(RED: bento 图表规则 0 命中→GREEN: 纳入检测, 无高度负例正确 FAIL/exit 1)。三模板回归仍全 exit 0。
- Emoji 正则与严重度分级**按用户确认保持不动**(全拦对勾/叉/星等符号)。已知边界(非本次新增): `min-height:0`(flex 布局)被判"已设高", 静态分析无法追踪 flex 链, 与原口径一致。

**卫生项**：
- `number-formatting.md`: 幽灵 Token `--shadow-hover/--shadow-card` → `--shadow-md/--shadow-sm`; 字体序列去 Inter(非三角色)改三角色字体; 版本 V1(2026-03)→V2 对齐。
- `design-tokens.md`: 补 `--font-serif` 文档化(Pull Quote 衬线, 此前仅 scroll 模板定义未收录)。
- `SKILL.md`: `prep-source/snapshot/validator` 版本标注 V2.5.1→V2.6(实为 V2.6 引入); "P0 清单(12项)"→"P0/P1(6+6)"; `checklist.md` 标题同步。
- `bento-brief.html`: 图表品牌色 `#0353a4` 硬编码 → `cssVar('--chart-1')`(visual-theme-engine 换色时跟随)。
- **自查抓到并修复一处自引入 regression**: 强化模板注释时误用警示符(U+26A0, 落在 validator Emoji 拦截区)致 scroll validator FAIL——改文字标签"注意:", 正印证"保持全拦"策略有效。

**未改 (经裁决, 非遗漏)**：
- Emoji 白名单: 用户确认对勾/叉/星等符号维持全拦(对齐"报告严禁 Emoji", 图标走 remixicon/文字)。
- validator 浅检查(间距 shorthand 只读首值 / tabular-nums 存在性 / letter-spacing 仅 em): 属 V2.3.1 起有意的降噪设计, 改严会误伤紧凑档合法间距, 记录不改。
- 既有 references 的警示符(chart-selection-guide §2 "暂无出厂代码"标记): 作者既有惯例, 不被 validator 扫, 按最小改动不动。
- 文档过载(601 行 SKILL + 多文件引用): RED 模拟提出的体验议题, 属结构性优化, 本轮聚焦缺陷修复未动, 留后续。

## V2.8 — 2026-07-11 — 缺陷修复闭环 (评审缺点 1-7 全量修复 + 改名)

依据 2026-07-11 全维度评审（8.7/10）的缺点 1-7，经 subagent 分组实现 + 独立审查 + 修复回环完成（全部改动均有 RED→GREEN 证据，留档 `../south-china-report-workspace/tests/logs/`）：

- **改名**：目录与技能 ID `south-china-report-V2` → `south-china-report`（版本号不再烧进稳定 ID；内容版本继续 V2.x 走 §11/CHANGELOG）。包内引用全量替换（SKILL/openai.yaml/trigger-eval/脚本头注释/demo），残留 0。
- **缺点 1 文档漂移**：§5 幽灵组件修正——Comparison/Metric Highlight 实际有 CSS（component-patterns §1.4/§1.5），Callout 在 table-patterns §4（类名 `.callout`），仅 Timeline 真需自写；bento/audit 头注释 `0.65`→`0.6` 对齐实际值；§9 Token 数 125→126。
- **缺点 2 Token 完整性**：references 内 6 个孤儿别名（`--color-success/danger/accent/secondary/bg-body/bg-card`）与 `--radius-md` 全量替换为真实 V2 Token（23 处）；validator 新增 **Token 引用完整性 P1**（未定义且无 fallback 的 `var()` 引用即报，注释文本已剥离防误报），机器守门根治此类缺陷。
- **缺点 3 数字一致性**：新增 `scripts/verify-numbers.mjs`——`data-metric="metrics.json点分路径"` 绑定值与 metrics.json 机器比对（容差=显示精度末位一半，`万/亿/%/pp` 自动换算，CountUp 元素取 `data-to+data-suffix`），错配 exit 1；scroll 模板 hero 与首 KPI 已带绑定示范；接线进步骤 9。48 项 Gate 中唯一 P0 级人工项就此自动化。
- **缺点 4 eval 闭环**：新增 `evals/`（3 用例+客观断言+合成 fixture 数据），完整 skill-creator 双跑（新版 vs V2.7 快照）+ grading + benchmark，结果见 workspace `iteration-1/`。
- **缺点 5 离线交付**：新增 `scripts/make-offline.mjs`——内联 CDN echarts 与图标 CSS（@font-face 裁剪至仅 woff2，产物 1.37MB），Google Fonts 默认移除走系统回退（`--fonts` 可全内联）；网络失败 exit 2 不写半成品；validator 增 `--strict-offline`（离线检测 P2→P1）。
- **缺点 6 prep-source 补强**：`map.roles.id` 重复行/重复单号检测（warn 不自动去重）；`map.caliber.granularity: month|xun` 旬粒度 YoY 锁定（`_mk` 键，month 模式行为与旧版逐处等价）；数量列坏值率上报（>5% 时 `pvm._caveat`）；map 声明列不存在显式 warn。12 项断言 + 三档回归（OK/BLOCKED/BLOCKED 合法 JSON）全过。
- **缺点 7 卫生项**：validator Token 完整性阈值与消息对齐（≥40）、Pull Quote 质检覆盖 `.pull-quote` div 容器；frontmatter 补 `compatibility` 依赖声明；生态耦合脱空处理（无姊妹技能时以 prep-source 的 quality.md+metrics.json 充当 Evidence Pack）；SKILL.md 瘦身——§6 叙事合同长示例、§10 踩坑表下沉 `references/narrative-contract-example.md`/`references/troubleshooting.md`（626→601 行；未到 500 行目标系"仅下沉不改语义"边界所致，经裁决接受）。
- **回归**：三模板 validator（含新检查）exit=0；5 个 .mjs `node --check` + prep-source `py_compile` 通过；verify-numbers/make-offline fixture 实测。

## V2.7 — 2026-07 — 综合评审修复 (数据正确性 + 文档对齐现实)

依据多 agent 综合评审逐条修复 (均已实测验证)：
- **数据正确性 (`prep-source.py`)**：① PVM `price_wan`→`price_mix_wan` 并加 `_note` (混合均价法含价+结构, 多SKU时非纯价, 瀑布图标签应写"价+结构")；② 金额解析失败(NaN)由静默"按空处理"改为**报剔除行数+占比**, 占比 >5% 升级为 `R.err`→BLOCKED (实测 20% 坏值正确阻断)；③ 除零守卫: 维度 `share` 与客户集中度在总额=0 时写 `null` 并报错, `json.dump(allow_nan=False)` backstop —— 根治"metrics.json 写出字面量 NaN 导致前端 JSON.parse 崩溃" (实测全坏值输出仍为合法 JSON)。
- **校验器口径一致 (`validate-report.mjs`)**：离线自包含检测补 CSS 侧外链 (`@import`/`@font-face src`/`background url`/`<img>`), 修复"仅 @font-face 远程字体时误报 PASS"。
- **图表口径统一 (`chart-selection-guide.md`)**：决策树与黄金法则改"饼图/环形=默认禁用"、Gauge 标"validator 默认禁用勿用" —— 与 validator 的 pie/gauge 禁令对齐 (消除自相矛盾)。
- **模板一致性**：`bento-brief`/`audit-pack` 紧凑档 `--density` 0.65→**0.6** 对齐 V2.4, 并注明二者为 spacing-only (无 scroll 的组件级重组)；`scroll-narrative` 补 `--font-serif` 定义 (Pull Quote 此前引用未定义 Token, 静默回落)。
- **文档对齐现实 (`SKILL.md`)**：§5 标注 Comparison/Metric Highlight/Timeline/Callout Box 四组件**无内置 CSS 需自写** (此前称"完整 CSS 在模板中"但实际无样式, 会产出裸元素)；离线检测措辞从"P0 必须全 PASS"更正为"P2 建议非阻断"；动效 Recipe 标注"目标规范, 未全部烘焙进模板 JS"；补 `agent_created: true` 与版本标识澄清句。
- **数据口径二轮修 (`prep-source.py`)**：④ 价量对齐——均价/PVM 的 qc/qp 只在金额有效行上求和 (与 tc/tp 同口径), 根治"分子含有效营收、分母含坏行销量→均价系统性低估"(实测 price_cur 由错配值纠正为 1250)；⑤ 维度 `share` 口径统一——有 YoY 期间时 share 走**当期**(与 yoy 同口径, 加 `meta.share_caliber` 标注), 消除"占比累计 vs 同比当期"打架 (实测当期 share 和=100)。
- **校验器误报收敛 (`validate-report.mjs`)**：图表容器高度检测除 `.chart-container{}` CSS 规则外, 增加 inline `style` 高度与 `#id{height}` 选择器识别; 部分未命中降为 WARN、全无高度才 P0 —— 修复"合法 inline/id 设高被误判 P0 阻断交付"(实测 inline/id 两种写法均转 PASS, 真无高度仍 FAIL)。
- **分区截图默认可用**：`scroll-narrative` 模板补 `data-snap` 示范 (`hero`/`chapter-01`/`chapter-02`/`closing`), 让 `snapshot.mjs` 开箱即出 `snap-*.png` 分区图 (此前模板无 data-snap→分区截图默认为空)；SKILL §9 措辞同步。
- **Emoji 纪律确认**：validator emoji 正则覆盖 `1F300-1F9FF`/Dingbats(`2700-27BF`, 含对勾/叉)/符号/区域指示符/变体选择符, 严格拦截一切 Emoji (对齐用户"报告严禁 Emoji"要求, 不设对勾/叉白名单)。
- **回归**：三套模板 validator 仍全绿 P0；5 脚本语法全过；prep-source 端到端 (干净/20%坏值/全坏值三档 = OK/BLOCKED/BLOCKED) 实测通过, 退化档输出仍为合法 JSON。
- **架构决策 (经分析师 agent 评测)**：两项"结构重构"评测后判定不做重版、只做轻量正解——① bento/audit **不补**完整紧凑重组 (二者本就是高密度 Bento/审计布局、组件体系与 scroll 完全不同、且不在用户紧凑主力路径; 补齐=高成本低回报)，改为 §0 文案收敛 (紧凑风典型场景移除"简报/审计包"，注明 compact 完整重组仅 scroll)；② Token **不追求**完全收敛 (与单文件自包含定位冲突)，只对齐三模板 `--chart-5/6` 配色 (消除唯一真正的跨模板配色不一致)，`--content-width` 等合理设计差异保留，§4"唯一真相源"改为"Token 主参考 + 允许差异"。

## V2.6 — 2026-07 — 借鉴 sales-report-html: 多源数据管线 + 截图 Gate

参照 `anthropic-skills:sales-report-html` (强在 Excel 数据清洗)，补齐我们缺的两层，并改造成**多源通吃**：
- **`scripts/prep-source.py` (核心新增)**：DuckDB 统一加载器 —— 一个接口吃 Excel/CSV/Parquet/SQLite/DuckDB/任意 SQL (比原版只读 Excel 广)。`profile` 命令做字段角色推断 + **自动建议分析骨架**(按 `audience-visual-contract §2` 覆盖面映射，无目标字段提示降级、剔除 ID/高基数噪声维度)；`build` 命令清洗(健壮数字解析/会计负数)+ 聚合(各维度 YoY/占比/趋势/客户集中度) + **数据级校验**(占比和≈100/编码跨年一致性/弱信号/BLOCKED 状态) → `metrics.json`+quality.md。**报告数字从 metrics.json 抄不手敲**。实测: profile 自动出的骨架与手工搭的 5 章几乎一致，build 数字与手工分析逐个吻合，Excel+SQLite 双源验证通过。
- **`scripts/snapshot.mjs` (截图 Gate, 补最后 0.3 分)**：Playwright 自动截 desktop(1440整页)/mobile(430整页)/`snap-<id>`(每 `data-snap` 区块) PNG。截图前**强制 `.reveal`→visible + 等 ECharts 渲染**，根治叙事档整页截图空白。实测跑通，分区图可直接发群。无 Chromium 时诚实报"未验证"。
- **`validate-report.mjs` 增强**：新增禁用图表检测(饼/雷达/仪表/3D/双轴)+ 离线自包含检测(外链 CDN/字体告警)。反向验证抓到注入的饼图与 CDN。
- **工作流接线**：步骤 4 加数据源 → prep-source 画像/构建；步骤 9 加截图 Gate;硬闸门增两条。
- **不借**：它的视觉/模板/叙事结构 —— 我们更强(叙事骨架/密度轴/IBCS/超级KPI/热力/双榜)，保持"报告≠看板"的护城河。

## V2.5.1 — 2026-07 — 工程化加固 (缺目标降级 / 触发 eval / demo 根治脱节)

补掉三项工程欠账 (评分时点名的 0.5 分里的两项)：
- **无目标数据自动降级** (`chart-selection-guide.md` §0.1b + `audience-visual-contract.md` Data Contract 必答项)：无目标/预算字段时，达成率/子弹图/进度条/完成度**强制降级**为 YoY/结构/趋势，禁止编造目标。Data Contract 4 项必答固化 (截止日期口径 / 有无目标 / 跨年编码变更 / 弱信号字段)——均来自真实实测撞到的坑。
- **触发准确性 eval** (`references/trigger-eval.md` 新增)：20 条 should/should-not 用例，自评 应触发 10/10、不应触发 9.5/10；据此收紧 description 明确"产物为静态自包含 HTML(非 PPT/Excel/交互式 BI)"，堵 PPT/交互 BI 误触。
- **demo 根治脱节**：`demos/density-comparison.html` 从"手抄模板样式"(历史两次误导用户) 重写为 **iframe 载入真实模板 + demo 内注入紧凑档**，模板一改两栏自动跟随，零脱节；代码 ~90→~30 行。已渲染验证 (需本地服务打开)。

## V2.5 — 2026-07 — 借鉴业界 B2B 报告 (密度 + 多维下钻)

用户以一份业界 B2B 渠道分析报告为参照要求加厚。裁决:吸收其密度/组件手法,不丢叙事骨架 (拒绝"无结论标题的彩色数字墙")。落地:
- **§1.8 增长/下滑双榜** (`component-patterns.md` 新增)：型号/客户/门店级 Top-N 涨跌并排，按**绝对增减额**排 (非增长率，防小基数噪声)；上方仍要 Action Title。选图引擎 §0 路由增"谁在涨谁在崩"一行。
- **§1.9 章节锚点导航** (`component-patterns.md` 新增)：≥4 章长报告顶部 sticky 跳章导航，短标签、≤6 项、仅 HTML 版。
- **Heat Table 提示强化**：`component-patterns.md` §0 矩阵标注"一张抵 12 张对比柱"，提醒战区×月同比矩阵优先用热力表。
- **实测报告加厚至 5 章 6 图 + 双榜 + 热力表 + 锚点导航**：新增 Ch2 型号双榜 (变频 KFR 领涨/定频 KF 退场，型号级证实结构升级)、Ch4 客户集中度 (Top5 占 50.9%、T1 独占 29.2%，三年翻倍的依赖风险)、Ch5 战区×月同比热力矩阵。全部真实数据、浏览器渲染验证、校验 0 FAIL。
- **数据质量甄别**：国补字段无信号 (1%)、产品定位字段跨年编码变更 (S→F 重分类) 均按"数据至上"排除，未拿来做误导性同比。

## V2.4.2 — 2026-07 — 实测迭代 (报告加厚 + 趋势图 YoY)

用户看完 V2.4.1 实测报告后反馈"只有 3 章太薄""趋势图应做同比"。据此：
- **趋势图默认改同期对比 (YoY)**：x=1-12 月、叠 2-3 年折线，季节峰谷与同比差距一眼可读；避免连续多年单折线把季节性画成噪声。写入 `audience-visual-contract.md` 覆盖面清单第 5 条。
- **经营分析覆盖面清单**：`audience-visual-contract.md` §2 新增——销售/经营复盘默认覆盖 总量·量价 / 结构升级 / 渠道结构 / 区域战区 / 趋势 五面，月报/半年报默认 4-5 章，勿停在下限。
- 实测报告随之升级为 4 章 (新增渠道结构分化章 + Ch1 增量价归因瀑布图)，6 图全部渲染验证；顺带修复我 harness 里量价瀑布 base 悬浮基座算错 (价柱应从"量后运行总额"浮起)。

## V2.4.1 — 2026-07 — 端到端实测修复 (截图安全)

用真实数据端到端测试（华南离线签收表 80,644 行 → Data Contract → Evidence Pack → 紧凑销售报告）跑通全流程，产出决策级报告。测试暴露并修复 1 个真实缺陷：
- **紧凑档 scroll-reveal 截图空白 bug**：`.reveal` 初始 `opacity:0`，依赖 IntersectionObserver 滚动触发。但紧凑档主场景是"整页截长图 / 打印 / 发飞书"——未滚动到的区块在整页截图时停在 `opacity:0` 出现空白段（实测首屏 hero 亦未触发）。修复：`:root[data-density="compact"] .reveal { opacity:1 !important; transform:none !important }`——紧凑档=截图优先，禁用隐藏态；叙事标准档保留 reveal 作沉浸滚动体验。已渲染验证：修复后首屏即完整显示。
- **记录一个 skill 假设边界（非 bug）**：子弹图/达成率范例假设有目标/预算字段；真实签收数据无此字段，按"数据至上"不编造目标，改用 YoY/结构/渗透叙事。建议 Data Contract 阶段显式检查"有无目标数据"，无则自动降级达成类图表。

## V2.4 — 2026-07 — 紧凑档重做为「紧凑销售报告风」

**背景**：渲染核对发现原「紧凑风」只是等比缩小（`--density:0.65` + 字号降一档 + Hero 52vh），保留了叙事风的全部沉浸骨架，结果是"缩小版的空"——Hero 仍被大留白包围、Pull Quote 漂浮在空带里、内容列窄两侧大量横向空白，不符合"信息密集 · 快速扫读"的销售报告定位。

**重做**：删除等比缩小方案，改为**版式重组**（共享全部视觉主体：品牌渐变/语义色/三角色字体/Token）。改动集中在 `templates/scroll-narrative-skeleton.html` 的 `:root[data-density="compact"]` 顶部 Token 覆盖 + 文件末尾"紧凑销售报告风"组件级重组层，不影响标准档、不动质量 Gate：
- **Hero → masthead 横幅**：CSS grid 把扁平子元素分区为「结论居左（badge+title+subtitle）+ 核心数字居右（number+label）」，`min-height:auto`，首屏即见结论+KPI+首章（不改 HTML）。
- **KPI Strip → 加密**：`flex-wrap` 左对齐、卡片收紧，一行可容 5–6 项。
- **Chapter → 内容列加宽**：`--content-width` → `--content-wide`，吃掉两侧空白；标题/导语间距收紧。
- **Pull Quote → 左线 callout**：从"居中大空带"改为 `border-left` 紧凑引用，不再漂浮占屏。
- **Data Table → 密集行**：行 padding 收到 5px（销售排名/渠道表主战场）；Insight 更密网格、图表矮一档、Closing 收紧。
- `--density` 0.65 → 0.6；排版刻度进一步下移。
- `demos/density-comparison.html` 的 `.panel-compact` 同步为新版式；SKILL/design-tokens 文档口径同步（"版式重组"而非"间距缩放"）。
- **验证**：浏览器渲染实测——紧凑档整份报告 3 屏读完（标准档需 6–7 屏），Hero masthead / 密集表格 / 左线 callout 均正常；`validate-report.mjs` 基模板全过。

**图表选型引擎 (紧凑 ≠ 简陋 补丁)**：用户反馈紧凑版内容/图表偏少、且 skill 对 agent 选图指引不足。基于《销售数据看板图表设计指南》深研文档 (Tufte 数据墨水比 / IBCS / Stephen Few 子弹图 / 图表选择引擎)，升级 `chart-selection-guide.md` 至 V2：
- **§0 Agent 选图引擎**：12 行"业务问题→意图→图表"强制路由表 (排名/达成/归因/趋势/构成/转化/停滞/明细…)，每图 5 项前置校验；禁止"数据长这样所以画这个"倒序选图。
- **§6 IBCS 语义规范**：时间=横轴、分类=水平条形 (禁斜标签)；实际实心/计划空心/预测斜纹三态编码；三段式口径副标题 (主体·度量单位·周期)；红绿只表差异。
- **§7 密度轴图表形态**：紧凑档信息预算**上调** (KPI 5-8 / Chapter 3-6 / 每章 ≤3 且密集形态算 1 个)；密集形态词汇表 (子弹阵列/Small Multiples/Sparkline 表格/热力表/表格+Δ+Badge)；降级顺序"进表格→合并→压高度"，禁止砍归因图/达成图。
- **§8 受众分层图表策略**：L1 高管 (KPI+子弹阵列+瀑布) / L2 总监 (漏斗+排名+停滞散点) / L3 一线 (密表+条件格式)；紧凑档默认 L1+L2 合并读者三层排布。
- 联动：`audience-visual-contract.md` 信息预算加密度轴修正；`anti-default-discipline.md` 律三放宽紧凑档至 ≤3 (密集形态算 1 个)；SKILL.md 步骤 8 强制"选图先过 §0 路由 + 遵守 §6 IBCS"。

**超级 KPI 卡 (Super KPI Card)**：基于《SaaS看板指标卡多维展示设计》研究，`component-patterns.md` 新增 §1.7——单卡 9 指标的零交互分区布局 (紧凑档 KPI 首选)：
- **认知四层**：主锚大数字 (Display 最大字号) → 战术偏差胶囊 (达成/同比/环比, 语义色只上胶囊) → 年累静音行 (仅文字着色, 发丝线分隔) → 双基线 Sparkline (本年实线+渐变面积 / 去年灰虚线 / 端点趋势色圆点, 无轴无网格)。
- **格式化纪律 6 条硬规则**：禁整卡染色 / 动态单位缩放 (主锚 ≤5 字符) / 畸变百分比 >±300% 只给绝对偏差 / 达成<80% 上边缘 2px 无声警报线 / 年累行禁实心背景 / 每报告 ≤4 张。
- **明确排除** (适配本 Skill 定位)：MTD/YTD toggle 切换 (违反"交付物无运行时切换"铁律, 截图只能拍一态, 改用零交互分区)；DAX/SVG BI 栈 (静态 HTML+ECharts 无此瓶颈)；Hover 渐进披露 (截图/长图/打印场景无 hover, 明细走 Data Detail)。
- 联动：SKILL.md §5 词汇表、component-patterns §0 选型矩阵、chart-selection-guide §7 密集形态表均登记。
- **验证**：出厂代码 (含模板 Token) 浏览器实渲染——四层结构/胶囊语义色/双基线趋势/告警边线全部正常。
**第三份研究吸收 (《Dashboard 设计进阶指南-Google》)**：该文档主体为交互式 BI/AI 平台能力 (语义层、对话式 AI、动态基线异常检测、一键 RCA、会话回放、角色感知重组、游戏化)——均按静态报告定位排除；提炼 5 项纯方法论落地：
- `audience-visual-contract.md` §2.1 指标甄选四原则：**伴生制衡** (新客数必配 CAC、签收额必配毛利/达成) / **无对比即无分析** / 认知上限 ≤7 / 第一性指标随业务阶段演进。
- `chart-selection-guide.md`：选图前置校验增"**对比基准**"关卡 (裸数字图=违规)；反模式表增"裸增长率无基数"与"孤立平均值"两条统计陷阱；§4 增**异常点原因标注**硬规则 (骤变必须就地注明原因, 防读者猜测与 AI 归因带偏)；§6.4 增**红坏绿好本地化防线** (不因"红涨绿跌"股市习惯翻转语义色, 业务方强要求须先提示冲突)。

- **补齐 (第二轮吸收)**：① IBCS 缩放方差条变体 (`.skpi-varbars` / `renderSkpiVarBars`)——长度=绝对差额、零心两侧红左绿右、同卡内共享缩放基准可横向比"哪个缺口的钱最大"，作为胶囊(%)的 IBCS 严谨替代 (元视角)；已渲染实测 (达成缺口−58万/同比增额+145万/环比−39万 按金额缩放正确)。② F/Z 扫描动线显式指引——把"主锚左上→偏差右→年累中→趋势底"的空间排布依据写成 Agent 排布规则表。至此该研究文档可吸收内容全部落地 (仅 toggle 切换/DAX-SVG/Hover 三项按静态定位排除，卡内子弹图变体经确认不补——可由现有子弹图组件拼)。

## V2.3.1 — 2026-07 — 校验器修正与脚本一致性

**校验脚本 (`scripts/validate-report.mjs`)**
- 密度档判定改为只读 `<html>` 开标签属性（新增 `isCompactDensity()`）。修复了默认档模板被 `/data-density="compact"/` 全文匹配命中 CSS 选择器 `:root[data-density="compact"]` 与注释，从而**误报「紧凑档已启用」**、并**误将均等网格 P1 告警降级为 P2** 而屏蔽的 bug。
- `checkChartContainers` 改为在 `.chart-container` 规则块内检测真实 `height/min-height`（原先只要全文任意位置出现 `height:` 即通过，形同虚设）。
- `checkTabularNums` 改为检测完整属性 `font-variant-numeric: tabular-nums`（原先匹配子串即通过）。
- 移除未接线的死代码 `FORBIDDEN_INLINE_COLORS`，及 `checkTabularNums` 内从不影响输出的 `numericClasses`/`missingClasses`。
- 均等网格 anti-default 正则收窄至 `repeat([2-8],1fr)`，放过 Bento 合法的 12 列基座。
- 间距纪律仅对 >12px 布局级间距强制 8pt 网格，放过边框/描边等 ≤12px 小值以降噪。
- Emoji 正则补齐区域旗 `1F1E6–1F1FF`、变体选择符 `FE0F`、keycap `20E3`、杂项符号 `2B00–2BFF`。

**辅助脚本**
- `scripts/presentation-mode.js`：清除注入 DOM 的 emoji（书签/全屏/关闭/场记板等 emoji → 文字标签），符合零 Emoji 铁律。
- `scripts/echarts-corporate-themes.js`：`corporate-blue` 色板前 6 系列对齐 `design-tokens.md §3.6` 的 `--chart-1..6`（原用 `#3B82F6…` 与注释、Token 均不符）；移除注释里字面的闭合 `script` 标签——它在内联进单文件报告时会提前截断脚本、导致主题不注册（渲染 harness 实测暴露）。

**运行时渲染核对**：搭最小 HTML harness（`scratchpad/harness/`，从 md 出厂抽取真实代码 + ECharts 5.5.1 + corporate-blue 主题），逐一渲染 6 个图表组件截图核对。结论：Waterfall / Bullet / Progress / Small Multiples / Lollipop / Slope 全部正常渲染，零控制台错误；Slope 图的 `label.position` 回调经实测 ECharts 5.5.1 支持（此前静态审阅的疑虑排除）。

**文档 (`SKILL.md`)**
- 修正 frontmatter description 截断（补全触发词与负向边界，标注 V2.3）。
- 步骤 0 表格文件名 `scroll-narrative.html` → `scroll-narrative-skeleton.html`。
- Token 数声明 104 → 125；Quality Gate 声明「40+」→「48」。
- 紧凑风切换补 `sed` 一行命令；补辅助脚本接线示例与 `presentation-mode.js` 布局兼容性警告。

## V2.3 — 2026-07 — 密度轴 (Apple §15 集成延伸)

新增「紧凑风」档位，与默认「叙事标准风」二选一（对话阶段选定即烘焙进 HTML）。所有 `--space-*` 改为 `calc(Npx * var(--density))`，紧凑档 `<html data-density="compact">` 仅以 `--density:0.65` 一处覆盖即整体收紧 35%，并下移排版刻度（标题缩小、行高收紧、Hero 高度压缩）。两种档位共用 Token 与全部质量 Gate，仅密度不同。详见 `references/design-tokens.md` §2.6 与 `demos/density-comparison.html` 实时预览。

## V2.2 — 2026-07 — 材质 + 无障碍 (Apple §12 / §14 集成)

提供 `.glass-surface` / `.glass-surface--dark` / `.glass-surface--edge-fade` 复用类（毛玻璃承载浮动层，内容滚动其下）；sticky 表头改为浮动玻璃材质 + 边缘渐隐遮罩。无障碍响应三信号 —— `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast` —— 已固化进三套模板。`validate-report.mjs` 增 P1 纪律锁（禁硬编码 letter-spacing、毛玻璃与动效须有降级）。详见 `references/design-tokens.md` §4.5 / §10 与 `references/motion-recipes.md` §8。

## V2.1 — 2026-07 — 排版 Token 集成 Apple §15

Tracking 尺寸专属（大字越负、微标越正）、Leading 与字号反向、层级由 weight+size+leading 共构、全局 `font-optical-sizing: auto` 尊重 Dynamic Type。新增 Token：`--leading-display` / `--tracking-display` / `--tracking-caption`；`--leading-tight` 由 1.15 收紧至 1.1。详见 `references/design-tokens.md` §2.3 / §2.5。

## V2.0 — 2026-06 — 系统级升级

三角色字体 / 色彩三层架构 / 动效 Recipe / Anti-Default 纪律 / 自动化校验。

## V1.5 — 2026-04

增加 Visual Contract + McKinsey Quality Gate。

## V1.0 — 2026-03 — 初版

Scroll Narrative 骨架 + 8 组件 + PAC 叙事。
