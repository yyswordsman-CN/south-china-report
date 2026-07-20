# 通用自动 Renderer V3.3 实施计划

> 状态：Phase R0–R4 已于 2026-07-20 实施并通过专项、六类完整七段 Gate、Demo 双密度等价性验收、四视口目检与全量回归；R5 为可选 Planner，另行决策。
>
> 计划日期：2026-07-20
>
> 当前基线：`main` / `7fd749e` / south-china-report V3.2.0。下个窗口开始前必须重新核对 `git status`、`HEAD`、远端 `main` 与 CI，不能把本文件中的基线当作永久事实。

## 1. 结论与目标

建议加入通用自动 Renderer，并把它作为 V3.3 的核心架构项。

V3.2 已经具备稳定的数据语义层、统计洞察、Evidence 合同、运行时数字合同和四组质量 Gate，但 `metrics.json + insights.json` 之后仍依赖 Agent 手工选择模板、填充组件、绑定数字路径、编写 Evidence ID 和 ECharts 合同。V3.3 要补齐的是确定性的“报告编译层”，不是让 AI 直接自由生成 HTML。

目标链路：

```text
Excel / CSV / SQL
  -> map.json
  -> metrics.json
  -> insights.json
  -> report-spec.json
  -> render-report.mjs
  -> report.html
  -> strict offline / runtime / snapshot Gates
```

核心目标：同一组 `metrics.json + insights.json + report-spec.json` 必须稳定生成字节可复现、可审计、可离线交付的 `report.html`，并自动生成所有机械性合同。

## 2. 首版范围

### 2.1 首版必须完成

- 新增机器可读的 `report-spec.json` 合同和 JSON Schema。
- 新增确定性 Renderer：只根据已验证输入装配 HTML，不自由发挥业务事实。
- 首版只支持 `scroll-narrative-skeleton.html`。
- 首版默认只支持紧凑密度；叙事标准风作为显式参数复用同一模板。
- 支持一组受控组件，不允许在 spec 中注入任意 HTML 或 JavaScript。
- 自动生成：
  - `#south-china-report-meta`
  - `data-metric`
  - `data-number-exempt`
  - `#south-china-report-evidence-contract`
  - `data-evidence-id`
  - hypothesis 显式标记
  - `#south-china-report-runtime-contract`
  - ECharts option 与 runtime binding
  - `data-snap`
- Renderer 输出后可一条命令串联现有全部 Gate。
- 继续支持人工维护 HTML 的旧流程，V3.3 不做破坏性迁移。
- 六类泛化夹具全部新增 Renderer 端到端回归。

### 2.2 首版明确不做

- 不做预测、自动因果归因或机器学习。
- 不让 AI 直接输出最终 HTML。
- 不让 Renderer 自己猜 Governing Thought、行动建议或业务原因。
- 不同时覆盖 scroll、bento、audit 三套模板。
- 不建立任意插件或任意组件执行系统。
- 不允许 spec 携带任意脚本、任意 CSS 或未转义 HTML。
- 不自动改数字、删除失败证据或改写结论来通过 Gate。
- 不把校验失败后的“循环修复”作为首版目标。
- 不把报告改造成交互式 BI 或高频运营看板。

## 3. 关键设计决策

### 3.1 Renderer 与 Planner 分离

Renderer 是确定性的装配器，只负责执行 `report-spec.json`；Planner 负责决定报告讲什么。

```text
规则 / Agent / 人工
       -> report-spec.json
       -> Renderer
       -> report.html
```

首版只实施 Renderer。规则 Planner 和 AI Planner 延后，避免同时把“故事选择”和“页面生成”两个高风险问题混在一起。

### 3.2 中间合同命名

统一使用 `report-spec.json`，不同时维护 `narrative-plan.json` 第二套同义合同。

原因：该文件不只包含叙事，还包含模板、受众、密度、组件、图表、数字格式、Evidence、行动和输出策略，`report-spec` 更准确。

### 3.3 首版运行时选择

- Renderer 使用 Node ESM，入口为 `scripts/render-report.mjs`。
- 原因：模板、ECharts option、runtime contract、现有校验器和离线工具都在 Node 侧，避免 Python/Node 各维护一套前端路径解析。
- JSON Schema 校验建议使用 `ajv` 并锁定版本；不得用零散 `if` 语句代替完整 Schema 后又宣称合同完整。
- 文件写出必须沿用临时文件 + 原子替换模式。
- 既有输出默认不覆盖；只有显式 `--force` 才允许替换。

