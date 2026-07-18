# Component Patterns V2 — 统一组件手册

> **版本**: V2.0 | 合并原 `analysis-component-patterns.md` + `kpi-display-patterns.md` + V2 新增组件
> **原则**: 所有 CSS 必须使用 `references/design-tokens.md` 定义的 Token，禁止硬编码色值/字号
> **字体纪律**: Display → 大数字/标题 | Editorial → 文案/标签 | Data → 表格数字/标注

---

## §0 快速选型矩阵

### 按分析维度选组件

| 维度 | 组件 | 适用场景 |
|:---|:---|:---|
| **趋势** | 面积图 + 关键标注 | 月度走势、同比对比 |
| **排名** | 水平赛马条形图 | 战区/产品/渠道 TOP-N |
| **目标** | 子弹图 Bullet Chart | 达成率追踪、KPI 考核 |
| **归因** | 瀑布图 Waterfall | 增长贡献拆解、差异分析 |
| **结构** | 100%堆叠条形 / Treemap | 渠道占比、产品结构 (环形图默认禁用) |
| **对比** | 蝴蝶图 Butterfly | 今年vs去年、A区vsB区 |
| **明细** | McKinsey 高密度表 | 全量数据展示 |
| **摘要** | 暗色总结卡 | 报告收尾、关键发现 |

### 按 KPI 场景选风格

| 风格 | 适用场景 | 视觉调性 |
|:---|:---|:---|
| **A. McKinsey 记分卡** | 正式汇报/董事会 | 极简/严肃 |
| **B. Bloomberg 终端** | 数据驱动/实时监控 | 科技/专业 |
| **C. SaaS 仪表盘** | 内部管理/日常运营 | 清新/友好 |
| **D. Executive 横幅** | 高层汇报/年度总结 | 大气/高端 |
| **E. Glassmorphism** | 品牌活动/产品发布 | 时尚/潮流 |
| **F. Gauge 环形仪表** | validator 默认禁用, 达成追踪改用超级 KPI 卡(G)/子弹图 | 数据大屏(不推荐) |
| **G. 超级 KPI 卡 (§1.7)** | 紧凑销售报告档首选: 单卡 9 指标, 零交互 | 高密度/专业冷峻 |

### V2 新增组件

| 组件 | 适用场景 |
|:---|:---|
| **Super KPI Card (§1.7)** | 单卡 9 指标: 主锚+战术胶囊+年累静音行+双基线趋势 (紧凑档 KPI 首选) |
| **增长/下滑双榜 (§1.8)** | 型号/客户/门店级 Top-N 涨跌并排 ("谁在涨谁在崩"), 按绝对增减额排 |
| **章节锚点导航 (§1.9)** | ≥4 章长报告顶部 sticky 跳章导航 |
| **Heat Table** | 多维度交叉热力 (战区×月/渠道×产品), 一张抵 12 张对比柱 |
| **Rank Bar** | 带归因标签的排名展示 |
| **Progress Section** | 多目标并行进度追踪 |
| **Comparison Block** | Before/After 对比 |
| **Metric Highlight** | 单指标沉浸区域 |
| **Audit Strip** | 数据来源/口径/审计状态条 |

---

## §1 V2 新增组件

### 1.1 Heat Table (热力图表格)

**适用**: 战区×月度、渠道×产品等多维度交叉分析

```css
.heat-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--text-sm); }
.heat-table th {
    background: var(--brand-deep); color: var(--text-inverse);
    padding: var(--space-2) var(--space-3); font-family: var(--font-editorial);
    font-weight: 600; font-size: var(--text-xs); text-transform: uppercase;
    letter-spacing: var(--tracking-wide); position: sticky; top: 0; z-index: 2;
}
.heat-table th:first-child { border-radius: var(--radius-sm) 0 0 0; }
.heat-table th:last-child { border-radius: 0 var(--radius-sm) 0 0; }
.heat-table td {
    padding: var(--space-2) var(--space-3); text-align: center;
    font-family: var(--font-data); font-variant-numeric: tabular-nums;
    font-weight: 500; border-bottom: 1px solid var(--border-subtle);
    transition: background var(--duration-fast) var(--ease-productive);
}
.heat-table td.row-label {
    font-family: var(--font-editorial); font-weight: 600;
    text-align: left; background: var(--surface-secondary);
}
/* 热力色阶 (5 级) */
.heat-table td[data-heat="5"] { background: var(--semantic-growth); color: #fff; font-weight: 700; }
.heat-table td[data-heat="4"] { background: var(--semantic-growth-bg); color: var(--semantic-growth); }
.heat-table td[data-heat="3"] { background: var(--surface-tertiary); color: var(--text-primary); }
.heat-table td[data-heat="2"] { background: var(--semantic-risk-bg); color: var(--semantic-risk); }
.heat-table td[data-heat="1"] { background: var(--semantic-risk); color: #fff; font-weight: 700; }
```

