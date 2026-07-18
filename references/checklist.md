# Quick Checklist — P0/P1 生成后快速核对

> 从 `mckinsey-quality-gate.md` 48 项中提取最关键的 12 项。
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

## P1 核心项 (应修复)

| # | 检查项 | 常见失败 | 验证方式 |
|:--|:---|:---|:---|
| 7 | **PAC 闭环完整** | 只有现象，缺归因和对策 | 人工：每个 Chapter 检查 P+A+C |
| 8 | **文案方向词与数据正负号一致** | 写"增长"但数据为负 | 人工 |
| 9 | **字体三角色分工正确** | Display 用在正文段落 | `validate-report.mjs` P1 |
| 10 | **Pull Quote 是洞察或反转** | 复述报告中已有数字 | 人工：删掉 Pull Quote 后叙事是否断裂 |
| 11 | **Closing CTA 有对象+动作+期限** | "加强管理"(空话) | 人工 |
| 12 | **间距来自 `--space-*` token** | 随意的 15px、22px | `validate-report.mjs` P2 |

---

## 自动化验证命令

```bash
# 运行后查看 P0/P1/P2 分级结果
node scripts/validate-report.mjs <report.html>

# 退出码: 0=全PASS, 1=有P0失败
```

## 快速修复索引

| 问题 | 修复方式 |
|:---|:---|
| 图表/组件色值未对齐 Token | 用 `cssVar('--chart-N')` 动态读取；ECharts/Badge 内保留的 literal 须能映射到已登记 Token（图表→`chart-patterns.md` 表，Badge→`design-tokens.md` §3.3 语义族）。裸 hex 且无映射才算缺陷 |
| 间距非标值 | 改用 `var(--space-N)` |
| 字体角色混用 | Display→Hero/KPI, Editorial→正文, Data→数字 |
| 图表无标题 | 添加 `.full-chart-title` 写结论句 |
| CTA 空话 | 改为"[对象] + [动作] + [期限] + [验证指标]" |
