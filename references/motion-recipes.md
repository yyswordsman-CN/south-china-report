# Motion Recipes — V2 动效系统

> **设计哲学**: 动效是叙事节奏的一部分，不是装饰。
> **技术约束**: 纯 CSS/JS 实现，无需引入 Motion One 或 GSAP (报告是单文件 HTML)。
> **降级策略**: `prefers-reduced-motion` 时所有动效即时显示，内容永远可读。

---

## §1 动效层级架构

```
动效层级 (从轻到重):
├── L0: 即时反馈        ← 0-150ms  (hover/focus/active)
├── L1: 入场动效        ← 300-700ms (scroll-reveal/CountUp)
├── L2: 叙事节奏        ← 700-1200ms (stagger/editorial/comparison)
└── L3: 环境感知        ← 持续 (scroll-progress/parallax)
```

### 层级使用规则

| 层级 | 允许区域 | 禁止区域 |
|:---|:---|:---|
| L0 即时反馈 | 全部区域 | 无 |
| L1 入场动效 | 全部 Section | 无 (但 Data Detail 仅用简单 reveal) |
| L2 叙事节奏 | Hero → Chapter → Closing 叙事主线 | Data Detail、Audit 区域 |
| L3 环境感知 | Scroll Progress Bar | 不做视差滚动 (分散注意力) |

---

## §2 CSS Motion Tokens

```css
:root {
    /* === Easing === */
    --ease-productive:  cubic-bezier(0.2, 0, 0.38, 0.9);
    --ease-expressive:  cubic-bezier(0.16, 1, 0.3, 1);
    --ease-exit:        cubic-bezier(0.4, 0.14, 1, 1);
    --ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1);

    /* === Duration === */
    --duration-instant:   70ms;
    --duration-fast:      150ms;
    --duration-moderate:  300ms;
    --duration-slow:      500ms;
    --duration-slower:    700ms;
    --duration-dramatic:  1200ms;

    /* === Stagger 间隔 === */
    --stagger-fast:       40ms;
    --stagger-normal:     60ms;
    --stagger-slow:       100ms;
    --stagger-dramatic:   160ms;
}
```

---

## §3 五种 Recipe

### Recipe 1: `cascade` (默认)

**适用**: 普通 Chapter、Insight Cards、Data Detail
**行为**: 所有 `.reveal` 元素逐个 stagger 入场
**触发**: 不加任何 `data-animate`，自动使用

```css
/* CSS 基础 */
.reveal {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity var(--duration-slower) var(--ease-expressive),
                transform var(--duration-slower) var(--ease-expressive);
}
.reveal.visible {
    opacity: 1;
    transform: translateY(0);
}
```

```javascript
// JS: IntersectionObserver + Stagger (上限 8 个)
const reveals = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
            const siblings = entry.target.parentElement.querySelectorAll('.reveal');
            const siblingIndex = Array.from(siblings).indexOf(entry.target);
            // §9 纪律: 超过 8 个不做 stagger，整体同时入场
            entry.target.style.transitionDelay = (siblings.length > 8 || siblingIndex >= 8)
                ? '0ms'
                : `${siblingIndex * 60}ms`;
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.15 });

reveals.forEach(el => observer.observe(el));
```

### Recipe 2: `hero`

**适用**: Hero Banner Section
**行为**: 慢节奏 stagger + CountUp 数字动画，仪式感
**触发**: `.hero` Section 自动使用

```javascript
// Hero 入场序列 (页面加载后触发)
function initHero() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    const elements = hero.querySelectorAll('.hero-badge, .hero-title, .hero-subtitle, .hero-number, .hero-number-label');

    elements.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = `opacity ${700}ms var(--ease-expressive), transform ${700}ms var(--ease-expressive)`;

        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, 300 + i * 160);  // 160ms stagger (慢节奏)
    });

    // CountUp 在序列末尾启动
    setTimeout(() => {
        initCountUp();
    }, 300 + elements.length * 160 + 200);
}
```

### Recipe 3: `editorial`

**适用**: Editorial Block (文+数并排)
**行为**: 左文先入 → 右数据后入，模拟阅读顺序
**触发**: `data-animate="editorial"` 或 `.editorial` 类自动使用