```javascript
// 热力色阶自动计算
function applyHeatMap(tableId, options) {
    var table = document.getElementById(tableId);
    var cells = table.querySelectorAll('td:not(.row-label)');
    var values = Array.from(cells).map(function(c) { return parseFloat(c.textContent) || 0; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var range = max - min || 1;

    cells.forEach(function(cell) {
        var val = parseFloat(cell.textContent) || 0;
        var normalized = (val - min) / range;
        var heat = normalized >= 0.8 ? 5 : normalized >= 0.6 ? 4 : normalized >= 0.4 ? 3 : normalized >= 0.2 ? 2 : 1;
        if (options && options.invert) heat = 6 - heat; // 越低越好 (如库存)
        cell.setAttribute('data-heat', heat);
    });
}
```

### 1.2 Rank Bar (带归因排名条)

**适用**: 战区排名、产品排名，附带归因标签解释 TOP1 为什么是 TOP1

```css
.rank-section { max-width: var(--content-width); }
.rank-item {
    display: grid; grid-template-columns: 40px 80px 1fr 80px 60px;
    align-items: center; gap: var(--space-3);
    padding: var(--space-3) 0; border-bottom: 1px solid var(--border-subtle);
}
.rank-item:last-child { border-bottom: none; }
.rank-badge {
    width: 32px; height: 32px; border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display); font-weight: 800; font-size: var(--text-sm); color: #fff;
}
.rank-badge.gold   { background: linear-gradient(135deg, #f59e0b, #d97706); }
.rank-badge.silver { background: linear-gradient(135deg, #94a3b8, #64748b); }
.rank-badge.bronze { background: linear-gradient(135deg, #d97706, #b45309); }
.rank-badge.normal { background: var(--surface-tertiary); color: var(--text-secondary); }
.rank-name { font-family: var(--font-editorial); font-weight: 600; font-size: var(--text-sm); }
.rank-bar-track { height: 24px; background: var(--surface-tertiary); border-radius: var(--radius-sm); overflow: hidden; }
.rank-bar-fill {
    height: 100%; border-radius: var(--radius-sm);
    display: flex; align-items: center; justify-content: flex-end; padding-right: var(--space-2);
    font-family: var(--font-data); font-size: var(--text-xs); font-weight: 600; color: #fff;
    transition: width var(--duration-dramatic) var(--ease-expressive);
}
.rank-value { font-family: var(--font-data); font-weight: 700; font-size: var(--text-sm); text-align: right; font-variant-numeric: tabular-nums; }
.rank-change { font-family: var(--font-data); font-size: var(--text-xs); font-weight: 600; text-align: right; }
.rank-change.up { color: var(--semantic-growth); }
.rank-change.down { color: var(--semantic-risk); }
/* 归因标签 */
.rank-reason {
    grid-column: 3 / -1; padding: var(--space-1) 0 var(--space-2);
    font-family: var(--font-editorial); font-size: var(--text-xs);
    color: var(--text-secondary); font-style: italic;
}
```

### 1.3 Progress Section (目标进度)

**适用**: 年度目标追踪、多维度 KPI 达成

```css
.progress-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-4); }
.progress-card {
    background: var(--surface-primary); border: 1px solid var(--border-default);
    border-radius: var(--radius); padding: var(--space-5);
    transition: box-shadow var(--duration-fast) var(--ease-productive);
}
.progress-card:hover { box-shadow: var(--shadow-md); }
.progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-3); }
.progress-label { font-family: var(--font-editorial); font-size: var(--text-sm); font-weight: 600; color: var(--text-primary); }
.progress-pct { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 800; }
.progress-track { height: 8px; background: var(--surface-tertiary); border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; transition: width var(--duration-dramatic) var(--ease-expressive); }
.progress-footer { display: flex; justify-content: space-between; margin-top: var(--space-2); }
.progress-foot-item { font-family: var(--font-data); font-size: var(--text-xs); color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
```

```javascript
// 进度条颜色自动判定
function progressColor(pct) {
    if (pct >= 100) return 'var(--semantic-growth)';
    if (pct >= 80)  return 'var(--brand-mid)';
    if (pct >= 60)  return 'var(--semantic-warning)';
    return 'var(--semantic-risk)';
}
```

