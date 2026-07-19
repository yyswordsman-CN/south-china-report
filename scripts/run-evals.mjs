#!/usr/bin/env node
/**
 * 对一份已生成报告执行 eval 机器断言。
 *
 * 报告须嵌入可审计元数据：
 * <script type="application/json" id="south-china-report-meta">
 * {
 *   "requested_period": "2025-12",
 *   "source": {"path": "evals/fixtures/sales-2024-2025.csv", "sha256": "..."},
 *   "report_mode": "compact-monthly",
 *   "key_metrics": {"period.total_cur_wan": 172.0}
 * }
 * </script>
 *
 * 用法: node scripts/run-evals.mjs <report.html> --eval <id> [--metrics metrics.json]
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EVALS = join(ROOT, 'evals', 'evals.json');
const VALIDATOR = join(__dirname, 'validate-report.mjs');
const VERIFY = join(__dirname, 'verify-numbers.mjs');

const args = process.argv.slice(2);
let report = null;
let evalId = null;
let metricsPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--eval') evalId = Number.parseInt(args[++i], 10);
  else if (args[i] === '--metrics') metricsPath = args[++i];
  else if (args[i].startsWith('--')) {
    console.error('未知参数: ' + args[i]);
    process.exit(2);
  } else if (!report) report = args[i];
  else {
    console.error('多余位置参数: ' + args[i]);
    process.exit(2);
  }
}
if (!report || evalId == null || Number.isNaN(evalId)) {
  console.error('用法: node scripts/run-evals.mjs <report.html> --eval <id> [--metrics metrics.json]');
  process.exit(2);
}

let suite;
let html;
let metrics = null;
let metricsSha256 = null;
try {
  suite = JSON.parse(readFileSync(EVALS, 'utf8'));
  html = readFileSync(report, 'utf8');
  if (metricsPath) {
    const raw = readFileSync(metricsPath);
    metricsSha256 = createHash('sha256').update(raw).digest('hex');
    metrics = JSON.parse(raw.toString('utf8'));
  }
} catch (error) {
  console.error('无法读取 eval、报告或 metrics: ' + error.message);
  process.exit(2);
}

const ev = suite.evals.find(item => item.id === evalId);
if (!ev) {
  console.error('未找到 eval id=' + evalId + '（可用: ' + suite.evals.map(item => item.id).join(', ') + '）');
  process.exit(2);
}
if (!Array.isArray(ev.machine_checks)) {
  console.error('eval ' + evalId + ' 无 machine_checks');
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

function stripComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function renderedHtml() {
  return stripComments(html)
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '');
}

function renderedText() {
  return renderedHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function domElements() {
  const source = renderedHtml();
  const elements = [];
  const re = /<([a-z][\w:-]*)([^>]*)>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    elements.push({ tag: match[1].toLowerCase(), attrs: parseAttributes(match[2]) });
  }
  return elements;
}

const elements = domElements();
function hasClass(element, className) {
  return (element.attrs.get('class') || '').split(/\s+/).includes(className);
}
function countClass(className) {
  return elements.filter(element => hasClass(element, className)).length;
}
function hasElement(tag, className) {
  return elements.some(element => (!tag || element.tag === tag) && (!className || hasClass(element, className)));
}

function lookup(object, path) {
  return path.split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (['__proto__', 'prototype', 'constructor'].includes(key)) return undefined;
    const ownKey = Array.isArray(value) && /^\d+$/.test(key) ? Number(key) : key;
    return Object.prototype.hasOwnProperty.call(value, ownKey) ? value[ownKey] : undefined;
  }, object);
}

function extractReportMeta() {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (const script of scripts) {
    const open = script.match(/^<script\b([^>]*)>/i);
    if (!open) continue;
    const attrs = parseAttributes(open[1]);
    if (attrs.get('id') !== 'south-china-report-meta') continue;
    if ((attrs.get('type') || '').toLowerCase() !== 'application/json') {
      return { error: '#south-china-report-meta 必须声明 type="application/json"' };
    }
    const body = script.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>\s*$/i, '').trim();
    try { return { value: JSON.parse(body) }; }
    catch (error) { return { error: '报告 meta JSON 无法解析: ' + error.message }; }
  }
  return { error: '缺少 <script type="application/json" id="south-china-report-meta"> 报告契约' };
}

const reportMeta = extractReportMeta();

function hashFile(relativeOrAbsolute) {
  const file = resolve(ROOT, relativeOrAbsolute);
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function numericEqual(actual, expected, tolerance = 1e-9) {
  return typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function collectVisibleMetricDisplays() {
  const values = new Map();
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const hiddenTags = new Set(['head', 'script', 'style', 'template', 'noscript', 'svg']);
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g;
  let token;
  const finalize = node => {
    const path = node.attrs.get('data-metric');
    if (!path || node.hidden) return;
    const raw = node.attrs.has('data-to')
      ? node.attrs.get('data-to') + (node.attrs.get('data-suffix') || '')
      : node.text.join(' ');
    const normalized = raw.replace(/\s+/g, '').replace(/[▲△↑]/g, '+').replace(/[▼▽↓−]/g, '-');
    const number = normalized.match(/([+-]?)([\d,]+(?:\.\d+)?)(亿|万|%|pp)?/i);
    if (!number) return;
    let value = Number.parseFloat(number[2].replace(/,/g, ''));
    if (number[1] === '-') value = -value;
    if (number[3] === '亿' && /_wan$/.test(path.split('.').pop())) value *= 1e4;
    if (!values.has(path)) values.set(path, []);
    values.get(path).push(value);
  };
  while ((token = tokenRe.exec(html)) !== null) {
    const raw = token[0];
    if (raw.startsWith('<!--') || raw.startsWith('<!')) continue;
    if (raw.startsWith('</')) {
      const close = (raw.match(/^<\/\s*([\w:-]+)/) || [])[1]?.toLowerCase();
      let index = stack.length - 1;
      while (index >= 0 && stack[index].tag !== close) index--;
      if (index >= 0) {
        const removed = stack.splice(index);
        for (const node of removed.reverse()) finalize(node);
      }
      continue;
    }
    if (raw.startsWith('<')) {
      const open = raw.match(/^<\s*([\w:-]+)([\s\S]*?)\/?\s*>$/);
      if (!open) continue;
      const tag = open[1].toLowerCase();
      const attrs = parseAttributes(open[2]);
      const parentHidden = stack.some(node => node.hidden);
      // aria-hidden 只影响无障碍树，不代表视觉上不可见，不得用它掩盖页面错值。
      const selfHidden = hiddenTags.has(tag) || attrs.has('hidden') ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.get('style') || '');
      const node = { tag, attrs, text: [], hidden: parentHidden || selfHidden };
      if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
      else finalize(node);
      continue;
    }
    const text = raw.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const node of stack) if (node.attrs.has('data-metric')) node.text.push(text);
  }
  while (stack.length) finalize(stack.pop());
  return values;
}

const visibleMetricDisplays = collectVisibleMetricDisplays();
function displayedMetricValues(path) {
  return visibleMetricDisplays.get(path) || [];
}

function runContractCheck(check) {
  if (reportMeta.error) return { ok: false, got: reportMeta.error };
  const meta = reportMeta.value;
  const failures = [];
  if (meta.requested_period !== check.requested_period) {
    failures.push('requested_period=' + JSON.stringify(meta.requested_period) + '，需 ' + JSON.stringify(check.requested_period));
  }
  if (meta.report_mode !== check.report_mode) {
    failures.push('report_mode=' + JSON.stringify(meta.report_mode) + '，需 ' + JSON.stringify(check.report_mode));
  }
  let expectedSourceHash;
  try { expectedSourceHash = hashFile(check.source_file); }
  catch (error) { return { ok: false, got: '无法计算源文件指纹: ' + error.message }; }
  const actualSourceHash = meta.source?.sha256 ?? meta.source_sha256;
  if (actualSourceHash !== expectedSourceHash) {
    failures.push('source.sha256=' + JSON.stringify(actualSourceHash) + '，实际 fixture 为 ' + expectedSourceHash);
  }
  if (check.source_file && meta.source?.path !== check.source_file) {
    failures.push('source.path=' + JSON.stringify(meta.source?.path) + '，需 ' + JSON.stringify(check.source_file));
  }
  for (const expectedMetric of check.key_metrics || []) {
    const actual = meta.key_metrics?.[expectedMetric.path];
    const tolerance = expectedMetric.tolerance ?? 1e-9;
    if (!numericEqual(actual, expectedMetric.expect, tolerance)) {
      failures.push('meta.key_metrics[' + expectedMetric.path + ']=' + JSON.stringify(actual) +
        '，需 ' + expectedMetric.expect + '±' + tolerance);
    }
    const displays = displayedMetricValues(expectedMetric.path);
    if (displays.length === 0) {
      failures.push('报告 DOM 未显示关键指标 data-metric="' + expectedMetric.path + '"');
    } else if (!displays.every(value => numericEqual(value, expectedMetric.expect, tolerance))) {
      failures.push('报告 DOM 中 ' + expectedMetric.path + '=' + JSON.stringify(displays) +
        '，存在值不匹配 ' + expectedMetric.expect + '±' + tolerance);
    }
    if (metrics) {
      const metricValue = lookup(metrics, expectedMetric.path);
      if (!numericEqual(metricValue, expectedMetric.expect, tolerance)) {
        failures.push('metrics[' + expectedMetric.path + ']=' + JSON.stringify(metricValue) +
          '，需 ' + expectedMetric.expect + '±' + tolerance);
      }
      if (!numericEqual(actual, metricValue, tolerance)) {
        failures.push('报告 meta 与 metrics.json 的 ' + expectedMetric.path + ' 不一致');
      }
    }
  }
  if (metrics && meta.metrics_sha256 && meta.metrics_sha256 !== metricsSha256) {
    failures.push('metrics_sha256 与 --metrics 文件不一致');
  }
  return failures.length
    ? { ok: false, got: failures.join('；') }
    : { ok: true, got: '期间、源文件 SHA-256、模式及 ' + (check.key_metrics || []).length + ' 个关键指标均匹配' };
}

function runCheck(check) {
  switch (check.type) {
    case 'validator_exit0':
      try {
        execFileSync('node', [VALIDATOR, report], { stdio: 'pipe' });
        return { ok: true, got: 'exit 0（无 P0）' };
      } catch (error) {
        return { ok: false, got: 'exit ' + (error.status ?? '?') + '（有 P0，运行 validate-report.mjs 查看详情）' };
      }
    case 'report_contract':
      return runContractCheck(check);
    case 'dom_class_count_min': {
      const count = countClass(check.class);
      return { ok: count >= check.min, got: 'DOM class .' + check.class + ' 为 ' + count + '（需 ≥' + check.min + '）' };
    }
    case 'dom_class_count_max': {
      const count = countClass(check.class);
      return { ok: count <= check.max, got: 'DOM class .' + check.class + ' 为 ' + count + '（需 ≤' + check.max + '）' };
    }
    case 'dom_class_pattern_count_max': {
      const pattern = new RegExp(check.pattern);
      const count = elements.filter(element => (element.attrs.get('class') || '').split(/\s+/).some(name => pattern.test(name))).length;
      return { ok: count <= check.max, got: 'DOM class pattern /' + check.pattern + '/ 为 ' + count + '（需 ≤' + check.max + '）' };
    }
    case 'dom_element_exists': {
      const ok = hasElement(check.tag || null, check.class || null);
      return { ok, got: ok ? 'DOM 元素存在' : 'DOM 元素不存在' };
    }
    case 'text_absent': {
      const pattern = new RegExp(check.pattern, check.flags || '');
      const matches = renderedText().match(pattern) || [];
      return { ok: matches.length === 0, got: '可见正文命中 ' + matches.length + ' 次（需 0）' };
    }
    case 'style_pattern': {
      const style = stripComments((html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || []).join('\n'));
      const matches = style.match(new RegExp(check.pattern, check.flags || 'g')) || [];
      return { ok: matches.length >= (check.min ?? 1), got: '真实 <style> 规则命中 ' + matches.length + ' 次' };
    }
    case 'script_pattern': {
      const scripts = stripComments((html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [])
        .filter(script => !/id\s*=\s*["']south-china-report-meta["']/i.test(script)).join('\n'));
      const matches = scripts.match(new RegExp(check.pattern, check.flags || 'g')) || [];
      return { ok: matches.length >= (check.min ?? 1), got: '真实 <script> 命中 ' + matches.length + ' 次' };
    }
    case 'density': {
      const tag = (html.match(/<html[^>]*>/i) || [''])[0];
      const actual = /data-density\s*=\s*["']compact["']/i.test(tag) ? 'compact' : 'standard';
      return { ok: actual === check.expect, got: '<html> 判定为 ' + actual + '（需 ' + check.expect + '）' };
    }
    case 'data_metric_or_verify':
      if (metricsPath) {
        try {
          execFileSync('node', [VERIFY, report, metricsPath], { stdio: 'pipe' });
          return { ok: true, got: 'verify-numbers 严格模式 exit 0' };
        } catch (error) {
          return { ok: false, got: 'verify-numbers exit ' + (error.status ?? '?') + '（错配或覆盖不足）' };
        }
      }
      return {
        ok: elements.filter(element => element.attrs.has('data-metric')).length >= check.min,
        got: '未给 --metrics，仅确认 DOM 中 data-metric 元素数量；关键指标仍由 report_contract 对 fixture 真值校验',
      };
    case 'manual':
      return { manual: true, got: '需人工判定' };
    default:
      return { ok: false, got: '未知 check 类型: ' + check.type };
  }
}

console.log('\n  Eval #' + ev.id + ' "' + ev.name + '"  —  报告: ' + report + '\n');
let pass = 0;
let fail = 0;
let manual = 0;
for (const check of ev.machine_checks) {
  const result = runCheck(check);
  let tag;
  if (result.manual) { tag = 'MANUAL'; manual++; }
  else if (result.ok) { tag = ' PASS '; pass++; }
  else { tag = ' FAIL '; fail++; }
  console.log('  [' + tag + '] ' + String(check.id).padEnd(19) + check.desc + '  →  ' + result.got);
}
console.log('\n  PASS: ' + pass + '  |  FAIL: ' + fail + '  |  MANUAL: ' + manual +
  (manual ? '（须人工复核）' : '') + '\n');
process.exit(fail > 0 ? 1 : 0);
