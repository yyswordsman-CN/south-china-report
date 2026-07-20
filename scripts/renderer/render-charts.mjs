import { addChart } from './binding-manifest.mjs';
import { blocked } from './errors.mjs';
import { escapeAttribute, escapeHtml } from './format-value.mjs';
import { resolvePath } from './resolve-path.mjs';
import { assertSemantic, comparisonLabels } from './validate-spec.mjs';

const PALETTE = ['#0353a4', '#047857', '#d97706', '#7c3aed', '#0891b2', '#be123c'];
const SEMANTIC_COLORS = {
  favorable: '#047857',
  unfavorable: '#b91c1c',
  neutral: '#0353a4',
};

function orderedRows(rows, field, sort = 'desc', limit = rows.length) {
  const indexed = rows.map((row, index) => ({ row, index }));
  if (sort !== 'none') {
    const direction = sort === 'asc' ? 1 : -1;
    indexed.sort((left, right) => {
      const a = left.row?.[field];
      const b = right.row?.[field];
      if (!Number.isFinite(a) && !Number.isFinite(b)) return left.index - right.index;
      if (!Number.isFinite(a)) return 1;
      if (!Number.isFinite(b)) return -1;
      return (a - b) * direction || left.index - right.index;
    });
  }
  return indexed.slice(0, limit);
}

function chartHtml(component, chartId, { height = null, note = '' } = {}) {
  // verify-runtime/snapshot 会把 id^="chart-" 视为真实图表容器；
  // 标题与说明 ID 必须使用不同前缀，避免被误识别成未绑定的空图表。
  const titleId = `title-${chartId}`;
  const descriptionId = `description-${chartId}`;
  const style = height ? ` style="height: ${height}px"` : '';
  return `<div class="full-chart-section reveal" data-component-id="${escapeAttribute(component.id)}">
  <div class="full-chart-title" id="${titleId}">${escapeHtml(component.title)}</div>
  <div class="full-chart-subtitle" id="${descriptionId}">${escapeHtml(component.subtitle)}${note ? ` · ${escapeHtml(note)}` : ''}</div>
  <div id="${chartId}" class="chart-container"${style} role="img" aria-labelledby="${titleId}" aria-describedby="${descriptionId}"></div>
</div>`;
}

function semanticColor(row, semantic) {
  if (semantic.direction === 'neutral') return SEMANTIC_COLORS.neutral;
  if (row?.favorable === true) return SEMANTIC_COLORS.favorable;
  if (row?.favorable === false) return SEMANTIC_COLORS.unfavorable;
  return SEMANTIC_COLORS.neutral;
}

function extremeSplit(rows, field) {
  if (rows.length < 3) return null;
  const byMagnitude = [...rows].sort((left, right) =>
    Math.abs(right.row[field]) - Math.abs(left.row[field]) || left.index - right.index);
  const largest = Math.abs(byMagnitude[0].row[field]);
  const second = Math.abs(byMagnitude[1].row[field]);
  if (largest === 0 || (second > 0 && largest / second < 20)) return null;
  const extreme = byMagnitude[0];
  return {
    extreme: [extreme],
    remainder: rows.filter((item) => item !== extreme),
  };
}

function barSeries(component, rows, semantic, index, split) {
  return {
    name: split ? (index === 0 ? '极端对象' : '其余对象') : component.title,
    type: 'bar',
    ...(split ? { xAxisIndex: index, yAxisIndex: index } : {}),
    data: rows.map(({ row }) => ({
      value: row[component.value_field],
      itemStyle: { color: semanticColor(row, semantic) },
    })),
    barMaxWidth: 28,
  };
}

function categoryAxis(rows, index = null) {
  return {
    type: 'category',
    ...(index == null ? {} : { gridIndex: index }),
    inverse: true,
    data: rows.map(({ row }) => row.name),
    axisLabel: { width: 240, overflow: 'break', lineHeight: 16 },
  };
}

function valueAxis(index = null) {
  return {
    type: 'value',
    ...(index == null ? {} : { gridIndex: index }),
    scale: false,
    splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } },
  };
}

function ensureSameUnit(semantics, componentId) {
  const units = new Set(semantics.map((item) => item.unit).filter(Boolean));
  if (units.size > 1) blocked('mixed_chart_units', `${componentId} 同轴 series 不允许混用多个单位: ${[...units].join(', ')}`);
}

function renderTrend(component, metrics, manifest) {
  const chartId = `chart-${component.id}`;
  const prepared = [];
  const semantics = [];
  for (const series of component.series) {
    const rows = resolvePath(metrics, series.data_path, { label: `${component.id}.series.data_path` });
    const semantic = assertSemantic(metrics, series.data_path, series);
    semantics.push(semantic);
    const points = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => typeof row?.period === 'string' && Number.isFinite(row?.value));
    if (points.length === 0) continue;
    prepared.push({ series, points });
  }
  if (prepared.length === 0) return { skipped: 'no_eligible_time_series' };
  ensureSameUnit(semantics, component.id);
  const categories = prepared[0].points.map(({ row }) => row.period);
  for (const item of prepared.slice(1)) {
    const labels = item.points.map(({ row }) => row.period);
    if (labels.length !== categories.length || labels.some((label, index) => label !== categories[index])) {
      blocked('unaligned_time_series', `${component.id} 的多条时间序列期间不对齐`);
    }
  }
  const optionSeries = prepared.map((item, index) => ({
    name: item.series.name,
    type: 'line',
    data: item.points.map(({ row }) => row.value),
    symbol: 'circle',
    symbolSize: 7,
    lineStyle: { width: index === 0 ? 3 : 2, color: PALETTE[index % PALETTE.length] },
    itemStyle: { color: PALETTE[index % PALETTE.length] },
  }));
  const runtimeSeries = prepared.map((item, index) => ({
    index,
    metrics: item.points.map(({ index: rowIndex }) => `${item.series.data_path}.${rowIndex}.value`),
  }));
  addChart(manifest, { id: chartId, series: runtimeSeries });
  return {
    html: chartHtml(component, chartId),
    definition: {
      id: chartId,
      option: {
        animation: false,
        tooltip: { trigger: 'axis' },
        legend: { top: 0 },
        grid: { top: 44, left: 64, right: 28, bottom: 54, containLabel: true },
        xAxis: { type: 'category', data: categories, axisLabel: { hideOverlap: true } },
        yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } } },
        series: optionSeries,
      },
    },
  };
}