### 1.4 Comparison Block (对比块)

**适用**: Before/After、去年/今年，配合动效 Recipe `comparison`

```css
.comparison {
    display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-6);
    max-width: var(--content-wide);
}
.comparison-side {
    background: var(--surface-secondary); border-radius: var(--radius);
    padding: var(--space-6); border: 1px solid var(--border-default);
}
.comparison-side.before { border-left: 4px solid var(--text-tertiary); }
.comparison-side.after { border-left: 4px solid var(--brand-accent); }
.comparison-label {
    font-family: var(--font-editorial); font-size: var(--text-xs);
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-tertiary); margin-bottom: var(--space-3);
}
.comparison-value {
    font-family: var(--font-display); font-size: var(--text-3xl);
    font-weight: 800; color: var(--text-primary); margin-bottom: var(--space-2);
    font-variant-numeric: tabular-nums;
}
.comparison-desc { font-family: var(--font-editorial); font-size: var(--text-sm); color: var(--text-secondary); line-height: 1.6; }
.comparison-delta {
    grid-column: 1 / -1; text-align: center; padding: var(--space-3);
    font-family: var(--font-display); font-size: var(--text-xl); font-weight: 700;
}
@media (max-width: 768px) { .comparison { grid-template-columns: 1fr; } }
```

### 1.5 Metric Highlight (单指标沉浸)

**适用**: 强调一个核心指标 + 归因说明，全宽区域

```css
.metric-highlight {
    background: var(--surface-secondary); border-radius: var(--radius-lg);
    padding: var(--space-12) var(--space-8);
    display: grid; grid-template-columns: 1fr 1.5fr; gap: var(--space-8);
    align-items: center; max-width: var(--content-wide);
}
.metric-highlight-number {
    text-align: right;
}
.metric-highlight-value {
    font-family: var(--font-display); font-size: var(--text-5xl);
    font-weight: 800; letter-spacing: -0.03em;
    background: linear-gradient(135deg, var(--brand-deep), var(--brand-accent));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    background-clip: text;
}
.metric-highlight-unit {
    font-family: var(--font-editorial); font-size: var(--text-lg);
    color: var(--text-tertiary); margin-top: var(--space-1);
}
.metric-highlight-body { }
.metric-highlight-title {
    font-family: var(--font-editorial); font-size: var(--text-xl);
    font-weight: 700; color: var(--text-primary); margin-bottom: var(--space-3);
}
.metric-highlight-text {
    font-family: var(--font-editorial); font-size: var(--text-base);
    color: var(--text-secondary); line-height: 1.8;
}
@media (max-width: 768px) {
    .metric-highlight { grid-template-columns: 1fr; text-align: center; }
    .metric-highlight-number { text-align: center; }
}
```

### 1.6 Audit Strip (审计状态条)

**适用**: 报告底部或顶部，标注数据来源/口径/审计状态

```css
.audit-strip {
    display: flex; align-items: center; gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    background: var(--surface-tertiary); border-radius: var(--radius-sm);
    font-family: var(--font-data); font-size: var(--text-xs);
    color: var(--text-tertiary);
}
.audit-strip-item { display: flex; align-items: center; gap: var(--space-1); }
.audit-strip-dot {
    width: 6px; height: 6px; border-radius: 50%;
}
.audit-strip-dot.pass { background: var(--semantic-growth); }
.audit-strip-dot.warn { background: var(--semantic-warning); }
.audit-strip-dot.fail { background: var(--semantic-risk); }
.audit-strip-sep { width: 1px; height: 12px; background: var(--border-default); }
```

```html
<div class="audit-strip">
    <div class="audit-strip-item">
        <span class="audit-strip-dot pass"></span>
        <span>数据源: DuckDB 本地库</span>
    </div>
    <div class="audit-strip-sep"></div>
    <div class="audit-strip-item">
        <span class="audit-strip-dot pass"></span>
        <span>口径: 含税签收额</span>
    </div>
    <div class="audit-strip-sep"></div>
    <div class="audit-strip-item">
        <span class="audit-strip-dot pass"></span>
        <span>审计: 图表=表格=文案 一致</span>
    </div>
</div>
```

---

### 1.7 超级 KPI 卡 (Super KPI Card) — V2.4 新增

