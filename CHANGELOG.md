# CHANGELOG — South China Report Style

> 详细变更叙述。`SKILL.md` §11 只保留一句话摘要表，细节全部下沉到这里。

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
