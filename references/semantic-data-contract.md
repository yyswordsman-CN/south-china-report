# 通用度量、分析范围与 Schema 合同

> `prep-source.py` V3.2 的数据语义真源。新项目优先使用本合同；`roles.amount/qty`、旧 `analysis_scope` 参考项与 `caliber.target_*` 只保留兼容，不再定义整个 Skill 的能力边界。

## 1. 最小合同

```json
{
  "source": {"path": "data.csv"},
  "roles": {
    "time": "date",
    "measures": [
      {
        "id": "resolution_time",
        "field": "resolution_minutes",
        "label": "平均处理时长",
        "semantic_type": "duration",
        "aggregation": "weighted_mean",
        "dimension_aggregation": "weighted_mean",
        "unit": "minute",
        "direction": "lower_is_better",
        "additivity": "non_additive",
        "weight_field": "ticket_count",
        "primary": true,
        "required": true
      },
      {
        "id": "ticket_count",
        "field": "ticket_count",
        "label": "工单数",
        "semantic_type": "count",
        "aggregation": "sum",
        "unit": "ticket",
        "direction": "neutral",
        "additivity": "additive",
        "primary": false,
        "required": true
      }
    ],
    "dimensions": ["queue"]
  },
  "analysis_scope": {
    "mode": "period",
    "period": "2025-04",
    "data_as_of": "2025-04-30",
    "comparison_as_of": "2025-03-31",
    "comparisons": [
      {"id": "previous", "type": "previous_calendar_period"}
    ]
  },
  "references": [
    {"id": "sla", "type": "target", "measure": "resolution_time", "value": 45,
     "unit": "minute", "direction_rule": "lower_is_better"},
    {"id": "healthy_band", "type": "benchmark", "measure": "resolution_time",
     "lower": 35, "upper": 50, "unit": "minute"}
  ],
  "schema": {
    "business_grain": "queue weekly aggregate",
    "primary_key": ["date", "queue"],
    "fields": {
      "date": {"required": true, "type": "date"},
      "resolution_minutes": {"required": true, "type": "number", "unit": "minute", "aggregation": "weighted_mean"},
      "ticket_count": {"required": true, "type": "number", "unit": "ticket", "aggregation": "sum"},
      "optional_note": {"required": false, "type": "string"}
    }
  },
  "drift_lock": {
    "baseline_metrics": "prior.metrics.json",
    "expected_result_change": true,
    "row_count_warn_pct": 10,
    "row_count_block_pct": 30
  }
}
```

## 2. `roles.measures[]`

| 字段 | 取值 | 约束 |
|:---|:---|:---|
| `id` | 稳定 ASCII 标识 | 唯一；作为 `measure_results.<id>` 路径 |
| `field` | 源字段名 | 普通度量必需；`aggregation=ratio` 改用分子/分母字段 |
| `semantic_type` | `amount/quantity/count/people/duration/score/rate/percentage/inventory/defect_rate/price/other` | 决定 PVM、格式化和方法适用性，不决定好坏方向 |
| `aggregation` | `sum/mean/weighted_mean/median/min/max/count/distinct_count/ratio` | `weighted_mean` 必须声明 `weight_field`；`ratio` 必须声明分子/分母 |
| `dimension_aggregation` | 同 `aggregation` | 横跨组织/仓库/队列等维度时的聚合；默认等于 `aggregation` |
| `time_aggregation` | `sum/mean/median/min/max/ending/last_non_null` | 横跨日期时的聚合；有时间列的 `semi_additive` 度量必须声明 |
| `unit` | 业务单位字符串 | 必须声明；与 `schema.fields.<field>.unit` 或 `unit_field` 实际值不一致时 BLOCKED |
| `storage_scale` | `raw/fraction/percent` | 百分比/缺陷率必须显式确认 `fraction`（0.018）或 `percent`（1.8），防止放大/缩小 100 倍 |
| `direction` | `higher_is_better/lower_is_better/neutral` | 语义色、问题识别和斜率图均读取此字段；`neutral` 不使用红绿好坏色 |
| `additivity` | `additive/semi_additive/non_additive` | 份额、贡献、Pareto、HHI 只在适用时启用 |
| `numerator_field/denominator_field` | 比率输入字段 | 仅 `ratio` 使用；按 `SUM(分子)/SUM(分母)` 聚合，分母必须为正，且两字段进入 Schema |
| `weight_field` | 权重字段 | 仅 `weighted_mean` 使用；分母必须为正 |
| `min_weight_coverage_pct` | 0–100 | 默认 95；主指标权重覆盖不足全局 BLOCKED，辅助指标机器跳过 |
| `primary` | `true/false` | 必须且只能有一个主指标 |
| `required` | `true/false` | `true` 合同漂移全局 BLOCKED；`false` 只关闭依赖模块 |

