#!/usr/bin/env node
/**
 * verify-numbers.mjs — 数字一致性与覆盖率 Gate
 *
 * 用法:
 *   node scripts/verify-numbers.mjs <report.html> <metrics.json>
 *     [--allow-unbound] [--binding-only]
 *
 * 约定:
 * - 业务数字所在元素或祖先必须有 data-metric="a.b.0.c"；
 * - 章节编号、日期、版本号等非业务数字须显式加 data-number-exempt="原因"；
 * - 默认要求可见数字文本节点 100% 已绑定或已豁免；
 * - --binding-only 保留旧流程：只校验已有 data-metric，覆盖不足仅告警；
 * - --allow-unbound 仅适用于明确没有 metrics 的产物，跳过数字 Gate。
 */
import { readFileSync } from 'fs';

const argv = process.argv.slice(2);
const allowUnbound = argv.includes('--allow-unbound');
const bindingOnly = argv.includes('--binding-only');
const knownFlags = new Set(['--allow-unbound', '--binding-only']);
const unknownFlags = argv.filter(a => a.startsWith('--') && !knownFlags.has(a));
if (unknownFlags.length) {
  console.error('未知参数: ' + unknownFlags.join(', '));
  process.exit(2);
}
const [htmlPath, metricsPath] = argv.filter(a => !a.startsWith('--'));
if (!htmlPath || !metricsPath) {
  console.error('用法: node verify-numbers.mjs <report.html> <metrics.json> [--allow-unbound] [--binding-only]');
  process.exit(2);
}

let html;
let metrics;
try {
  html = readFileSync(htmlPath, 'utf-8');
  metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
} catch (error) {
  console.error('无法读取 HTML 或 metrics.json: ' + error.message);
  process.exit(2);
}

function parseAttributes(source) {
  const attrs = new Map();
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function decodeEntities(value) {
  const named = { nbsp: ' ', minus: '−', ndash: '–', mdash: '—', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#([0-9]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all);
}

function lookup(obj, path) {
  return path.split('.').reduce((o, key) => {
    if (o == null) return undefined;
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
    const ownKey = Array.isArray(o) && /^\d+$/.test(key) ? Number(key) : key;
    return Object.prototype.hasOwnProperty.call(o, ownKey) ? o[ownKey] : undefined;
  }, obj);
}

function parseDisplay(raw) {
  const text = decodeEntities(raw)
    .replace(/\s+/g, '')
    .replace(/[▲△↑]/g, '+')
    .replace(/[▼▽↓]/g, '-')
    .replace(/−/g, '-');
  const matches = [...text.matchAll(/([+-]?)([\d,]+(?:\.\d+)?)(亿|万|%|pp)?/gi)];
  const match = matches[0];
  if (!match) return null;
  let value = parseFloat(match[2].replace(/,/g, ''));
  if (match[1] === '-') value = -value;
  return { value, unit: (match[3] || '').toLowerCase(), decimals: (match[2].split('.')[1] || '').length, count: matches.length };
}

function isHidden(stack) {
  return stack.some(node => {
    if (['head', 'script', 'style', 'template', 'noscript', 'svg'].includes(node.tag)) return true;
    if (node.attrs.has('hidden') || node.cssHidden) return true;
    // aria-hidden 只隐藏无障碍树，视觉上仍可见，不能用于跳过数字 Gate。
    return /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(node.attrs.get('style') || '');
  });
}

function topLevelCssRules(cssInput) {
  const css = cssInput.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@charset\s+[^;]+;/gi, '');
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open === -1) break;
    const prelude = css.slice(cursor, open).trim();
    let depth = 1;
    let close = open + 1;
    while (close < css.length && depth > 0) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}') depth--;
      close++;
    }
    if (depth !== 0) break;
    if (prelude && !prelude.startsWith('@')) rules.push({ selectors: prelude, body: css.slice(open + 1, close - 1) });
    cursor = close;
  }
  return rules;
}