> **场景**: 紧凑销售报告档的 KPI 首选形态。单卡承载最多 9 项指标 (本月值/达成/同比/环比 + 年累值/达成/同比 + 本年趋势/同期对比)，把"当前坐标+偏航程度+行驶轨迹"压进一张卡。
> **来源**: SaaS 高密度 KPI 卡研究 — 零交互分区布局 (Split-Pane)。**不做 MTD/YTD toggle 切换** (违反本 Skill "交付物无运行时切换"铁律，且截图/长图只能拍到一态)。

#### 认知四层结构 (尺寸定阅读顺序, 颜色定注意力)

| 层 | 指标 | 视觉权重 | 实现 |
|:---|:---|:---|:---|
| **主锚** (Primary Anchor) | 本月收入 | 最高: 最大字号 Display 字体 | `.skpi-value` |
| **战术偏差** (Tactical Variance) | 本月达成/同比/环比 | 高: 语义色胶囊 + ▲▼ | `.skpi-pill` |
| **战略背景** (Strategic Context) | 年累收入/达成/同比 | 中: 静音行内, 字号≈主锚 40% | `.skpi-ytd` |
| **轨迹** (Dynamic Trajectory) | 本年趋势 vs 去年同期 | 底: 无轴双基线 Sparkline | `.skpi-trend` |

#### 空间编排 (F/Z 扫描动线 — Agent 排布依据)

> 位置不是随意的, 而是按人眼 F/Z 型扫描路径锚定。Agent 布局超级卡时必须遵守此顺序, 不得打乱:

| 屏幕位置 | 放什么 | 为什么 |
|:---|:---|:---|
| **左上** (视觉制高点) | 卡名 + 主锚绝对值 | 左上角获得压倒性注意力, 无条件留给"是什么+当前值" |
| **主锚右侧** | 战术偏差 (达成/同比/环比) | 视线自然右移, 紧邻主值放"判决" (红绿+▲▼), 毫秒级读好坏 |
| **中部** | 年累静音行 | 次级战略视野, 静音处理避免与顶部战术指标抢注意力 |
| **底部** | 双基线趋势 Sparkline | 视线下移后横向扫描意愿降低, 底部只需余光感知"轨迹形态", 故去坐标轴、传形不传值 |

阅读证据链: 眼睛先落在**巨大绝对数字** → 再看**红绿偏差(判决)** → 最后**背景趋势(长期视角)**。尺寸定阅读顺序, 颜色定注意力流向。

```css
/* === Super KPI Card — 发丝边框, 无色条, 语义色只上胶囊 === */
.skpi {
    background: var(--surface-primary);
    border: 1px solid var(--border-default);
    border-radius: var(--radius);
    padding: var(--space-5) var(--space-6) var(--space-3);
    min-width: 320px;
}
.skpi-header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: var(--space-2);
}
.skpi-title {
    font-size: var(--text-sm); font-weight: var(--fw-semibold);
    color: var(--text-secondary);
}
.skpi-period {
    font-family: var(--font-data); font-size: var(--text-xs);
    color: var(--text-tertiary); letter-spacing: var(--tracking-caption);
}
/* 主锚 + 战术偏差胶囊 同行 */
.skpi-hero { display: flex; align-items: flex-end; gap: var(--space-5); flex-wrap: wrap; }
.skpi-value {
    font-family: var(--font-display);
    font-size: var(--text-4xl); font-weight: var(--fw-extrabold);
    color: var(--text-primary); line-height: 1;
    font-variant-numeric: tabular-nums; letter-spacing: var(--tracking-tight);
}
.skpi-pills { display: flex; gap: var(--space-2); padding-bottom: 2px; }
.skpi-pill {
    display: inline-flex; align-items: center; gap: 3px;
    font-family: var(--font-data); font-size: var(--text-xs); font-weight: 600;
    padding: 3px 8px; border-radius: var(--radius-full);
    font-variant-numeric: tabular-nums;
}
.skpi-pill .pill-label { font-family: var(--font-editorial); font-weight: 500; opacity: 0.75; }
.skpi-pill.up   { background: var(--semantic-growth-bg); color: var(--semantic-growth-text); }
.skpi-pill.down { background: var(--semantic-risk-bg);   color: var(--semantic-risk-text); }
.skpi-pill.flat { background: var(--semantic-neutral-bg); color: var(--semantic-neutral-text); }
/* 战略背景行: 静音, 发丝线分隔, 禁止实心红绿底 */
.skpi-ytd {
    display: flex; gap: var(--space-5); flex-wrap: wrap;
    margin-top: var(--space-4); padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
    font-size: var(--text-sm); color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
}
.skpi-ytd b { font-family: var(--font-data); font-weight: 600; color: var(--text-primary); }
.skpi-ytd .delta-up   { color: var(--semantic-growth); }   /* 仅文字着色, 不用背景 */
.skpi-ytd .delta-down { color: var(--semantic-risk); }
/* 轨迹区: 无轴双基线 */
.skpi-trend { height: 56px; margin-top: var(--space-3); }
.skpi-trend-legend {
    display: flex; gap: var(--space-4);
    font-size: 10px; color: var(--text-tertiary); margin-top: 2px;
}
/* 无声警报: 达成 < 80% 时上边缘 2px 警戒线 (JS 按阈值加 .skpi--alert) */
.skpi--alert { border-top: 2px solid var(--semantic-risk); }
```