### 3.4 模板策略

不复制第二套 CSS 真源。

在 `templates/scroll-narrative-skeleton.html` 中增加少量、唯一、可验证的编译锚点，例如：

```html
<!-- SCR:REPORT_CONTENT -->
<!-- SCR:REPORT_CONTRACTS -->
<!-- SCR:REPORT_SCRIPTS -->
```

要求：

- 每个锚点在模板中恰好出现一次。
- `--template-mode` 仍可验证模板。
- 人工复制模板的旧流程仍可使用。
- Renderer 只能替换锚点，不能靠脆弱的正则猜测任意 DOM 位置。

### 3.5 可信链策略

- Renderer 读取 `metrics.json` 和 `insights.json` 的实际文件字节并计算 SHA-256。
- 必须验证 `insights.meta.metrics_sha256` 与实际 metrics 一致。
- spec 中的所有 `metrics.*`、`insights.*` 路径必须在渲染前解析成功。
- 禁止访问 `__proto__`、`prototype`、`constructor` 等原型链键。
- 数值、单位、方向和格式化规则从 metrics 语义层读取；spec 只能选择展示方式，不能覆盖事实语义。
- Evidence ID、DOM 绑定和 runtime binding 必须来自同一份内部 binding manifest，避免三套路径分别拼接后漂移。

### 3.6 降级策略

- 必需数据、路径、单位、Evidence 或 runtime binding 不成立：`BLOCKED`，退出码 2，不写最终文件。
- Playwright/Chromium 缺失：沿用 `UNVERIFIED`，退出码 3。
- 可选组件不适用：只有 spec 明确允许 `optional: true` 时才能机器跳过，并记录 `reason_code`。
- 非 Evidence 原因只能作为 `hypothesis` 渲染，页面必须显式标注，不能自动升级为事实。
- Renderer 不实现“为了过 Gate 自动删组件”。

## 4. `report-spec.json` 最小合同

建议首版 Schema 顶层结构：

```json
{
  "schema_version": "1.0",
  "report": {
    "id": "service-monthly-2025-04",
    "type": "strategic_narrative",
    "audience": "L2",
    "density": "compact",
    "language": "zh-CN",
    "title": "服务效率改善，但高峰队列仍需治理",
    "subtitle": "2025年4月服务运营分析"
  },
  "narrative": {
    "governing_thought": {
      "text": "服务效率改善，但高峰队列仍需治理",
      "claim_kind": "evidence",
      "evidence": ["metrics.measure_results.resolution_time.current"]
    },
    "chapters": []
  },
  "components": [],
  "actions": [],
  "output": {
    "offline": true,
    "run_gates": true
  }
}
```

首版必须校验：

- `schema_version`、报告 ID、类型、受众、密度、语言。
- Governing Thought 不为空且不超过配置上限。
- Chapter ID 和组件 ID 全局唯一且使用安全字符。
- 每个事实结论至少绑定一个真实 `metrics|insights` 路径。
- `hypothesis` 必须提供 `validation_needed`。
- 行动项必须至少含对象、动作、期限和验证指标；不完整时只能留在草稿，不能作为 final 输出。
- 组件类型必须来自白名单。
- 图表只允许引用已注册的数据路径和格式化器。
- 不允许任意 HTML、任意 JavaScript、内联事件处理器或远程资源 URL。

## 5. 首版组件白名单

首版优先支持以下组件：

| 组件 | 用途 | 首版要求 |
| --- | --- | --- |
| `hero` | Governing Thought、期间、主指标 | 必须有 Evidence |
| `kpi_strip` | 3–8 个核心指标 | 自动绑定单位、方向和格式 |
| `chapter_intro` | Action Title、So What、PAC 导语 | 必须有 Evidence 或 hypothesis |
| `insight_callout` | 洞察、反转、方法边界 | 禁止复述无意义数字 |
| `rank_table` | 分类排名、正负值、长标签 | 动态排序和格式化 |
| `comparison_table` | 当前/基线/差异/方向 | 读取真实比较标签 |
| `trend_chart` | 规则时间序列 | 方法不适用则跳过或 BLOCK |
| `bar_chart` | 分类比较 | 动态轴域、长标签策略 |
| `slope_chart` | 两期变化 | 读取指标方向和真实期间标签 |
| `data_detail` | 复算明细与口径 | 只展示已声明字段 |
| `closing_actions` | 对象、动作、期限、验证指标 | 禁止空话 CTA |