```javascript
// Editorial 阅读序入场
function initEditorialReveal(editorialEl) {
    const text = editorialEl.querySelector('.editorial-text');
    const data = editorialEl.querySelector('.editorial-data');

    // 先入文字
    text.style.opacity = '0';
    text.style.transform = 'translateX(-20px)';
    text.style.transition = `all var(--duration-slower) var(--ease-expressive)`;

    // 后入数据
    data.style.opacity = '0';
    data.style.transform = 'translateX(20px)';
    data.style.transition = `all var(--duration-slower) var(--ease-expressive)`;

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            text.style.opacity = '1';
            text.style.transform = 'translateX(0)';

            setTimeout(() => {
                data.style.opacity = '1';
                data.style.transform = 'translateX(0)';
            }, 200);  // 数据延迟 200ms

            observer.unobserve(editorialEl);
        }
    }, { threshold: 0.2 });

    observer.observe(editorialEl);
}
```

### Recipe 4: `comparison`

**适用**: Before/After 对比块、去年/今年对比
**行为**: 左列从左滑入 → 右列从右滑入
**触发**: `data-animate="comparison"`

```html
<div class="comparison" data-animate="comparison">
    <div class="comparison-left" data-anim="left">
        <!-- 去年 / Before -->
    </div>
    <div class="comparison-right" data-anim="right">
        <!-- 今年 / After -->
    </div>
</div>
```

```javascript
function initComparisonReveal(compEl) {
    const left = compEl.querySelector('[data-anim="left"]');
    const right = compEl.querySelector('[data-anim="right"]');

    left.style.cssText = 'opacity:0; transform:translateX(-30px); transition:all var(--duration-slower) var(--ease-expressive)';
    right.style.cssText = 'opacity:0; transform:translateX(30px); transition:all var(--duration-slower) var(--ease-expressive)';

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
            left.style.opacity = '1';
            left.style.transform = 'translateX(0)';
            setTimeout(() => {
                right.style.opacity = '1';
                right.style.transform = 'translateX(0)';
            }, 150);
            observer.unobserve(compEl);
        }
    }, { threshold: 0.2 });

    observer.observe(compEl);
}
```

### Recipe 5: `reveal-only`

**适用**: Data Detail 区域、辅助信息
**行为**: 只做简单 fade-up，无 stagger，无方向性
**触发**: `data-animate="reveal-only"` 或 Data Detail 区域自动

```css
[data-animate="reveal-only"] .reveal,
.data-detail-section .reveal {
    transition-delay: 0ms !important;  /* 无 stagger */
}
```

---

## §4 Recipe 选择决策树

```
这个 Section 是什么类型？
│
├── Hero Banner (.hero) → Recipe: hero (自动)
│
├── 主叙事章节 (Chapter)
│   ├── 含 Editorial Block → Recipe: editorial
│   ├── 含 Before/After 对比 → Recipe: comparison
│   └── 普通章节 → Recipe: cascade (默认)
│
├── 数据明细 (Data Detail) → Recipe: reveal-only
│
└── 行动号召 (Closing) → Recipe: cascade (默认)
```

---

## §5 CountUp 数字动画

```javascript
// CountUp 标准实现
function countUp(el, target, duration = 1200) {
    const start = 0;
    const startTime = performance.now();
    const suffix = el.dataset.suffix || '';

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // 缓出曲线: 开始快 → 结束慢
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = Math.floor(start + (target - start) * easeOut);

        el.textContent = current.toLocaleString('zh-CN') + suffix;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            el.textContent = target.toLocaleString('zh-CN') + suffix;
        }
    }

    requestAnimationFrame(update);
}

function initCountUp() {
    document.querySelectorAll('[data-from][data-to]').forEach(el => {
        const target = parseInt(el.dataset.to);
        const suffix = el.dataset.suffix || '';
        countUp(el, target, 1200);
    });
}
```

---

## §6 Scroll Progress Bar

```javascript
// Scroll Progress
function initScrollProgress() {
    const bar = document.getElementById('scrollProgress');
    if (!bar) return;

    window.addEventListener('scroll', () => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const progress = (scrollTop / docHeight) * 100;
        bar.style.width = progress + '%';
    }, { passive: true });
}
```

---

## §7 L0 即时反馈 CSS

```css
/* Hover 态 */
.insight-card,
.metric-tile,
.action-item {
    transition: box-shadow var(--duration-fast) var(--ease-productive),
                transform var(--duration-fast) var(--ease-productive);
}
.insight-card:hover,
.metric-tile:hover {
    box-shadow: var(--shadow-md);
    transform: translateY(-2px);
}

/* Focus 态 */
:focus-visible {
    outline: 2px solid var(--brand-accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
    transition: outline-offset var(--duration-instant) var(--ease-productive);
}

/* Active 态 */
button:active,
[role="button"]:active {
    transform: scale(0.98);
    transition: transform var(--duration-instant) var(--ease-productive);
}
```

---