```html
<div class="skpi">
    <div class="skpi-header">
        <span class="skpi-title">签收金额</span>
        <span class="skpi-period">2026-02 · 截至 02-27</span>
    </div>
    <div class="skpi-hero">
        <div class="skpi-value">1,817<span style="font-size:0.5em">万</span></div>
        <div class="skpi-pills">
            <span class="skpi-pill up"><span class="pill-label">达成</span>96.8%</span>
            <span class="skpi-pill up"><span class="pill-label">同比</span>&#9650;8.7%</span>
            <span class="skpi-pill down"><span class="pill-label">环比</span>&#9660;2.1%</span>
        </div>
    </div>
    <div class="skpi-ytd">
        <span>年累 <b>4,236万</b></span>
        <span>年累达成 <b>93.5%</b></span>
        <span>年累同比 <b class="delta-up">+6.7%</b></span>
    </div>
    <div class="skpi-trend" id="skpi-trend-revenue"></div>
    <div class="skpi-trend-legend">
        <span>— 本年逐月</span><span style="opacity:.6">--- 去年同期</span>
    </div>
</div>
```

```javascript
// 双基线 Sparkline: 本年实线+渐变面积, 去年同期灰虚线, 端点趋势色圆点
// Sparkline 纪律: 无轴/无网格/无图例, 平滑, 传"轨迹感"不传精确值
function renderSkpiTrend(domId, current, previous) {
    var chart = echarts.init(document.getElementById(domId), 'corporate-blue');
    var last = current[current.length - 1], prev = current[current.length - 2];
    var trendColor = last >= prev ? cssVar('--semantic-growth') : cssVar('--semantic-risk');
    chart.setOption({
        animation: false,
        grid: { top: 4, left: 2, right: 6, bottom: 2 },
        xAxis: { type: 'category', show: false, boundaryGap: false,
                 data: current.map(function(_, i) { return i + 1; }) },
        yAxis: { type: 'value', show: false },
        series: [
            { type: 'line', data: previous, z: 1, silent: true,
              smooth: true, symbol: 'none',
              lineStyle: { width: 1.5, type: 'dashed', color: cssVar('--border-emphasis') } },
            { type: 'line', data: current, z: 2,
              smooth: true, symbol: 'none',
              lineStyle: { width: 2, color: cssVar('--brand-mid') },
              areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[
                  { offset: 0, color: 'rgba(3,83,164,0.12)' },
                  { offset: 1, color: 'rgba(3,83,164,0.01)' }]) },
              markPoint: { silent: true, symbol: 'circle', symbolSize: 6,
                  itemStyle: { color: trendColor, borderColor: '#fff', borderWidth: 1.5 },
                  data: [{ coord: [current.length - 1, last] }] } }
        ]
    });
    return chart;
}
// 用法: renderSkpiTrend('skpi-trend-revenue', [820,760,910,1020,980,1120], [780,720,850,940,890,1010]);
```

#### 格式化纪律 (硬规则)

1. **语义色只上胶囊/文字, 禁止整卡染色** — 某指标恶化时卡片背景不变红, 否则次级信息全被淹没、警示失敏。
2. **动态单位缩放** — 主锚数字 ≤5 个字符: `18,171,234` → `1,817万`; 亿级用 `1.42亿`。
3. **畸变百分比阈值** — 环比/同比 >±300% (小基数畸变) 时: 只显示绝对偏差金额, 或标注"低基数"; 禁止让一个 +500% 撑爆视觉。
4. **无声警报** — 达成率 <80% 时加 `.skpi--alert` (上边缘 2px 红线), 不用大面积色块喊叫。
5. **年累行禁用实心背景** — 战略背景层的红绿只允许文字着色 (`.delta-up/.delta-down`), 保持"静音"。
6. **每份报告 ≤4 张超级卡** — 超级卡本身是密集形态, 一行 2-4 张; 更多指标降级为普通 KPI Strip 或表格。