首版不支持的组件必须返回机器可读 `unsupported_component`，不能静默退回成普通卡片。

## 6. 内部模块建议

建议新增：

```text
schemas/report-spec.schema.json
scripts/render-report.mjs
scripts/build-report.mjs
scripts/renderer/
  load-inputs.mjs
  validate-spec.mjs
  resolve-path.mjs
  format-value.mjs
  binding-manifest.mjs
  render-contracts.mjs
  render-components.mjs
  render-charts.mjs
  render-template.mjs
  write-atomic.mjs
references/report-spec-contract.md
tests/renderer-contract-smoke.mjs
tests/renderer-negative-smoke.mjs
tests/renderer-e2e-smoke.mjs
evals/specs/generalized/
demo-report/report-spec.json
```

建议修改：

```text
templates/scroll-narrative-skeleton.html
scripts/build-demo.py
package.json
package-lock.json
release-profile.json
.github/workflows/ci.yml
SKILL.md
README.md
USAGE-GUIDE.md
CHANGELOG.md
references/checklist.md
references/release-process.md
```

## 7. 分阶段实施

### Phase R0：合同冻结与 RED 测试

目标：先定义输入输出，不写 Renderer 主逻辑。

- [x] 新增 `schemas/report-spec.schema.json`。
- [x] 新增 `references/report-spec-contract.md`，解释给普通使用者看。
- [x] 把现有销售 Demo 人工反向整理成 `demo-report/report-spec.json` 金样。
- [x] 为财务、人员、库存、质量、服务工单、评分调查各写一个最小 spec。
- [x] 新增 RED 测试：未知组件、无效路径、原型链路径、重复 ID、缺 Evidence、hypothesis 无验证需求、任意 HTML/脚本、错误单位、错误方向、错误比较标签。
- [x] 明确 Renderer 状态与退出码。

完成条件：Schema 与负例测试能准确描述失败，但 Renderer 尚未实现时测试应为 RED。

### Phase R1：确定性 Renderer 核心

目标：从合法 spec 稳定生成在线 `report.html`。

- [x] 实现输入加载、双 SHA 校验、状态拦截和安全路径解析。
- [x] 实现模板锚点与原子写出。
- [x] 实现 binding manifest，作为 DOM/Evidence/runtime 三类绑定的单一真源。
- [x] 实现安全 HTML 转义和严格组件白名单。
- [x] 实现 `hero`、`kpi_strip`、`chapter_intro`、`insight_callout`、`data_detail`、`closing_actions`。
- [x] 实现 `rank_table`、`comparison_table`。
- [x] 实现 `trend_chart`、`bar_chart`、`slope_chart`。
- [x] 自动生成 report meta、Evidence contract 和 runtime contract。
- [x] 支持 `--out`、`--force`、`--density`、`--template`；首版只接受已注册模板。
- [x] 同一输入重复渲染必须字节一致。

完成条件：Demo spec 可生成在线 HTML，并通过静态 validator 与 `verify-numbers`。

### Phase R2：一条命令 Gate 编排

目标：把生成和现有 Gate 串成明确发布链，不隐藏任何失败。

- [x] 新增 `scripts/build-report.mjs`。
- [x] 顺序执行 Renderer、validator、verify-numbers、make-offline、strict-offline validator、verify-runtime、snapshot。
- [x] 每一步保存结构化状态和日志摘要。
- [x] 任一步失败时保留诊断产物，但不发布最终目录。
- [x] 使用 staging 目录；全部通过后才原子发布输出目录。
- [x] 支持 `--skip-snapshot` 仅用于开发，并明确输出 `UNVERIFIED`，不能标为成品。
- [x] 新增 `npm run render`、`npm run build:report`、`npm run test:renderer`。

完成条件：一条命令可以从三份 JSON 生成在线版、离线版、截图和机器可读 Gate 摘要。

### Phase R3：跨业务泛化与渲染压力回归

目标：证明 Renderer 不是销售报告专用生成器。

