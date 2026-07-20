# Quick Checklist — P0/P1 生成后快速核对

> 从数据口径、结构、数字、响应式与离线交付中提取的快速门禁。
> 生成报告后**逐项核对**，全 PASS 才允许交付。

---

## P0 阻断项 (任何一项 FAIL = 不交付)

| # | 检查项 | 常见失败 | 验证方式 |
|:--|:---|:---|:---|
| 1 | **零 Emoji** | 使用了对勾/叉号/图表等 Emoji 字符 | `validate-report.mjs` P0 自动检测 |
| 2 | **Hero 标题 = Governing Thought** | "2026年X月经营分析" (描述标签) | 人工：能否一句话说清核心发现？ |
| 3 | **每个 Chapter 标题是 Action Title** | "各渠道签收情况" (无方向无归因) | 人工：≤30字 + 包含变化方向 |
| 4 | **图表上方有结论标题** | "各渠道签收额图" | 人工：标题是结论而非描述 |
| 5 | **同一指标文案/图/表数字一致** | 文案写"增长12%"但图表显示11.8% | 交叉验证 |
| 6 | **数字使用 `tabular-nums` + `--font-data`** | 数字列不对齐 | `validate-report.mjs` P0 自动检测 |
| 7 | **分析范围与比较合同一致** | 快照强做趋势；部分当期与完整基期混比；并列两个时间基线 | `prep-source` analysis_scope + period_lock Gate |
| 8 | **Schema/粒度/单位与跨运行漂移已受控** | 必需字段或单位变化；主键重复；主指标空值/重复；语义/schema/行数/结果 hash 未授权变化 | `prep-source` semantic_layer + schema + `drift_report` + 默认物质性阈值 |
| 9 | **report→insights→metrics 双哈希真源链完整** | 报告引用旧 metrics/insights；哈希缺失 | `verify-numbers --insights` + `run-evals` |
| 10 | **核心结论已绑定 Evidence ID** | 归因无真源；假设写成事实 | `validate-report` + Evidence 路径实存校验 |
| 11 | **所有可见业务数字已绑定** | 只校验 KPI，标题/洞察/图表数字漏接 | `verify-numbers.mjs` 覆盖率 100% |
| 12 | **全部 ECharts 实例渲染后对账** | 任意容器命名绕过选择器；JS 注入错值 | `getInstanceByDom` 反查 + V2 runtime contract |
| 13 | **严格离线版四视口无横滚/重叠/空图** | 390px 表格撑宽页面 | `snapshot.mjs` 自动布局/出站网络断言 + 逐图目检 |
| 14 | **四视口无障碍自动 Gate 通过** | 跳级标题、无名控件、Tab 漏达、焦点不可见、对比度不足 | `snapshot.mjs` DOM + AX Tree + 真实 Tab + WCAG AA |
| 15 | **严格离线无任何外部/相对资源** | CDN、字体、图片或 CSS URL 残留 | `validate-report.mjs --strict-offline` |
| 16 | **审计 PASS 已明确终稿确认** | 模板预填 PASS/MATCH 当成真结果 | `data-audit-finalized="true"` + 成品校验 |
| 17 | **报告 meta schema/generator/data_cutoff 已实例化** | 旧 schema 或占位截止日进入成品 | `validate-report.mjs` 成品模式 |
| 18 | **页面调用 ECharts 时必有唯一运行时合同** | `echarts.init()` 存在但合同缺失/空壳 | `validate-report.mjs` 静态 P0 |

## P1 核心项 (应修复)

| # | 检查项 | 常见失败 | 验证方式 |
|:--|:---|:---|:---|
| 19 | **PAC 闭环完整** | 只有现象，缺归因和对策 | 人工：每个 Chapter 检查 P+A+C |
| 20 | **方向语义与文案/颜色一致** | 低优指标上涨画绿；`neutral` 被标风险；斜率图写死去年/今年 | `measure.direction` + `chart-semantics.mjs` + 人工 |
| 21 | **字体三角色分工正确** | Display 用在正文段落 | `validate-report.mjs` P1 |
| 22 | **Pull Quote 是洞察或反转** | 复述报告中已有数字 | 人工：删掉 Pull Quote 后叙事是否断裂 |
| 23 | **Closing CTA 有对象+动作+期限** | "加强管理"(空话) | 人工 |
| 24 | **间距来自 `--space-*` token** | 随意的 15px、22px | `validate-report.mjs` P2 |

---

## 自动化验证命令

```bash
# 完整交付链；运行时与截图只对严格离线版运行
node scripts/validate-report.mjs <report.html>
node scripts/verify-numbers.mjs <report.html> <metrics.json> --insights <insights.json>
node scripts/make-offline.mjs <report.html>
node scripts/validate-report.mjs <report.offline.html> --strict-offline
node scripts/verify-runtime.mjs <report.offline.html> <metrics.json>
node scripts/snapshot.mjs <report.offline.html> <shots-dir>

# 任一 Gate 非 0 均不得冒充通过；Playwright 缺失会以 3 明确标记未验证
```

## 快速修复索引

| 问题 | 修复方式 |
|:---|:---|
| 图表/组件色值未对齐 Token | 用 `cssVar('--chart-N')` 动态读取；ECharts/Badge 内保留的 literal 须能映射到已登记 Token（图表→`chart-patterns.md` 表，Badge→`design-tokens.md` §3.3 语义族）。裸 hex 且无映射才算缺陷 |
| 间距非标值 | 改用 `var(--space-N)` |
| 字体角色混用 | Display→Hero/KPI, Editorial→正文, Data→数字 |
| 图表无标题 | 添加 `.full-chart-title` 写结论句 |
| CTA 空话 | 改为"[对象] + [动作] + [期限] + [验证指标]" |
