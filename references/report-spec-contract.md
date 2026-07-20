# Report Spec 合同与确定性 Renderer

> `report-spec.json` 是 `metrics.json + insights.json` 到 HTML 之间的机器可读编译合同。JSON Schema 真源为 `schemas/report-spec.schema.json`；首版 Renderer 入口为 `scripts/render-report.mjs`。

## 1. 角色边界

```text
规则 / Agent / 人工负责决定讲什么
            -> report-spec.json
            -> render-report.mjs 只做确定性装配
            -> report.html
```

Renderer 不调用模型，不猜 Governing Thought、业务原因、行动建议或预测结果，也不根据 Gate 失败删除证据或改写数字。同一组输入、同一模板和同一运行环境必须生成字节一致的在线 HTML。

人工维护 HTML 的旧流程继续可用。模板中的 `SCR:*` 是编译锚点；人工流程可继续按既有示例编辑，自动流程只在这些显式锚点之间替换内容，不猜测任意 DOM 位置。

Demo 已在 R4 迁移为 spec/Renderer 真源；`demo-report/legacy/` 中的 V3.2 手工 HTML 只保留一个版本周期作等价性对照和回退，不参与新产物生成。

## 2. 一条命令

```bash
node scripts/render-report.mjs \
  --metrics metrics.json \
  --insights insights.json \
  --spec report-spec.json \
  --out report.html
```

可选参数：

- `--force`：允许原子替换既有输出；默认拒绝覆盖。
- `--density compact|standard`：显式覆盖 spec 的密度；默认读取 `report.density`。
- `--template scroll-narrative`：首版唯一已注册模板。其他值返回 `unsupported_template`。

输出成功时打印机器可读摘要，包含输入哈希、输出哈希、组件数、图表数和跳过项。失败时不写最终文件，退出码为 `2`。

## 3. 最小结构

完整金样见 `demo-report/report-spec.json`，六类跨业务合同夹具见 `evals/specs/generalized/`。

```json
{
  "schema_version": "1.0",
  "report": {
    "id": "service-monthly",
    "type": "strategic_narrative",
    "audience": "L2",
    "density": "compact",
    "language": "zh-CN",
    "title": "效率改善，高峰队列仍需治理",
    "subtitle": "服务运营分析",
    "organization": "服务组织",
    "subject": "工单运营"
  },
  "narrative": {
    "governing_thought": {
      "text": "总体效率改善，高峰队列仍是主要约束",
      "claim_kind": "fact",
      "evidence": ["metrics.measure_results.resolution_time.current"]
    },
    "chapters": []
  },
  "components": [],
  "actions": [],
  "output": { "offline": true, "run_gates": true }
}
```

Schema 还会要求至少一个章节、一个完整行动项，以及 `hero`、`kpi_strip`、每章唯一 `chapter_intro` 和 `closing_actions`。上面的片段只展示字段含义，不是可直接渲染的完整文件。

## 4. Claim 与 Evidence

`claim_kind` 只允许 `fact|attribution|action|hypothesis`：

- 非假设必须提供至少一个 `metrics.*` 或 `insights.*` 路径。
- `hypothesis` 必须提供 `reason` 和 `validation_needed`，不得伪装成事实。
- 所有 Evidence 路径在写文件前解析；不存在、为空或含 `__proto__|prototype|constructor` 时直接 BLOCK。
- Renderer 从同一个 binding manifest 生成 Evidence claim、DOM `data-evidence-id` 和 ECharts runtime binding，避免三套合同分开拼接。

## 5. Metric 引用

Metric 引用只选择展示方式，不覆盖事实语义：

```json
{
  "path": "measure_results.resolution_time.current",
  "label": "平均处理时长",
  "format": "decimal",
  "precision": 1,
  "assert_unit": "minute",
  "assert_direction": "lower_is_better"
}
```

- `path` 始终相对 `metrics.json`。
- `assert_unit` 和 `assert_direction` 是漂移断言，不是覆盖值；与语义层不一致时分别返回 `unit_mismatch`、`direction_mismatch`。
- `format` 只允许 `auto|integer|decimal|percent|percentage_point|signed_number|signed_percent`。百分比格式与度量语义不相容时返回 `format_semantic_mismatch`。
- 页面数字由 Renderer 自动生成 `data-metric`；报告 meta 的 `key_metrics`、Evidence 与 runtime contract 同源生成。

首版自由文本禁止裸阿拉伯数字。业务数字必须通过 Metric 引用进入页面；章节号和行动序号由 Renderer 逐叶加 `data-number-exempt`。带数字的维度标签只按“编号型标签”显式豁免。该限制用于结构性保证 `verify-numbers` 的百分百覆盖，不允许事后用大容器豁免掩盖业务数字。

## 6. 组件白名单

