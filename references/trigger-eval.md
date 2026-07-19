# 触发准确性 Eval (Trigger Accuracy)

> 用途: 校准 frontmatter `description` 的触发边界。改 description 后重跑本表自评 (逐条判"当前描述会不会触发")，防过触发/漏触发。
> 口径: report-skill-eval 的 `trigger_accuracy` lane。

## 应触发 (should-trigger) — 10 条

| # | 用户 prompt | 命中依据 | 现描述判定 |
|:--|:--|:--|:--|
| 1 | 把华南 2 月签收数据做成月报 HTML | 月报 + HTML 报告 | 是 |
| 2 | 生成一份战区经营分析报告，能发飞书 | 战区分析 + 报告 | 是 |
| 3 | 做个渠道结构分析的报告页面 | 渠道分析 + 报告 | 是 |
| 4 | 年度经营总结，要沉浸式叙事那种 | 年报 + narrative | 是 |
| 5 | 把这份销售数据做成能截图的紧凑报告 | sales analysis + 紧凑档 | 是 |
| 6 | 旬报，信息密集适合快速扫读 | 旬报 + 紧凑 | 是 |
| 7 | 专题复盘：为什么 Q2 达成掉了，做成报告 | 专题复盘 | 是 |
| 8 | 帮我把销售分析做成 HTML 发给领导 | sales analysis HTML | 是 |
| 9 | 审计包：证明这批数据可信可复算 | audit pack | 是 |
| 10 | 经营分析看板(要讲故事、发群那种) | business analysis dashboard(叙事型) | 是 |

## 不应触发 (should-not-trigger) — 10 条

| # | 用户 prompt | 不该命中依据 | 现描述判定 |
|:--|:--|:--|:--|
| 1 | 帮我做个 FineBI 实时监控大屏 | operational_monitor (负向已排除) | 不触发 |
| 2 | 把这个明细表导出成 Excel | analysis_workbook / xlsx | 不触发 |
| 3 | 写个 SQL 查各战区签收 | 数据查询, 非报告 | 不触发 |
| 4 | 帮我算这个月毛利率 | 计算, 非报告产物 | 不触发 |
| 5 | 做个实时刷新的运营看板 | operational_monitor | 不触发 |
| 6 | 清洗这份脏数据 | 数据清洗 | 不触发 |
| 7 | 给我一个能筛选下钻的交互式 BI 工具 | 交互平台, 非静态报告 | 不触发 (描述已注明静态 HTML) |
| 8 | 写个 Python 脚本分析销售 | 脚本, 非报告 | 不触发 |
| 9 | 帮我做套销售 PPT | 产物是 PPT 非 HTML | 边界: 描述已注"输出 HTML", 但"销售/汇报"易误触。见下 |
| 10 | 回复这封关于销售的邮件 | 无关 | 不触发 |

## 维护契约 (V2.12.0)

- 上表是触发回归样例，不是模型自评分数；改 frontmatter description 后必须重跑并记录实际触发结果。
- `south-china-report` 是稳定兼容 ID，描述必须覆盖非华南的通用经营报告，不得因 ID 名称漏触发。
- 销售 PPT 的产物是 PPT 而非 HTML，必须不触发本 Skill；frontmatter 已显式排除 PPT/Excel/交互式 BI。
- 新增一类误触发或漏触发，就同步增加 should-not 或 should-trigger 用例。
