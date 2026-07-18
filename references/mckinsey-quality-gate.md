# Quality Gate — 报告交付前检查清单

> **定位**: 本 Gate 只检查 `output-quality-guard` 和全局规则**不覆盖**的报告专属项。
> 数据准确性 → `output-quality-guard` / `data-audit-framework`
> Emoji/视觉基线 → `output-quality-guard`
> 本文件 → 叙事质量 + 图表设计 + 数字格式

---

## Gate 1: 叙事质量 (Narrative Quality) — 8 项

| # | 检查项 | 通过标准 | 档案 |
|:---|:---|:---|:---:|
| 1.1 | **Governing Thought** | 报告有 1 个统领性思想, Hero 标题体现 | strategic+ |
| 1.2 | **Action Title** | 每个 Chapter/Section 标题是结论句 ≤ 30 字 | operational+ |
| 1.3 | **PAC 闭环** | 叙事段落包含现象+归因+对策 | strategic+ |
| 1.4 | **图表服务叙事** | 删掉图表后叙事断裂 → 保留; 不断裂 → 删除 | strategic+ |
| 1.5 | **So What 测试** | 每个数据点可回答"所以呢?" | all |
| 1.6 | **Pull Quote 质量** | 金句不是数据复述, 要有洞察/反转/启发 | strategic+ |
| 1.7 | **Closing CTA 可执行** | 行动项有对象+动作+截止时间 | strategic+ |
| 1.8 | **叙事方向性一致** | 文案方向性关键词(提价/铺量/增长等)与数据正负号一致; 复合叙事(以价换量/量价齐升)满足组合条件 | **all** |

### Action Title 公式

```
[对象] + [关键变化] + [方向/归因/建议]

正例: "传统渠道占比下降3.2pp，需加速渠道转型"
正例: "P系列渗透率突破35%，结构升级进入加速通道"
反例: "各渠道签收情况" (描述标签)
反例: "战区达成率对比" (描述标签)
```

### So What 测试流程

```
对报告中每个数据点连续追问:
1. "这个数据说明了什么?" → 现象
2. "为什么会这样?"       → 归因
3. "所以我们该怎么做?"   → 对策
4. "这对 Governing Thought 有什么影响?" → 回链

任何数据点无法回答第 4 个问题 → 移到 Data Detail 区域
```

---

## Gate 2: 图表设计 (Chart Design) — 10 项

| # | 检查项 | 通过标准 |
|:---|:---|:---|
| 2.1 | **柱图基线 = 0** | 所有柱状/条形图 Y 轴从 0 开始 |
| 2.2 | **直接标注优先** | 图例能省则省, 在图表上直接标注 |
| 2.3 | **数据点用小符号** | 折线图 symbolSize ≤ 6 |
| 2.4 | **事件标注** | 关键拐点标注原因/事件, 不只标数字 |
| 2.5 | **颜色映射一致** | 同一报告中同一含义用同一颜色 |
| 2.6 | **去噪** | 无 3D、无多余网格线、无装饰边框 |
| 2.7 | **双轴默认禁用** | 优先拆图; 确需双轴必须说明两轴关系和防误读方式 |
| 2.8 | **饼图/环形克制** | 饼图/环形默认禁用; 构成改 100%堆叠条形/Treemap/表格; 仅 ≤3 类且明确要求可破例 (与 validator 一致) |
| 2.9 | **图表角色明确** | 每张图只承担趋势、比较、构成、归因、关系中的一种主任务 |
| 2.10 | **无装饰性图表** | 删掉不影响叙事的图表，避免为了视觉丰富而堆图 |

---

## Gate 3: 数字格式 (Number Formatting) — 5 项

| # | 检查项 | 通过标准 |
|:---|:---|:---|
| 3.1 | **千分位** | ≥1000 的整数使用千分位 |
| 3.2 | **量级适配** | 亿级→X.X亿, 万级→X,XXX万 |
| 3.3 | **百分比精度** | 统一 1 位小数 |
| 3.4 | **pp 单位** | 百分点差值用 "pp" 后缀 |
| 3.5 | **符号方向** | 正值"+"前缀, 负值"-"前缀, 零值"—" |

---