function renderBar(component, metrics, manifest) {
  const chartId = `chart-${component.id}`;
  const rows = resolvePath(metrics, component.data_path, { label: `${component.id}.data_path` });
  const selected = orderedRows(rows, component.value_field, component.sort || 'desc', component.limit || 12)
    .filter(({ row }) => typeof row?.name === 'string' && Number.isFinite(row?.[component.value_field]));
  if (selected.length === 0) return { skipped: 'no_eligible_category_values' };
  const semantic = assertSemantic(metrics, component.data_path, component);
  const split = extremeSplit(selected, component.value_field);
  const groups = split ? [split.extreme, split.remainder] : [selected];
  addChart(manifest, {
    id: chartId,
    series: groups.map((group, index) => ({
      index,
      metrics: group.map((item) => `${component.data_path}.${item.index}.${component.value_field}`),
    })),
  });
  const chartHeight = split
    ? Math.max(440, 184 + split.remainder.length * 32)
    : Math.max(360, 96 + selected.length * 32);
  const standardGrid = { top: 18, left: 28, right: 42, bottom: 24, containLabel: true };
  const splitGrids = [
    { top: 28, left: 28, right: 42, height: 64, containLabel: true },
    { top: 152, left: 28, right: 42, bottom: 24, containLabel: true },
  ];
  return {
    html: chartHtml(component, chartId, {
      height: chartHeight,
      note: split ? '极端对象与其余对象使用独立零基线，不可跨区比较条长' : '',
    }),
    definition: {
      id: chartId,
      option: {
        animation: false,
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        ...(split ? {
          title: [
            { text: '极端对象（独立零基线）', left: 28, top: 0, textStyle: { fontSize: 12, fontWeight: 600, color: '#475569' } },
            { text: '其余对象（独立零基线）', left: 28, top: 120, textStyle: { fontSize: 12, fontWeight: 600, color: '#475569' } },
          ],
          grid: splitGrids,
          xAxis: [valueAxis(0), valueAxis(1)],
          yAxis: [categoryAxis(split.extreme, 0), categoryAxis(split.remainder, 1)],
          series: groups.map((group, index) => barSeries(component, group, semantic, index, true)),
        } : {
          grid: standardGrid,
          xAxis: valueAxis(),
          yAxis: categoryAxis(selected),
          series: [barSeries(component, selected, semantic, 0, false)],
        }),
      },
      responsive: {
        kind: 'horizontal_bar',
        max_width: 520,
        label_width: 128,
        split_number: 2,
        show_max_label: false,
        split: Boolean(split),
      },
    },
  };
}

function renderSlope(component, metrics, manifest) {
  const chartId = `chart-${component.id}`;
  const rows = resolvePath(metrics, component.data_path, { label: `${component.id}.data_path` });
  const selected = orderedRows(rows, 'current', component.sort || 'desc', component.limit || 8)
    .filter(({ row }) => typeof row?.name === 'string' && Number.isFinite(row?.baseline) && Number.isFinite(row?.current));
  if (selected.length === 0) return { skipped: 'comparison_values_unavailable' };
  const labels = comparisonLabels(metrics);
  if (!labels) blocked('comparison_unavailable', `${component.id} 缺少真实比较期间`);
  const semantic = assertSemantic(metrics, component.data_path, component);
  const optionSeries = selected.map(({ row }, index) => ({
    name: row.name,
    type: 'line',
    data: [row.baseline, row.current],
    symbol: ['circle', 'diamond', 'rect', 'triangle'][index % 4],
    symbolSize: 8,
    lineStyle: { width: 2, type: index % 2 === 0 ? 'solid' : 'dashed', color: semanticColor(row, semantic) },
    itemStyle: { color: semanticColor(row, semantic) },
  }));
  const runtimeSeries = selected.map(({ index }, seriesIndex) => ({
    index: seriesIndex,
    metrics: [`${component.data_path}.${index}.baseline`, `${component.data_path}.${index}.current`],
  }));
  addChart(manifest, { id: chartId, series: runtimeSeries });
  return {
    html: chartHtml(component, chartId),
    definition: {
      id: chartId,
      option: {
        animation: false,
        tooltip: { trigger: 'axis' },
        legend: { type: 'scroll', top: 0, textStyle: { width: 220, overflow: 'truncate' } },
        grid: { top: 56, left: 64, right: 36, bottom: 42, containLabel: true },
        xAxis: { type: 'category', data: [labels.baseline, labels.current] },
        yAxis: { type: 'value', scale: true, splitLine: { lineStyle: { type: 'dashed', color: '#e2e8f0' } } },
        series: optionSeries,
      },
    },
  };
}

export function renderChart(component, metrics, manifest) {
  if (component.type === 'trend_chart') return renderTrend(component, metrics, manifest);
  if (component.type === 'bar_chart') return renderBar(component, metrics, manifest);
  if (component.type === 'slope_chart') return renderSlope(component, metrics, manifest);
  blocked('unsupported_component', `renderChart 不支持 ${component.type}`);
}