function elementMatchesSimpleSelector(tag, attrs, selector) {
  const source = selector.trim();
  if (!source || /[>+~\s]/.test(source) || /:/.test(source)) return false;
  const tagMatch = source.match(/^[a-z][\w-]*/i);
  if (tagMatch && tagMatch[0].toLowerCase() !== tag) return false;
  const id = attrs.get('id') || '';
  const classes = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
  for (const match of source.matchAll(/#([\w-]+)/g)) if (id !== match[1]) return false;
  for (const match of source.matchAll(/\.([\w-]+)/g)) if (!classes.has(match[1])) return false;
  for (const match of source.matchAll(/\[([^\]=\s]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)) {
    const actual = attrs.get(match[1].toLowerCase());
    if (actual == null || (match[2] != null && actual !== match[2])) return false;
  }
  return Boolean(tagMatch || /[#.\[]/.test(source) || source === '*');
}

const hiddenCssSelectors = (html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [])
  .flatMap(block => topLevelCssRules(block.replace(/^<style\b[^>]*>/i, '').replace(/<\/style>\s*$/i, '')))
  .filter(rule => /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/i.test(rule.body))
  .flatMap(rule => rule.selectors.split(',').map(selector => selector.trim()).filter(Boolean));

// 离线产物可含数十 MB 内联字体/脚本；每个节点从头扫描行号会退化为 O(n²)。
const lineStarts = [0];
for (let index = 0; index < html.length; index++) if (html.charCodeAt(index) === 10) lineStarts.push(index + 1);
function lineAt(offset) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

const bindings = [];
const numericNodes = [];
const exemptionIssues = [];
const stack = [];
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const bannedExemptionTags = new Set([
  'html', 'body', 'main', 'section', 'article', 'aside', 'nav', 'header', 'footer',
  'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol',
]);
const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
let token;

function finalizeNode(node) {
  if (node.attrs.has('data-number-exempt')) {
    const reason = node.attrs.get('data-number-exempt').trim();
    if (!reason) exemptionIssues.push('第 ' + node.line + ' 行: data-number-exempt 理由不能为空');
    if (bannedExemptionTags.has(node.tag)) {
      exemptionIssues.push('第 ' + node.line + ' 行: <' + node.tag + '> 是大容器，禁止使用 data-number-exempt；请缩小到单个数字叶子元素');
    }
    if (node.attrs.has('data-metric')) {
      exemptionIssues.push('第 ' + node.line + ' 行: 同一元素不得同时声明 data-metric 与 data-number-exempt');
    }
    const text = node.text.join(' ');
    const numericClusters = text.match(/[+-]?\d[\d,.]*(?:[-~\/]\d[\d,.]*)*(?:%|pp|万|亿|户)?/gi) || [];
    if (numericClusters.length > 1) {
      exemptionIssues.push('第 ' + node.line + ' 行: 单个豁免元素包含 ' + numericClusters.length + ' 个独立数字（' +
        numericClusters.slice(0, 5).join('、') + '）；请拆成逐数字叶子豁免');
    }
  }
  if (!node.attrs.has('data-metric')) return;
  const path = node.attrs.get('data-metric').trim();
  const to = node.attrs.get('data-to');
  const suffix = node.attrs.get('data-suffix') || '';
  const text = to != null ? to + suffix : node.text.join(' ');
  bindings.push({ path, text, line: node.line });
}

while ((token = tokenRe.exec(html)) !== null) {
  const raw = token[0];
  if (raw.startsWith('<!--') || raw.startsWith('<!')) continue;
  if (raw.startsWith('</')) {
    const close = (raw.match(/^<\/\s*([\w:-]+)/) || [])[1]?.toLowerCase();
    if (!close) continue;
    let index = stack.length - 1;
    while (index >= 0 && stack[index].tag !== close) index--;
    if (index >= 0) {
      const removed = stack.splice(index);
      for (const node of removed.reverse()) finalizeNode(node);
    }
    continue;
  }
  if (raw.startsWith('<')) {
    const open = raw.match(/^<\s*([\w:-]+)([\s\S]*?)\/?\s*>$/);
    if (!open) continue;
    const tag = open[1].toLowerCase();
    const attrs = parseAttributes(open[2]);
    const node = {
      tag,
      attrs,
      text: [],
      line: lineAt(token.index),
      cssHidden: hiddenCssSelectors.some(selector => elementMatchesSimpleSelector(tag, attrs, selector)),
    };
    if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
    else finalizeNode(node);
    continue;
  }

  if (isHidden(stack)) continue;
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  if (!text) continue;
  for (const node of stack) if (node.attrs.has('data-metric') || node.attrs.has('data-number-exempt')) node.text.push(text);
  if (!/[0-9０-９]/.test(text)) continue;
  const metricNode = [...stack].reverse().find(node => node.attrs.has('data-metric'));
  const exemptNode = [...stack].reverse().find(node => node.attrs.has('data-number-exempt'));
  numericNodes.push({
    text,
    line: lineAt(token.index),
    covered: Boolean(metricNode),
    exempt: Boolean(exemptNode),
    metric: metricNode?.attrs.get('data-metric') || null,
    exemption: exemptNode?.attrs.get('data-number-exempt') || null,
  });
}
while (stack.length) finalizeNode(stack.pop());

const mismatches = [];
for (const binding of bindings) {
  if (!binding.path) {
    mismatches.push('第 ' + binding.line + ' 行: data-metric 为空');
    continue;
  }
  const display = parseDisplay(binding.text);
  if (!display) {
    mismatches.push(binding.path + ': 显示文本无法解析数字（第 ' + binding.line + ' 行，"' + binding.text.slice(0, 40) + '"）');
    continue;
  }
  if (display.count !== 1) {
    mismatches.push(binding.path + ': 一个 data-metric 元素内发现 ' + display.count + ' 个数字；每个业务数字必须使用独立叶子元素绑定');
    continue;
  }
  const raw = lookup(metrics, binding.path);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    mismatches.push(binding.path + ': metrics.json 无此有限数值（得到 ' + JSON.stringify(raw) + '）');
    continue;
  }
  let expected = raw;
  const leaf = binding.path.split('.').pop();
  if (display.unit === '亿' && /_wan$/.test(leaf)) expected = raw / 1e4;
  const tolerance = Math.pow(10, -display.decimals) / 2 + 1e-9;
  if (Math.abs(display.value - expected) > tolerance) {
    mismatches.push(binding.path + ': 显示 ' + display.value + display.unit + ' ≠ 期望 ' + expected +
      '（容差 ±' + tolerance.toFixed(display.decimals + 1) + '）');
  }
}

if (exemptionIssues.length) {
  console.error('✗ data-number-exempt 使用不合规: ' + exemptionIssues.length + ' 项');
  exemptionIssues.slice(0, 30).forEach(item => console.error('   - ' + item));
  if (exemptionIssues.length > 30) console.error('   - 其余 ' + (exemptionIssues.length - 30) + ' 项已省略');
  process.exit(1);
}

if (bindings.length === 0 && !allowUnbound) {
  console.error('✗ 未发现任何 data-metric 绑定，数字一致性 Gate 无法起效。');
  console.error('  为业务数字添加 data-metric；非业务数字添加 data-number-exempt。确需跳过请显式 --allow-unbound。');
  process.exit(1);
}
if (mismatches.length) {
  console.error('✗ 数字一致性失败: ' + mismatches.length + '/' + bindings.length + ' 处绑定不正确');
  mismatches.slice(0, 30).forEach(item => console.error('   - ' + item));
  if (mismatches.length > 30) console.error('   - 其余 ' + (mismatches.length - 30) + ' 项已省略');
  process.exit(1);
}

const covered = numericNodes.filter(node => node.covered).length;
const exempt = numericNodes.filter(node => !node.covered && node.exempt).length;
const unbound = numericNodes.filter(node => !node.covered && !node.exempt);
const coverage = numericNodes.length === 0 ? 100 : ((covered + exempt) / numericNodes.length * 100);

console.log('数字绑定: ' + bindings.length + ' 处全部匹配');
console.log('可见数字覆盖: ' + (covered + exempt) + '/' + numericNodes.length + ' 文本节点（绑定 ' + covered +
  '，显式豁免 ' + exempt + '，覆盖率 ' + coverage.toFixed(1) + '%）');
console.log('静态边界: DOM 文本 Gate 不覆盖 JavaScript 运行时注入或 Canvas/SVG 图表内部数字；这两类必须另做渲染后 DOM/图表 option Gate。');

if (allowUnbound) {
  console.log('△ 已按 --allow-unbound 显式跳过未绑定数字 Gate；不得把此结果表述为数字已验证。');
  process.exit(0);
}
if (unbound.length) {
  console.error('✗ 发现 ' + unbound.length + ' 个未绑定且未豁免的可见数字文本节点：');
  unbound.slice(0, 20).forEach(node => console.error('   - 第 ' + node.line + ' 行: "' + node.text.slice(0, 80) + '"'));
  if (unbound.length > 20) console.error('   - 其余 ' + (unbound.length - 20) + ' 项已省略');
  console.error('  业务数字请加 data-metric；章节编号、日期、版本等请加 data-number-exempt="原因"。');
  if (bindingOnly) {
    console.error('△ --binding-only 已启用：保留旧流程，仅告警覆盖缺口。');
    process.exit(0);
  }
  process.exit(1);
}

console.log('✓ 数字一致性与可见数字覆盖率均通过');
