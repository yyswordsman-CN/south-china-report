import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blocked } from './errors.mjs';
import { REGISTRY_VERSION } from './registry.mjs';
import { validateSpec } from './validate-spec.mjs';

function safeId(value, fallback) {
  const normalized = String(value || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 48);
  return normalized.length >= 2 ? normalized : fallback;
}

function safeLabel(value, fallback) {
  const text = String(value || '').trim();
  return text && !/[0-9０-９<>]/.test(text) ? text.slice(0, 40) : fallback;
}

function metricRef(pathValue, result, label, format = 'auto') {
  return {
    path: pathValue,
    label,
    format,
    ...(result?.unit ? { assert_unit: result.unit } : {}),
    ...(result?.direction ? { assert_direction: result.direction } : {}),
  };
}

function finitePath(metrics, rawPath) {
  const value = rawPath.split('.').reduce((current, key) => current?.[key], metrics);
  return Number.isFinite(value);
}

function kpiRefs(metrics, measureIds, primary) {
  const candidates = [];
  for (const measureId of [primary, ...measureIds.filter((id) => id !== primary)]) {
    const result = metrics.measure_results[measureId];
    const label = safeLabel(result?.label, measureId === primary ? '核心指标' : '辅助指标');
    for (const [field, suffix, format] of [
      ['current', '当前值', 'auto'],
      ['change_pct', '变化', 'signed_percent'],
      ['baseline', '比较值', 'auto'],
      ['change_abs', '变化量', 'signed_number'],
    ]) {
      const metricPath = `measure_results.${measureId}.${field}`;
      if (finitePath(metrics, metricPath)) candidates.push(metricRef(metricPath, result, `${label}${suffix}`, format));
    }
  }
  const unique = [];
  for (const item of candidates) {
    if (!unique.some((existing) => existing.path === item.path)) unique.push(item);
  }
  if (unique.length < 3) blocked('planner_insufficient_metrics', 'Planner 至少需要三个可展示数值路径');
  return unique.slice(0, 6);
}

function overallNarrative(result) {
  const label = safeLabel(result.label, '核心指标');
  if (result.favorable === true) return {
    governing: `${label}改善，结构差异仍需持续验证`,
    chapter: `${label}改善，优势结构需继续巩固`,
  };
  if (result.favorable === false) return {
    governing: `${label}承压，主要结构缺口需优先治理`,
    chapter: `${label}回落，恢复动作需聚焦主要缺口`,
  };
  return {
    governing: `${label}保持稳定，结构差异需持续监测`,
    chapter: `${label}整体稳定，局部差异需分层查看`,
  };
}

function dimensionChapter(dimension, index) {
  const label = safeLabel(dimension, `结构维度${index + 1}`.replace(/[0-9]/g, ''));
  return {
    id: safeId(`dimension-${index + 1}`, `dimension-${String.fromCharCode(97 + index)}`),
    label,
    title: `${label}分化明显，应按影响程度排序治理`,
    lead: `${label}内部的方向与影响量级不一致，应先处理主要缺口，再复制有效经验。`,
  };
}

