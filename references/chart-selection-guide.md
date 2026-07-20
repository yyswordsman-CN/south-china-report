# 图表选择与高级图表模板

> McKinsey 核心方法: 选错图表 = 传递错误信息。
> 版本: V2 (2026-07) — 增加 Agent 选图引擎 / IBCS 语义规范 / 密度轴图表形态 / 受众分层策略
> 来源: McKinsey/BCG 图表设计规范 + Umbrex 咨询可视化指南 + Tufte 数据墨水比原则 + IBCS (Hichert SUCCESS) + Stephen Few 子弹图规范

### 目录

0. [Agent 选图引擎](#0-agent-选图引擎-chart-selection-engine) — 业务问题→意图→图表 强制路由
1. [图表选择决策树](#1-图表选择决策树-chart-selection-decision-tree) — 选图黄金法则 + 反模式处理表
2. [高级图表模板](#2-高级图表模板) — 点阵图 / 斜率图 / BCG矩阵 / Treemap / Marimekko
3. [轴线完整性规范](#3-轴线完整性规范-axis-integrity-rules) — 基线规则 + ECharts 强制实现
4. [标注系统](#4-标注系统-annotation-patterns) — 参考线 / 异常高亮 / 数据点标注 / 直接标注规则
5. [色阶系统](#5-色阶系统-color-ramp-system) — 序列色阶 / 发散色阶 / 应用函数
6. [IBCS 语义规范](#6-ibcs-语义规范-销售报告硬性视觉语法) — 轴向 / 实际·计划·预测编码 / 三段式标题 / 红绿纪律
7. [密度轴图表形态](#7-密度轴图表形态-紧凑--简陋) — 紧凑档的密集图表词汇表 + 信息预算
8. [受众分层图表策略](#8-受众分层图表策略) — L1 高管 / L2 总监 / L3 一线 各自的图表组合

---

## 0. Agent 选图引擎 (Chart Selection Engine)

> **强制流程**: Agent 接到任何报告任务, 在写第一个图表前, 必须把每个 Chapter 的分析问题先路由到下表的**意图池**, 再按意图取图——禁止"数据长这样所以画这个"的倒序选图。

### 0.0 方法适用性 Gate（先于选图，机器可读）

每个方法先读取 `metrics.method_applicability` / `insights.method_applicability`：

| 方法 | 最低适用条件 | 不满足时 |
|:---|:---|:---|
| MK 趐势 / 稳健 Z | 日历连续、有序、至少 4 点；`n<8` 只报方向 | `SKIPPED: requires_regular_series_n_gte_4`，关闭趋势章 |
| PVM | 可加金额 + 可加数量 + 有效时间基线 + 正分母 | `SKIPPED/BLOCKED`，禁止量价象限与瀑布 |
| TopN | 至少一个含 2 个以上分组的维度 | `SKIPPED: requires_dimension_with_multiple_groups` |
| Pareto / HHI | nonnegative + additive + 有效份额 | `SKIPPED: requires_nonnegative_additive_measure` |
| HHI/Top5 风险分级 | 上述条件 + 显式业务政策阈值 | 无政策只输出 `classification=descriptive, level=null` |
| 斜率图 | 两个明确可比期间 + 指标方向 + 单位 | 缺合同即跳过，不得硬编码“去年/今年” |

`SKIPPED` 是正常可控降级，不是失败；只有必需字段、主键/业务粒度、必需类型或单位漂移，以及现有数据质量 P0 越线才进入全局 `BLOCKED`。

### 0.1 业务问题 → 意图 → 图表 路由表

| 用户/章节在问什么 (典型销售话术) | 意图分类 | 首选图表 | 密集形态替代 (紧凑档优先) |
|:---|:---|:---|:---|
| "各战区/渠道/品类谁高谁低?" | 排名对比 | 水平条形图 (降序) | Lollipop / 点阵图 |
| "谁在涨、谁在崩?" (型号/客户/门店) | 涨跌 Top-N | **增长/下滑双榜** (`component-patterns.md` §1.8) | 同左, 按绝对增减额排 |
| "目标完成得怎么样? 哪些落后?" | 目标达成 | **子弹图** (多指标垂直阵列) | 子弹图阵列 + 进度条表格列 |
| "为什么比上月/预测差了 X 万?" | 增量归因 | **瀑布图** (Revenue Bridge) | 瀑布图 (无可替代, 归因唯一解) |
| "毛收入怎么变成净利润的?" | 结构侵蚀 | P&L 瀑布图 | 同左 |
| "趋势怎么走? 是否放缓/反转?" | 时间趋势 | 折线/面积图 (时间强制横轴) | Sparkline 行 (嵌入表格) |
| "多个战区的趋势模式有何不同?" | 多体趋势对比 | Small Multiples 网格 | 同左 (本身就是密集形态) |
| "占比结构怎么变的?" | 构成 | 堆叠条形 / 100% 堆叠 | Treemap / 热力表 |
| "两个可比期的排名/数值怎么变?" | 两期变化 | 方向感知斜率图 (Slope) | 表格 + Δ 列 + 方向 Badge |
| "折扣/投入和产出有关系吗?" | 相关性 | 散点图 (+趋势线) | 同左, 加对数/线性拟合线 |
| "漏斗哪一环在漏?" | 转化流失 | 水平漏斗条形图 (带转化率标签) | 同左 (禁用梯形漏斗, 面积不可比) |
| "哪些单子卡住了?" | 停滞诊断 | 散点图 (X=停留天数, Y=金额) | 表格条件格式 (红=超期) |
| "全量明细给我看" | 明细复算 | 高密度表格 + 条件格式 | 表格 + Sparkline + Badge (三合一) |

### 0.1b 数据可得性降级 (缺目标/预算数据时强制)

> **触发**: Data Contract 阶段必答"有无目标/预算/计划字段?"。**没有目标数据就禁止画达成类图表**——不许编造目标 (违反"数据至上")。按下表自动降级:

| 原想画 (需目标数据) | 无目标数据时降级为 | 说明 |
|:---|:---|:---|
| 达成率 KPI / 完成度 | 同比(YoY) / 环比(MoM) KPI | 用"比去年/上期"替代"比目标" |
| 子弹图 (目标 vs 实际) | 降序水平条形 + YoY 色 / 结构渗透率 | 展示排名与同比方向 |
| 进度条 (达成%) | Sparkline 趋势 / 增长下滑双榜 | 展示走势与涨跌 |
| "完成度分析"整块 | "同比/结构分析"块 | 换叙事框架, 不换成假目标 |

> IBCS 的实际/计划/预测三态编码 (§6.2) 同理: 无"计划"数据时只画实际值, 不画空心目标柱。

### 0.2 选图前置校验 (每图必过)

1. **意图先行**: 本图回答的是上表哪一行? 答不出 = 不该画这张图。
2. **结论标题**: Action Title 写好了吗? 标题写不出结论 = 图表还没想清楚。
3. **对比基准** (无对比即无分析): 本图带了哪类基准 — 时间(同比/环比) / 结构(跨战区/渠道) / 目标(达成线/Benchmark/历史极值)? 一类都没有的裸数字图 = 违规。
4. **数据墨水比** (Tufte): 删掉网格线/图例/边框/背景色后信息是否受损? 不受损就删。图表中每一滴"墨水"应随数据变化而变化。
5. **反模式扫描**: 对照 §1 反模式表 + §6 IBCS 纪律。
6. **密度适配**: 紧凑档报告 → 优先取路由表最后一列的密集形态 (见 §7)。
7. **方向合同**: 读取 `measure.direction`；`lower_is_better` 的下降才是有利，`neutral` 不使用红绿好坏色。
8. **标签/轴域压力**: 调用 `scripts/chart-semantics.mjs` 的动态轴域与分类布局策略；长标签优先横向、高基数先 TopN+明细表、极端值与负数必须进入轴域。

---

## 1. 图表选择决策树 (Chart Selection Decision Tree)

> **强制规则**: 每次创建图表前，必须先用此决策树确认图表类型。禁止凭直觉选图。

```
你要展示什么？(What's the message?)
│
├─ 比较 (Comparison)
│   ├─ 少量分类 (≤5)
│   │   ├─ 精确值重要 → 柱状图 (Bar)
│   │   └─ 排名重要 → 点阵图 (Dot Plot)
│   ├─ 多分类 (>5) → 横向柱状图 (Horizontal Bar)
│   ├─ 前后对比 (Before/After) → 斜率图 (Slope Chart)
│   ├─ 多维度密集对比 → 子弹图 (Bullet Chart)
│   └─ 跨区域/时间段对比 → Small Multiples
│
├─ 趋势 (Trend over time)
│   ├─ 单指标趋势 → 折线图 (Line)
│   ├─ 多指标趋势 → 多折线 (≤4 系列) / Small Multiples (>4)
│   ├─ 组合占比变化 → 堆叠面积图 (Stacked Area)
│   └─ 高密度趋势 → Sparkline (表格内嵌)
│
├─ 构成 (Composition / Part-to-whole)
│   ├─ 简单占比 (≤5 类) → 100%堆叠条形 / 堆叠柱状 (Stacked Bar)  [禁饼图/环形: 与 validator 一致]
│   ├─ 层级构成 → Treemap
│   ├─ 流转/分配 → Sankey 桑基图
│   └─ 双维度占比 → Marimekko (宽度=市场规模, 高度=份额)
│
├─ 归因 (Attribution / Bridge)
│   ├─ 单因素归因 → 瀑布图 (Waterfall / Revenue Bridge)
│   ├─ 三因素归因 → 量价(PVM)瀑布图 (Price×Volume×Mix, 用 §1 瀑布图组件实现)
│   └─ 多因素同时展示 → 力矩图 / 龙卷风图
│
├─ 关系 (Relationship)
│   ├─ 两变量关系 → 散点图 (Scatter)
│   ├─ 三变量关系 → 气泡图 (Bubble)
│   └─ 战略定位 → BCG Matrix / 四象限图
│
├─ 达成 (Achievement / Progress)
│   ├─ 密集对比 (多指标) → 子弹图 (Bullet)
│   ├─ 轻量单指标 → 进度条 (Progress Bar)
│   └─ 达成/进度 → 子弹图 (Bullet)  [Gauge 仪表盘被 validator 默认禁用, 勿用]
│
└─ 分布 (Distribution)
    ├─ 单变量频率 → 直方图 (Histogram)
    ├─ 多组对比 → 箱线图 (Box Plot)
    └─ 地理分布 → 热力地图 (Choropleth)
```

> **出厂代码边界 (硬提示)**: 本 Skill 的 `chart-patterns.md` 只交付 6 种带代码的图表——瀑布(§1)/子弹(§2)/进度条(§3)/Small Multiples(§4)/点阵 Lollipop(§5)/斜率 Slope(§6)。量价(PVM)归因用 §1 瀑布图组件实现(非独立组件)。决策树里的 **Treemap / Sankey / Marimekko / 气泡图(Bubble) / BCG 矩阵 / 热力地图(Choropleth)** 均**无出厂组件**,需外接第三方或自写,用前必须确认可实现;**无把握则降级为降序水平条形 / 高密度表格**,不要交付半成品图位。

### 选图黄金法则

| # | 法则 | 说明 |
|:---|:---|:---|
| 1 | **饼图/环形 = 默认禁用** | 构成一律用 100%堆叠条形/Treemap；仅用户明确要求且 ≤3 类才可破例, 须在交付说明写明理由 (与 validator P1 一致) |
| 2 | **3D = 永远禁止** | 3D 图表扭曲数据感知, 无任何信息增益 |
| 3 | **双轴图 = 默认禁用** | 优先拆成上下双图或 Small Multiples；确需使用必须标注左右轴含义、逻辑关系和防误读说明 |
| 4 | **系列 ≤ 4** | 单图超过 4 个系列 → 改用 Small Multiples |
| 5 | **时间轴 = 左→右** | 时间维度只能从左到右, 禁止反向 |
| 6 | **柱图基线 = 0** | 柱状/条形图 Y 轴必须从 0 开始 (McKinsey 硬规则) |

### 反模式处理表

| 反模式 | 为什么危险 | 默认替代 |
|:---|:---|:---|
| 3D 柱/饼/面积 | 透视会扭曲数值感知 | 2D 柱图、条形图、Treemap |
| 双 Y 轴 | 容易制造虚假相关 | 上下双图、指数化折线、Small Multiples |
| 复杂饼图 | 切片难比较，标签易重叠 | Treemap、堆叠条形图、排序表 |
| 非零基线柱图 | 夸大差距 | 从 0 起柱图，或改折线/点阵图 |
| 彩虹色分类 | 颜色含义混乱 | 语义色 + 有限分类色 |
| 图表无结论标题 | 读者不知道看什么 | Action Title + 直接标注 |
| 裸增长率 (无绝对基数) | 小基数造成"+500%"伪高增长错觉 | 增长率必须并列绝对值/基数 (如 "+150% (由2台增至5台)") |
| 孤立平均值 | 均值掩盖极端分布 (少数大单拉高"均价") | 配分布直方图/箱线, 或并列中位数 |
| 小样本/低基数同比 | 基数极小时同比剧烈波动, 易把噪声当信号 | 标注"样本有限, 趋势待观察", 并列绝对基数, 不据单期波动下结论 |

---

## 2. 高级图表模板索引

> **代码模板统一维护在 `references/chart-patterns.md`**，此处仅列选型速查。

| 图表 | 场景 | 代码位置 |
|:---|:---|:---|
| Small Multiples 网格 | 多主体同维趋势对比 (4–8 个) | `chart-patterns.md` §4 |
| 点阵图 (Dot Plot / Lollipop) | 替代柱状图，精确对比，视觉更轻量 | `chart-patterns.md` §5 |
| 斜率图 (Slope Chart) | 两个时期之间的排名/数值变化 | `chart-patterns.md` §6 |
| BCG 矩阵 / 四象限气泡图 | 战略定位分析，双维度 + 气泡大小 | 暂无出厂代码，需外接组件/自写，用前确认可实现 |
| Treemap (层级构成) | 产品/渠道/客户收入占比层级 | 暂无出厂代码，需外接组件/自写，用前确认可实现 |
| Marimekko (双维度构成) | 渠道市场规模(宽度) × 份额(高度) | 暂无出厂代码，需外接组件/自写，用前确认可实现 |
| 瀑布图 (Waterfall) | 收入归因分析，因素增减拆解 | `chart-patterns.md` §1 |
| 子弹图 (Bullet Chart) | 目标 vs 实际密集对比 | `chart-patterns.md` §2 |
| 进度条 (Progress Bar) | 达成率轻量展示 | `chart-patterns.md` §3 |

---

## 3. 轴线完整性规范 (Axis Integrity Rules)

> **来源**: McKinsey Chart Design Rules (Umbrex)

| 图表类型 | 基线规则 | 原因 |
|:---|:---|:---|
| 柱状图/条形图 | **Y 轴必须从 0 开始** | 非零基线会放大差异, 误导决策 |
| 折线图 | Y 轴可从非零开始 | 关注变化趋势而非绝对值, 但范围必须明确标注 |
| 散点图 | 自由裁剪范围 | 关注相关性, 非绝对值 |
| 瀑布图 | 不要求从零 | 悬浮柱无意义的基线 |

### ECharts 强制实现

```javascript
// 柱状图: 强制从零
yAxis: {
    min: 0,                    // 硬性要求
    axisLabel: { 
        fontSize: 11, 
        color: '#64748B',
        formatter: function(value) {
            if (value >= 10000) return (value / 10000).toFixed(1) + '万';
            return value.toLocaleString();
        }
    },
    splitLine: {
        lineStyle: { color: '#F1F5F9', type: 'dashed' }
    },
    splitNumber: 5             // 合理的刻度数量
}

// 折线图: 自动裁剪但标注范围
yAxis: {
    // 不设 min，让 ECharts 自适应
    // 但必须在 axisLabel 中显示清晰的范围
    axisLabel: {
        fontSize: 11,
        color: '#64748B',
        formatter: '{value}%'  // 标注单位
    },
    // 可选: 添加参考线标注上下界
    // markLine: { data: [{ yAxis: targetValue, name: '目标' }] }
}
```

---

## 4. 标注系统 (Annotation Patterns)

> **异常点原因标注 (硬规则)**: 图表中肉眼可见的异常波动 (骤跌/骤涨/断档) 必须就地附原因注释 (如 "2月: 春节停产" / "6·18 大促拉动"), 用 §4.3 markPoint 或 `.chart-annotation` 标签实现。让读者自己猜异常原因 = 信任机制缺陷; 已知异常不标注, AI 归因也会被带偏。

### 4.1 参考线 (Reference Line)

```javascript
// 在任何系列中添加
markLine: {
    silent: true,
    symbol: 'none',
    lineStyle: { 
        color: '#94A3B8', 
        type: 'dashed', 
        width: 1.5 
    },
    label: {
        position: 'end',
        fontSize: 11,
        fontWeight: 600,
        color: '#64748B',
        formatter: '{b}: {c}'
    },
    data: [
        { yAxis: 35, name: '目标线' },    // 水平参考
        { xAxis: '6月', name: '截止日' }  // 垂直参考
    ]
}
```

### 4.2 异常区间高亮 (Shaded Region)

```javascript
markArea: {
    silent: true,
    itemStyle: { 
        color: 'rgba(239, 68, 68, 0.06)'  // 极淡红色警告区
    },
    label: {
        show: true,
        position: 'insideTop',
        fontSize: 10,
        color: '#EF4444',
        fontWeight: 500
    },
    data: [
        [
            { name: '预警区间', yAxis: 0 },
            { yAxis: 20 }  // 低于 20% 为危险区
        ]
    ]
}
```

### 4.3 数据点高亮 (Key Point Callout)

```javascript
markPoint: {
    symbol: 'circle',
    symbolSize: 8,
    itemStyle: { color: '#EF4444', borderColor: '#FFF', borderWidth: 2 },
    label: {
        show: true,
        position: 'top',
        fontSize: 11,
        fontWeight: 700,
        color: '#EF4444',
        backgroundColor: '#FEF2F2',
        borderRadius: 4,
        padding: [4, 8],
        formatter: '{c}'
    },
    data: [
        { type: 'min', name: '最低点' },
        { type: 'max', name: '最高点' }
    ]
}
```

### 4.4 直接标注 vs 图例 (Direct Labeling Rule)

> **McKinsey 规则**: 优先在图表上直接标注, 消除图例。

```javascript
// 正确: 直接在折线末端标注
series: [{
    type: 'line',
    data: [...],
    endLabel: {
        show: true,
        fontSize: 11,
        fontWeight: 600,
        color: '#334155',
        formatter: '{a}'  // 系列名作为末端标签
    }
}]
// legend: { show: false }  // 隐藏图例

// 错误: 依赖独立图例
// legend: { show: true, data: ['传统', 'B2B', 'O2O'] }
```

---

## 5. 色阶系统 (Color Ramp System)

### 5.1 序列色阶 (Sequential — for intensity/density)

```css
/* 蓝色序列 — 热力图/密度 */
--seq-100: #EFF6FF;  /* 最浅 */
--seq-200: #BFDBFE;
--seq-300: #93C5FD;
--seq-400: #60A5FA;
--seq-500: #3B82F6;
--seq-600: #2563EB;
--seq-700: #1D4ED8;  /* 最深 */

/* 绿色序列 — 达成率/渗透率 */
--seq-g100: #ECFDF5;
--seq-g300: #6EE7B7;
--seq-g500: #10B981;
--seq-g700: #047857;
```

### 5.2 发散色阶 (Diverging — for deviation from center)

```css
/* 红←白→绿 发散 — 偏差分析 */
--div-neg3: #DC2626;  /* 严重负偏 */
--div-neg2: #F87171;
--div-neg1: #FCA5A5;
--div-zero: #F8FAFC;  /* 中性零点 */
--div-pos1: #86EFAC;
--div-pos2: #34D399;
--div-pos3: #059669;  /* 强正偏 */
```

### 5.3 色阶应用 JavaScript

```javascript
function getSequentialColor(value, min, max, ramp) {
    ramp = ramp || ['#EFF6FF','#BFDBFE','#93C5FD','#60A5FA','#3B82F6','#2563EB','#1D4ED8'];
    var ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    var idx = Math.min(Math.floor(ratio * ramp.length), ramp.length - 1);
    return ramp[idx];
}

function getDivergingColor(value, center, range, negRamp, posRamp) {
    negRamp = negRamp || ['#DC2626','#F87171','#FCA5A5'];
    posRamp = posRamp || ['#86EFAC','#34D399','#059669'];
    var neutral = '#F8FAFC';
    
    if (Math.abs(value - center) < range * 0.05) return neutral;
    if (value < center) {
        var ratio = Math.min(1, (center - value) / range);
        return negRamp[Math.min(Math.floor(ratio * negRamp.length), negRamp.length - 1)];
    }
    var ratio = Math.min(1, (value - center) / range);
    return posRamp[Math.min(Math.floor(ratio * posRamp.length), posRamp.length - 1)];
}
```

---

## 6. IBCS 语义规范 (销售报告硬性视觉语法)

> 核心信条: **同义同象, 异义异象** — 相同含义的东西必须长得一样, 不同含义的必须长得不一样。
> 目的: 建立视觉条件反射——读者扫过任何一张图都无需查图例即可读懂语义。

### 6.1 轴向标准化 (强制)

| 数据维度 | 强制轴向 | 图表形态 | 原因 |
|:---|:---|:---|:---|
| **时间** (日/旬/月/季/年) | 水平横轴, 左→右 | 纵向柱 / 折线 / 面积 | 人类潜意识的时间流方向 |
| **分类结构** (战区/渠道/品类/导购) | 垂直纵轴 | **水平条形图** | 中文标签水平完整可读, 彻底消除斜排/截断 |

> 一票否决: 分类维度用纵向柱 + 45° 斜标签 = 违规, 必须转水平条形。

### 6.2 实际 / 计划 / 预测 三态编码 (强制)

| 数据场景 | 视觉编码 | ECharts 实现 |
|:---|:---|:---|
| **实际值** (Actuals) | 纯色实心填充 | `itemStyle: { color: cssVar('--chart-1') }` |
| **目标/计划** (Plan/Target) | 空心轮廓 或 细标记线 | `itemStyle: { color: 'transparent', borderColor: ..., borderWidth: 1.5 }` 或子弹图 target 竖线 |
| **预测值** (Forecast) | 斜线阴影 / 半透明 + 虚线边 | `decal: { symbol: 'line', rotation: Math.PI/4 }` 或 `opacity: 0.45` + 虚线折线段 |

同一张图里实际与预测相接时 (如全年滚动预测), 必须在切换点有明确视觉分界, 禁止实/预同色实心连续画。

### 6.3 三段式图表副标题 (强制)

Action Title 负责结论, 但图表还必须有一行**口径副标题**自证数据范围:

```
[主体] · [度量+单位] · [时间周期]
例: 华南大区 · 签收金额/万元 · 2026年2月 (数据截至 02-27)
```

任何被单独截图转发的图表, 凭副标题即可自证口径——这是信任机制的一部分。

### 6.4 红绿纪律 (强制)

红/绿**只**用于表达绩效差异 (同比/环比/达成偏差): 正向=绿 `--semantic-growth`, 负向=红 `--semantic-risk`。
常规数据系列一律用低饱和中性/品牌色 (`--chart-*`)。红绿一旦被拿去做装饰, 预警信号即失敏。
(呼应克制六律·律一: 一份报告 ≤4 种情感色。)

> **本地化防线**: 中国金融市场"红涨绿跌"习惯与本系统相反——但认知心理学上人眼对高饱和红有天然危机敏感, 国际通行且本 Skill 坚守 **红坏绿好** (Red=负面/告警, Green=正面)。生成报告时不因用户/股市习惯翻转语义色; 若业务方明确要求红涨, 须先提示语义冲突再执行。

---

## 7. 密度轴图表形态 (紧凑 ≠ 简陋)

> **纪律**: 紧凑销售报告风的密度来自**换用密集图表形态**, 不是砍图表数量、更不是砍分析维度。
> 紧凑档的信息预算**高于**标准档——同样一屏, 它应该回答更多业务问题。

### 7.1 两档信息预算

| 预算项 | 叙事标准档 | 紧凑销售报告档 |
|:---|:---|:---|
| KPI 数量 | 3–5 | 5–8 (允许两行) |
| 每 Chapter 图表组件 | ≤2 (克制律三) | ≤3, 且**密集形态算 1 个**(见 7.2) |
| Chapter 数量 | 2–4 | 3–6 (每章更短) |
| 明细表格 | 沉底 Data Detail | 可上浮进章节, 表格+Sparkline+Badge 三合一 |
| 图表高度 | 420px | 300px; Sparkline 行 48px; 子弹图每行 ~36px |

### 7.2 密集形态词汇表 (紧凑档优先取用)

| 密集形态 | 一个组件承载的信息量 | 替代了什么 | 代码位置 |
|:---|:---|:---|:---|
| **超级 KPI 卡** | 单卡 9 指标: 月值+达成/同比/环比+年累三项+双基线趋势 | 3 张普通 KPI 卡 + 1 张趋势图 | `component-patterns.md` §1.7 |
| **子弹图垂直阵列** | 6–10 个指标的 实际+目标+区间 | 6–10 个 Gauge/进度环 | `chart-patterns.md` §2 |
| **Small Multiples 网格** | 4–8 个主体的同维趋势 | 4–8 张独立折线图 | `chart-patterns.md` §4 |
| **Sparkline 表格行** | 每行一条 12 期微趋势 | 整版趋势折线区 | `table-patterns.md` |
| **热力表 (Heat Table)** | 战区×月份 双维矩阵 | 12 张对比柱图 | `table-patterns.md` |
| **表格 + Δ列 + Badge** | 排名/两期变化/状态 三合一 | 斜率图 + 排名条形 | `table-patterns.md` |
| **瀑布图** | 一张图讲完整归因链 | 多段文字+多柱图 | `chart-patterns.md` §1 |

### 7.3 紧凑档选图降级顺序

标准档首选图在紧凑档按此顺序适配: **能进表格的进表格 (Sparkline/Badge/进度列) → 能合并的合并 (子弹阵列/Small Multiples) → 剩下的压高度 (300px)**。任何情况下不允许因"紧凑"而删掉归因图 (瀑布) 或达成图 (子弹)——那是砍分析, 不是压密度。

---

## 8. 受众分层图表策略

> 与 `audience-visual-contract.md` §1 的 L1/L2/L3 对应。同一份数据, 不同第一读者 = 不同图表组合。

| 层级 | 第一读者 | 核心图表组合 | 禁忌 |
|:---|:---|:---|:---|
| **L1 决策** | 大区总/经营层 | KPI Strip (含 Sparkline) + **子弹图阵列** (各战区达成一屏扫完) + **P&L/量价瀑布图** (钱去哪了) | 明细表格上首屏; 超过 4 张主图 |
| **L2 战术** | 战区/渠道/品类负责人 | 水平漏斗条形 (哪环在漏) + 降序条形排名 (谁先谁后) + 散点停滞诊断 (哪些单卡住) + Small Multiples (各区趋势模式) | 只给汇总不给责任归属维度 |
| **L3 执行** | 分析师/一线运营 | 高密度表格 + 条件格式 + Sparkline 行 + 明细下钻; 图表退居辅助 | 用大 Hero 和叙事金句稀释表格空间 |

**紧凑销售报告档的默认假设是 L1+L2 合并读者**: 首屏 masthead+KPI 服务 L1 五秒判断, 章节主体的排名/归因/达成图服务 L2 找动作, 明细表服务 L3 复算——一份紧凑报告按此三层排布, 内容自然丰富且不失焦。
