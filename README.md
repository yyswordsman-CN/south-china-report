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
      → report-spec.json（受控组件 + Evidence 声明）→ render-report.mjs
      → 双 SHA 强绑定自包含 HTML → 四道质量 Gate
```

## 核心特性

- **通用度量语义层**：`measures[]` 原生支持金额、数量、人数、时长、得分、比率、库存和缺陷率，分离维度轴/时间轴聚合，声明百分比存储尺度、比率分子分母和权重覆盖；没有金额也能正常出报告
- **通用分析合同**：同比、日历环比、等长滚动窗、上一完整期、上一期同阶段、自定义基线和无时间快照按不同语义路由；不适用的方法机器可读跳过
- **统一参考合同**：目标、Benchmark、参考区间和组间比较统一进入 `references[]`，绑定度量、单位、方向、容差、粒度与聚合；旧目标字段只作兼容投影
- **数据可信链**：必需 Schema、业务粒度、主键、单位与结果快照进入 Gate；跨运行漂移锁同时核对语义合同、schema、行数和结果 hash；报告以双 SHA 与 Evidence ID 追溯真源
- **方向感知统计层**：Mann-Kendall、稳健 Z、结构变化、PVM、TopN、Pareto 与 HHI 先判断适用性；HHI 无业务政策只作描述，低优指标按下降为有利解释
- **叙事强制合同**：Governing Thought + 章节 PAC 闭环（现象→归因→对策）+ So-What 四连问；没讲完故事的章节进不了正文
- **确定性报告编译器（V3.3 Phase R0/R1）**：Schema 先行的 `report-spec.json` 通过受控组件生成 Evidence、运行时数字合同和 HTML；同一组输入逐字节复现，路径越界、未知组件、裸业务数字或覆盖已有文件均 fail-closed
- **一条命令交付链（V3.3 Phase R2）**：`build-report.mjs` 在隔离 staging 中依次完成在线渲染、静态 Gate、离线内联、严格复检、运行时真值和四视口截图；全通过后才原子发布输出目录，失败只保留诊断目录
- **跨业务泛化回归（V3.3 Phase R3）**：财务、人员、库存、质量、服务工单、评分调查从真实夹具重建并跑完整七段 Gate；快照不伪造日期或趋势，低优指标、百分比、负数、零值、极端值、长标签与高基数均进入自动回归
- **Demo 真源迁移（V3.3 Phase R4）**：`demo_sales.csv + map.json + enrichment.json + report-spec.json` 可重建标准/紧凑两版在线与离线 HTML；spec 是叙事结构真源，Renderer 是 HTML 真源，V3.2 手工版仅作一个版本周期的对照/回退
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

# 3. 有 report-spec.json 时一条命令生成在线版、离线版、截图、日志和机器摘要
node scripts/build-report.mjs \
  --metrics metrics.json --insights insights.json \
  --spec report-spec.json --out-dir report-build

# 开发期如显式跳过截图，命令返回 3 / UNVERIFIED，产物不得标为成品：
# node scripts/build-report.mjs ... --out-dir report-build --skip-snapshot

# 4. 人工 HTML 兼容流程仍可逐段运行以下 Gate
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

四章叙事：趋势诊断（MK 检验）→ 量价缺口（数量趋势 + Evidence 中的 PVM 归因）→ 战区贡献分解 → 结构变化；标准/紧凑版可见数字均为 48/48（覆盖率 100%），各有 4 张图、71 个运行时业务数值叶子，无辅助系列或结构叶子豁免，并继续通过报告级 eval、严格离线、运行时真值与四视口 DOM/AX/Tab/对比度 Gate。

演示数据链不再依赖手工最终 HTML：`demo_sales.csv + map.json + enrichment.json + report-spec.json` 是四份显式输入；`report-spec.json` 是叙事结构真源，Renderer 生成 `report.html` 与 `report-compact.html`。V3.2 手工版保留在 `demo-report/legacy/` 一个版本周期，只用于 R4 等价性对照和回退，不再是真源。可原子重建或只读检查：

```bash
npm run build:demo       # 重建数据 + Renderer 双密度在线版 + 两份离线版
npm run test:demo-repro  # 数据/Renderer 逐字节比对 + 离线来源指纹/严检/数字/eval
```

## 项目结构

| 目录 | 内容 |
|---|---|
| `SKILL.md` | 主文件：设计哲学 + 工作流 + 质量体系 |
| `schemas/` | `report-spec.json` 的 Draft-07 Schema；是确定性渲染器的输入合同 |
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
