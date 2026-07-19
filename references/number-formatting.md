# 数字格式化标准与交互动效目录

## 快速导航

- [1. 数字格式化](#1-数字格式化标准-number-formatting-standards)
- [2. 微交互](#2-交互动效目录-micro-interaction-catalog)
- [3. 加载状态](#3-加载状态管理)
- [4. 打印与导出](#4-打印与导出适配)

> 来源: McKinsey 数字呈现规范 + Apple/Airbnb 动效设计 + 现代 CSS 交互模式
> 版本: V2 对齐 (2026-07) — 阴影/字体 Token 随三角色视觉系统更新 (Display=Plus Jakarta Sans / Editorial=DM Sans / Data=JetBrains Mono)
> 用途: 统一报告内所有数字的呈现格式, 提供标准化动效组件

---

## 1. 数字格式化标准 (Number Formatting Standards)

### 1.1 量级适配表

> **核心原则**: 人类一次只能处理 3-4 位数字。超过 4 位必须缩写。

| 原始值范围 | 格式 | 示例 | 代码 |
|:---|:---|:---|:---|
| ≥ 1 亿 | X.X 亿 | 40.9亿 | `(v/1e8).toFixed(1) + '亿'` |
| 1000万 ~ 9999万 | X,XXX 万 | 5,382万 | `Math.round(v/1e4).toLocaleString() + '万'` |
| 100万 ~ 999万 | XXX.X 万 | 234.5万 | `(v/1e4).toFixed(1) + '万'` |
| 1万 ~ 99万 | X.X 万 或 XX,XXX | 12.3万 | `(v/1e4).toFixed(1) + '万'` |
| < 1万 | 千分位整数 | 8,639 | `Math.round(v).toLocaleString()` |
| 百分比 | X.X% | 23.5% | `v.toFixed(1) + '%'` |
| pp 差值 | ±X.Xpp | -3.2pp | `(v > 0 ? '+' : '') + v.toFixed(1) + 'pp'` |
| 均价 | X,XXX 元 | 2,462元 | `Math.round(v).toLocaleString() + '元'` |

### 1.2 统一格式化函数

```javascript
/**
 * McKinsey 级别数字格式化
 * @param {number} value - 原始数字
 * @param {string} type - 'amount'|'pct'|'pp'|'count'|'price'|'auto'
 * @returns {string} 格式化后的字符串
 */
function formatNumber(value, type) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    
    switch(type) {
        case 'pct':
            return value.toFixed(1) + '%';
        case 'pp':
            var sign = value > 0 ? '+' : '';
            return sign + value.toFixed(1) + 'pp';
        case 'price':
            return Math.round(value).toLocaleString() + '元';
        case 'count':
            return Math.round(value).toLocaleString();
        case 'amount':
        case 'auto':
        default:
            return formatAmount(value);
    }
}

function formatAmount(value) {
    var abs = Math.abs(value);
    var sign = value < 0 ? '-' : '';
    
    if (abs >= 1e8)  return sign + (abs / 1e8).toFixed(1) + '亿';
    if (abs >= 1e7)  return sign + Math.round(abs / 1e4).toLocaleString() + '万';
    if (abs >= 1e6)  return sign + (abs / 1e4).toFixed(1) + '万';
    if (abs >= 1e4)  return sign + (abs / 1e4).toFixed(1) + '万';
    return sign + Math.round(abs).toLocaleString();
}

/**
 * 趋势方向符号
 * @param {number} value - 变化值
 * @returns {{ symbol:string, class:string, color:string }}
 */
function getTrendIndicator(value) {
    if (value > 0) return { symbol: '↑', class: 'up', color: 'var(--semantic-growth)' };
    if (value < 0) return { symbol: '↓', class: 'down', color: 'var(--semantic-risk)' };
    return { symbol: '—', class: 'flat', color: 'var(--text-secondary)' };
}
```

### 1.3 ECharts axisLabel 格式化模板

```javascript
// 金额轴 — 万元自动缩写
axisLabel: {
    formatter: function(value) {
        if (Math.abs(value) >= 10000) return (value / 10000).toFixed(0) + '万';
        if (Math.abs(value) >= 1000) return (value / 1000).toFixed(0) + 'K';
        return value;
    },
    fontSize: 11,
    color: '#64748B'
}

// 百分比轴
axisLabel: {
    formatter: '{value}%',
    fontSize: 11,
    color: '#64748B'
}

// Tooltip — 智能格式化
tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: 'transparent',
    textStyle: { color: '#E2E8F0', fontSize: 12 },
    formatter: function(params) {
        var html = '<b>' + params[0].name + '</b>';
        params.forEach(function(p) {
            var color = p.color;
            var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:6px;"></span>';
            html += '<br/>' + dot + p.seriesName + ': ' + formatNumber(p.value, 'auto');
        });
        return html;
    }
}
```

---

## 2. 交互动效目录 (Micro-interaction Catalog)

### 2.1 数字计数动画 (CountUp Animation)

> **场景**: KPI 大数字的入场动画, 增强数据感知力

```javascript
/**
 * 轻量版 CountUp — 无外部依赖版本
 * @param {HTMLElement} el - 目标 DOM 元素
 * @param {number} endVal - 目标数字
 * @param {Object} opts - { duration, decimals, suffix, prefix }
 */
function countUp(el, endVal, opts) {
    opts = Object.assign({ duration: 1200, decimals: 0, suffix: '', prefix: '' }, opts);
    var startVal = 0;
    var startTime = null;
    
    function easeOutExpo(t) {
        return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }
    
    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        var progress = Math.min((timestamp - startTime) / opts.duration, 1);
        var easedProgress = easeOutExpo(progress);
        var currentVal = startVal + (endVal - startVal) * easedProgress;
        
        el.textContent = opts.prefix + currentVal.toFixed(opts.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + opts.suffix;
        
        if (progress < 1) requestAnimationFrame(step);
    }
    
    requestAnimationFrame(step);
}

// 用法: 在 IntersectionObserver 中触发
document.querySelectorAll('[data-count]').forEach(function(el) {
    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                countUp(el, parseFloat(el.dataset.count), {
                    decimals: parseInt(el.dataset.decimals || '0'),
                    suffix: el.dataset.suffix || '',
                    duration: parseInt(el.dataset.duration || '1200')
                });
                observer.unobserve(el);
            }
        });
    }, { threshold: 0.5 });
    observer.observe(el);
});
```

```html
<!-- HTML 用法 -->
<span class="kpi-value" data-count="8639" data-suffix="台" data-duration="1500">0</span>
<span class="kpi-value" data-count="23.5" data-decimals="1" data-suffix="%" data-duration="1200">0</span>
```

### 2.2 骨架屏 (Skeleton Screen)

> **场景**: 数据加载前的占位动画

```css
/* 骨架屏 — 微光效果 */
.skeleton {
    background: linear-gradient(90deg, 
        var(--surface-secondary) 25%, 
        rgba(255,255,255,0.5) 50%, 
        var(--surface-secondary) 75%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s ease-in-out infinite;
    border-radius: var(--radius-sm);
}

@keyframes skeleton-shimmer {
    0%   { background-position: -200% 0; }
    100% { background-position: 200% 0; }
}

/* 骨架占位组件 */
.skeleton-text { height: 14px; margin-bottom: 8px; }
.skeleton-title { height: 24px; width: 60%; margin-bottom: 16px; }
.skeleton-kpi { height: 48px; width: 40%; margin-bottom: 12px; }
.skeleton-chart { height: 300px; width: 100%; }
.skeleton-table-row { height: 40px; margin-bottom: 4px; }
```

### 2.3 卡片入场动画 (Staggered Entrance)

```css
/* 滚动渐入 — 已有 .reveal, 此处增强 */
.reveal {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
                transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.visible {
    opacity: 1;
    transform: translateY(0);
}

/* 交错入场 — 卡片网格中依次出现 */
.reveal:nth-child(1) { transition-delay: 0ms; }
.reveal:nth-child(2) { transition-delay: 80ms; }
.reveal:nth-child(3) { transition-delay: 160ms; }
.reveal:nth-child(4) { transition-delay: 240ms; }
.reveal:nth-child(5) { transition-delay: 320ms; }
.reveal:nth-child(6) { transition-delay: 400ms; }
```

### 2.4 微交互三态 (Hover / Focus / Active)

```css
/* 卡片三态 */
.report-card {
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.report-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
}
.report-card:active {
    transform: translateY(0);
    box-shadow: var(--shadow-sm);
}

/* 表格行三态 */
.data-grid-table tbody tr {
    transition: background-color 0.15s ease;
}
.data-grid-table tbody tr:hover {
    background-color: var(--surface-secondary);
}
.data-grid-table tbody tr:active {
    background-color: #E2E8F0;
}

/* 数字变化闪烁动画 */
@keyframes number-flash {
    0%, 100% { color: inherit; }
    50% { color: var(--brand-accent); }
}
.number-updated {
    animation: number-flash 0.6s ease;
}
```

### 2.5 平滑锚点导航

```css
/* 全局平滑滚动 */
html {
    scroll-behavior: smooth;
    scroll-padding-top: 80px;  /* 补偿固定头部高度 */
}

/* 锚点到达高亮 */
:target {
    animation: target-highlight 1s ease;
}
@keyframes target-highlight {
    0% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3); }
    100% { box-shadow: none; }
}
```

### 2.6 图表入场动画配置

```javascript
// ECharts 标准入场动画
var standardAnimation = {
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut',        // 柔和减速
    animationDelay: function(idx) {
        return idx * 50;                 // 系列内交错
    },
    animationDurationUpdate: 400,        // 数据更新动画
    animationEasingUpdate: 'cubicInOut'
};

// 禁用动画的场景 (打印/PPT导出)
var noAnimation = {
    animation: false
};

// 条件使用
var isExportMode = window.location.search.includes('export=true');
var animConfig = isExportMode ? noAnimation : standardAnimation;
```

---

## 3. 加载状态管理

### 3.1 报告加载序列

```
1. [0ms]    HTML 骨架渲染 → 侧边栏 + 骨架屏
2. [100ms]  CSS 字体加载 → Plus Jakarta Sans / DM Sans / JetBrains Mono / Noto Sans SC
3. [200ms]  首屏 KPI 数字 → CountUp 动画启动
4. [400ms]  ECharts Flash-then-Hide 初始化
5. [600ms]  卡片 .reveal → 交错入场
6. [800ms]  图表动画完成
7. [1000ms] 完整交互就绪
```

### 3.2 字体加载优化

```css
/* 字体预加载 + 备选方案 */
@font-face {
    font-family: 'DM Sans';
    src: url('path/to/dm-sans.woff2') format('woff2');
    font-display: swap;  /* 先用备选字体，加载完后替换 */
}
```

```html
<!-- HTML head 中预加载关键字体 -->
<link rel="preload" href="path/to/dm-sans-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="path/to/dm-sans-700.woff2" as="font" type="font/woff2" crossorigin>
```

---

## 4. 打印与导出适配

### 4.1 打印模式禁用动画

```css
@media print {
    * {
        animation: none !important;
        transition: none !important;
    }
    .skeleton { display: none; }
    .reveal { opacity: 1; transform: none; }
    [data-count] { /* 显示最终数值 */ }
}
```

### 4.2 导出参数标记

```javascript
// URL 参数控制导出模式
// ?export=true&theme=print
var params = new URLSearchParams(window.location.search);
if (params.get('export') === 'true') {
    document.body.classList.add('export-mode');
    // 禁用所有动画
    // 展开所有折叠区域
    // 显示所有隐藏的 section
}
```
