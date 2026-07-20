# Chart Patterns V2 — 高级图表组件库

## 快速导航

- [1. 瀑布图](#1-瀑布图-waterfall--revenue-bridge)
- [2. 子弹图](#2-子弹图-bullet-chart)
- [3. 横向进度条](#3-横向进度条-progress-bar)
- [4. Small Multiples](#4-small-multiples-grid)
- [5. Lollipop](#5-lollipop-chart-棒棒糖图)
- [6. Slope Chart](#6-slope-chart-斜率图)

> 补充 ECharts 生产级图表模板，覆盖麦肯锡常用的归因分析、目标跟踪、密集对比场景。

### V2 Token 对齐说明

| 代码中的硬编码色值 | 对应 V2 Token | 语义 |
|:---|:---|:---|
| `#10B981` / `#34D399` | `--semantic-growth` / `--semantic-growth-dark` | 增长/正面 |
| `#EF4444` / `#FB7185` | `--semantic-risk` / `--semantic-risk-dark` | 风险/负面 |
| `#F59E0B` / `#FBBF24` | `--semantic-warning` / `--semantic-warning-dark` | 警告/关注 |
| `#3B82F6` / `#60A5FA` | `--brand-mid` 近似 | 品牌/强调 |
| `#F1F5F9` | `--surface-tertiary` | 背景轨道 |
| `#E2E8F0` | `--border-default` | 边框 |
| `#64748B` | `--text-secondary` | 辅助文字 |
| `#94A3B8` | `--text-tertiary` | 次要文字 |

> **合规口径**: ECharts 的 `setOption` 是 JS，不支持 CSS `var()`，故图表函数内保留 literal 色值。
> **只要 literal 落在上表(已映射到 Token)即视为合规**——这不算"裸 hex 硬编码缺陷"。
> 新增图表若用到上表以外的色值，须先补进本表、或改用 `cssVar('--semantic-growth')` 动态读取
> (工具函数见 `component-patterns.md` §4)。校验/自检口径与此一致 (见 `checklist.md` 快速修复索引)。

---

## 1. 瀑布图 (Waterfall / Revenue Bridge)

> **场景**: 收入归因分析 — 从基期到本期的增减拆解。麦肯锡最常用的分析图表之一。

```javascript
function createWaterfallChart(domId, data, options = {}) {
    // data: [{ name: '基期', value: 10000 }, { name: '价格', value: 1200 }, ...]
    // 最后一项为终值 (total)
    var chart = echarts.init(document.getElementById(domId), 'corporate-blue');
    var total = 0;
    var baseData = [];    // 透明底座
    var increaseData = []; // 增长 (绿色)
    var decreaseData = []; // 下降 (红色)
    var totalData = [];    // 总计 (蓝色)

    data.forEach(function(item, i) {
        if (i === 0 || i === data.length - 1) {
            // 首尾为基期/终值
            totalData.push(i === 0 ? item.value : null);
            if (i === data.length - 1) totalData[i] = total + (item.value || 0);
            baseData.push(0);
            increaseData.push('-');
            decreaseData.push('-');
            if (i === 0) total = item.value;
        } else {
            baseData.push(item.value >= 0 ? total : total + item.value);
            increaseData.push(item.value >= 0 ? item.value : '-');
            decreaseData.push(item.value < 0 ? Math.abs(item.value) : '-');
            totalData.push('-');
            total += item.value;
        }
    });
    // 修正终值
    totalData[data.length - 1] = total;

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: function(params) {
                var item = data[params[0].dataIndex];
                var prefix = item.value >= 0 ? '+' : '';
                return '<b>' + item.name + '</b><br/>' +
                    (params[0].dataIndex === 0 || params[0].dataIndex === data.length - 1
                        ? item.value.toLocaleString()
                        : prefix + item.value.toLocaleString());
            }
        },
        grid: { top: 40, left: 60, right: 30, bottom: 40 },
        xAxis: { type: 'category', data: data.map(function(d) { return d.name; }) },
        yAxis: {
            type: 'value',
            name: options.unit || '',
            axisLabel: { formatter: function(v) { return (v / 10000).toFixed(0) + '万'; } },
            splitLine: { lineStyle: { type: 'dashed', color: '#F1F5F9' } }
        },
        series: [
            { name: 'base', type: 'bar', stack: 'wf', data: baseData,
              itemStyle: { borderColor: 'transparent', color: 'transparent' },
              emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } }
            },
            { name: '增长', type: 'bar', stack: 'wf', data: increaseData,
              itemStyle: { color: '#10B981', borderRadius: [4,4,0,0] },
              label: { show: true, position: 'top', fontSize: 10, color: '#10B981',
                       formatter: function(p) { return p.value !== '-' ? '+' + p.value.toLocaleString() : ''; } }
            },
            { name: '下降', type: 'bar', stack: 'wf', data: decreaseData,
              itemStyle: { color: '#EF4444', borderRadius: [4,4,0,0] },
              label: { show: true, position: 'bottom', fontSize: 10, color: '#EF4444',
                       formatter: function(p) { return p.value !== '-' ? '-' + p.value.toLocaleString() : ''; } }
            },
            { name: '合计', type: 'bar', stack: 'wf', data: totalData,
              itemStyle: { color: '#3B82F6', borderRadius: [4,4,0,0] },
              label: { show: true, position: 'top', fontSize: 11, fontWeight: 600, color: '#0B1120',
                       formatter: function(p) { return p.value !== '-' ? p.value.toLocaleString() : ''; } }
            }
        ]
    });
    return chart;
}

// 用法:
// createWaterfallChart('chart-waterfall', [
//     { name: '2024年收入', value: 120000 },
//     { name: '价格提升',   value: 8500 },
//     { name: '新客户',     value: 15000 },
//     { name: '老客流失',   value: -6200 },
//     { name: '产品结构',   value: 3200 },
//     { name: '季节性',     value: -2100 },
//     { name: '2025年收入', value: 0 }   // 终值自动计算
// ]);
```

---

## 2. 子弹图 (Bullet Chart)

> **场景**: 目标 vs 实际密集对比。比仪表盘(Gauge)更节省空间，适合同时展示 6+ 个指标。

```javascript
function createBulletChart(domId, items, options = {}) {
    // items: [{ name: '深圳', actual: 85, target: 100, ranges: [60, 80, 100] }, ...]
    var chart = echarts.init(document.getElementById(domId), 'corporate-blue');
    var categories = items.map(function(d) { return d.name; });

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                var item = items[params[0].dataIndex];
                return '<b>' + item.name + '</b><br/>' +
                    '实际: ' + item.actual.toLocaleString() + '<br/>' +
                    '目标: ' + item.target.toLocaleString() + '<br/>' +
                    '达成: ' + (item.actual / item.target * 100).toFixed(1) + '%';
            }
        },
        grid: { top: 20, left: 80, right: 40, bottom: 20 },
        xAxis: { type: 'value', show: false, max: function(v) { return v.max * 1.1; } },
        yAxis: { type: 'category', data: categories, inverse: true,
                 axisLabel: { fontSize: 12, fontWeight: 500, color: '#334155' },
                 axisTick: { show: false }, axisLine: { show: false } },
        series: [
            // 背景条 (达标区间)
            { type: 'bar', data: items.map(function(d) { return d.ranges ? d.ranges[2] : d.target * 1.2; }),
              barWidth: 28, barGap: '-100%', z: 0,
              itemStyle: { color: '#F1F5F9', borderRadius: [0,4,4,0] }, silent: true },
            // 中等区间
            { type: 'bar', data: items.map(function(d) { return d.ranges ? d.ranges[1] : d.target; }),
              barWidth: 28, barGap: '-100%', z: 1,
              itemStyle: { color: '#E2E8F0', borderRadius: [0,4,4,0] }, silent: true },
            // 实际值
            { type: 'bar', data: items.map(function(d) { return d.actual; }),
              barWidth: 12, z: 2,
              itemStyle: { color: function(p) {
                  var rate = items[p.dataIndex].actual / items[p.dataIndex].target;
                  return rate >= 1 ? '#10B981' : rate >= 0.8 ? '#F59E0B' : '#EF4444';
              }, borderRadius: [0,4,4,0] },
              label: { show: true, position: 'right', fontSize: 11, fontWeight: 600,
                       formatter: function(p) {
                           var rate = (items[p.dataIndex].actual / items[p.dataIndex].target * 100).toFixed(0);
                           return rate + '%';
                       } } },
            // 目标标记线
            { type: 'scatter', symbol: 'rect', symbolSize: [3, 28],
              data: items.map(function(d) { return d.target; }), z: 3,
              itemStyle: { color: '#0B1120' } }
        ]
    });
    return chart;
}

// 用法:
// createBulletChart('chart-bullet', [
//     { name: '深圳', actual: 12500, target: 15000 },
//     { name: '广州', actual: 9800,  target: 8500 },
//     { name: '长沙', actual: 6200,  target: 9000 },
// ]);
```

---

## 3. 横向进度条 (Progress Bar)

> **场景**: 轻量级达成率展示，适合嵌入 KPI 卡片或表格行。

```css
/* === 进度条组件 === */
.progress-bar-wrap {
    width: 100%;
    height: 8px;
    background: #F1F5F9;
    border-radius: var(--radius-full, 100px);
    overflow: hidden;
    margin-top: var(--space-2, 8px);
}
.progress-bar-fill {
    height: 100%;
    border-radius: var(--radius-full, 100px);
    transition: width 1.2s cubic-bezier(0.4, 0, 0.2, 1);
    min-width: 4px;
}
/* 语义色 */
.progress-bar-fill.success { background: linear-gradient(90deg, #10B981, #34D399); }
.progress-bar-fill.warning { background: linear-gradient(90deg, #F59E0B, #FBBF24); }
.progress-bar-fill.danger  { background: linear-gradient(90deg, #EF4444, #FB7185); }
.progress-bar-fill.accent  { background: linear-gradient(90deg, #3B82F6, #60A5FA); }

/* 带标签版本 */
.progress-bar-labeled {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
}
.progress-bar-labeled .progress-bar-wrap { flex: 1; }
.progress-bar-labeled .progress-bar-value {
    font-size: var(--text-sm, 12px);
    font-weight: var(--fw-semibold, 600);
    font-variant-numeric: tabular-nums;
    min-width: 48px;
    text-align: right;
}
```

```html
<!-- 基础用法 -->
<div class="progress-bar-wrap">
    <div class="progress-bar-fill success" style="width: 78%"></div>
</div>

<!-- 带标签 -->
<div class="progress-bar-labeled">
    <div class="progress-bar-wrap">
        <div class="progress-bar-fill danger" style="width: 43%"></div>
    </div>
    <span class="progress-bar-value" style="color: #EF4444">43.2%</span>
</div>
```

```javascript
// 动态设置进度
function setProgress(wrapEl, percent, options) {
    var opts = Object.assign({ animate: true }, options);
    var fill = wrapEl.querySelector('.progress-bar-fill');
    var cls = percent >= 80 ? 'success' : percent >= 50 ? 'warning' : 'danger';
    fill.className = 'progress-bar-fill ' + cls;
    if (opts.animate) {
        fill.style.width = '0%';
        requestAnimationFrame(function() {
            fill.style.width = Math.min(percent, 100) + '%';
        });
    } else {
        fill.style.width = Math.min(percent, 100) + '%';
    }
}
```

---

## 4. Small Multiples Grid

> **场景**: 多战区/多渠道同维度趋势对比。让读者一眼看到 N 个子图的模式差异。

```css
.small-multiples {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-4, 16px);
}
.small-multiples .sm-cell {
    background: var(--surface-primary, #fff);
    border: 1px solid var(--color-border, #E2E8F0);
    border-radius: var(--radius-sm, 6px);
    padding: var(--space-3, 12px);
}
.small-multiples .sm-title {
    font-size: var(--text-sm, 12px);
    font-weight: var(--fw-semibold, 600);
    color: var(--text-secondary, #64748B);
    margin-bottom: var(--space-2, 8px);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide, 0.05em);
}
.small-multiples .sm-chart {
    width: 100%;
    height: 120px;
}
```

```javascript
// 批量生成 Small Multiples
function createSmallMultiples(containerId, datasets, chartFactory) {
    var container = document.getElementById(containerId);
    var charts = [];
    datasets.forEach(function(ds) {
        var cell = document.createElement('div');
        cell.className = 'sm-cell';
        cell.innerHTML = '<div class="sm-title">' + ds.title + '</div>' +
                         '<div class="sm-chart" id="sm-' + ds.id + '"></div>';
        container.appendChild(cell);
        var c = chartFactory('sm-' + ds.id, ds);
        charts.push(c);
    });
    return charts;
}
```

---

## 5. Lollipop Chart (棒棒糖图)

> **场景**: 柱状图的精细替代。当柱子太多时，棒棒糖图更清洁。适合 10+ 维度的单指标比较。

```javascript
function createLollipopChart(domId, items) {
    // items: [{ name: '深圳', value: 42.3 }, ...]
    var chart = echarts.init(document.getElementById(domId), 'corporate-blue');
    var names = items.map(function(d) { return d.name; });
    var values = items.map(function(d) { return d.value; });

    chart.setOption({
        tooltip: { trigger: 'axis' },
        grid: { top: 20, left: 80, right: 40, bottom: 20 },
        xAxis: { type: 'value', show: false },
        yAxis: { type: 'category', data: names, inverse: true,
            axisLabel: { fontSize: 12, fontWeight: 500, color: '#334155' },
            axisTick: { show: false }, axisLine: { show: false }
        },
        series: [
            // 连接线 (pictorialBar 模拟)
            { type: 'bar', data: values, barWidth: 2, z: 1,
              itemStyle: { color: '#CBD5E1', borderRadius: 0 },
              silent: true },
            // 圆点
            { type: 'scatter', symbol: 'circle', symbolSize: 12, z: 2,
              data: values,
              itemStyle: { color: function(p) {
                  return items[p.dataIndex].value >= (items[p.dataIndex].target || 30)
                      ? '#10B981' : '#EF4444';
              }},
              label: { show: true, position: 'right', fontSize: 11,
                  fontWeight: 600, fontFamily: 'JetBrains Mono',
                  formatter: function(p) { return p.value.toFixed(1) + '%'; }
              }
            }
        ]
    });
    return chart;
}
```

---

## 6. Slope Chart (斜率图)

> **场景**: 对比两个明确期间的排名或数值变化。颜色表达“有利/不利”，不表达“数值涨/跌”；成本、缺陷率、处理时长等 `lower_is_better` 指标下降必须使用有利色。
>
> **适用条件**: 正好两个可比期间；`periodLabels`、`direction`、`unit` 必须来自 `metrics.analysis_scope` 与 `semantic_layer.measures[]`。缺任一项则 `SKIPPED`，不得回退成“去年/今年”或默认“上涨=绿”。轴域由数据动态计算，柱/条形才强制零基线，斜率图默认保留变化辨识度。

```javascript
import { buildSlopeOption } from '../scripts/chart-semantics.mjs';

function createSlopeChart(domId, items, options) {
    // items: [{ name: '某分组', before: 48, after: 36 }, ...]
    // options: { periodLabels: ['基线期标签','当前期标签'], direction: 'lower_is_better', unit: 'minute' }
    var chart = echarts.init(document.getElementById(domId), 'corporate-blue');
    chart.setOption(buildSlopeOption(items, options));
    return chart;
}
```

`chart-semantics.mjs` 同时提供 `dynamicValueDomain()`、`categoryLayout()` 与 `ellipsizeLabel()`；长标签/高基数先改横向布局并限制可见 TopN，再把全标签放 tooltip/表格，不得靠缩小字号或固定轴域硬塞。
