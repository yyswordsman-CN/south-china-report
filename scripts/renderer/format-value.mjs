import { blocked } from './errors.mjs';
import { resolvePath } from './resolve-path.mjs';
import { assertSemantic } from './validate-spec.mjs';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function safeJsonForScript(value, spacing = 0) {
  return JSON.stringify(value, null, spacing)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function groupedFixed(value, precision) {
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = normalized < 0 ? '-' : '';
  const [integer, decimal] = Math.abs(normalized).toFixed(precision).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (decimal == null ? '' : `.${decimal}`);
}

function inferredFormat(path, semantic) {
  const leaf = path.split('.').at(-1) || '';
  if (/contribution_pp$|share_shift_pp$|_pp$/.test(leaf)) return 'percentage_point';
  if (/change_pct$|share$|yoy$|_pct$/.test(leaf)) return 'percent';
  if (semantic.unit === 'percent' || semantic.unit === 'percentage') return 'percent';
  if (['count', 'person', 'people', 'ticket', 'unit'].includes(semantic.unit)) return 'integer';
  return 'decimal';
}

function assertFormatCompatible(path, format, semantic) {
  const leaf = path.split('.').at(-1) || '';
  const percentLike = semantic.unit === 'percent' || semantic.unit === 'percentage' ||
    /change_pct$|share$|yoy$|_pct$|rate$/.test(leaf);
  const ppLike = /contribution_pp$|share_shift_pp$|_pp$/.test(leaf) ||
    (semantic.unit === 'percent' && leaf === 'change_abs');
  if (['percent', 'signed_percent'].includes(format) && !percentLike) {
    blocked('format_semantic_mismatch', `${path} 不是百分比语义，不能使用 ${format}`);
  }
  if (format === 'percentage_point' && !ppLike) {
    blocked('format_semantic_mismatch', `${path} 不是百分点语义，不能使用 percentage_point`);
  }
}

export function formatMetric(metrics, ref) {
  const value = resolvePath(metrics, ref.path, { label: `metric ${ref.path}` });
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    blocked('non_numeric_metric', `${ref.path} 必须解析为有限数值，得到 ${JSON.stringify(value)}`);
  }
  const semantic = assertSemantic(metrics, ref.path, ref);
  const format = !ref.format || ref.format === 'auto' ? inferredFormat(ref.path, semantic) : ref.format;
  assertFormatCompatible(ref.path, format, semantic);
  const defaultPrecision = format === 'integer' ? 0 : (Number.isInteger(value) && format === 'decimal' ? 0 : 1);
  const precision = ref.precision ?? defaultPrecision;
  let text = groupedFixed(value, precision);
  if (['signed_number', 'signed_percent'].includes(format) && value > 0) text = `+${text}`;
  if (['percent', 'signed_percent'].includes(format)) text += '%';
  if (format === 'percentage_point') text += 'pp';
  return { value, text, format, precision, semantic };
}

export function unitLabel(semantic) {
  const aliases = {
    currency: '元', CNY: '元', count: '项', person: '人', people: '人',
    ticket: '单', unit: '单位', minute: '分钟', point: '分', percent: '百分比',
  };
  return aliases[semantic?.unit] || semantic?.unit || '';
}

export function renderDimensionLabel(value) {
  const escaped = escapeHtml(value);
  if (/[0-9０-９]/.test(String(value))) {
    return `<span data-number-exempt="维度标签中的编号">${escaped}</span>`;
  }
  return escaped;
}