#### 变体: 缩放方差条 (IBCS Scaled Bar / Pin Chart)

> **场景**: 胶囊只给百分比 (差了百分之几), 但管理层往往更关心**差了多少钱**。IBCS 建议用一条**长度=绝对差额**的方差条同时表达绝对+相对方差——条越长, 缺口的"钱"越大, 不读数字光看条长就能横向比较哪个维度亏/盈最重。
> **用法**: 作为战术偏差区的 IBCS 严谨替代 (替代或补充胶囊)。当"金额缺口对比"比"百分比"更重要时优先用。同一卡内多条共享一个缩放基准 (最长条=最大缺口)。

```css
/* 零心方差条: 左=红(落后/负), 右=绿(领先/正), 长度按金额缩放, 跨行可比 */
.skpi-varbars {
    display: grid; grid-template-columns: auto 1fr auto;
    gap: var(--space-1) var(--space-3); align-items: center;
    margin-top: var(--space-3); padding-top: var(--space-3);
    border-top: 1px solid var(--border-subtle);
}
.skpi-varbars .vb-label { font-size: var(--text-xs); color: var(--text-secondary); white-space: nowrap; }
.skpi-varbar {
    position: relative; height: 10px;
    background: var(--surface-tertiary); border-radius: 2px;
}
.skpi-varbar::before {                       /* 零线 */
    content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px;
    width: 1px; background: var(--border-emphasis);
}
.skpi-varbar-fill { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; }
.skpi-varbar-fill.pos { background: var(--semantic-growth); }
.skpi-varbar-fill.neg { background: var(--semantic-risk); }
.skpi-varbars .vb-value {
    font-family: var(--font-data); font-size: var(--text-xs); font-weight: 600;
    font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap;
}
.skpi-varbars .vb-value.pos { color: var(--semantic-growth); }
.skpi-varbars .vb-value.neg { color: var(--semantic-risk); }
```

```html
<!-- 放在 .skpi 内, 替代或补充 .skpi-pills -->
<div class="skpi-varbars" id="skpi-var-revenue"></div>
```

```javascript
// 缩放方差条: 长度=绝对差额(同卡内共享基准, 跨行可比), 方向=正负色, 数字=具体金额
// items: [{label, value(元)}], value>=0 领先/正(绿右), <0 落后/负(红左)
function fmtMoney(v) {                        // 规范见 number-formatting.md
    var a = Math.abs(v);
    if (a >= 1e8) return (v/1e8).toFixed(2) + '亿';
    if (a >= 1e4) return Math.round(v/1e4) + '万';
    return Math.round(v).toLocaleString();
}
function renderSkpiVarBars(domId, items, opts) {
    opts = opts || {};
    var scale = opts.max || Math.max.apply(null, items.map(function(d){ return Math.abs(d.value); })) || 1;
    document.getElementById(domId).innerHTML = items.map(function(d) {
        var w = Math.min(50, Math.abs(d.value) / scale * 50);   // 零心两侧各占 50%
        var pos = d.value >= 0;
        var side = pos ? 'left:50%;width:' + w + '%' : 'right:50%;width:' + w + '%';
        var cls = pos ? 'pos' : 'neg';
        return '<span class="vb-label">' + d.label + '</span>'
             + '<span class="skpi-varbar"><span class="skpi-varbar-fill ' + cls + '" style="' + side + '"></span></span>'
             + '<span class="vb-value ' + cls + '">' + (pos ? '+' : '−') + fmtMoney(Math.abs(d.value)) + '</span>';
    }).join('');
}
// 用法: renderSkpiVarBars('skpi-var-revenue', [
//   { label: '达成缺口', value: -580000 },   // 距目标差 58 万 → 最长红条
//   { label: '同比增额', value: 1450000 },   // 比去年多 145 万 → 绿条
//   { label: '环比变动', value: -390000 }    // 比上月少 39 万 → 红条
// ]);
```

> **纪律**: 方差条只表达"实际 − 基准"的**差额** (达成缺口/同比增额/环比变动), 不表达绝对规模; 零线两侧对称, 禁止非零基线。与胶囊二选一为主 (都要则胶囊给%、方差条给元, 但一张卡别超过一组), 避免过载。

---

### 1.8 增长/下滑双榜 (Gainers / Losers Dual Ranking) — V2.5 新增