- [x] 六类夹具均生成报告并通过适用 Gate。
- [x] 输入不存在时不得出现“战区、渠道、产品、客户、销售”等默认词。
- [x] 无时间快照只生成结构、分布、排名、异常和组间差异，不生成趋势/PVM。
- [x] 成本、缺陷率、处理时长按 `lower_is_better` 正确着色和排序。
- [x] 百分比、负数、零值、极端值、长标签和高基数不画错。
- [x] 可选模块缺失只记录 `SKIPPED + reason_code`。
- [x] 必需路径、单位和 Evidence 漂移继续 BLOCK。
- [x] 紧凑布局在 1440/1360/430/390 四视口通过。
- [x] 未配置政策的 HHI 只输出描述性集中度。
- [x] 所有旧 P0、严格离线、运行时真值、安装恢复测试继续通过。

完成条件：`npm test` 和 `release:check` 全绿，且逐张人工看过六类代表性截图。已于 2026-07-20 完成。

### Phase R4：Demo 迁移与兼容收口

目标：证明 Renderer 可以替代人工 Demo HTML 真源，同时保留旧流程回退。

- [x] 用 `demo-report/report-spec.json` 生成标准/紧凑两版 Demo。
- [x] 对比现有人工 HTML 的数字、章节、图表、Evidence 和截图。
- [x] 允许经过审阅的视觉差异，不要求逐字节兼容旧人工 HTML。
- [x] 修改 `build-demo.py`，让 spec 成为叙事结构真源，Renderer 成为 HTML 真源。
- [x] 删除“人工 HTML 是叙事真源”的旧声明前，先完成等价性验收。
- [x] 人工 HTML 流程保留一个版本周期，并在文档中标注 legacy/manual。

完成条件：Demo 可完全由数据、enrichment、spec 和 Renderer 重建，不再要求人工先维护最终 HTML。

验收记录：新增迁移金丝测试，锁定双密度逐字节重建、4 章/4 图/3 行动、业务基线与 Evidence 不退化。旧定制 PVM 瀑布图经审阅替换为通用数量趋势图，PVM 归因值仍保留在 Evidence 合同。标准/紧凑版均通过 48/48 可见数字、4 图 71 个运行时业务叶子、四视口自动 Gate 与人工目检。

### Phase R5：可选 Planner，另行决策

这一阶段不属于首版 Renderer 的完成条件。

- [ ] 规则 Planner 根据 `method_applicability`、受众、主指标和可用维度生成 draft spec。
- [ ] Agent 只能生成或修改合法 spec，不直接写最终 HTML。
- [ ] Planner 输出必须区分 evidence、hypothesis 和 unsupported。
- [ ] draft spec 未经检查只能输出带草稿状态的报告，不能冒充 final。
- [ ] 使用优秀报告 spec 做 eval，不以模型自评分作为发布证据。

## 8. 总待办清单

### P0：首版必须

- [x] 冻结 `report-spec` Schema 与版本策略。
- [x] 建立安全路径解析和原型链阻断。
- [x] 建立统一 binding manifest。
- [x] 实现双 SHA 校验与 Evidence 路径验证。
- [x] 实现模板锚点和原子输出。
- [x] 实现首版组件白名单。
- [x] 自动生成 report meta、Evidence contract、runtime contract。
- [x] 实现一条命令 Gate 编排。
- [x] 六类夹具端到端通过。
- [x] 新增全部负向回归。
- [x] 旧 `npm test` 与严格离线门禁继续全绿。

### P1：首版质量

- [x] 动态标签、轴域、单位、数字精度和方向语义一致。
- [x] 组件级空态、跳过态、BLOCK 态和 hypothesis 样式统一。
- [x] 输出结构化 `build-summary.json`。
- [x] 输出组件选择与跳过原因，便于审计。
- [x] Demo 迁移为 Renderer 真源。
- [x] 文档增加普通人可复制的一条命令示例。
- [ ] 安装副本同步并验证哈希。

### P2：后续增强

- [ ] 扩展 bento brief Renderer。
- [ ] 扩展 audit pack Renderer。
- [ ] 规则 Planner 自动生成 draft spec。
- [ ] Agent 辅助改写 Governing Thought 和 PAC，但必须经过 spec Schema。
- [ ] 报告差异对比与增量重渲染。
- [ ] 组件注册表版本迁移工具。

## 9. 验收标准

### 9.1 功能验收

- 合法的 metrics、insights、spec 可以一条命令生成完整 HTML。
- 同一输入、同一版本、同一环境重复生成的在线 HTML 字节一致。
- Renderer 不依赖模型调用也能完成确定性生成。
- 生成报告没有模板占位符、`undefined`、`NaN` 或未绑定业务数字。
- 每个核心结论都有 Evidence ID；每个 ECharts 数值叶子都有 runtime binding 或明确豁免。
- 无时间、无金额、无目标、无政策阈值时按合同降级，不产生伪同比、伪达成或伪风险。