export function createDraftSpec(metrics, insights, options = {}) {
  const measureIds = Object.keys(metrics.measure_results || {});
  const primary = metrics.meta?.primary_measure_id || measureIds[0];
  const primaryResult = metrics.measure_results?.[primary];
  if (!primary || !primaryResult || !Number.isFinite(primaryResult.current)) {
    blocked('planner_missing_primary_measure', 'Planner 需要可用的主指标当前值');
  }
  const reportType = options.reportType || 'strategic_narrative';
  const audience = options.audience || 'L2';
  const narrative = overallNarrative(primaryResult);
  const primaryLabel = safeLabel(primaryResult.label, '核心指标');
  const dimensions = Object.entries(metrics.measure_dimensions?.[primary] || {})
    .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
    .slice(0, reportType === 'executive_brief' || audience === 'L1' ? 1 : 2);
  const chapters = [{
    id: 'overall-performance',
    title: narrative.chapter,
    lead: '先确认整体方向和变化边界，再进入结构拆解与行动排序。',
    claim_kind: 'fact',
    evidence: [`metrics.measure_results.${primary}.current`],
  }];
  const components = [
    {
      id: 'hero-main',
      type: 'hero',
      primary_metric: metricRef(`measure_results.${primary}.current`, primaryResult, primaryLabel),
    },
    { id: 'kpi-main', type: 'kpi_strip', metrics: kpiRefs(metrics, measureIds, primary).slice(0, audience === 'L1' ? 4 : 6) },
    { id: 'intro-overall', type: 'chapter_intro', chapter_id: 'overall-performance' },
  ];
  const decisions = [{
    id: 'overall-evidence',
    status: 'evidence',
    reason_code: 'primary-measure-available',
    evidence: [`metrics.measure_results.${primary}.current`],
  }];

  const trendPath = `measure_results.${primary}.time_series`;
  const trendRows = primaryResult.time_series;
  const trendMethod = metrics.method_applicability?.mk_trend;
  if (reportType !== 'audit_pack' && Array.isArray(trendRows) && trendRows.filter((row) => Number.isFinite(row?.value)).length >= 4 &&
      !['SKIPPED', 'BLOCKED'].includes(trendMethod?.status)) {
    components.push({
      id: 'trend-main',
      type: 'trend_chart',
      chapter_id: 'overall-performance',
      title: `${primaryLabel}趋势揭示恢复节奏与异常波动`,
      subtitle: '按完整时间序列展示，不进行超出证据的预测外推',
      series: [{
        name: primaryLabel,
        data_path: trendPath,
        ...(primaryResult.unit ? { assert_unit: primaryResult.unit } : {}),
        ...(primaryResult.direction ? { assert_direction: primaryResult.direction } : {}),
      }],
    });
    decisions.push({
      id: 'trend-evidence',
      status: 'evidence',
      reason_code: safeId(trendMethod?.reason_code, 'time-series-available'),
      evidence: [`metrics.${trendPath}`],
    });
  } else {
    decisions.push({
      id: 'trend-unsupported',
      status: 'unsupported',
      reason_code: safeId(trendMethod?.reason_code, 'time-series-unavailable'),
    });
  }

  dimensions.forEach(([dimension], index) => {
    const chapter = dimensionChapter(dimension, index);
    const chapterId = chapter.id;
    const dataPath = `measure_dimensions.${primary}.${dimension}`;
    const evidence = `metrics.${dataPath}.0.current`;
    chapters.push({
      id: chapterId,
      title: chapter.title,
      lead: chapter.lead,
      claim_kind: 'fact',
      evidence: [evidence],
    });
    components.push({ id: `intro-${chapterId}`, type: 'chapter_intro', chapter_id: chapterId });
    if (reportType === 'strategic_narrative') components.push({
        id: `bars-${chapterId}`,
        type: 'bar_chart',
        chapter_id: chapterId,
        title: `${chapter.label}变化方向分化，影响集中在少数对象`,
        subtitle: '分类比较使用真实变化值与动态零基线',
        data_path: dataPath,
        value_field: Number.isFinite(metrics.measure_dimensions[primary][dimension][0]?.change_pct) ? 'change_pct' : 'current',
        limit: 10,
        sort: 'asc',
        ...(primaryResult.unit ? { assert_unit: primaryResult.unit } : {}),
        ...(primaryResult.direction ? { assert_direction: primaryResult.direction } : {}),
      });
    components.push({
        id: `table-${chapterId}`,
        type: 'rank_table',
        chapter_id: chapterId,
        title: `${chapter.label}排名与变化需同时查看`,
        subtitle: '当前值、比较值与变化取自同一维度合同',
        data_path: dataPath,
        columns: [
          { label: '当前值', field: 'current', format: 'auto' },
          ...(Number.isFinite(metrics.measure_dimensions[primary][dimension][0]?.change_pct)
            ? [{ label: '变化率', field: 'change_pct', format: 'signed_percent' }]
            : []),
        ],
        limit: 10,
        sort: 'desc',
      });
    decisions.push({
      id: `dimension-${String.fromCharCode(97 + index)}-evidence`,
      status: 'evidence',
      reason_code: 'dimension-values-available',
      evidence: [evidence],
    });
  });

  components.push({
    id: 'closing-main',
    type: 'closing_actions',
    title: '先验证主要缺口，再固化有效改善动作',
  });
  const actionObject = dimensions.length ? safeLabel(dimensions[0][0], '业务责任团队') : '业务责任团队';
  const actions = [{
    id: 'validate-primary-gap',
    object: `${actionObject}责任团队`,
    action: '复核主要缺口并建立可跟踪的恢复清单',
    deadline: '下个复盘周期前',
    validation_metric: `${primaryLabel}变化返回可控区间`,
    priority: 'urgent',
    claim_kind: 'hypothesis',
    reason: '规则 Planner 只能识别数据缺口，不能自动确认业务原因。',
    validation_needed: '由责任团队核对原始记录、业务事件和可执行资源后再定稿。',
  }];
  decisions.push(
    {
      id: 'action-hypothesis',
      status: 'hypothesis',
      reason_code: 'business-cause-unverified',
      validation_needed: '需由业务责任人确认原因、对象、期限与验证指标。',
    },
    {
      id: 'causal-unsupported',
      status: 'unsupported',
      reason_code: 'causal-context-unavailable',
    },
  );

  return {
    schema_version: '1.0',
    registry_version: REGISTRY_VERSION,
    lifecycle: { status: 'draft' },
    planner: { name: 'rule-planner', version: '1.0', strategy: 'deterministic-rules', decisions },
    report: {
      id: safeId(options.id || `planned-${primary}`, 'planned-report'),
      type: reportType,
      audience,
      density: options.density || 'compact',
      language: 'zh-CN',
      title: narrative.governing,
      subtitle: options.subtitle || '规则 Planner 生成的待审阅草稿',
      organization: options.organization || '业务组织',
      subject: options.subject || primaryLabel,
    },
    narrative: {
      governing_thought: {
        text: narrative.governing,
        claim_kind: 'fact',
        evidence: [`metrics.measure_results.${primary}.current`],
      },
      chapters,
    },
    components,
    actions,
    output: { offline: true, run_gates: true },
  };
}

export async function loadPlannerInputs(metricsPath, insightsPath) {
  const [metricsPayload, insightsPayload] = await Promise.all([readFile(metricsPath), readFile(insightsPath)]);
  let metrics;
  let insights;
  try {
    metrics = JSON.parse(metricsPayload.toString('utf8'));
    insights = JSON.parse(insightsPayload.toString('utf8'));
  } catch (error) {
    blocked('invalid_json', `Planner 输入不是有效 JSON: ${error.message}`);
  }
  if (metrics?.data_status?.status === 'BLOCKED') blocked('metrics_blocked', 'metrics.json 已 BLOCKED，Planner 不生成叙事');
  const metricsSha = createHash('sha256').update(metricsPayload).digest('hex');
  if (insights?.meta?.metrics_sha256 !== metricsSha) {
    blocked('insights_metrics_sha_mismatch', 'insights.meta.metrics_sha256 与实际 metrics.json 不一致');
  }
  return { metrics, insights };
}

export async function validatePlannedSpec(spec, metrics, insights, root) {
  return validateSpec(spec, metrics, path.join(root, 'schemas', 'report-spec.schema.json'), insights);
}
