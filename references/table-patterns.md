# Table & Component Patterns — 表格与通用组件库

## 快速导航

- [1. 高密度数据表](#1-高密度数据表格-data-grid)
- [2–3. Badge](#2-badge-系统)
- [4. Callout](#4-callout-洞察框)
- [5. Trend Indicators](#5-trend-indicators--svg-图标)
- [6–7. 密度与卡片](#6-高密度数据折叠-flex-baseline)
- [8. Sparkline](#8-sparkline-迷你趋势图)

> 整合自 SKILL 和 KI 中的表格、Badge、排名、Callout 等通用组件。
> 所有间距使用 `design-tokens.md` 中定义的 token。
>
> **色值合规口径**: 下方 Badge/组件内的 literal 色值属 `design-tokens.md` §3.3 的语义色族
> (`--semantic-{growth,risk,opportunity,warning,neutral}-bg` / `-text`)，即已对齐 Token、非"裸 hex 缺陷"。
> 需动态取值时用对应 CSS 变量或 `cssVar('--semantic-growth-bg')`；新增组件若引入语义族以外的色值须先在 §3.3 登记。

---

## 1. 高密度数据表格 (Data Grid)

```css
.data-grid-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    font-family: var(--font-editorial);
    font-variant-numeric: tabular-nums;
}
.data-grid-table th {
    background: var(--surface-secondary);
    color: var(--text-secondary);
    font-weight: var(--fw-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border-default);
    text-align: right;
    position: sticky; top: 0; z-index: 10;
}
.data-grid-table th:first-child { text-align: left; }
.data-grid-table td {
    border: 1px solid var(--border-default);
    padding: var(--space-2) var(--space-3);
    text-align: right;
    color: #334155;
}
.data-grid-table tbody tr:hover { background: #F8FAFC; }
.data-grid-table tbody tr:nth-child(even) { background: #FAFBFC; }
```

### 条件着色 (Heat Map)

```javascript
function applyHeatMap(tableSelector, colIndex, options) {
    var opts = Object.assign({
        min: null, max: null,
        lowColor: [254,226,226],   // red-100
        highColor: [220,252,231]   // green-100
    }, options);
    var cells = document.querySelectorAll(tableSelector + ' tbody td:nth-child(' + colIndex + ')');
    var values = Array.from(cells).map(function(td) {
        return parseFloat(td.textContent.replace(/[,%]/g, '')) || 0;
    });
    var min = opts.min !== null ? opts.min : Math.min.apply(null, values);
    var max = opts.max !== null ? opts.max : Math.max.apply(null, values);
    cells.forEach(function(td, i) {
        var ratio = max === min ? 0.5 : (values[i] - min) / (max - min);
        var r = Math.round(opts.lowColor[0] + (opts.highColor[0] - opts.lowColor[0]) * ratio);
        var g = Math.round(opts.lowColor[1] + (opts.highColor[1] - opts.lowColor[1]) * ratio);
        var b = Math.round(opts.lowColor[2] + (opts.highColor[2] - opts.lowColor[2]) * ratio);
        td.style.backgroundColor = 'rgb(' + r + ',' + g + ',' + b + ')';
        td.style.fontWeight = '600';
    });
}
```

---

## 2. Badge 系统

### 语义 Badge (浅色底)

```css
.badge {
    display: inline-block;
    padding: var(--space-0.5) var(--space-2);
    border-radius: 3px;
    font-size: 10px;
    font-weight: var(--fw-semibold);
    line-height: 1.6;
}
.badge-danger  { background: #FEE2E2; color: #991B1B; }
.badge-success { background: #D1FAE5; color: #065F46; }
.badge-warning { background: #FEF3C7; color: #92400E; }
.badge-info    { background: #DBEAFE; color: #1E40AF; }
```

### 半透明底趋势 Badge (深色底用)

> 通用公式: `文字色=目标色100%` + `背景色=same rgba(r,g,b,0.10)` + `border-radius:100px`

```css
.trend-badge {
    display: inline-block;
    padding: var(--space-0.5) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
}
.trend-badge.up   { color: #6EE7B7; background: rgba(110,231,183,0.10); }
.trend-badge.down { color: #FCA5A5; background: rgba(252,165,165,0.10); }
.trend-badge.flat { color: #94A3B8; background: rgba(148,163,184,0.08); }
```

### 分类标签 Badge

```css
.tag-badge {
    font-size: 9px;
    font-weight: var(--fw-bold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wider);
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: #F1F5F9;
    color: var(--text-secondary);
}
```

---

## 3. 排名 Badge (正圆化设计)

> Top1-3 正圆 + 柔和底色。4+ 名零底色纯数字。严禁"方角胶囊 + 统一灰底"的组件滥用。

```css
.rank-badge {
    width: 24px; height: 24px;
    border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: var(--text-xs);
    font-weight: var(--fw-bold);
    font-variant-numeric: tabular-nums;
    font-family: var(--font-data);
    line-height: 1;
}
.rank-1 { background: #FEF08A; color: #D97706; }  /* 金 */
.rank-2 { background: #E2E8F0; color: #475569; }  /* 银 */
.rank-3 { background: #FDBA74; color: #9A3412; }  /* 铜 */
.rank-n { background: none; color: #9CA3AF; }      /* 无底色 */
```

---

## 4. Callout 洞察框

```css
.callout {
    background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
    border-left: 4px solid var(--brand-accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: var(--space-4) var(--space-5);
    margin: var(--space-4) 0;
    font-size: 13px;
    line-height: var(--leading-relaxed);
}
.callout-title {
    font-weight: var(--fw-bold);
    color: var(--brand-accent);
    margin-bottom: var(--space-1);
    font-size: var(--text-sm);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.callout-success { background: linear-gradient(135deg, #ECFDF5, #D1FAE5); border-left-color: var(--semantic-growth); }
.callout-success .callout-title { color: var(--semantic-growth); }
.callout-danger  { background: linear-gradient(135deg, #FEF2F2, #FEE2E2); border-left-color: var(--semantic-risk); }
.callout-danger .callout-title  { color: var(--semantic-risk); }
```

---

## 5. Trend Indicators & SVG 图标

### CSS 趋势指示

```css
.trend-up   { color: var(--semantic-growth); }
.trend-down { color: var(--semantic-risk); }
.trend-flat { color: var(--text-secondary); }
```

### SVG 微图标 (12x12)

```html
<!-- 上升 -->
<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
    <polyline points="2 8 6 4 10 8"/>
</svg>
<!-- 下降 -->
<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;">
    <polyline points="2 4 6 8 10 4"/>
</svg>
```

---

## 6. 高密度数据折叠 (Flex Baseline)

> 核心: 用 `align-items: baseline` 让主指标和辅助指标在同一行对齐。

```html
<div style="display:flex; align-items:baseline; justify-content:flex-end; gap:6px;">
    <strong style="font-size:14px; letter-spacing:-0.4px;">19.0%</strong>
    <span style="font-size:10px; color:var(--text-secondary);">/ 11,248.1万</span>
</div>
```

---

## 7. 渠道卡片 2x2 网格

```html
<div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 12px;
            font-size:10px; color:var(--text-secondary); font-variant-numeric:tabular-nums;">
    <span>占比 50.7% <span style="color:#EF4444;font-weight:600">↓32.6pp</span></span>
    <span>数量 4,395 台</span>
    <span>均价 2,462元</span>
    <span>年累 15,997.5万</span>
</div>
```

---

## 8. Sparkline 迷你趋势图

```javascript
function createSparkline(data, options) {
    var opts = Object.assign({ width: 80, height: 24, color: '#3B82F6', fill: true }, options);
    var max = Math.max.apply(null, data), min = Math.min.apply(null, data);
    var range = max - min || 1;
    var step = opts.width / (data.length - 1);
    var points = data.map(function(v, i) {
        return (i * step).toFixed(1) + ',' + (opts.height - ((v - min) / range) * (opts.height - 4) - 2).toFixed(1);
    });
    var path = 'M' + points.join('L');
    var fillPath = path + 'L' + opts.width + ',' + opts.height + 'L0,' + opts.height + 'Z';
    return '<svg width="' + opts.width + '" height="' + opts.height + '" style="vertical-align:middle">'
        + (opts.fill ? '<path d="' + fillPath + '" fill="' + opts.color + '" fill-opacity="0.1"/>' : '')
        + '<path d="' + path + '" fill="none" stroke="' + opts.color + '" stroke-width="1.5" stroke-linecap="round"/>'
        + '<circle cx="' + points[points.length-1].split(',')[0] + '" cy="' + points[points.length-1].split(',')[1]
        + '" r="2" fill="' + opts.color + '"/></svg>';
}
```
