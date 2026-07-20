# Planner 与报告生命周期合同

V3.3 把“讲什么”和“怎样渲染”分开：Planner 只生成或修订通过 `report-spec.schema.json` 的 JSON；Renderer 零模型依赖，只执行已验证 Spec，禁止 Agent 直接写最终 HTML。

## 确定性规则 Planner

```bash
node scripts/plan-report.mjs \
  --metrics metrics.json --insights insights.json \
  --report-type strategic_narrative \
  --out report-spec.draft.json
```

规则只读取主指标、可用维度、`method_applicability` 与受众档位。每次决策必须写入 `planner.decisions`，并明确标记：

- `evidence`：具备可解析的 metrics/insights 路径；
- `hypothesis`：需要人工复核，必须写 `validation_needed`；
- `unsupported`：当前合同不足，不得伪装成事实或自动补造原因。

Planner 输出固定为 `lifecycle.status=draft`。相同输入、相同版本与参数应产生字节一致的 Spec。

## Agent 协助边界

Agent 只能通过 `revise-report-spec.mjs` 修改 draft 的 `report`、`narrative` 和 `actions`，修改后仍需 Schema、Evidence 路径、无裸业务数字和安全文本校验。组件、注册表版本、生命周期与输出门禁不接受 Agent patch。

## 草稿与定稿

- Renderer 默认拒绝 draft，只有审阅预览可显式传 `--allow-draft`；预览包含可见草稿标识和 `report_status=draft` 元数据。
- `build-report.mjs` 不提供草稿绕过参数，因此不会把 draft 发布为可交付目录。
- 定稿必须运行 `finalize-report-spec.mjs`，显式提供审阅人和 UTC 审阅时间；工具重新校验完整 Spec 后才写出 final。

```bash
node scripts/finalize-report-spec.mjs \
  --metrics metrics.json --insights insights.json \
  --spec report-spec.draft.json --out report-spec.json \
  --reviewed-by "业务审阅人" --reviewed-at 2026-07-20T00:00:00Z
```

## 差异、增量渲染与迁移

- `diff-report-spec.mjs` 输出逐路径结构化差异和分类计数。
- `render-report.mjs --incremental` 在生成字节未变化时不改写文件并返回 `reused=true`；有变化时原子替换。
- `migrate-report-spec.mjs` 将 legacy Spec 升级到当前组件注册表版本，要求显式审阅信息，并在写出前对真实 metrics/insights 重新校验。
- 组件、报告类型和模板映射的唯一真源是 `schemas/component-registry.json`。

Planner 评估以输出 Spec 的可复现性、Schema 合法性、Evidence 可解析性、草稿门禁和负例为准，不接受模型自评分作为发布证据。
