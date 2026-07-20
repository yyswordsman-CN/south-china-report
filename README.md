# south-china-report

> 通用型数据分析报告叙事设计系统（Codex Skill）· 当前版本 V3.2.0
>
> 报告不是仪表盘。仪表盘是给人"扫"的，报告是给人"读"的。

把任意业务数据（Excel / CSV / Parquet / SQLite / DuckDB / SQL）变成一份**给人读、能决策**的叙事型静态自包含 HTML 报告。报告主体（机构/区域/业务线/品类）由数据内容自动适配，不绑定任何特定组织。

## 它解决什么问题

市面上的数据分析工具都在卷"算得深"，真正的断层在**最后一公里**：结论有了，但它还不是一个决策者三分钟能拍板的东西。本系统把这一公里做到工程级——

```
数据源 → prep-source.py（measures/比较/Schema/结果快照 Gate）→ metrics.json
      → stat-insights.py（方向感知 + 方法适用性 + metrics SHA）→ insights.json
      → Evidence ID 叙事合同 → 双 SHA 强绑定自包含 HTML → 四道质量 Gate
```

## 核心特性

- **通用度量语义层**：`measures[]` 原生支持金额、数量、人数、时长、得分、比率、库存和缺陷率，分离维度轴/时间轴聚合，声明百分比存储尺度、比率分子分母和权重覆盖；没有金额也能正常出报告
- **通用分析合同**：同比、日历环比、等长滚动窗、上一完整期、上一期同阶段、自定义基线和无时间快照按不同语义路由；不适用的方法机器可读跳过
- **统一参考合同**：目标、Benchmark、参考区间和组间比较统一进入 `references[]`，绑定度量、单位、方向、容差、粒度与聚合；旧目标字段只作兼容投影
- **数据可信链**：必需 Schema、业务粒度、主键、单位与结果快照进入 Gate；跨运行漂移锁同时核对语义合同、schema、行数和结果 hash；报告以双 SHA 与 Evidence ID 追溯真源
- **方向感知统计层**：Mann-Kendall、稳健 Z、结构变化、PVM、TopN、Pareto 与 HHI 先判断适用性；HHI 无业务政策只作描述，低优指标按下降为有利解释
- **叙事强制合同**：Governing Thought + 章节 PAC 闭环（现象→归因→对策）+ So-What 四连问；没讲完故事的章节进不了正文
- **视觉纪律**：三角色字体 / 语义色三层架构 / 克制动效 / IBCS 选图语法（饼图默认禁用）/ 紧凑销售报告风默认、叙事标准风显式可选
- **四组质量 Gate**：结构/Evidence 校验（P0 硬阻断）→ 静态数字+双哈希真源一致性 → 离线内联严格复检 → 全部 ECharts 实例运行时合同 + 四视口 DOM/AX/Tab/对比度检查与截图目检
- **可发布工程链**：GitHub Actions 跑全量回归；发布清单、版本一致性、只读安装差异、原子替换和可恢复备份均有脚本约束
- **统计诚实纪律**：小样本只报方向不判显著；无目标数据不编造达成率；不做预测外推

## 快速上手

```bash
# 0. 安装经验证依赖（建议在项目虚拟环境中）
python3 -m pip install -r requirements.txt
npm ci
npx playwright install chromium

# 1. 数据画像 + 聚合校验（DuckDB 统吃多种数据源）
python3 scripts/prep-source.py profile 你的数据.xlsx --out-map map.draft.json
# 默认不打印原始字段样例；只有确认终端环境安全时才显式加 --show-samples
# 先确认 roles.measures[]、analysis_scope 与 schema；完整合同见 references/semantic-data-contract.md
# 推荐让 map.source 成为唯一源配置，避免重复传路径；CLI 路径仅用于显式覆盖
python3 scripts/prep-source.py build --map map.json --out metrics.json
# 需要锁定上次已确认结果时：追加 --baseline-metrics prior.metrics.json，或写 map.drift_lock

# 2. 统计洞察（趋势显著性 / 异常月 / 断崖引擎 / 问题清单）
python3 scripts/stat-insights.py metrics.json --out insights.json

# 3. 按 SKILL.md 工作流填充模板生成报告，交付前跑四组 Gate
node scripts/validate-report.mjs report.html
node scripts/verify-numbers.mjs report.html metrics.json --insights insights.json
node scripts/make-offline.mjs report.html
node scripts/validate-report.mjs report.offline.html --strict-offline
node scripts/verify-runtime.mjs report.offline.html metrics.json
node scripts/snapshot.mjs report.offline.html shots/
```

