# Evidence ID 与产物真源合同

> 目标：让报告中的每个核心结论都能被机器追溯到 `metrics.json` 或 `insights.json`，并阻断“旧数据 + 新报告”、无证据归因和真源路径漂移。

## 1. 产物哈希链

`#south-china-report-meta` 必须包含：

```json
{
  "schema_version": "1.0",
  "generator": {
    "name": "south-china-report",
    "version": "3.2.0"
  },
  "data_cutoff": {
    "data_as_of": "2026-06-30",
    "comparison_as_of": "2025-06-30",
    "completeness": "complete",
    "like_for_like": true
  },
  "metrics_sha256": "<metrics.json 完整字节的 SHA-256>",
  "insights_sha256": "<insights.json 完整字节的 SHA-256>"
}
```

`stat-insights.py` 产出的 `insights.json` 会另外写入：

```json
{
  "schema_version": "1.0",
  "meta": {
    "metrics_sha256": "<生成该 insights 时实际读取的 metrics.json SHA-256>"
  }
}
```

因此可校验 `report.html → insights.json → metrics.json` 和 `report.html → metrics.json` 两条链。任一文件被替换，`verify-numbers.mjs` 都必须失败。

## 2. Evidence 合同

报告必须只有一个 JSON 脚本：

```html
<script type="application/json" id="south-china-report-evidence-contract">
{
  "version": 1,
  "claims": [
    {
      "id": "E-PVM",
      "kind": "attribution",
      "sources": [
        { "file": "metrics", "path": "period.pvm.vol_wan" },
        { "file": "metrics", "path": "period.pvm.price_mix_wan" }
      ]
    },
    {
      "id": "H-CAUSE",
      "kind": "hypothesis",
      "reason": "暂无事件日历支撑原因归因",
      "validation_needed": "结合促销、提货和缺货日志复核"
    }
  ]
}
</script>
```

`kind` 只允许：

- `fact`：可直接由数据支撑的事实。
- `attribution`：由可复算分解支撑的归因，例如 PVM 或贡献度。
- `action`：有数据证据支撑的行动建议。
- `hypothesis`：待验证假设；不得声明 `sources`即可通过，但必须填写 `reason` 和 `validation_needed`。

除 `hypothesis` 外，每个 claim 必须至少绑定一个实际存在且非空的 `metrics|insights` 点分路径。

## 3. DOM 绑定

核心叙事节点用 `data-evidence-id` 引用 claim：

```html
<h2 class="chapter-title" data-evidence-id="E-PVM">量是本期收入缺口主因</h2>
<p class="chapter-lead" data-evidence-id="E-PVM">...</p>
<p data-evidence-id="H-CAUSE" data-claim-kind="hypothesis">活动错期可能放大了波动。</p>
```

以下核心类名强制绑定：`hero-title`、`brief-title`、`chapter-title`、`chapter-lead`、`pull-quote`、`insight-card`、`closing-title`、`action-card`。任何引用 `hypothesis` 的 DOM 节点还必须显式写 `data-claim-kind="hypothesis"`，禁止把未验证原因写成事定事实。

审计包等无主叙事产物必须在合同根节点写 `no_narrative_claims_reason`。

## 4. 强制验证

```bash
node scripts/validate-report.mjs report.html
node scripts/verify-numbers.mjs report.html metrics.json --insights insights.json
node scripts/run-evals.mjs report.html --eval <id> --metrics metrics.json --insights insights.json
```

`validate-report` 检查合同结构、核心 DOM 覆盖和假设显式标注；`verify-numbers` 校验两份产物哈希及所有 Evidence 路径真实存在。两者都通过才能交付。
