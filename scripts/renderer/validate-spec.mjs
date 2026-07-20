import Ajv from 'ajv';
import { readFile } from 'node:fs/promises';
import { blocked, RendererError } from './errors.mjs';
import { assertRegistryVersion, COMPONENT_TYPES } from './registry.mjs';
import { resolvePath, splitSafePath, walkOwnValues } from './resolve-path.mjs';

export { COMPONENT_TYPES } from './registry.mjs';

const VISIBLE_DIGIT_RE = /[0-9０-９]/;
const UNSAFE_TEXT_RE = /[<>]|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|https?:\/\//i;

function collectVisibleText(spec) {
  const values = [
    ['report.title', spec.report?.title],
    ['report.subtitle', spec.report?.subtitle],
    ['report.organization', spec.report?.organization],
    ['report.subject', spec.report?.subject],
    ['narrative.governing_thought.text', spec.narrative?.governing_thought?.text],
  ];
  for (const [index, chapter] of (spec.narrative?.chapters || []).entries()) {
    values.push([`narrative.chapters.${index}.title`, chapter.title]);
    values.push([`narrative.chapters.${index}.lead`, chapter.lead]);
  }
  for (const [index, component] of (spec.components || []).entries()) {
    for (const key of ['title', 'subtitle', 'text']) {
      if (component[key] != null) values.push([`components.${index}.${key}`, component[key]]);
    }
    for (const [metricIndex, metric] of (component.metrics || []).entries()) {
      if (metric.label != null) values.push([`components.${index}.metrics.${metricIndex}.label`, metric.label]);
    }
    if (component.primary_metric?.label != null) {
      values.push([`components.${index}.primary_metric.label`, component.primary_metric.label]);
    }
    for (const [columnIndex, column] of (component.columns || []).entries()) {
      values.push([`components.${index}.columns.${columnIndex}.label`, column.label]);
    }
    for (const [seriesIndex, series] of (component.series || []).entries()) {
      values.push([`components.${index}.series.${seriesIndex}.name`, series.name]);
    }
  }
  for (const [index, action] of (spec.actions || []).entries()) {
    for (const key of ['object', 'action', 'deadline', 'validation_metric']) {
      values.push([`actions.${index}.${key}`, action[key]]);
    }
  }
  return values.filter(([, value]) => typeof value === 'string');
}

function assertNoUnsafeContent(spec) {
  walkOwnValues(spec, (value, path) => {
    if (typeof value === 'string' && UNSAFE_TEXT_RE.test(value)) {
      blocked('unsafe_content', `report-spec 包含不允许的 HTML、脚本、事件处理器或远程 URL: ${path}`);
    }
  });
  const numeric = collectVisibleText(spec).filter(([, value]) => VISIBLE_DIGIT_RE.test(value));
  if (numeric.length) {
    blocked(
      'unbound_numeric_literal',
      '首版自由文本禁止裸数字；业务数字必须通过 metric 组件绑定，期间等非业务数字只写入 meta',
      numeric.slice(0, 12).map(([path, value]) => `${path}: ${JSON.stringify(value)}`),
    );
  }
}

function formatAjvError(error) {
  const path = error.instancePath || '/';
  return `${path} ${error.message || error.keyword}`;
}

function assertUniqueIds(spec) {
  const seen = new Map();
  const entries = [
    ['report', spec.report.id],
    ...(spec.narrative.chapters || []).map((item) => ['chapter', item.id]),
    ...(spec.components || []).map((item) => ['component', item.id]),
    ...(spec.actions || []).map((item) => ['action', item.id]),
  ];
  for (const [kind, id] of entries) {
    if (seen.has(id)) {
      blocked('duplicate_id', `ID 必须全局唯一: ${id}`, [`${seen.get(id)} 与 ${kind} 重复`]);
    }
    seen.set(id, kind);
  }
}

function assertStructure(spec) {
  const components = spec.components;
  const count = (type) => components.filter((item) => item.type === type).length;
  if (count('hero') !== 1) blocked('component_cardinality', '首版必须且只能有一个 hero');
  if (count('kpi_strip') !== 1) blocked('component_cardinality', '首版必须且只能有一个 kpi_strip');
  if (count('closing_actions') !== 1) blocked('component_cardinality', '首版必须且只能有一个 closing_actions');

  const chapters = new Set(spec.narrative.chapters.map((chapter) => chapter.id));
  for (const chapterId of chapters) {
    const intros = components.filter((item) => item.type === 'chapter_intro' && item.chapter_id === chapterId);
    if (intros.length !== 1) {
      blocked('chapter_intro_cardinality', `章节 ${chapterId} 必须且只能有一个 chapter_intro`);
    }
  }
  for (const component of components) {
    if (component.chapter_id && !chapters.has(component.chapter_id)) {
      blocked('unknown_chapter', `组件 ${component.id} 引用了不存在的 chapter_id=${component.chapter_id}`);
    }
  }
}

function assertPlannerDecisions(spec, metrics, insights) {
  for (const decision of spec.planner?.decisions || []) {
    for (const rawPath of decision.evidence || []) {
      const [rootName, ...parts] = rawPath.split('.');
      const root = rootName === 'metrics' ? metrics : insights;
      resolvePath(root, parts.join('.'), { label: `planner decision ${decision.id}` });
    }
  }
}