## §8 降级策略

> **Apple §14 三信号**: 减少动效 ≠ 无反馈, 而是更温和的等效。须响应三个独立信号: `prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`。

```css
/* 信号 1: 减少动效 — 替换滑动/弹性为静态, 内容永远可读 */
@media (prefers-reduced-motion: reduce) {
    .reveal {
        opacity: 1 !important;
        transform: none !important;
        transition: none !important;
    }
    .hero-number,
    .hero-scroll-hint {
        animation: none !important;
    }
    .scroll-progress {
        transition: none !important;
    }
    /* CountUp 降级: 直接显示最终值 */
    [data-from][data-to] {
        /* JS 中也需检查 prefers-reduced-motion */
    }
    /* 玻璃表面降级: 去除过渡 */
    .glass-surface { transition: none !important; }
}
/* 信号 2: 降低透明度 — 毛玻璃转实底, 去除 blur */
@media (prefers-reduced-transparency: reduce) {
    .glass-surface { background: var(--surface-primary); backdrop-filter: none; -webkit-backdrop-filter: none; }
    .glass-surface--dark { background: var(--brand-deep); backdrop-filter: none; -webkit-backdrop-filter: none; }
    .scroll-progress { backdrop-filter: none; -webkit-backdrop-filter: none; }
}
/* 信号 3: 增强对比 — 实底 + 对比边框 */
@media (prefers-contrast: more) {
    .glass-surface { background: var(--surface-primary); border: 1px solid var(--text-primary); }
    .glass-surface--dark { background: var(--brand-deep); border: 1px solid #fff; }
}
```

```javascript
// JS 中检查 reduced motion
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
    // CountUp 直接显示最终值
    document.querySelectorAll('[data-from][data-to]').forEach(el => {
        el.textContent = parseInt(el.dataset.to).toLocaleString('zh-CN') + (el.dataset.suffix || '');
    });
    // 所有 reveal 直接可见
    document.querySelectorAll('.reveal').forEach(el => {
        el.classList.add('visible');
    });
} else {
    initHero();
    initScrollProgress();
    // Observer 初始化...
}
```

---

## §9 动效纪律总结

| 规则 | 详情 |
|:---|:---|
| **叙事主线** = L1 + L2 | Hero → Chapter → Closing 使用入场+叙事节奏动效 |
| **数据区域** = L1 only | Data Detail 只做简单 reveal，不喧宾夺主 |
| **Duration 上限** | 单个动效 ≤ 1200ms (CountUp)。整个 Hero 序列 ≤ 2500ms |
| **Stagger 上限** | 同一视口内 stagger 元素 ≤ 8 个。超过的不 stagger |
| **无限动画** = 禁止 | 只有 Hero 的 bounce hint 允许无限循环，其他一律 `animation-iteration-count: 1` |
| **降级** = 必须 | `prefers-reduced-motion` 时所有动效即时显示，内容永远可读 |

---

## §10 统一初始化 Dispatcher

> Agent 在模板中添加 `data-animate` 属性后，只需调用此函数即可自动分发到对应 Recipe。

```javascript
function initAllRecipes() {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
        // 降级: 所有内容直接显示
        document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
        document.querySelectorAll('[data-from][data-to]').forEach(el => {
            el.textContent = parseInt(el.dataset.to).toLocaleString('zh-CN') + (el.dataset.suffix || '');
        });
        return;
    }

    // 1. Hero (自动检测 .hero)
    initHero();

    // 2. Editorial (自动检测 .editorial 或 [data-animate="editorial"])
    document.querySelectorAll('.editorial, [data-animate="editorial"]')
        .forEach(el => initEditorialReveal(el));

    // 3. Comparison (检测 [data-animate="comparison"])
    document.querySelectorAll('[data-animate="comparison"]')
        .forEach(el => initComparisonReveal(el));

    // 4. Cascade (默认: 所有 .reveal 元素，含 stagger ≤ 8 上限)
    const reveals = document.querySelectorAll('.reveal:not(.visible)');
    const cascadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const siblings = entry.target.parentElement.querySelectorAll('.reveal');
                const idx = Array.from(siblings).indexOf(entry.target);
                entry.target.style.transitionDelay = (siblings.length > 8 || idx >= 8)
                    ? '0ms' : `${idx * 60}ms`;
                entry.target.classList.add('visible');
                cascadeObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.15 });
    reveals.forEach(el => cascadeObserver.observe(el));

    // 5. Scroll Progress
    initScrollProgress();
}

// 调用时机
document.addEventListener('DOMContentLoaded', initAllRecipes);
```
