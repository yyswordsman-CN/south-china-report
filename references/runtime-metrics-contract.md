# Runtime Metrics Contract — 渲染后数字真值合同

## 目的

`verify-numbers.mjs` 校验 HTML 源码中的可见数字；`verify-runtime.mjs` 在 Chromium 中真正执行严格离线报告，再校验最终 DOM 与 ECharts `getOption()`。两者必须同时通过，避免 CountUp、运行时注入、Canvas/SVG 或嵌套 option 绕过静态 Gate。

## 合同版本

新报告使用 `version: 2`。V1 的标量 `metrics` 与整系列 `exempt` 写法继续兼容；坐标、树和 custom 等结构化数据只能使用 V2。

```html
<script type="application/json" id="south-china-report-runtime-contract">
{
  "version": 2,
  "charts": [
    {
      "id": "chart-trend",
      "series": [
        {
          "index": 0,
          "metrics": [
            "trend.2026.0",
            "trend.2026.1",
            { "path": "trend.2026.2", "factor": 0.0001, "tolerance": 0.001 }
          ]
        }
      ]
    }
  ]
}
</script>
```

- `charts[].id` 必须等于已渲染 ECharts 容器的 `id`，每张图都必须进入合同。
- `series[].index` 对应 `echartsInstance.getOption().series[index]`。
- 每个非空系列必须且只能选一种模式：`metrics`、整系列 `exempt`、或 V2 `bindings/exemptions`。
- metric 对象支持 `transform: "identity" | "abs" | "negate"`、有限数值 `factor`、非负 `tolerance`。

## 模式一：标量简写

`metrics` 与 `series.data` 等长，适用于数字、`null`、`"-"`，或仅含一个标量 `value` 的 data item：

```json
{
  "index": 0,
  "metrics": ["trend.2026.0", "trend.2026.1"]
}
```

只要 data item 内还有圆角、透明度、坐标数组或其他数值叶子，标量简写就会失败，必须改用结构化绑定。这条规则防止视觉配置或自定义编码藏在对象里绕过覆盖率。

## 模式二：结构化叶子绑定

`bindings` 用 RFC 6901 JSON Pointer 指向 `series.data` 内的每个业务数值叶子。数组下标从 `0` 开始，对象键中的 `~`/`/` 分别编码为 `~0`/`~1`。

### 坐标对

图表数据 `[[1, 10], [2, 20]]`：

```json
{
  "index": 0,
  "bindings": [
    { "dataPointer": "/0/0", "metric": "scatter.points.0.x" },
    { "dataPointer": "/0/1", "metric": "scatter.points.0.y" },
    { "dataPointer": "/1/0", "metric": "scatter.points.1.x" },
    { "dataPointer": "/1/1", "metric": "scatter.points.1.y" }
  ]
}
```

### 递归树

图表数据 `[{value:100, children:[{value:60},{value:40}]}]`：

```json
{
  "index": 1,
  "bindings": [
    { "dataPointer": "/0/value", "metric": "tree.total" },
    { "dataPointer": "/0/children/0/value", "metric": "tree.children.0.value" },
    { "dataPointer": "/0/children/1/value", "metric": "tree.children.1.value" }
  ]
}
```

### Custom / 任意嵌套对象

`{value:[x,y,size], itemStyle:{opacity:0.8}}` 的三个业务维度必须绑定；纯视觉透明度逐叶豁免：

```json
{
  "index": 2,
  "bindings": [
    { "dataPointer": "/0/value/0", "metric": "custom.0.x" },
    { "dataPointer": "/0/value/1", "metric": "custom.0.y" },
    { "dataPointer": "/0/value/2", "metric": "custom.0.size" }
  ],
  "exemptions": [
    { "dataPointer": "/0/itemStyle/opacity", "reason": "视觉透明度常量，不表达业务值" }
  ]
}
```

多个同理由的叶子可合并为精确列表：

```json
{
  "dataPointers": ["/0/itemStyle/borderRadius", "/1/itemStyle/borderRadius"],
  "reason": "条形圆角视觉常量，不表达业务值"
}
```

不支持通配符或整棵子树豁免，防止结构变化后把新增业务值静默吞掉。

## 数值叶子与 fail-closed 规则

以下都视为必须绑定或豁免的叶子：

- 有限 number、`null`、`"-"`。
- 完整数值字符串，例如 `"7,292.5"`、`"+8.0pp"`、`"30%"`；它们常出现在 data item 的 `label.formatter` 中。
- 任意深度数组或对象内的上述值，包括树的 `children`、坐标维度、symbol size、圆角和透明度。

以下情况直接失败：遗漏叶子、重复绑定/豁免、指针不存在、指向非数值叶子、非法 `~` 转义、原型链键、未知字段、空理由、非有限数值、循环引用、超过 64 层或 100,000 个数值叶子。

## 整系列豁免

仅不表达业务值的辅助系列可以使用：

```json
{ "index": 0, "exempt": "瀑布图透明基座，仅用于定位浮动柱" }
```

目标线、参考线、计划值、标签数字仍是业务值，不得豁免。最终 DOM 中的章节号、日期、序号等非业务数字继续使用 `data-number-exempt="具体原因"`。

## 交付命令与边界

```bash
node scripts/verify-runtime.mjs report.offline.html metrics.json
```

退出码：`0` 通过；`1` 真值或覆盖失败；`2` 参数/文件错误；`3` Playwright 或 Chromium 不可用，此时必须标注“运行时数字未验证”。

V2 已覆盖 `series.data` 的标量、坐标、递归树和任意嵌套 custom 结构。当前仍不解析 `dataset.source`、`markPoint/markLine` 或 renderItem 函数内部临时生成、但未落入 `series.data` 的数值；使用这些能力时必须先扩展合同或在交付说明中标为未验证，不能把当前 Gate 写成全 option 覆盖。