> **场景**: 销售报告刚需——"谁在涨、谁在崩"并排一屏看清。下钻到型号/客户/门店/品类级，两张榜并列。
> **排序纪律**: **按绝对增减额排 (Δ金额)**，不按增长率——避免小基数 "+500%" 噪声 (呼应 `chart-selection-guide.md` 反模式表)。增长率作为副列 Badge。
> **来源**: 参照业界 B2B 渠道分析报告的 Top-N 双榜实践。

```html
<!-- 左右并排 (紧凑档内容列已够宽); 用 editorial grid 或 flex 两列 -->
<div class="editorial">
  <div><table class="data-table">
    <thead>
      <tr><th colspan="4" style="background:var(--semantic-growth)">增量榜 TOP5</th></tr>
      <tr><th></th><th>型号</th><th class="num">本期金额</th><th class="num">增额</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>KFR-35GW/JD21+B1</td><td class="num">7,798万</td>
          <td class="num"><span class="badge badge-g">+6,189万</span></td></tr>
      <!-- ...更多行 -->
    </tbody>
  </table></div>
  <div><table class="data-table">
    <thead>
      <tr><th colspan="4" style="background:var(--semantic-risk)">减量榜 TOP5</th></tr>
      <tr><th></th><th>型号</th><th class="num">本期金额</th><th class="num">减额</th></tr>
    </thead>
    <tbody>
      <tr><td>1</td><td>KF-26GW/XT21+5</td><td class="num">2.12亿</td>
          <td class="num"><span class="badge badge-r">−3,102万</span></td></tr>
    </tbody>
  </table></div>
</div>
```

> **纪律**: ① 两榜同粒度 (都到型号 or 都到客户)，别混。② 基数门槛过滤 (如上期 <100万 的不进榜)，防小基数噪声。③ 上方仍要 Action Title 结论 (如"变频领涨、定频退场")，不做无叙事的裸榜——这是本 Skill 区别于纯看板的底线。

### 1.9 章节锚点导航 (Section Anchor Nav) — V2.5 新增

> **场景**: 章节较多 (≥4) 的长密报告，顶部加一行 sticky 锚点导航，点击跳章。**仅用于滚动阅读的 HTML 版**；截长图/打印时它只是一行链接，无害。给每个 `.chapter` 加 `id`。

```html
<nav style="position:sticky;top:0;z-index:900;display:flex;background:var(--surface-primary);
     border-bottom:1px solid var(--border-default);padding:0 var(--space-8);overflow-x:auto">
  <a href="#c1" style="padding:12px 18px;font-size:13px;font-weight:600;color:var(--text-secondary);
     text-decoration:none;white-space:nowrap;border-bottom:2px solid transparent">量价</a>
  <!-- ...每章一个 -->
</nav>
<section class="chapter" id="c1">...</section>
```

> **纪律**: 锚点文字用**短标签** (量价/结构/渠道/客户/战区)，不是完整 Action Title。≤6 项；再多说明章节该合并。

---

## §2 V1 组件索引 (已合并至此文件)

以下组件的完整 CSS/JS 代码已合并至 §1 对应组件中，原独立文件已移除。此处保留索引以便查找 V2 Token 对齐建议。

### 分析组件 (原 `analysis-component-patterns.md`，已移除)

| # | 组件 | V2 Token 对齐建议 |
|:---|:---|:---|
| 1 | 面积图 + 关键标注 | `axisLabel.color` → `var(--text-tertiary)` |
| 2 | 水平赛马条形图 | `.rank-pos` 用 `var(--font-display)` |
| 3 | 子弹图 Bullet Chart | 填充色使用 `var(--semantic-growth/risk)` |
| 4 | 瀑布图 Waterfall | 正增量 `var(--semantic-growth)`, 负增量 `var(--semantic-risk)` |
| 5 | Treemap (环形图默认禁用) | 系列色使用 `--chart-1` 到 `--chart-6` |
| 6 | 蝴蝶图 Butterfly | 旧数据 `var(--border-default)`, 新数据 `var(--brand-mid)` |
| 7 | McKinsey 高密度表 | `.num` 用 `var(--font-data)` |
| 8 | 暗色总结卡 | 数字用 `var(--font-display)`, 标签用 `var(--font-editorial)` |

### KPI 展示 (原 `kpi-display-patterns.md`，已移除)