| 组件 | 关键字段 | 说明 |
|:---|:---|:---|
| `hero` | `primary_metric` | Governing Thought 与首屏主指标 |
| `kpi_strip` | `metrics` | 三至八个核心指标 |
| `chapter_intro` | `chapter_id` | 每章必须且只能有一个 |
| `insight_callout` | `title/text/claim_kind/evidence` | Evidence 或显式 hypothesis |
| `rank_table` | `data_path/columns/sort/limit` | 分类排名与长标签 |
| `comparison_table` | 同上 | 当前、基线、变化对比 |
| `trend_chart` | `series[].data_path` | 规则时间序列，期间必须对齐 |
| `bar_chart` | `data_path/value_field` | 分类比较与动态轴域 |
| `slope_chart` | `data_path/assert_comparison_labels` | 两期变化，显示标签只读真实 period lock |
| `data_detail` | `data_path/columns` | 可复算明细 |
| `closing_actions` | 顶层 `actions[]` | 对象、动作、期限、验证指标 |

未知组件返回 `unsupported_component`，不会静默退回普通卡片。图表 option 由 Renderer 白名单代码生成，spec 不能携带任意 JavaScript、CSS、HTML、事件处理器或远程 URL。

## 7. 可选组件与降级

图表或表格声明 `optional: true` 后，仅在方法或数据确实不适用时允许跳过，并在成功摘要的 `skipped[]` 中记录 `component_id/component_type/reason_code`。必需组件不适用时返回 `component_not_applicable`。

`period` 成品要求 `period_lock` 提供真实当前期、基期与同口径截止日。无时间 `snapshot` 不伪造业务日期：meta 固定写 `requested_period="snapshot"`，`data_as_of/comparison_as_of=null`、`completeness="snapshot"`、`like_for_like=false`；趋势、斜率和 PVM 等时间模块只能以 `optional: true` 机器跳过并记录 `reason_code`，或在必需时直接 BLOCK。

## 8. 状态与退出码

| 退出码 | 状态 | 含义 |
|:---:|:---|:---|
| `0` | `OK` | HTML 已原子写出；仍需执行既有 Gate |
| `2` | `BLOCKED` | 参数、Schema、真源、路径、语义、模板或写出失败；不写最终文件 |
| `3` | `UNVERIFIED` | 由后续 Playwright/Chromium Gate 使用；Renderer 本身不把未验证当成功 |

常见 `reason_code`：`invalid_report_spec`、`unsupported_component`、`unsafe_content`、`unsafe_path`、`duplicate_id`、`missing_evidence`、`unresolved_path`、`unit_mismatch`、`direction_mismatch`、`comparison_label_mismatch`、`insights_metrics_sha_mismatch`、`metrics_blocked`、`template_anchor_invalid`、`output_exists`。

## 9. R0/R1/R3 验收

```bash
npm run test:renderer

node scripts/render-report.mjs \
  --metrics demo-report/metrics.json \
  --insights demo-report/insights.json \
  --spec demo-report/report-spec.json \
  --out /tmp/south-china-rendered-report.html

node scripts/validate-report.mjs /tmp/south-china-rendered-report.html
node scripts/verify-numbers.mjs /tmp/south-china-rendered-report.html \
  demo-report/metrics.json --insights demo-report/insights.json
```

`exit 0` 只说明当前 Gate 无 P0。严格离线、运行时真值、四视口截图与人工目检仍按 `SKILL.md` 步骤执行；首版 Renderer 不把这些后续步骤的缺失包装成“成品已发布”。

R3 六类泛化链会从 CSV 重建 metrics/insights，逐类执行完整七段 Gate，并检查快照降级、默认销售词禁入、低优指标方向语义、百分比/负数/零值/极值/长标签/高基数、可选跳过和 HHI 无政策描述性边界：

```bash
npm run test:renderer-generalized
```

## 10. R2 完整构建

需要交付完整报告目录时，使用一条命令：

```bash
node scripts/build-report.mjs \
  --metrics metrics.json \
  --insights insights.json \
  --spec report-spec.json \
  --out-dir report-build
```

构建器只做编排，不复制或弱化任何 Gate。它在目标目录同级的 staging 中依次执行：

1. `render-report.mjs`
2. 在线版 `validate-report.mjs`
3. `verify-numbers.mjs --insights`
4. `make-offline.mjs`
5. 离线版 `validate-report.mjs --strict-offline`
6. `verify-runtime.mjs`
7. `snapshot.mjs`

全部通过后才用同文件系统目录重命名原子发布。输出包括 `report.html`、`report.offline.html`、`shots/`、`logs/` 和 `build-summary.json`；摘要逐步记录状态、退出码、原因码、日志路径、核心计数和产物 SHA-256。

任何步骤失败都不会发布最终目录，也不会触碰既有成功目录；已生成的诊断产物和日志会保存在返回的 `diagnostics_dir`。目标已存在时默认拒绝覆盖，只有显式 `--force` 才允许在全部 Gate 通过后替换。

`--skip-snapshot` 只供开发使用：仍执行到运行时真值 Gate，但整体返回退出码 `3`、状态 `UNVERIFIED`、`delivery_ready=false`。该开发目录不得描述为已完成截图验收或可交付成品。
