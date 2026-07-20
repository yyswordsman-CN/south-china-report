/** Direction-aware, data-driven chart helpers for report authors and regression tests. */

const DIRECTIONS = new Set(['higher_is_better', 'lower_is_better', 'neutral']);

export function semanticDeltaState(before, after, direction = 'neutral') {
  if (!DIRECTIONS.has(direction)) throw new Error(`invalid measure direction: ${direction}`);
  if (![before, after].every(Number.isFinite)) return 'unknown';
  if (after === before) return 'unchanged';
  if (direction === 'neutral') return 'neutral';
  const favorable = direction === 'higher_is_better' ? after > before : after < before;
  return favorable ? 'favorable' : 'unfavorable';
}

export function dynamicValueDomain(values, options = {}) {
  const finite = values.flat(Infinity).filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  const zeroBaseline = options.zeroBaseline === true;
  if (zeroBaseline) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const fallback = Math.abs(min) || 1;
    min -= fallback * 0.1;
    max += fallback * 0.1;
  } else {
    const padding = (max - min) * (Number.isFinite(options.paddingRatio) ? options.paddingRatio : 0.08);
    min -= padding;
    max += padding;
  }
  if (options.boundedPercent === true) {
    min = Math.max(0, min);
    max = Math.min(100, max);
  }
  return { min: Number(min.toPrecision(12)), max: Number(max.toPrecision(12)) };
}

export function ellipsizeLabel(value, maxCharacters = 18) {
  const text = String(value ?? '');
  const characters = Array.from(text);
  if (characters.length <= maxCharacters) return text;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
}

export function categoryLayout(labels, width = 720) {
  const lengths = labels.map((label) => Array.from(String(label ?? '')).length);
  const maxLength = lengths.length ? Math.max(...lengths) : 0;
  const highCardinality = labels.length > 16;
  const longLabels = maxLength > 14;
  return {
    orientation: highCardinality || longLabels ? 'horizontal' : 'vertical',
    visibleLimit: highCardinality ? Math.max(8, Math.floor(width / 56)) : labels.length,
    maxLabelCharacters: Math.max(8, Math.min(24, Math.floor(width / 38))),
    rotate: !highCardinality && longLabels ? 24 : 0,
  };
}

export function buildSlopeOption(items, options = {}) {
  const periodLabels = options.periodLabels;
  if (!Array.isArray(periodLabels) || periodLabels.length !== 2 || periodLabels.some((label) => !String(label).trim())) {
    throw new Error('slope chart requires two explicit periodLabels; do not hard-code 去年/今年');
  }
  const direction = options.direction || 'neutral';
  if (!DIRECTIONS.has(direction)) throw new Error(`invalid measure direction: ${direction}`);
  const palette = {
    favorable: options.favorableColor || '#0F766E',
    unfavorable: options.unfavorableColor || '#B42318',
    neutral: options.neutralColor || '#475569',
    unchanged: options.unchangedColor || '#64748B',
    unknown: options.unknownColor || '#94A3B8',
  };
  const values = [];
  const series = items.map((item) => {
    const before = Number(item.before);
    const after = Number(item.after);
    if (Number.isFinite(before)) values.push(before);
    if (Number.isFinite(after)) values.push(after);
    const state = semanticDeltaState(before, after, direction);
    return {
      name: String(item.name),
      type: 'line',
      data: [Number.isFinite(before) ? before : null, Number.isFinite(after) ? after : null],
      symbol: 'circle',
      symbolSize: 8,
      lineStyle: { width: 2, color: palette[state] },
      itemStyle: { color: palette[state] },
      emphasis: { lineStyle: { width: 3 } },
      encode: { semanticState: state },
    };
  });
  const domain = dynamicValueDomain(values, {
    zeroBaseline: options.zeroBaseline === true,
    boundedPercent: options.boundedPercent === true,
    paddingRatio: options.paddingRatio,
  });
  return {
    tooltip: { trigger: 'item' },
    grid: { top: 24, left: options.left ?? 88, right: options.right ?? 88, bottom: 28, containLabel: true },
    xAxis: {
      type: 'category', data: periodLabels.map(String), boundaryGap: false,
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value', min: domain.min, max: domain.max,
      name: options.unit || '',
      axisLabel: { formatter: options.axisFormatter || undefined },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series,
  };
}