环境依赖：Node >=18（截图需 Playwright+Chromium）和 Python >=3.11；本轮实测运行时为 Node 22.22.3 / Python 3.14.3，经验证依赖锁定在 `package-lock.json` 与 `requirements.txt`。缺依赖时按文内降级路径执行并标注未验证。

## 完整演示

[demo-report/](demo-report/) 是一份用 10,800 行模拟数据端到端生成的实战报告，**双风格档各一份**，浏览器直接打开：

- `demo-report/report-compact.offline.html` — **紧凑销售报告风（默认）**：Hero 收为 masthead 横幅、8 KPI 密排一行、密集表格，同一份数据同一套故事，整页高度压缩约 25%，适合发群扫读 / 打印 / 移动端长图
- `demo-report/report.offline.html` — **叙事标准风（显式可选）**：大留白沉浸、100vh Hero、滚动动效，适合明确要求的高管汇报与对外呈现

四章叙事：趋势诊断（MK 检验）→ 量价拆解（PVM 瀑布）→ 战区贡献分解 → 结构与集中度；标准/紧凑版可见数字覆盖分别为 181/181、185/185（业务数字绑定，日期/序号等叶子豁免），各有 4 张图、55 个运行时业务数值叶子、1 个有理由豁免的辅助系列及 21 个逐叶声明的视觉常量，均通过报告级 eval、严格离线、运行时真值与四视口 DOM/AX/Tab/对比度 Gate。

演示数据链不再依赖手工补丁：`demo_sales.csv + map.json + enrichment.json` 是三份显式数据输入，后者单独声明模拟源指纹、历史趋势窗口、证据阈值和行动假设；`report.html` 与 `report-compact.html` 是人工维护的叙事/版式真源。可原子重建或只读检查：

```bash
npm run build:demo       # 重建数据、同步在线 meta，再从在线真源生成两份离线版
npm run test:demo-repro  # 数据逐字节比对 + 离线来源指纹/严检/数字/eval
```

## 项目结构

| 目录 | 内容 |
|---|---|
| `SKILL.md` | 主文件：设计哲学 + 工作流 + 质量体系 |
| `templates/` | 三套模板：scroll-narrative（叙事）/ bento-brief（一屏简报）/ audit-pack（审计包） |
| `references/` | 选图引擎、组件库、Token、叙事合同、52 项 Quality Gate、运行时合同与发布流程 |
| `scripts/` | 数据管线、统计洞察、demo 构建、静态/运行时/截图 Gate、发布安装与 eval 回归脚本 |
| `evals/` | 机器断言回归用例 |
| `USAGE-GUIDE.md` | 使用指南与提示词手册 |
| `CHANGELOG.md` | V1.0 → V3.2.0 完整迭代记录（含缺陷复现与回归证据） |

## 质量证据

项目不把模型自评分数当成发布证明。当前质量以多源金样、负向 fixture、报告 validator、静态与运行时数字覆盖、严格离线、四视口 DOM/AX/Tab/对比度检查和截图为准；CI 与安装边界见 [release-process.md](references/release-process.md)，版本级修复和限制见 [CHANGELOG.md](CHANGELOG.md)。

## 边界（它不做什么）

不做高频运营监控看板、不做交互式下钻 BI、不产出 PPT/Excel、不编造任何数据。校验脚本 `exit 0` 不等于可交付——部分设计纪律仍须人工清零，这一点写在文档里而不是藏起来。
