# Design Tokens V2 — 完整设计系统基础

> **版本**: V2.0 | **基于**: Carbon 严谨性 + Tremor 语义化 + Taste-Skill 工程化
> 所有间距、字号、颜色、阴影均定义于此。可执行模板与报告在 `:root` 外优先通过 `var(--xxx)` 引用；参考文档为解释色板或兼容第三方图表而展示 literal 时，复制到报告前必须映射到已登记 Token，禁止引入无法追溯的裸色值。

### 目录

1. [8pt 间距系统](#1-8pt-间距系统-spacing-system)
2. [排版音阶](#2-排版音阶-type-scale--v2-editorial)
3. [色彩系统 V2 (三层架构)](#3-色彩系统-v2-三层架构)
4. [阴影系统](#4-阴影系统-v2-分层)
4.5 [材质系统 (Apple §12)](#45-材质系统-materials-apple-12)
5. [圆角系统](#5-圆角系统)
6. [布局系统](#6-布局系统)
7. [Motion Tokens](#7-motion-tokens-v2-新增)
8. [表头系统](#8-表头系统-v2-补充)
9. [响应式断点](#9-响应式断点)
10. [可访问性](#10-可访问性-accessibility)
11. [主题变体 (三套)](#11-主题变体-v2-三套完整主题)
12. [Token 速查表](#12-token-速查表-按使用频率)

---

## 1. 4pt 最小刻度 + 8pt 主布局网格 (Spacing System)

> 原则：边框、图标微调和小间隔允许 4px 的整数倍；大于 12px 的主布局间距优先使用 8px 整数倍并通过 `--space-*` Token 引用。禁止 `6px`、`14px`、`22px` 等无口径字面量。

```css
:root {
    /* === 8pt Grid Spacing System — 密度轴 (V2.4) ===
       --space-* 全部由 --density 缩放; <html data-density="compact"> 时 --density:0.6 + 组件级版式重组 */
    --density: 1;
    --space-0:   0;
    --space-px:  1px;    /* 边框、分隔线 (不随密度缩放) */
    --space-0.5: 2px;    /* 极微间距 (不随密度缩放) */
    --space-1:   calc(4px  * var(--density));  /* 行内图标与文字 gap */
    --space-2:   calc(8px  * var(--density));  /* 标签与数值、Badge padding */
    --space-3:   calc(12px * var(--density));  /* 卡片内元素间、表格 cell padding */
    --space-4:   calc(16px * var(--density));  /* 组件间距、grid gap */
    --space-5:   calc(20px * var(--density));
    --space-6:   calc(24px * var(--density));  /* 卡片 padding、section 内间距 */
    --space-8:   calc(32px * var(--density));  /* 板块间 */
    --space-10:  calc(40px * var(--density));  /* 区域间距: main-content padding-y */
    --space-12:  calc(48px * var(--density));
    --space-16:  calc(64px * var(--density));  /* 页面间距: main-content padding-x */
    --space-20:  calc(80px * var(--density));  /* Chapter 间呼吸空间 */
    --space-24:  calc(96px * var(--density));  /* Hero/Closing padding */
}
```

### 间距应用规范

| 场景 | Token | 像素值 | 说明 |
|:---|:---|:---|:---|
| 行内图标与文字 | `--space-1` | 4px | SVG icon 与 label 的 gap |
| Badge 内边距 | `--space-0.5` `--space-2` | 2px 8px | padding: 2px 8px |
| 表格 cell | `--space-2` `--space-3` | 8px 12px | padding: 8px 12px |
| 表格 th | `--space-2` `--space-3` | 8px 12px | 与网格刻度一致 |
| KPI 卡片 padding | `--space-5` `--space-6` | 20px 24px | padding: 20px 24px |
| 卡片间距 | `--space-6` | 24px | margin-bottom: 24px |
| 组件间 gap | `--space-4` | 16px | grid gap / flex gap |
| Section 间 | `--space-8` | 32px | section margin-bottom |
| **Chapter 间呼吸** | `--space-20` | 80px | **V2: 章节间的视觉留白** |
| 报告内容 padding | `--space-10` `--space-16` | 40px 64px | `padding: 40px 64px` |
| 侧边栏 padding | `--space-6` | 24px | padding: 24px 0 |

> 上表像素值为**叙事标准档 (density=1)**; 紧凑档 (`data-density="compact"`) 下间距全部 ×0.6，并叠加组件级版式重组 (见 §2.6)。

### 2.6 密度轴 (Density Axis) — V2.4 紧凑销售报告风

> 同一套视觉主体 (品牌渐变/语义色/三角色字体/Token)，两种阅读密度。未指定时使用紧凑档；标准档需显式选择。
> 紧凑档不是"等比缩小"，而是为「信息密集 · 快速扫读」做的**版式重组**。

| 档位 | 触发方式 | `--density` | 适用场景 | 版式特征 |
| :--- | :--- | :--- | :--- | :--- |
| **紧凑销售报告风 (默认)** | `<html lang="zh-CN" data-density="compact">` | `0.6` | 销售月报/旬报快速扫读、打印存档、移动端长图、信息密集简报 | Hero 收为 masthead 横幅(结论居左+数字居右)、KPI 换行加密、内容列加宽、Pull Quote 转左线 callout、表格密集行 |
| **叙事标准风 (显式可选)** | `<html lang="zh-CN">` (移除属性) | `1` | 明确要求的高管月报/年报/战略叙事、沉浸式阅读 | 大留白、慢节奏、强 Hero 沉浸 (100vh)、章节间 80px 呼吸 |

**机制 (CSS 唯一真相源 = `scroll-narrative-skeleton.html`)**:
- **间距层**: 所有 `--space-*` = `calc(Npx * var(--density, 1))`, 紧凑档 `--density:0.6` 整体收紧 40%；排版刻度下移 (`--text-hero/5xl/4xl/3xl` 缩小, `--leading-relaxed/normal/loose` = 1.5/1.4/1.55)。
- **版式层 (V2.4 新增)**: 模板末尾"紧凑销售报告风"区块用 `:root[data-density="compact"] .组件 {…}` 对 Hero/KPI/Chapter/Editorial/Pull Quote/Chart/Insight/Table/Closing 逐一重组。要点:
  - Hero → CSS grid masthead: 结论 (badge+title+subtitle) 居左、核心数字 (number+label) 居右, `min-height:auto`，首屏即见结论+KPI+首章 (不改 HTML，靠 grid-area 对扁平子元素分区)。
  - KPI Strip → `flex-wrap` 左对齐、卡片收紧，一行可容 5–6 项。
  - Chapter → 内容列由 `--content-width` 放宽到 `--content-wide`，吃掉两侧空白；标题/导语间距收紧。
  - Pull Quote → 从"居中大空带"改为左线 `border-left` callout，不再漂浮占屏。
  - Data Table → 行 padding 收到 5px，销售排名/渠道表主战场更密。
- **Anti-Default 其余五律、§15 排版纪律、§12 材质、§14 三信号无障碍在两种档位下均强制生效**, 不因密度变化而放松。

**切换示例**:
```html
<!-- 紧凑风 (模板出厂默认) -->
<html lang="zh-CN" data-density="compact">

<!-- 叙事标准风 (显式移除 data-density) -->
<html lang="zh-CN">
```

---

## 2. 排版音阶 (Type Scale — V2 Editorial)

> V2 核心升级: 三角色字体分工 + clamp() 流体排版 + 语义化 Weight/Leading/Tracking

### 2.1 字体系统 — 三角色严格分工

| 角色 | CSS Variable | 拉丁字体 | 中文字体 | 设计意图 | 使用场景 |
|:---|:---|:---|:---|:---|:---|
| **Display** | `--font-display` | Plus Jakarta Sans 800 | Noto Sans SC 900 | 视觉重音，制造张力 | Hero数字/Chapter标题/KPI大数字 |
| **Editorial** | `--font-editorial` | DM Sans 400-600 | Noto Sans SC 400-500 | 阅读舒适，编辑式体验 | 正文/叙事段落/Insight文案/Pull Quote |
| **Data** | `--font-data` | JetBrains Mono 500 | — | 等宽对齐，数据纪律 | KPI数值/表格数字/图表标注/标签 |

```css
:root {
    /* === V2 三角色字体栈 === */
    --font-display:   'Plus Jakarta Sans', 'Noto Sans SC', sans-serif;
    --font-editorial: 'DM Sans', 'Noto Sans SC', -apple-system, sans-serif;
    --font-data:      'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

    /* === 向后兼容别名 (V1 代码不必改) === */
    --font-sans:    var(--font-editorial);
    --font-mono:    var(--font-data);
    --font-kpi:     var(--font-display);

    /* === Pull Quote 衬线 (仅 scroll-narrative 模板启用; 系统衬线栈, 无外链, 离线安全) === */
    --font-serif:   Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif CJK SC', serif;
}
```

**字体纪律 (V2 新增)**:
- Display 只用于 Hero 数字、Chapter 标题、KPI 大数字 — 其他场景禁止
- Editorial 用于所有阅读性文字 — 叙事段落、Insight 文案、Pull Quote
- Data 用于所有数字场景 — 表格、图表标注、KPI 变化值
- **禁止**: 在同一行混用 Display 和 Editorial 字体

### 2.2 字号音阶 — 流体排版

```css
:root {
    /* === V2 Type Scale (clamp 流体) === */
    --text-2xs:     9px;                             /* 打印页脚、水印 */
    --text-xs:      11px;                            /* 图表标注、辅助标签 */
    --text-sm:      13px;                            /* 表格数据、Caption */
    --text-base:    16px;                            /* 正文 */
    --text-lg:      18px;                            /* 卡片标题 */
    --text-xl:      22px;                            /* Section 小标题 */
    --text-2xl:     28px;                            /* Section 主标题 */
    --text-3xl:     clamp(28px, 3.5vw, 36px);        /* KPI 数字 (V2: clamp 流体) */
    --text-4xl:     clamp(32px, 5vw, 56px);          /* Chapter 标题 (V2: 扩展上限) */
    --text-5xl:     clamp(48px, 6vw, 64px);          /* Editorial big-number */
    --text-hero:    clamp(56px, 8vw, 96px);          /* Hero 核心数字 (V2: 扩展上限) */
}
```

### 2.3 Weight / Leading / Tracking (V2.1 集成 Apple §15)

> **Apple §15 排版纪律**（来自 *The Details of UI Typography*, WWDC 2020，已翻译成 Web 实现）：
> 1. **Tracking 尺寸专属，绝不固定** —— 大字要负 tracking（字母越大越显散），微标要轻微正 tracking（提升可读性）。固定 `letter-spacing` 一定在某处是错的。
> 2. **Leading 与字号反向** —— 大字紧、正文松。
> 3. **层级由 weight + size + leading 作为一组共同构建**，而非只靠字号。
> 4. **尊重用户字号设置（Dynamic Type）** —— 全局启用 `font-optical-sizing: auto`，`html` 设 `text-size-adjust: 100%`。
> 来源 Skill: `apple-design`（§15 Typography）。

```css
:root {
    /* === Font Weight 语义 === */
    --fw-normal:     400;  /* 正文、辅助文字 */
    --fw-medium:     500;  /* 标签、KPI change */
    --fw-semibold:   600;  /* 表头、nav-header、Badge */
    --fw-bold:       700;  /* 标题、KPI 数字 */
    --fw-extrabold:  800;  /* Hero 大字、Chapter 标题 */
    --fw-black:      900;  /* 中文 Display 字体 */

    /* === Line Height: 与字号反向 (Apple §15) === */
    --leading-display: 1.05;   /* Hero 超大拉丁数字 (Apple: 大字最紧) */
    --leading-tight:   1.1;    /* 大标题 (V2.1: 1.15→1.1 更紧凑, CJK 安全) */
    --leading-snug:    1.3;    /* 卡片标题、Action Title */
    --leading-normal:  1.5;    /* 标准 */
    --leading-relaxed: 1.7;    /* 正文、Insight 文案、chapter-lead */
    --leading-loose:   1.8;    /* 长段落阅读 */

    /* === Letter Spacing: 尺寸专属, 绝不固定 (Apple §15) === */
    --tracking-display: -0.035em;  /* Hero 超大字, 越大越负 */
    --tracking-tighter: -0.03em;   /* Hero 标题 */
    --tracking-tight:   -0.02em;   /* KPI 大数字、Chapter 标题 */
    --tracking-normal:   0;        /* 正文 */
    --tracking-caption:  0.01em;   /* ≤11px 微标, 轻微正 tracking 提可读性 */
    --tracking-wide:     0.05em;   /* 大写标签 (UPPERCASE) */
    --tracking-wider:    0.08em;   /* Badge 内文字 */
    --tracking-widest:   0.12em;   /* chapter-number / hero-badge */
}
```

> **CJK 安全说明**: 中文字体需要比拉丁文更大的 leading。本报告 Hero 标题（中文 Governing Thought）使用 `--leading-tight` (1.1) 而非 `--leading-display` (1.05)，在保持紧凑的同时避免中文换行行距过挤。纯拉丁数字（`.hero-number`）才使用 `--leading-display`。

### 2.4 排版应用规范

| 语义角色 | Font Family | Font Size | Weight | Line Height | Letter Spacing | 用途 |
|:---|:---|:---|:---|:---|:---|:---|
| Hero 核心数字 | `--font-display` | `--text-hero` | `--fw-extrabold` | `--leading-display` | `--tracking-display` | Hero 区核心拉丁数字 (CJK 标题用 `--leading-tight`) |
| Chapter 标题 | `--font-display` | `--text-4xl` | `--fw-extrabold` | `--leading-tight` | `--tracking-tight` | 章节大标题 |
| KPI 数字 | `--font-display` | `--text-3xl` | `--fw-bold` | `--leading-tight` | `--tracking-tight` | KPI Strip / 卡片主数字 |
| Section 标题 | `--font-editorial` | `--text-2xl` | `--fw-bold` | `--leading-snug` | `--tracking-normal` | Section 主标题 |
| Section 小标题 | `--font-editorial` | `--text-xl` | `--fw-bold` | `--leading-snug` | `--tracking-normal` | Editorial Block h3 |
| 卡片标题 | `--font-editorial` | `--text-lg` | `--fw-semibold` | `--leading-normal` | `--tracking-normal` | Insight Card h4 |
| **正文** | `--font-editorial` | `--text-base` | `--fw-normal` | `--leading-relaxed` | `--tracking-normal` | **段落文字** |
| 表格数据 | `--font-data` | `--text-sm` | `--fw-medium` | `--leading-normal` | `--tracking-normal` | 表格 td 数字列 |
| 图表标注 | `--font-data` | `--text-xs` | `--fw-medium` | 1 | `--tracking-wide` | axisLabel、chart-tag |
| 辅助标签 | `--font-editorial` | `--text-xs` | `--fw-semibold` | 1 | `--tracking-wider` | KPI label, UPPERCASE 标签 |
| 元数据标签 | `--font-data` | `--text-xs` | `--fw-medium` | 1 | `--tracking-widest` | chapter-number / hero-badge |
| 极小微标 | `--font-data` | `--text-2xs` | `--fw-medium` | 1 | `--tracking-caption` | 打印页脚、水印 (≤11px 轻微正 tracking) |

---

## 2.5 Apple §15 排版原则集成 (V2.1)

> 本节将 `apple-design` Skill 的 §15 Typography 纪律落为本 Skill 的 Token 与组件规则。
> 集成策略：**集中管理、按需引用** —— Token 统一在 `:root` 声明，组件通过 `var(--xxx)` 引用，不内联硬编码。

### 落地的四条纪律

| # | Apple §15 原则 | 本 Skill 落地方式 | 改动点 |
| :- | :--- | :--- | :--- |
| 1 | Tracking 尺寸专属，绝不固定 | 新增 `--tracking-display`(-0.035em) / `--tracking-caption`(+0.01em)，与既有 tighter/tight/wide/wider/widest 构成完整尺寸梯度 | `:root` + 应用表 |
| 2 | Leading 与字号反向 | `--leading-display`(1.05) 用于超大数字；`--leading-tight` 由 1.15 收紧至 1.1 | `:root` + Hero/Chapter |
| 3 | 层级 = weight + size + leading 一组 | Hero/Chapter/KPI 全部改用 `var(--fw-*)` + `var(--leading-*)` + `var(--tracking-*)` 三件套 | 组件 CSS |
| 4 | 尊重 Dynamic Type | 全局 `font-optical-sizing: auto`；`html` 设 `text-size-adjust: 100%` | `body` / `html` |

### 禁止回退

- 禁止在组件内写死 `line-height: 1.15`、`letter-spacing: -0.02em` 等字面量 → 一律改为 `var(--leading-*)` / `var(--tracking-*)`。
- 新增字号时，必须按尺寸从梯度中选 tracking/leading，**不要**给所有尺寸同一个 tracking 值。
- CJK 标题不得用 `--leading-display`(1.05)，最低用 `--leading-tight`(1.1)。

### 校验联动

`scripts/validate-report.mjs` 已落地两条 P1 纪律锁，固化本集成成果：
- **排版纪律 (Apple §15)**：组件内出现硬编码 `letter-spacing` 字面量即 P1，强制走 `var(--tracking-*)`。
- **无障碍降级 (Apple §14)**：使用 `backdrop-filter` 缺 `prefers-reduced-transparency` 降级、或使用动效缺 `prefers-reduced-motion` 降级，均 P1。

### 关联集成 (V2.2)

- **§12 材质**：见 [§4.5 材质系统](#45-材质系统-materials-apple-12)，模板提供 `.glass-surface` / `.glass-surface--dark` / `.glass-surface--edge-fade` 复用类。
- **§14 三信号无障碍**：见 [§10 无障碍降级三信号](#10-可访问性-accessibility)，`prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast` 已固化进三套模板。

---

## 3. 色彩系统 V2 (三层架构)

> V2 核心升级: 品牌色 → 语义色 → 界面色 三层严格递进。
> 学习来源: Tremor 的五级语义化 + Carbon 的 $ui/$text 结构 + 铁幕·Iron 的三层配色

### 3.1 色彩策略原则

报告色彩先服务语义，再服务品牌。禁止把整个页面做成单一深蓝、单一紫、单一灰或单一暖色的"一色系报告"。默认使用:

- **定性分类色**: 区分渠道、产品、区域等并列类别
- **顺序色**: 表达从低到高、从弱到强
- **发散色**: 表达正负、超欠、增长下降
- **强调色**: 只给关键结论、风险和行动

同一含义在同一报告中必须固定颜色；同一颜色不要在不同章节表达相反语义。

### 3.2 第一层: 品牌色 (可通过 visual-theme-engine 替换)

```css
:root {
    /* === 品牌渐变 (Hero/Closing) === */
    --brand-deepest: #001d3d;  /* Hero 渐变起点，最深 */
    --brand-deep:    #003566;  /* Hero 渐变中间，KPI 数字色 */
    --brand-mid:     #0353a4;  /* Hero 渐变终点，图表主色 */
    --brand-light:   #006daa;  /* V2 保留: 图表辅助色 */
    --brand-accent:  #0369a1;  /* 章节号、链接、按钮，白底 AA */
    --brand-faint:   #e8f4fd;  /* V2 新增: 极浅品牌底色 (Tag 背景/高亮行) */
    --brand-muted:   #b8d8e8;  /* V2 新增: 柔和品牌辅助 (分隔线/图表辅助) */
}
```

### 3.3 第二层: 语义色 (情感固定，不随主题变)

```css
:root {
    /* === 语义色 — 浅底专用 (Light Mode) === */
    --semantic-growth:         #047857;  /* 增长/积极 — AA 深绿 */
    --semantic-growth-bg:      #ecfdf5;  /* Badge/卡片底色 */
    --semantic-growth-text:    #065f46;  /* 深色文字(需高对比时) */

    --semantic-risk:           #b91c1c;  /* 风险/警告 — AA 深红 */
    --semantic-risk-bg:        #fef2f2;
    --semantic-risk-text:      #991b1b;

    --semantic-opportunity:    #1d4ed8;  /* 机会/战略 — AA 深蓝 */
    --semantic-opportunity-bg: #eff6ff;
    --semantic-opportunity-text: #1e40af;

    --semantic-warning:        #b45309;  /* 监控/关注 — AA 深琥珀 */
    --semantic-warning-bg:     #fffbeb;
    --semantic-warning-text:   #92400e;

    --semantic-neutral:        #475569;  /* 中性/参考 — AA 深灰 */
    --semantic-neutral-bg:     #f1f5f9;
    --semantic-neutral-text:   #334155;

    /* === 语义色 — 深底专用 (Hero/Closing 区) === */
    --semantic-growth-dark:      #6ee7b7;  /* emerald-300 */
    --semantic-risk-dark:        #fca5a5;  /* red-300 */
    --semantic-opportunity-dark: #93c5fd;  /* blue-300 */
    --semantic-warning-dark:     #fcd34d;  /* amber-300 */

    /* === 向后兼容别名 (V1 代码不必改) === */
    --color-growth:         var(--semantic-growth);
    --color-growth-bg:      var(--semantic-growth-bg);
    --color-risk:           var(--semantic-risk);
    --color-risk-bg:        var(--semantic-risk-bg);
    --color-opportunity:    var(--semantic-opportunity);
    --color-opportunity-bg: var(--semantic-opportunity-bg);
    --color-warning:        var(--semantic-warning);
    --color-neutral:        var(--semantic-neutral);

    /* === Action Tag 暗底专用亮色 (V1 兼容) === */
    --color-urgent-light:    var(--semantic-risk-dark);
    --color-strategic-light: var(--semantic-opportunity-dark);
    --color-monitor-light:   var(--semantic-warning-dark);
}
```

### 3.4 第三层: 界面色 (跟随 Light/Dark 模式)

```css
:root {
    /* === Surface 表面色 === */
    --surface-primary:    #ffffff;   /* 页面主背景 */
    --surface-secondary:  #f8fafc;   /* 卡片/KPI Strip 底色 */
    --surface-tertiary:   #f1f5f9;   /* 表格斑马纹/Editorial Data 底色 */
    --surface-inverse:    #0f172a;   /* V2: 深色 section 内的界面色 */

    /* === Text 文字色 === */
    --text-primary:    #1a1a2e;   /* 标题、正文 */
    --text-secondary:  #475569;   /* 副标题、说明文字 */
    --text-tertiary:   #64748b;   /* 辅助标签、图表轴标签，白底 AA */
    --text-inverse:    #f8fafc;   /* V2: 深底上的文字 */
    --text-muted:      #cbd5e1;   /* V2 新增: 极淡文字(装饰性) */

    /* === Border 边框色 === */
    --border-default:   #e2e8f0;   /* 卡片边框、分隔线 */
    --border-emphasis:  #cbd5e1;   /* V2 新增: 强调型边框 */
    --border-subtle:    #f1f5f9;   /* V2 新增: 极淡边框 */

    /* === 向后兼容别名 (V1 代码不必改) === */
    --color-bg:             var(--surface-primary);
    --color-text:           var(--text-primary);
    --color-text-secondary: var(--text-secondary);
    --color-text-tertiary:  var(--text-tertiary);
    --color-border:         var(--border-default);
    --color-bg-subtle:      var(--surface-secondary);
}
```

### 3.5 Dark Mode 完整对偶 (V2 新增)

```css
[data-theme="dark"],
.dark-mode {
    /* === Surface === */
    --surface-primary:    #0f172a;
    --surface-secondary:  #1e293b;
    --surface-tertiary:   #334155;
    --surface-inverse:    #ffffff;

    /* === Text === */
    --text-primary:    #f8fafc;
    --text-secondary:  #94a3b8;
    --text-tertiary:   #64748b;
    --text-inverse:    #0f172a;
    --text-muted:      #475569;

    /* === Border === */
    --border-default:   #334155;
    --border-emphasis:  #475569;
    --border-subtle:    #1e293b;

    /* === 语义色 Dark 覆写 (深底上用亮变体) === */
    --semantic-growth:      #34d399;
    --semantic-risk:        #fb7185;
    --semantic-opportunity: #60a5fa;
    --semantic-warning:     #fbbf24;
    --semantic-neutral:     #94a3b8;

    --semantic-growth-bg:      rgba(52, 211, 153, 0.12);
    --semantic-risk-bg:        rgba(251, 113, 133, 0.12);
    --semantic-opportunity-bg: rgba(96, 165, 250, 0.12);
    --semantic-warning-bg:     rgba(251, 191, 36, 0.12);

    /* === 阴影 Dark 覆写 === */
    --shadow-sm:  0 1px 2px rgba(0,0,0,0.3);
    --shadow-md:  0 4px 12px rgba(0,0,0,0.4);
    --shadow-lg:  0 12px 32px rgba(0,0,0,0.5);
}
```

### 3.6 图表色板

```css
:root {
    /* === 定性分类色 (最多 6 类) === */
    --chart-1: var(--brand-mid);          /* #0353a4 主系列 */
    --chart-2: var(--semantic-growth);    /* #047857 第二系列 */
    --chart-3: #d97706;                  /* 琥珀 — 第三系列 */
    --chart-4: #7c3aed;                  /* 紫色 — 第四系列 */
    --chart-5: #0891b2;                  /* 青色 — 第五系列 */
    --chart-6: #be123c;                  /* 玫红 — 第六系列 (克制使用) */

    /* === 顺序色 (热力图/渐变) === */
    --seq-low:   #dbeafe;
    --seq-mid:   #60a5fa;
    --seq-high:  #1d4ed8;

    /* === 发散色 (正负对比) === */
    --div-negative: var(--semantic-risk);
    --div-neutral:  var(--semantic-neutral);
    --div-positive: var(--semantic-growth);
}
```

---

## 4. 阴影系统 (V2 分层)

```css
:root {
    /* === V2 四级阴影 === */
    --shadow-sm:        0 1px 2px rgba(0,0,0,0.05);           /* 静态卡片 */
    --shadow-md:        0 4px 12px rgba(0,0,0,0.08);          /* Hover 态 */
    --shadow-lg:        0 12px 32px rgba(0,0,0,0.1);          /* 浮层/Modal */
    --shadow-elevated:  0 20px 40px -5px rgba(0,0,0,0.12);    /* V2 新增: 最高层级 */

    /* === V2 品牌色阴影 (Hero/Closing 专用) === */
    --shadow-brand:  0 8px 24px rgba(3, 83, 164, 0.15);
}
```

---

## 4.5 材质系统 (Materials, Apple §12)

> 毛玻璃承载浮动功能层, 让结构浮现而不抢焦点。报告中最典型的承载点是 **sticky 表头** (内容滚动其下)。
> 集成自 apple-design §12。模板已提供 `.glass-surface` 复用类, 直接挂到浮动元素即可。

```css
/* 浅色材质 (默认浮动层) */
.glass-surface {
    background: rgba(255, 255, 255, 0.72);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-top: 1px solid rgba(255, 255, 255, 0.45);  /* 亮边 = 光打在材质上 */
    box-shadow: var(--shadow-lg);
}
/* 深底材质变体 (深底浮动层, 如 sticky 表头) */
.glass-surface--dark {
    background: rgba(0, 29, 61, 0.82);
    backdrop-filter: blur(12px) saturate(160%);
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}
/* 边缘渐隐遮罩: 用滚动边缘效果替代硬 1px 分隔线 */
.glass-surface--edge-fade {
    -webkit-mask-image: linear-gradient(to bottom, #000 85%, transparent 100%);
    mask-image: linear-gradient(to bottom, #000 85%, transparent 100%);
}
```

**材质纪律 (Apple §12)**:
- 材质重量编码层级: 越大表面越厚 (更强 blur + 更深阴影)。
- **切勿将浅色毛玻璃叠在另一浅色毛玻璃上** (可读性崩塌)。
- 亮色文字落于毛玻璃上时, 用更高对比 + 略重字重 + 轻微正 tracking (见 §2.3 `--tracking-caption`)。
- 打印/导出场景: `@media print` 中须将毛玻璃转为实底并去除 `backdrop-filter`/`mask-image` (模板已处理 sticky 表头)。

---

## 5. 圆角系统

```css
:root {
    --radius-sm:    6px;     /* Badge、小型标签 */
    --radius:       12px;    /* 标准卡片、输入框 */
    --radius-lg:    16px;    /* 大型卡片、图表容器 */
    --radius-xl:    24px;    /* V2 新增: 特殊容器 */
    --radius-full:  100px;   /* 胶囊型 Badge/Tag */
}
```

---

## 6. 布局系统

```css
:root {
    /* === 内容宽度 === */
    --content-width:     960px;   /* 编辑式阅读宽度 (叙事段落) */
    --content-wide:     1200px;   /* 宽版 (图表/表格) */
    --content-full:     1400px;   /* V2 新增: Bento Brief 满宽 */

    /* === Bento Grid (V2 新增) === */
    --bento-columns:    12;
    --bento-gap:        var(--space-4);

    /* === Sidebar (运营报告用) === */
    --sidebar-width:    260px;
}
```

---

## 7. Motion Tokens (V2 新增)

> 学习来源: Carbon motion 包的 duration/easing 标准化 + guizang 的 recipe 驱动

```css
:root {
    /* === Easing 曲线 === */
    --ease-productive:  cubic-bezier(0.2, 0, 0.38, 0.9);    /* 功能性过渡 (hover/toggle) */
    --ease-expressive:  cubic-bezier(0.16, 1, 0.3, 1);      /* 入场/戏剧性 (scroll-reveal) */
    --ease-exit:        cubic-bezier(0.4, 0.14, 1, 1);       /* 退场/消失 */
    --ease-spring:      cubic-bezier(0.34, 1.56, 0.64, 1);   /* V2: 弹性 (CountUp/Badge) */

    /* === Duration === */
    --duration-instant:   70ms;     /* Tooltip、Focus ring */
    --duration-fast:      150ms;    /* Hover、Active */
    --duration-moderate:  300ms;    /* 组件过渡、Badge 出现 */
    --duration-slow:      500ms;    /* Scroll Reveal */
    --duration-slower:    700ms;    /* 入场动效 (stagger 元素) */
    --duration-dramatic:  1200ms;   /* CountUp 数字动画 */

    /* === Stagger (V2 新增) === */
    --stagger-fast:       40ms;     /* 密集列表 stagger */
    --stagger-normal:     60ms;     /* 标准 cascade stagger */
    --stagger-slow:       100ms;    /* Hero 仪式感 stagger */
    --stagger-dramatic:   160ms;    /* Pipeline 逐步揭示 */
}
```

---

## 8. 表头系统 (V2 补充)

```css
:root {
    /* === 表头 (支持品牌色覆写) === */
    --th-bg:     var(--brand-deep);     /* 默认品牌深色表头 */
    --th-color:  #f1f5f9;              /* Slate-100 高反差白字 */
    --th-bg-alt: #1e293b;              /* V2: 中性深色表头 (不与品牌色抢) */
}
```

---

## 9. 响应式断点

```css
/* 宽屏桌面 (默认) */
/* 无 media query */

/* 窄屏笔记本 */
@media (max-width: 1024px) {
    :root { --sidebar-width: 60px; }
    .sidebar .nav-text, .sidebar-header span { display: none; }
    .nav-item { text-align: center; padding: 12px 0; font-size: 0; }
    .nav-item::before { font-size: 16px; }
    .kpi-grid { grid-template-columns: repeat(3, 1fr); }
}

/* 平板 & 窄屏 */
@media (max-width: 768px) {
    .sidebar { display: none; }
    .main-content { margin-left: 0; padding: var(--space-4); }
    .kpi-grid { grid-template-columns: repeat(2, 1fr); }
    .data-grid-table { font-size: 10px; }
    .data-grid-table th, .data-grid-table td { padding: var(--space-1) var(--space-2); }
    /* V2: Scroll Narrative 移动端适配 */
    .editorial { grid-template-columns: 1fr; }
    .editorial-reverse { direction: ltr; }
    .kpi-strip { flex-wrap: wrap; }
    .kpi-strip-item { border-right: none; border-bottom: 1px solid var(--border-default); }
    .chapter { padding: var(--space-16) var(--space-5); }
    .chapter-title { font-size: var(--text-2xl); }
}

/* 打印 */
@media print {
    .no-print, .sidebar, .scroll-progress, .hero-scroll-hint { display: none !important; }
    .main-content { margin-left: 0; padding: var(--space-5); max-width: 100%; }
    .section { display: block !important; page-break-inside: avoid; }
    .report-card { box-shadow: none; border: 1px solid #ddd; break-inside: avoid; }
    .reveal { opacity: 1 !important; transform: none !important; }
    .hero { min-height: auto; padding: var(--space-10); break-after: page; }
    .chapter { padding: var(--space-8); break-inside: avoid; }
    .closing { break-before: page; }
    body { font-size: 12px; }
}

/* V2: prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    .hero-number { animation: none !important; }
    .scroll-progress { transition: none !important; }
    .hero-scroll-hint { animation: none !important; }
}
```

---

## 10. 可访问性 (Accessibility)

### WCAG AA 对比度验证

| 文字色 | 背景色 | 对比度 | AA 状态 |
|:---|:---|:---|:---|
| `--text-primary` (#1a1a2e) | `--surface-primary` (#ffffff) | 16.4:1 | Pass |
| `--text-secondary` (#475569) | `--surface-primary` (#ffffff) | 7.58:1 | Pass (AA) |
| `--text-tertiary` (#64748b) | `--surface-primary` (#ffffff) | 4.76:1 | Pass (AA) |
| `--text-inverse` (#f8fafc) | `--surface-inverse` (#0f172a) | 15.3:1 | Pass |
| `--semantic-growth-dark` (#6ee7b7) | `--surface-inverse` (#0f172a) | 9.2:1 | Pass |
| `--semantic-risk-dark` (#fca5a5) | `--surface-inverse` (#0f172a) | 7.1:1 | Pass |
| `--brand-accent` (#0369a1) | `--surface-primary` (#ffffff) | 5.93:1 | Pass (AA) |

### Focus 状态

```css
:focus-visible {
    outline: 2px solid var(--brand-accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
}
```

### 数字等宽对齐

```css
/* 所有数字场景必须启用 tabular-nums */
.kpi-value, .kpi-strip-value, .data-table td.num,
.heatmap-cell, .rank-badge, .big-number, .hero-number,
[class*="metric"], [data-number] {
    font-variant-numeric: tabular-nums;
    font-family: var(--font-data);
}
```

### 无障碍降级三信号 (Apple §14)

> 减少动效 ≠ 无反馈, 而是更温和、非前庭性的等效。报告须响应三个**独立**信号, 并固化进组件。

```css
/* 信号 1: 减少动效 — 替换滑动/弹性/视差为短促淡入或静态 */
@media (prefers-reduced-motion: reduce) {
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    .glass-surface { transition: none !important; }
}

/* 信号 2: 降低透明度 — 毛玻璃转实底, 去除 blur */
@media (prefers-reduced-transparency: reduce) {
    .glass-surface { background: var(--surface-primary); backdrop-filter: none; -webkit-backdrop-filter: none; }
    .glass-surface--dark { background: var(--brand-deep); backdrop-filter: none; -webkit-backdrop-filter: none; }
}

/* 信号 3: 增强对比 — 实底 + 定义对比边框 */
@media (prefers-contrast: more) {
    .glass-surface { background: var(--surface-primary); border: 1px solid var(--text-primary); }
    .glass-surface--dark { background: var(--brand-deep); border: 1px solid #fff; }
}
```

**校验约束**: `validate-report.mjs` 已将以上两处纳入 **P1** —
1. 使用 `backdrop-filter` 但缺 `prefers-reduced-transparency` 降级 → P1;
2. 使用动效但缺 `prefers-reduced-motion` 降级 → P1。

---

## 11. 主题变体 (V2: 三套完整主题)

> 主题通过覆写 `--brand-*` + 第三层界面色实现。情感色 (第二层) **不随主题变**。

### Theme: Deep Ocean (默认)

即上方所有 `:root` 定义。品牌色系: 深海蓝。

### Theme: Executive Dark

```css
[data-theme="executive-dark"] {
    --brand-deepest: #0c0a09;
    --brand-deep:    #1c1917;
    --brand-mid:     #f59e0b;   /* 金色强调 */
    --brand-accent:  #fbbf24;
    --brand-faint:   rgba(245, 158, 11, 0.08);
    --brand-muted:   rgba(245, 158, 11, 0.25);

    --surface-primary:   #0f172a;
    --surface-secondary: #1e293b;
    --surface-tertiary:  #334155;
    --text-primary:      #f8fafc;
    --text-secondary:    #94a3b8;
    --text-tertiary:     #64748b;
    --border-default:    #334155;

    --th-bg: #292524;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
    --shadow-md: 0 4px 12px rgba(0,0,0,0.4);

    --chart-1: #f59e0b;
    --chart-2: #3b82f6;
    --chart-3: #10b981;
    --chart-4: #fb7185;
    --chart-5: #a78bfa;
    --chart-6: #22d3ee;
}
```

### Theme: Warm Earth

```css
[data-theme="warm-earth"] {
    --brand-deepest: #292524;
    --brand-deep:    #44403c;
    --brand-mid:     #ea580c;   /* 橙色强调 */
    --brand-accent:  #ea580c;
    --brand-faint:   rgba(234, 88, 12, 0.06);
    --brand-muted:   rgba(234, 88, 12, 0.20);

    --surface-primary:   #fafaf9;
    --surface-secondary: #ffffff;
    --surface-tertiary:  #f5f5f4;
    --text-primary:      #292524;
    --text-secondary:    #78716c;
    --text-tertiary:     #a8a29e;
    --border-default:    #e7e5e4;

    --th-bg: #44403c;
    --chart-1: #ea580c;
    --chart-2: #65a30d;
    --chart-3: #0284c7;
    --chart-4: #dc2626;
    --chart-5: #7c3aed;
    --chart-6: #0891b2;
}
```

---

## 12. Token 速查表 (按使用频率)

### 日常高频 Token (80% 场景覆盖)

| 用途 | Token |
|:---|:---|
| 正文字体 | `var(--font-editorial)` |
| 数字字体 | `var(--font-data)` |
| 标题字体 | `var(--font-display)` |
| 正文字号 | `var(--text-base)` |
| 卡片间距 | `var(--space-6)` |
| 组件 gap | `var(--space-4)` |
| 页面背景 | `var(--surface-primary)` |
| 正文色 | `var(--text-primary)` |
| 辅助文字色 | `var(--text-secondary)` |
| 卡片边框 | `var(--border-default)` |
| 标准圆角 | `var(--radius)` |
| 正增长 | `var(--semantic-growth)` |
| 负增长 | `var(--semantic-risk)` |
| Hover 阴影 | `var(--shadow-md)` |
| 入场动效 | `var(--ease-expressive)` + `var(--duration-slow)` |