金额不再特殊。没有金额但有数量、人数、时长、得分、库存、缺陷率或比率时，报告正常生成。旧 `roles.amount/qty` 会自动转换成兼容 measures；兼容输出继续保留 `period.total_*`、金额维度别名与 PVM 路径，但不会把非金额度量伪装成“万元”。

库存、余额等典型半可加指标应使用 `dimension_aggregation=sum + time_aggregation=ending|last_non_null`，含义是“同一天跨仓求和、跨日期取期末”，不能把每日库存继续相加。百分比原始字段用 `storage_scale`；可复算的率优先使用 `ratio + numerator_field + denominator_field`，不要平均已经算好的百分比。

## 3. `analysis_scope`

### 3.1 模式

- `period`：需要有效时间字段、明确当前期间与 `data_as_of`；只有配置了时间基线才要求 `comparison_as_of`。
- `snapshot`：无需时间字段，当前范围为全表；允许结构、分布、排名、异常值和组间差异，趋势/MK/PVM 机器跳过。

### 3.2 比较类型

| `type` | 语义 | 关键字段 |
|:---|:---|:---|
| `year_over_year` / `yoy` | 同比；部分期严格同日历截止 | `comparison_as_of` |
| `mom/qoq/wow` | 上一月/季/ISO 周的完整日历期；别名输出为 `previous_calendar_period` | `comparison_as_of`；别名必须与期间粒度匹配 |
| `previous_calendar_period` / `previous_complete_period` | 按月/周/季/半年/年取上一完整日历期 | `comparison_as_of` |
| `same_stage_previous_period` | 当前期未完结时，比较上一日历期相同经过天数 | `data_as_of` + 对齐的 `comparison_as_of` |
| `previous_equal_window` | 紧邻当前期之前的等长滚动窗口，不承诺日历边界 | `comparison_as_of` |
| `period_over_period` | 旧版等长窗口兼容别名 | 新项目改用上面语义明确的类型 |
| `custom` | 自定义基线 | `period` 或 `baseline_period` |
| `none` | 不做时间比较 | 只保留当前范围分析 |

同一合同只允许一个主时间基线。`mom/qoq/wow` 是日历比较，`previous_equal_window` 是滚动等长窗，二者不得混写。部分期若选完整上一期，输出会明确标记“非同阶段”；要同阶段必须显式选 `same_stage_previous_period`。

## 4. `references[]` 统一参考合同

目标、Benchmark、参考区间和组间比较全部写在顶层 `references[]`：

| 字段 | 说明 |
|:---|:---|
| `id/type/measure/unit` | 必填；`type=target|benchmark|group`，`unit` 必须与度量一致 |
| `value` | 标量目标/Benchmark |
| `lower/upper/tolerance` | 合理区间及容差；区间内为有利 |
| `direction_rule` | 默认读取度量方向；可显式用 `higher_is_better/lower_is_better/neutral/closer_to_target` |
| `field/aggregation` | 从源字段取参考值；`unique/auto/sum/mean/median/min/max/first_per_group/unique_per_period` |
| `grain/frequency` | 字段型参考的去重粒度与 `period/week/month/xun/quarter/half/year` 频率 |
| `dimension/reference_group` | 组间比较的维度与参考组；未给参考组时对总体 |
| `required` | 参考合同局部严重度；缺失/冲突写 `BLOCKED`，不伪造达成率 |