## Gate 4: 布局检查 (Layout) — 10 项

| # | 检查项 | 通过标准 | 档案 |
|:---|:---|:---|:---:|
| 4.1 | **Three-Layer** | Hero(5秒) → 故事(3分钟) → 明细(按需) | strategic+ |
| 4.2 | **数字等宽** | 所有数字列 `font-variant-numeric: tabular-nums` | all |
| 4.3 | **间距规范** | 间距值来自 `--space-*` token | all |
| 4.4 | **WCAG AA** | 文字/背景对比度 ≥ 4.5:1 | all |
| 4.5 | **产物类型匹配** | brief/monitor/audit/workbook 不强制套 Scroll Narrative | all |
| 4.6 | **Hero 高度克制** | 100vh 仅用于高价值战略/汇报型报告; 其他报告可紧凑开场 | strategic+ |
| 4.7 | **响应式无重叠** | 桌面和移动端无文字溢出、遮挡、卡片挤压 | all |
| 4.8 | **图表非空** | 关键图表容器宽高非 0，隐藏 Tab 场景完成 resize/init | all |
| 4.9 | **Visual Contract** | 生成前已明确受众层级、布局模型、信息预算、图表政策和信任机制 | all |
| 4.10 | **布局权重表达优先级** | Bento 不能是均等 KPI 卡片墙；Scroll 不能把所有信息堆在首屏 | brief+ |

---

## Gate 5: 洞察与行动 (Insight & Action) — 5 项

| # | 检查项 | 通过标准 | 档案 |
|:---|:---|:---|:---:|
| 5.1 | **Evidence Pack** | 每个核心章节绑定证据包或审计结果 | strategic+ |
| 5.2 | **归因分级** | 已证实/高概率推断/需验证分开表达 | strategic+ |
| 5.3 | **行动可执行** | 建议包含对象、动作、范围/数量、时限、验证指标 | operational+ |
| 5.4 | **空话拦截** | 不出现无约束的“加强、优化、关注、推动” | all |
| 5.5 | **边界说明** | 缺数据、样本不足、口径变化写进交付说明 | all |

---

## Gate 6: 视觉系统 V2 (V2 新增) — 8 项

| # | 检查项 | 通过标准 | 档案 |
|:---|:---|:---|:---:|
| 6.1 | **三角色字体** | Display→大数字/标题, Editorial→正文, Data→表格数字 | all |
| 6.2 | **字体不混用** | 同一行不混用 Display 和 Editorial | all |
| 6.3 | **色彩三层架构** | 品牌色只在 Hero/Closing/章节号；语义色固定不随主题变 | all |
| 6.4 | **情感色 ≤ 4 种** | 增长/风险/机会/中性，不出现无语义的装饰色 | all |
| 6.5 | **动效克制** | 仅 CountUp/Reveal/Progress，无无限循环动画 | all |
| 6.6 | **Dark Mode 对偶** | 深底区域(Hero/Closing)使用 `--semantic-*-dark` 亮色变体 | strategic+ |
| 6.7 | **Token 引用** | CSS 中色值/字号/间距全部通过 `var(--xxx)` 引用 | all |
| 6.8 | **prefers-reduced-motion** | 动效可降级，`@media (prefers-reduced-motion)` 已定义 | all |

---

## Gate 7: 自动化校验 (V2 新增) — 2 项

| # | 检查项 | 通过标准 | 档案 |
|:---|:---|:---|:---:|
| 7.1 | **validate-report.mjs** | `node scripts/validate-report.mjs report.html` P0 全部 PASS | all |
| 7.2 | **Anti-Default 检查** | 对照 `anti-default-discipline.md` §4 Post-Build 完成勾选 | strategic+ |

---

## 使用方式

```
brief        → Gate 2-4 + Gate 6 + Gate 7.1
operational  → Gate 1(1.2/1.5) + Gate 2-4 + Gate 6 + Gate 7.1
strategic    → 全部 Gate (Gate 1-7)
presentation → 全部 Gate + 逐项人工复核
audit_pack   → Gate 5.5 + Gate 7.1 + 数据审计为主
```

> **V2 总计**: 48 项检查 (8+10+5+10+5+8+2)