export function semanticForPath(metrics, rawPath) {
  const parts = splitSafePath(rawPath, 'metric path');
  let measureId = null;
  if (parts[0] === 'measure_results' && parts.length >= 3) measureId = parts[1];
  if (parts[0] === 'measure_dimensions' && parts.length >= 3) measureId = parts[1];
  if (!measureId) return { measureId: null, unit: null, direction: null };
  const result = metrics.measure_results?.[measureId];
  const semantic = (metrics.semantic_layer?.measures || []).find((item) => item.id === measureId);
  if (!result && !semantic) blocked('unknown_measure', `路径引用未知 measure: ${rawPath}`);
  return {
    measureId,
    unit: result?.unit ?? semantic?.unit ?? null,
    direction: result?.direction ?? semantic?.direction ?? null,
  };
}

export function assertSemantic(metrics, rawPath, assertions = {}) {
  const semantic = semanticForPath(metrics, rawPath);
  if (assertions.assert_unit && semantic.unit !== assertions.assert_unit) {
    blocked('unit_mismatch', `${rawPath} 单位断言错误: spec=${assertions.assert_unit}, metrics=${semantic.unit}`);
  }
  if (assertions.assert_direction && semantic.direction !== assertions.assert_direction) {
    blocked('direction_mismatch', `${rawPath} 方向断言错误: spec=${assertions.assert_direction}, metrics=${semantic.direction}`);
  }
  return semantic;
}

export function comparisonLabels(metrics) {
  const lock = metrics.meta?.period_lock;
  if (!lock || !lock.base_start || !lock.start) return null;
  const labelFrom = (dateText, granularity, fallback) => {
    const [year, month] = String(dateText).split('-').map(Number);
    if (granularity === 'month') return `${year}-${String(month).padStart(2, '0')}`;
    if (granularity === 'quarter') return `${year}Q${Math.floor((month - 1) / 3) + 1}`;
    if (granularity === 'half') return `${year}H${month <= 6 ? 1 : 2}`;
    if (granularity === 'year') return String(year);
    return fallback || String(dateText);
  };
  return {
    baseline: labelFrom(lock.base_start, lock.granularity, lock.base_start),
    current: lock.label || labelFrom(lock.start, lock.granularity, lock.start),
  };
}

function assertComponentSemantics(spec, metrics) {
  for (const component of spec.components) {
    try {
      if (component.primary_metric) {
        resolvePath(metrics, component.primary_metric.path, { label: `${component.id}.primary_metric.path` });
        assertSemantic(metrics, component.primary_metric.path, component.primary_metric);
      }
      for (const metric of component.metrics || []) {
        resolvePath(metrics, metric.path, { label: `${component.id}.metrics.path` });
        assertSemantic(metrics, metric.path, metric);
      }
      if (component.data_path) {
        const data = resolvePath(metrics, component.data_path, { label: `${component.id}.data_path` });
        if (!Array.isArray(data)) blocked('invalid_component_data', `${component.id}.data_path 必须解析为数组`);
        assertSemantic(metrics, component.data_path, component);
      }
      for (const series of component.series || []) {
        const data = resolvePath(metrics, series.data_path, { label: `${component.id}.series.data_path` });
        if (!Array.isArray(data)) blocked('invalid_component_data', `${component.id}.series.data_path 必须解析为数组`);
        assertSemantic(metrics, series.data_path, series);
      }
      if (component.type === 'slope_chart') {
        const actual = comparisonLabels(metrics);
        if (!actual) blocked('comparison_unavailable', `${component.id} 需要真实比较期间，但 metrics.meta.period_lock 不完整`);
        const expected = component.assert_comparison_labels;
        if (expected && (expected.baseline !== actual.baseline || expected.current !== actual.current)) {
          blocked(
            'comparison_label_mismatch',
            `${component.id} 比较标签断言错误`,
            [`spec=${expected.baseline}/${expected.current}`, `metrics=${actual.baseline}/${actual.current}`],
          );
        }
      }
    } catch (error) {
      const optionalTypes = new Set(['rank_table', 'comparison_table', 'trend_chart', 'bar_chart', 'slope_chart', 'data_detail']);
      const skippableReasons = new Set(['unresolved_path', 'invalid_component_data', 'comparison_unavailable']);
      if (component.optional && optionalTypes.has(component.type) && error instanceof RendererError && skippableReasons.has(error.reasonCode)) {
        continue;
      }
      throw error;
    }
  }
}

export async function validateSpec(spec, metrics, schemaPath, insights = null) {
  const unknown = (spec.components || []).find((component) => !COMPONENT_TYPES.has(component?.type));
  if (unknown) blocked('unsupported_component', `不支持的组件类型: ${JSON.stringify(unknown.type)}`);
  assertRegistryVersion(spec);
  assertNoUnsafeContent(spec);

  let schema;
  try {
    schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  } catch (error) {
    blocked('schema_read_failed', `无法读取 report-spec Schema: ${schemaPath}`, [error.message]);
  }
  const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: false });
  const validate = ajv.compile(schema);
  if (!validate(spec)) {
    blocked('invalid_report_spec', 'report-spec 未通过 JSON Schema', (validate.errors || []).map(formatAjvError));
  }
  assertUniqueIds(spec);
  assertStructure(spec);
  assertComponentSemantics(spec, metrics);
  if (spec.planner) {
    if (!insights) blocked('planner_insights_required', '校验 Planner 决策时必须提供 insights.json');
    assertPlannerDecisions(spec, metrics, insights);
  }
  return spec;
}