### 9.2 安全与真实性验收

- spec 中的任意 HTML、脚本、事件处理器和危险 URL 被拒绝。
- 原型链路径、越界路径、旧 metrics、旧 insights、错误 SHA 被拒绝。
- Renderer 不得改变 metrics 或 insights 文件。
- Renderer 不得根据 Gate 失败自动修改业务数字或删除 Evidence。
- SQL 查询文本 hash 与结果快照 hash 的边界继续保留。

### 9.3 视觉与交付验收

- 1440、1360、430、390 四视口通过布局与无障碍 Gate。
- 长标签、高基数、极端值、负数和百分比不溢出、不误导。
- 紧凑布局保持可读，不靠缩小字体堆信息。
- 离线版无外链、相对资源或运行时出站请求。
- 最终截图必须人工逐张查看，自动 PASS 不替代目检。

### 9.4 回归验收

建议新增并最终执行：

```bash
npm run test:renderer
npm test
npm run release:check
```

CI 必须覆盖：

- report-spec Schema 正负例。
- Renderer 单元测试。
- 六类泛化 E2E。
- 双 SHA / Evidence / runtime binding 负例。
- 严格离线、运行时、截图和安装恢复。

## 10. 主要风险与控制

| 风险 | 表现 | 控制方式 |
| --- | --- | --- |
| Renderer 变成另一套模板系统 | CSS 和组件重复维护 | 复用现有模板，只增加唯一锚点 |
| spec 过度复杂 | 普通人无法填写 | 普通人不直接写完整 JSON；首版提供最小示例和后续表单/Planner |
| 故事质量机械化 | 每份报告结构相同 | Planner 与 Renderer 分离，spec 显式选择章节 |
| 自动化掩盖错误 | 为过 Gate 删除内容 | 业务错误 fail-closed，只允许机械修复 |
| Evidence 与图表漂移 | DOM、图表、合同路径不一致 | 单一 binding manifest 同源生成 |
| 销售语义回流 | 非销售夹具出现销售默认词 | 六类词汇禁入回归 |
| 一次支持过多模板 | 首版周期失控 | 先只做 scroll narrative |
| AI 与 Renderer 混写 | 难以复现和审计 | AI 只产 spec，Renderer 零模型依赖 |

## 11. 下个窗口建议执行顺序

下个窗口不要先改模板或写大量组件，按以下顺序开始：

1. 重新核对仓库状态、`main`、远端和 CI。
2. 读本计划、`SKILL.md`、Evidence/Runtime/Semantic 三份合同。
3. 建立 `report-spec.schema.json` 和合同文档。
4. 从现有 Demo 反向写一份金样 spec。
5. 先写负向 RED 测试。
6. 实现安全输入加载、路径解析、hash 校验和原子输出。
7. 实现无图表的六个基础组件。
8. 实现表格和三类图表。
9. 同源生成 Evidence 与 runtime contract。
10. 串联 Gate，跑六类夹具和完整 `npm test`。
11. 最后才迁移 Demo 真源并更新版本文档。

## 12. 下个窗口可直接使用的任务描述

```text
继续实施 south-china-report 的通用自动 Renderer。
先读取 docs/plans/2026-07-20-generic-renderer-v3.3-plan.md、SKILL.md、
references/semantic-data-contract.md、references/evidence-contract.md、
references/runtime-metrics-contract.md，并重新核对 main/远端/CI。

本轮只执行 Phase R0 + R1：
1. report-spec JSON Schema 与文档；
2. Demo 金样 spec；
3. RED 负向测试；
4. 确定性 render-report.mjs；
5. 默认 scroll narrative 紧凑模板；
6. 基础组件、表格、trend/bar/slope；
7. 自动 meta/data-metric/Evidence/runtime contract；
8. 静态 validator + verify-numbers 通过。

不要做 AI Planner、预测、因果、机器学习、bento/audit Renderer，
不要自动改业务事实来过 Gate。保留人工 HTML 兼容路径。
```

## 13. 计划编写时的交付边界（历史记录）

本轮只创建这份实施计划和待办：

- 尚未新增 Renderer 代码。
- 尚未修改模板、数据合同、Gate 或版本号。
- 尚未运行 Renderer 专项测试，因为实现尚不存在。
- 尚未 commit、push 或同步安装副本。
