# south-china-report

> 通用型数据分析报告叙事设计系统（Claude Skill）· 当前版本 V2.10
>
> 报告不是仪表盘。仪表盘是给人"扫"的，报告是给人"读"的。

把任意业务数据（Excel / CSV / Parquet / SQLite / DuckDB / SQL）变成一份**给人读、能决策**的叙事型静态自包含 HTML 报告。报告主体（机构/区域/业务线/品类）由数据内容自动适配，不绑定任何特定组织。

## 它解决什么问题

市面上的数据分析工具都在卷"算得深"，真正的断层在**最后一公里**：结论有了，但它还不是一个决策者三分钟能拍板的东西。本系统把这一公里做到工程级——

```
数据源 → prep-source.py（DuckDB 清洗聚合）→ metrics.json（唯一数字来源）
      → stat-insights.py（统计洞察层）→ insights.json（问题清单）
      → 叙事合同（现象→归因→对策）→ 自包含 HTML → 四道质量 Gate
```

## 核心特性

- **数据可信链**：报告里每个数字从 `metrics.json` 抄、禁止手敲；`verify-numbers.mjs` 机器对账页面数字与管线数字；脏数据标记 `BLOCKED` 时只出修数建议、不出结论
- **统计洞察层（V2.10）**：Mann-Kendall 趋势显著性检验（p<0.05 才允许写"趋势性下滑"）、稳健 Z 异常月检测、维度断崖/引擎/结构位移/增速贡献分解、HHI 集中度、量价象限、按影响金额排序的问题清单——零新依赖，纯 Python 标准库
- **叙事强制合同**：Governing Thought + 章节 PAC 闭环（现象→归因→对策）+ So-What 四连问；没讲完故事的章节进不了正文
- **视觉纪律**：三角色字体 / 语义色三层架构 / 克制动效 / IBCS 选图语法（饼图默认禁用）/ 叙事标准风与紧凑销售报告风双档
- **四道质量 Gate**：结构校验（P0 硬阻断）→ 截图逐张目检 → 数字一致性机器对账 → 离线内联复检
- **统计诚实纪律**：小样本只报方向不判显著；无目标数据不编造达成率；不做预测外推

## 快速上手

```bash
# 1. 数据画像 + 聚合校验（DuckDB 统吃多种数据源）
python3 scripts/prep-source.py profile 你的数据.xlsx
python3 scripts/prep-source.py build 你的数据.xlsx --map map.json --out metrics.json

# 2. 统计洞察（趋势显著性 / 异常月 / 断崖引擎 / 问题清单）
python3 scripts/stat-insights.py metrics.json --out insights.json

# 3. 按 SKILL.md 工作流填充模板生成报告，交付前跑四道 Gate
node scripts/validate-report.mjs report.html
node scripts/snapshot.mjs report.html shots/
node scripts/verify-numbers.mjs report.html metrics.json
node scripts/make-offline.mjs report.html
```

环境依赖：`node >= 18`（校验/截图/离线内联，截图另需 Playwright+Chromium）、`python3 + duckdb + pandas`（数据管线）。缺依赖时按文内降级路径执行并标注未验证。

## 完整演示

[demo-report/](demo-report/) 是一份用 10,800 行模拟数据端到端跑通的实战报告（V2.10 全链路），直接浏览器打开 `demo-report/report.offline.html` 即可查看。四章叙事：趋势诊断（MK 检验）→ 量价拆解（PVM 瀑布）→ 战区贡献分解 → 结构与集中度，49 处数字绑定全部通过机器对账。

## 项目结构

| 目录 | 内容 |
|---|---|
| `SKILL.md` | 主文件：设计哲学 + 工作流 + 质量体系 |
| `templates/` | 三套模板：scroll-narrative（叙事）/ bento-brief（一屏简报）/ audit-pack（审计包） |
| `references/` | 选图引擎、组件库、Token、叙事合同、48 项 Quality Gate 等 15 份参考 |
| `scripts/` | 数据管线、统计洞察、四道 Gate、eval 回归等 9 个自动化脚本 |
| `evals/` | 机器断言回归用例 |
| `USAGE-GUIDE.md` | 使用指南与提示词手册 |
| `CHANGELOG.md` | V1.0 → V2.10 完整迭代记录（含独立盲评与缺陷修复过程） |

## 一份外部评测

Claude Fable 5 通读全部源码后的评分：**8.5 / 10**——"在'把业务数据讲成能决策的故事'这个细分赛道，它的工程完成度超过我见过的绝大多数民间 Skill，包括 Anthropic 官方的同类实现。"（模型评估存在主观性，七维评分卡与方法见 `wechat-release/`）

## 边界（它不做什么）

不做高频运营监控看板、不做交互式下钻 BI、不产出 PPT/Excel、不编造任何数据。校验脚本 `exit 0` 不等于可交付——部分设计纪律仍须人工清零，这一点写在文档里而不是藏起来。