| 风格 | V2 Token 对齐建议 |
|:---|:---|
| A. McKinsey 记分卡 | `.mckinsey-val` → `var(--font-display)`, `.mckinsey-label` → `var(--font-editorial)` |
| B. Bloomberg 终端 | 已使用 JetBrains Mono → 改引用 `var(--font-data)` |
| C. SaaS 仪表盘 | `.saas-val` → `var(--font-display)` |
| D. Executive 横幅 | `.exec-cell-val` → `var(--font-display)`, badge 用 `var(--semantic-*-dark)` |
| E. Glassmorphism | `.glass-val` → `var(--font-display)` |
| F. Gauge 环形仪表 (默认禁用) | `.gauge-center-val` → `var(--font-display)` |

---

## §3 Badge 统一系统 (V2)

```css
/* === V2 统一 Badge 系统 === */
.badge {
    display: inline-flex; align-items: center; gap: var(--space-1);
    padding: 2px var(--space-2); border-radius: var(--radius-full);
    font-family: var(--font-editorial); font-size: 10px; font-weight: 700;
    line-height: 1.4;
}
/* 语义变体 */
.badge-growth, .badge-g   { background: var(--semantic-growth-bg); color: var(--semantic-growth); }
.badge-risk, .badge-r     { background: var(--semantic-risk-bg); color: var(--semantic-risk); }
.badge-opportunity, .badge-b { background: var(--semantic-opportunity-bg); color: var(--semantic-opportunity); }
.badge-warning            { background: var(--semantic-warning-bg); color: var(--semantic-warning); }
.badge-neutral            { background: var(--semantic-neutral-bg); color: var(--semantic-neutral); }
/* 品牌变体 */
.badge-brand   { background: var(--brand-faint); color: var(--brand-mid); }
/* 暗底变体 (Hero/Closing 内使用) */
.badge-dark-growth { background: rgba(52,211,153,0.15); color: var(--semantic-growth-dark); }
.badge-dark-risk   { background: rgba(251,113,133,0.15); color: var(--semantic-risk-dark); }
.badge-dark-info   { background: rgba(96,165,250,0.15); color: var(--semantic-opportunity-dark); }
.badge-dark-action { background: rgba(251,191,36,0.15); color: var(--semantic-warning-dark); }
```

---

## §4 工具函数 (V2 统一)

### Sparkline SVG 生成

```javascript
function sparkSvg(data, color) {
    var w = 60, h = 18;
    var max = Math.max.apply(null, data), min = Math.min.apply(null, data);
    var rng = max - min || 1, step = w / (data.length - 1);
    var pts = data.map(function(v, i) {
        return (i * step).toFixed(1) + ',' + (h - ((v - min) / rng) * (h - 4) - 2).toFixed(1);
    });
    var last = pts[pts.length - 1].split(',');
    return '<svg width="' + w + '" height="' + h + '">' +
           '<path d="M' + pts.join('L') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round"/>' +
           '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2" fill="' + color + '"/>' +
           '</svg>';
}
```

### 达成标签自动着色

```javascript
function achieveBadge(pct) {
    if (pct >= 100) return '<span class="badge badge-growth">' + pct + '%</span>';
    if (pct >= 90)  return '<span class="badge badge-brand">' + pct + '%</span>';
    return '<span class="badge badge-risk">' + pct + '%</span>';
}
```

### CSS Token 读取 (ECharts 用)

```javascript
function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
```

### 场景自动推荐 KPI 风格

```javascript
function recommendKpiStyle(context) {
    var map = {
        'board':     'mckinsey',
        'executive': 'exec-banner',
        'monitor':   'bloomberg',
        'internal':  'saas',
        'brand':     'glass',
        'target':    'super-kpi'   // 达成追踪首选超级 KPI 卡(§1.7); Gauge 环形仪表被 validator 默认禁用
    };
    return map[context] || 'saas';
}
```

---

## §5 字体依赖 (V2 统一)

```html
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 图标依赖

```html
<!-- Remix Icon (推荐) -->
<link href="https://cdn.jsdelivr.net/npm/remixicon@4.1.0/fonts/remixicon.css" rel="stylesheet">
```

| 指标 | Remix Icon |
|:---|:---|
| 数量 | `ri-shopping-cart-line` |
| 金额 | `ri-money-cny-circle-line` |
| 均价 | `ri-price-tag-3-line` |
| 占比 | `ri-pie-chart-line` |
| 达成 | `ri-focus-3-line` |
| 增长 | `ri-line-chart-line` |
| SKU | `ri-archive-drawer-line` |
| 风险 | `ri-alert-line` |
| 趋势 | `ri-arrow-up-s-fill` / `ri-arrow-down-s-fill` |