输出唯一真源为 `metrics.references[]`；`metrics.comparisons[]` 当前是同内容兼容别名。旧 `analysis_scope.comparisons` 中的 target/benchmark/group、`measure.target_field/benchmark` 与 `roles.target + caliber.target_*` 会适配进同一解析器；`metrics.target` 只是 `legacy_target` 的兼容投影。

## 5. Schema、粒度与降级

- `schema.business_grain`：人读业务粒度说明。
- `schema.primary_key`：机器验证主键；默认不允许重复。确有合法重复时必须显式声明 `allow_duplicate_primary_key: true` 并解释业务键。
- `schema.fields`：逐字段声明 `required/type/unit/aggregation`。比率的分子/分母也必须声明 numeric。必需字段、必需类型、主键/粒度或单位漂移才进入 Schema 级 BLOCKED；可选字段缺失只 WARN 并关闭依赖模块。
- 既有 P0 仍有效：时间解析、主指标空值/坏值、完全重复行、完整度、时区、维度编码漂移等物质性越线仍可 BLOCKED。

## 6. 跨运行漂移锁

`drift_lock.baseline_metrics` 指向上一次人工确认的 `metrics.json`，相对路径按 map 文件目录解析；CLI `--baseline-metrics` 可覆盖。每次构建输出 `drift_report`，同时检查：

- `semantic_contract_sha256`：度量字段、聚合轴、单位、方向、可加性、比率/权重和 Schema 合同；默认变化即 BLOCKED。
- `result_schema_sha256`：实际加载结果的字段和 dtype；默认变化即 BLOCKED。
- `result_snapshot_rows`：默认绝对变化超过 10% WARN、超过 30% BLOCKED，可配置。
- `result_snapshot_sha256`：实际结果内容；`expected_result_change=false` 时发生变化 BLOCKED，未声明预期时变化 WARN，`true` 表示本轮已授权结果更新。

`allow_schema_change/allow_semantic_change=true` 只能用于已审阅的显式迁移，并仍保留 WARN 证据。漂移锁不是自动更新器：确认新结果后由人决定是否把本次 `metrics.json` 晋级为下一条基线。

## 7. 输出合同

`metrics.json` 新增：

- `semantic_layer.measures[]`：最终生效的度量合同与主指标。
- `analysis_scope`：模式、时间比较类型和原始比较声明。
- `measure_results.<id>`：当前、基线、绝对/百分比变化、`favorable`、分布与可用月序列。
- `measure_dimensions.<id>.<dimension>[]`：按同一聚合规则计算的排名、基线、变化、份额和方向。
- `references[]`：目标、Benchmark、区间与组间比较的结果、达成率、方向、质量或跳过原因；`comparisons[]` 是兼容别名。
- `method_applicability`：PVM、MK、TopN、Pareto、HHI 的 `ELIGIBLE/SKIPPED/BLOCKED` 与 `reason_code`。
- `meta.semantic_contract_sha256`：实际生效语义合同哈希。
- `meta.result_snapshot_sha256/result_snapshot_rows/result_schema_sha256`：加载结果快照。SQL 的 `source_sha256` 仍只证明查询文本，必须和这三项一起披露，才能发现“SQL 文本没变、结果已变”。
- `drift_report`：基线文件、策略、四类检查、警告和阻断项。

## 8. 方法适用性与政策

- PVM：只适用于可加金额 + 可加数量 + 有效时间基线 + 正分母。
- MK/稳健 Z：只接受日历连续有序序列；少于 4 点跳过，4–7 点只报方向不判显著。
- TopN：至少一个维度含两个以上分组。
- Pareto/HHI：只接受 nonnegative additive 份额。
- HHI/Top5 没有显式业务政策阈值时，输出 `classification=descriptive`、`level=null`；不得把通用启发式阈值写成业务风险。
- 低优指标：`lower_is_better` 的下降为有利、上涨为不利；`neutral` 只写变化，不使用风险/机会色。

完整跨业务示例与回归在 `evals/fixtures/generalized/`：财务、人员、库存、质量、服务工单、评分调查。
