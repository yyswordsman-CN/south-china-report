#!/usr/bin/env node
/**
 * verify-runtime.mjs — 渲染后 DOM / ECharts 数字真值 Gate
 *
 * 用法: node scripts/verify-runtime.mjs <report.offline.html> <metrics.json>
 *
 * 报告中如存在 ECharts，须提供：
 * <script type="application/json" id="south-china-report-runtime-contract">
 * {
 *   "version": 2,
 *   "charts": [{
 *     "id": "chart-trend",
 *     "series": [{ "index": 0, "metrics": ["trend.2026.0", "trend.2026.1"] }]
 *   }]
 * }
 * </script>
 *
 * series 仅可三选一：
 * - metrics: 与 getOption().series[index].data 等长的 metrics 路径；
 * - exempt: 透明基座等不表达业务值的系列，须写明具体原因。
 * - bindings + exemptions (V2): 用 JSON Pointer 覆盖坐标对、树与 custom
 *   series.data 中的每一个数值/null 叶子。
 * metrics 条目可写成 {path, transform:"abs|negate", factor, tolerance}。
 * V1 合同继续兼容，但结构化叶子绑定仅在 V2 可用。
 *
 * 退出码: 0=通过，1=真值/覆盖失败，2=参数或文件错误，
 *         3=Playwright/Chromium 不可用（运行时未验证）。
 */
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [,, reportArg, metricsArg, ...extra] = process.argv;
if (!reportArg || !metricsArg || extra.length > 0) {
  console.error('用法: node scripts/verify-runtime.mjs <report.offline.html> <metrics.json>');
  process.exit(2);
}

const reportPath = path.resolve(reportArg);
const metricsPath = path.resolve(metricsArg);
if (!existsSync(reportPath) || !existsSync(metricsPath)) {
  console.error(`文件不存在: ${!existsSync(reportPath) ? reportPath : metricsPath}`);
  process.exit(2);
}

let metrics;
try {
  metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
} catch (error) {
  console.error('metrics.json 无法解析:', error.message);
  process.exit(2);
}

function lookupOwn(root, metricPath) {
  let current = root;
  for (const rawKey of String(metricPath || '').split('.')) {
    if (!rawKey || ['__proto__', 'prototype', 'constructor'].includes(rawKey) || current == null) {
      return { exists: false, value: undefined };
    }
    const key = Array.isArray(current) && /^\d+$/.test(rawKey) ? Number(rawKey) : rawKey;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return { exists: false, value: undefined };
    current = current[key];
  }
  return { exists: true, value: current };
}

function parseDisplay(raw) {
  const text = String(raw || '')
    .replace(/\s+/g, '')
    .replace(/[▲△↑]/g, '+')
    .replace(/[▼▽↓]/g, '-')
    .replace(/−/g, '-');
  const matches = [...text.matchAll(/([+-]?)([\d,]+(?:\.\d+)?)(亿|万|%|pp)?/gi)];
  const match = matches[0];
  if (!match) return null;
  let value = Number(match[2].replace(/,/g, ''));
  if (match[1] === '-') value = -value;
  return {
    value,
    unit: (match[3] || '').toLowerCase(),
    decimals: (match[2].split('.')[1] || '').length,
    count: matches.length,
  };
}

function displayMatches(binding) {
  const resolved = lookupOwn(metrics, binding.path);
  if (!resolved.exists || typeof resolved.value !== 'number' || !Number.isFinite(resolved.value)) {
    return `${binding.path}: metrics.json 无此有限数值（得到 ${JSON.stringify(resolved.value)}）`;
  }
  const display = parseDisplay(binding.text);
  if (!display || display.count !== 1) {
    return `${binding.path}: 渲染后文本必须且只能包含一个数字（得到 ${JSON.stringify(binding.text.slice(0, 60))}）`;
  }
  let expected = resolved.value;
  if (display.unit === '亿' && /_wan$/.test(binding.path.split('.').pop())) expected /= 1e4;
  const tolerance = 10 ** (-display.decimals) / 2 + 1e-9;
  if (Math.abs(display.value - expected) > tolerance) {
    return `${binding.path}: 渲染后显示 ${display.value}${display.unit} ≠ ${expected}（容差 ±${tolerance}）`;
  }
  return null;
}

function normalizedMetricSpec(raw) {
  if (typeof raw === 'string') return { path: raw, transform: 'identity', factor: 1, tolerance: 1e-9 };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    path: raw.path,
    transform: raw.transform || 'identity',
    factor: raw.factor ?? 1,
    tolerance: raw.tolerance ?? 1e-9,
  };
}

function expectedChartValue(spec) {
  if (!spec || typeof spec.path !== 'string' || !spec.path.trim()) return { error: 'metrics 条目缺少 path' };
  if (!['identity', 'abs', 'negate'].includes(spec.transform)) return { error: `${spec.path}: 不支持 transform=${spec.transform}` };
  if (typeof spec.factor !== 'number' || !Number.isFinite(spec.factor)) return { error: `${spec.path}: factor 必须是有限数值` };
  if (typeof spec.tolerance !== 'number' || !Number.isFinite(spec.tolerance) || spec.tolerance < 0) {
    return { error: `${spec.path}: tolerance 必须是非负有限数值` };
  }
  const resolved = lookupOwn(metrics, spec.path);
  if (!resolved.exists) return { error: `${spec.path}: metrics.json 路径不存在` };
  if (resolved.value === null) return { value: null, tolerance: spec.tolerance };
  if (typeof resolved.value !== 'number' || !Number.isFinite(resolved.value)) {
    return { error: `${spec.path}: metrics 值必须是有限数值或 null` };
  }
  let value = resolved.value;
  if (spec.transform === 'abs') value = Math.abs(value);
  if (spec.transform === 'negate') value = -value;
  return { value: value * spec.factor, tolerance: spec.tolerance };
}

function scalarDataValue(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const { leaves, errors } = collectStructuredLeaves(raw);
    if (errors.length) return { error: errors[0] };
    if (leaves.size !== 1 || !leaves.has('/value')) {
      return { error: `metrics 简写只允许唯一标量 value；嵌套数值请使用 V2 bindings（发现 ${[...leaves.keys()].join(', ') || '无 value'}）` };
    }
    return { value: leaves.get('/value') };
  }
  const value = raw;
  if (value === null || value === '-' || typeof value === 'undefined') return { value: null };
  if (typeof value === 'number' && Number.isFinite(value)) return { value };
  return { error: `metrics 简写仅支持标量 series.data；坐标/树/custom 数据请使用 V2 bindings（得到 ${JSON.stringify(value)}）` };
}

const UNSAFE_POINTER_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_STRUCTURED_LEAVES = 100000;
const MAX_STRUCTURED_DEPTH = 64;

function encodePointerToken(token) {
  return String(token).replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerFromTokens(tokens) {
  return `/${tokens.map(encodePointerToken).join('/')}`;
}

function parseDataPointer(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/')) {
    return { error: `dataPointer 必须是指向 data 内叶子的 JSON Pointer（得到 ${JSON.stringify(raw)}）` };
  }
  const tokens = [];
  for (const encoded of raw.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(encoded)) return { error: `dataPointer 含非法 JSON Pointer 转义: ${raw}` };
    const token = encoded.replaceAll('~1', '/').replaceAll('~0', '~');
    if (UNSAFE_POINTER_KEYS.has(token)) return { error: `dataPointer 禁止原型链键: ${raw}` };
    tokens.push(token);
  }
  return { tokens, canonical: pointerFromTokens(tokens) };
}

function structuredLeafValue(raw) {
  if (raw === null || raw === '-') return { eligible: true, value: null };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { eligible: true, error: `series.data 含非有限数值 ${String(raw)}` };
    return { eligible: true, value: raw };
  }
  if (typeof raw === 'string') {
    const text = raw.trim().replace(/−/g, '-');
    const match = text.match(/^([+-]?)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:亿|万|%|pp)?$/i);
    if (match) {
      const value = Number(`${match[1]}${match[2].replaceAll(',', '')}`);
      if (Number.isFinite(value)) return { eligible: true, value };
    }
  }
  return { eligible: false };
}

function collectStructuredLeaves(root) {
  const leaves = new Map();
  const errors = [];
  const ancestors = new WeakSet();
  let stopped = false;

  const visit = (value, tokens, depth) => {
    if (stopped) return;
    if (depth > MAX_STRUCTURED_DEPTH) {
      errors.push(`series.data 嵌套超过 ${MAX_STRUCTURED_DEPTH} 层: ${pointerFromTokens(tokens)}`);
      stopped = true;
      return;
    }
    const leaf = structuredLeafValue(value);
    if (leaf.eligible) {
      const pointer = pointerFromTokens(tokens);
      if (leaf.error) errors.push(`${pointer}: ${leaf.error}`);
      else leaves.set(pointer, leaf.value);
      if (leaves.size > MAX_STRUCTURED_LEAVES) {
        errors.push(`series.data 数值叶子超过 ${MAX_STRUCTURED_LEAVES} 个，拒绝不受控合同`);
        stopped = true;
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (ancestors.has(value)) {
      errors.push(`series.data 含循环引用: ${pointerFromTokens(tokens)}`);
      stopped = true;
      return;
    }
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...tokens, String(index)], depth + 1));
    } else {
      for (const key of Object.keys(value).sort()) {
        if (UNSAFE_POINTER_KEYS.has(key)) {
          errors.push(`series.data 含禁止的原型链键: ${pointerFromTokens([...tokens, key])}`);
          continue;
        }
        visit(value[key], [...tokens, key], depth + 1);
      }
    }
    ancestors.delete(value);
  };

  visit(root, [], 0);
  return { leaves, errors };
}

function compareChartMetric(actualValue, rawMetricSpec, label) {
  const expected = expectedChartValue(normalizedMetricSpec(rawMetricSpec));
  if (expected.error) return { issue: `${label}: ${expected.error}`, matched: false };
  if (actualValue === null || expected.value === null) {
    if (actualValue !== expected.value) return { issue: `${label}: 图表=${actualValue} ≠ metrics=${expected.value}`, matched: false };
    return { issue: null, matched: true };
  }
  if (Math.abs(actualValue - expected.value) > expected.tolerance) {
    return { issue: `${label}: 图表=${actualValue} ≠ metrics=${expected.value}（容差 ±${expected.tolerance}）`, matched: false };
  }
  return { issue: null, matched: true };
}

async function attachNetworkGuard(page) {
  const blocked = [];
  const localProtocols = new Set(['file:', 'data:', 'about:', 'blob:']);
  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    let protocol;
    try { protocol = new URL(requestUrl).protocol; } catch { protocol = ''; }
    if (localProtocols.has(protocol)) await route.continue();
    else {
      blocked.push(requestUrl);
      await route.abort('blockedbyclient');
    }
  });
  await page.routeWebSocket('**/*', async (socket) => {
    blocked.push(socket.url());
    await socket.close({ code: 1008, reason: 'runtime truth gate' });
  });
  return blocked;
}

const PREP = () => new Promise((resolve) => {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('visible'));
  document.querySelectorAll('[data-to]').forEach((element) => {
    const raw = String(element.getAttribute('data-to') || '').replace(/,/g, '').trim();
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const decimalPart = raw.match(/\.(\d+)/)?.[1] || '';
    const decimals = Number(element.getAttribute('data-decimals') ?? decimalPart.length);
    const safeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 12 ? decimals : decimalPart.length;
    element.textContent = `${element.getAttribute('data-prefix') || ''}${value.toLocaleString('en-US', {
      minimumFractionDigits: safeDecimals,
      maximumFractionDigits: safeDecimals,
    })}${element.getAttribute('data-suffix') || ''}`;
  });
  window.dispatchEvent(new Event('resize'));
  setTimeout(resolve, document.querySelector('[data-to]') ? 2200 : 900);
});

function inspectRuntimePage() {
  const isVisible = (element) => {
    if (!element || element.closest('script, style, template, noscript, svg, canvas, [hidden], [inert]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
  };
  const bindings = Array.from(document.querySelectorAll('[data-metric]'))
    .filter(isVisible)
    .map((element) => ({ path: (element.getAttribute('data-metric') || '').trim(), text: element.textContent || '' }));

  const numericNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!parent || !/[0-9０-９]/.test(text) || !isVisible(parent)) continue;
    const metricOwner = parent.closest('[data-metric]');
    const exemptOwner = parent.closest('[data-number-exempt]');
    numericNodes.push({
      text,
      covered: Boolean(metricOwner),
      exempt: Boolean(exemptOwner),
      exemption: exemptOwner?.getAttribute('data-number-exempt') || '',
    });
  }

  // ECharts 容器名不是信任边界。遍历全部元素调用官方 getInstanceByDom，
  // 再与约定容器取并集，既发现任意命名的真实实例，也保留“容器存在但未渲染”诊断。
  const allElements = Array.from(document.querySelectorAll('*'));
  const instanceElements = typeof window.echarts?.getInstanceByDom === 'function'
    ? allElements.filter((element) => Boolean(window.echarts.getInstanceByDom(element)))
    : [];
  const declaredElements = Array.from(document.querySelectorAll('.chart-container, .tile-chart, [data-chart], [id^="chart-"]'));
  const charts = [...new Set([...instanceElements, ...declaredElements])]
    .map((element) => {
      const instance = window.echarts?.getInstanceByDom?.(element);
      if (!instance) return { id: element.id || '', missingInstance: true, option: null };
      return { id: element.id || '', missingInstance: false, option: instance.getOption?.() || null };
    })
    .filter((chart) => chart.missingInstance || chart.option);

  let contract = null;
  let contractError = null;
  const contractNode = document.getElementById('south-china-report-runtime-contract');
  if (contractNode) {
    try { contract = JSON.parse(contractNode.textContent || ''); }
    catch (error) { contractError = error.message; }
  }
  return { bindings, numericNodes, charts, contract, contractError };
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('[UNVERIFIED] 未安装 Playwright，未执行渲染后数字真值 Gate。');
  console.error('原因:', error.message);
  process.exit(3);
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error('[UNVERIFIED] Chromium 启动失败:', error.message);
  process.exit(3);
}

const issues = [];
let runtime;
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const blocked = await attachNetworkGuard(page);
  const pageErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(reportPath).href, { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(PREP);
  runtime = await page.evaluate(inspectRuntimePage);
  if (blocked.length) issues.push(`阻断到外部网络请求: ${blocked.join(', ')}`);
  if (pageErrors.length) issues.push(`页面运行错误: ${pageErrors.join(' | ')}`);
} catch (error) {
  issues.push(`浏览器运行失败: ${error.message}`);
} finally {
  await browser.close();
}

if (runtime) {
  const unbound = runtime.numericNodes.filter((node) => !node.covered && !node.exempt);
  const emptyExemptions = runtime.numericNodes.filter((node) => !node.covered && node.exempt && !node.exemption.trim());
  if (unbound.length) issues.push(`渲染后 DOM 有 ${unbound.length} 个数字文本未绑定/豁免: ${unbound.slice(0, 8).map((node) => JSON.stringify(node.text)).join(', ')}`);
  if (emptyExemptions.length) issues.push(`渲染后 DOM 有 ${emptyExemptions.length} 个空 data-number-exempt 理由`);
  for (const binding of runtime.bindings) {
    const mismatch = displayMatches(binding);
    if (mismatch) issues.push(mismatch);
  }

  if (runtime.contractError) issues.push(`运行时合同 JSON 无法解析: ${runtime.contractError}`);
  const chartCount = runtime.charts.length;
  const contract = runtime.contract;
  const contractVersion = contract?.version;
  const validContract = contract && [1, 2].includes(contractVersion) && Array.isArray(contract.charts);
  if (chartCount > 0 && !validContract) {
    issues.push('页面含 ECharts，但缺少有效 #south-china-report-runtime-contract（version=1|2）');
  }

  let checkedPoints = 0;
  let exemptSeries = 0;
  let exemptLeaves = 0;
  if (validContract) {
    const contractIds = new Set();
    for (const chartSpec of contract.charts) {
      if (!chartSpec || typeof chartSpec.id !== 'string' || !chartSpec.id.trim()) {
        issues.push('运行时合同 charts 条目缺少 id');
        continue;
      }
      if (contractIds.has(chartSpec.id)) issues.push(`运行时合同重复 chart id: ${chartSpec.id}`);
      contractIds.add(chartSpec.id);
      const chart = runtime.charts.find((item) => item.id === chartSpec.id);
      if (!chart) {
        issues.push(`运行时合同引用不存在或未渲染的图表: #${chartSpec.id}`);
        continue;
      }
      if (chart.missingInstance || !chart.option) {
        issues.push(`图表未取得 ECharts 实例/option: #${chartSpec.id}`);
        continue;
      }
      if (!Array.isArray(chartSpec.series)) {
        issues.push(`#${chartSpec.id}: 合同缺少 series 数组`);
        continue;
      }
      const declared = new Map();
      for (const seriesSpec of chartSpec.series) {
        if (!Number.isInteger(seriesSpec?.index) || seriesSpec.index < 0) {
          issues.push(`#${chartSpec.id}: series.index 必须是非负整数`);
          continue;
        }
        if (declared.has(seriesSpec.index)) issues.push(`#${chartSpec.id}: series ${seriesSpec.index} 重复声明`);
        declared.set(seriesSpec.index, seriesSpec);
      }
      const optionSeries = Array.isArray(chart.option.series) ? chart.option.series : [];
      optionSeries.forEach((series, index) => {
        if (series?.data != null && !Array.isArray(series.data)) {
          issues.push(`#${chartSpec.id} series[${index}].data 必须是数组`);
          return;
        }
        const data = Array.isArray(series?.data) ? series.data : [];
        if (data.length === 0) return;
        const seriesSpec = declared.get(index);
        if (!seriesSpec) {
          issues.push(`#${chartSpec.id} series[${index}] 有 ${data.length} 个数据项但未声明 metrics/exempt/bindings`);
          return;
        }
        const hasMetrics = Array.isArray(seriesSpec.metrics);
        const hasSeriesExempt = typeof seriesSpec.exempt === 'string';
        const structuredDeclared = Object.hasOwn(seriesSpec, 'bindings') || Object.hasOwn(seriesSpec, 'exemptions');
        const modeCount = Number(hasMetrics) + Number(hasSeriesExempt) + Number(structuredDeclared);
        const seriesLabel = `#${chartSpec.id} series[${index}]`;
        if (modeCount !== 1) {
          issues.push(`${seriesLabel} 必须且只能声明 metrics、exempt 或 V2 bindings/exemptions`);
          return;
        }
        if (hasSeriesExempt) {
          if (seriesSpec.exempt.trim().length < 4) issues.push(`${seriesLabel} exempt 理由过短`);
          else exemptSeries += 1;
          return;
        }

        if (hasMetrics) {
          if (seriesSpec.metrics.length !== data.length) {
            issues.push(`${seriesLabel} metrics 长度 ${seriesSpec.metrics.length} ≠ data 长度 ${data.length}`);
            return;
          }
          data.forEach((rawValue, dataIndex) => {
            const actual = scalarDataValue(rawValue);
            const label = `${seriesLabel}.data[${dataIndex}]`;
            if (actual.error) {
              issues.push(`${label}: ${actual.error}`);
              return;
            }
            const result = compareChartMetric(actual.value, seriesSpec.metrics[dataIndex], label);
            if (result.issue) issues.push(result.issue);
            if (result.matched) checkedPoints += 1;
          });
          return;
        }

        if (contractVersion !== 2) {
          issues.push(`${seriesLabel} 的结构化 bindings 仅支持合同 version=2`);
          return;
        }
        if (!Array.isArray(seriesSpec.bindings) || seriesSpec.bindings.length === 0) {
          issues.push(`${seriesLabel}.bindings 必须是非空数组`);
          return;
        }
        if (Object.hasOwn(seriesSpec, 'exemptions') && !Array.isArray(seriesSpec.exemptions)) {
          issues.push(`${seriesLabel}.exemptions 必须是数组`);
          return;
        }

        const { leaves, errors: leafErrors } = collectStructuredLeaves(data);
        leafErrors.forEach((error) => issues.push(`${seriesLabel}: ${error}`));
        const covered = new Set();

        for (const binding of seriesSpec.bindings) {
          if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
            issues.push(`${seriesLabel}.bindings 条目必须是对象`);
            continue;
          }
          const unknown = Object.keys(binding).filter((key) => !['dataPointer', 'metric'].includes(key));
          if (unknown.length) issues.push(`${seriesLabel}.bindings 含未知字段: ${unknown.join(', ')}`);
          const parsed = parseDataPointer(binding.dataPointer);
          if (parsed.error) {
            issues.push(`${seriesLabel}: ${parsed.error}`);
            continue;
          }
          if (covered.has(parsed.canonical)) {
            issues.push(`${seriesLabel} 重复绑定/豁免 dataPointer: ${parsed.canonical}`);
            continue;
          }
          if (!leaves.has(parsed.canonical)) {
            issues.push(`${seriesLabel} dataPointer 不存在或不是数值/null 叶子: ${parsed.canonical}`);
            continue;
          }
          if (!Object.hasOwn(binding, 'metric')) {
            issues.push(`${seriesLabel} ${parsed.canonical}: binding 缺少 metric`);
            continue;
          }
          covered.add(parsed.canonical);
          const result = compareChartMetric(leaves.get(parsed.canonical), binding.metric, `${seriesLabel}.data${parsed.canonical}`);
          if (result.issue) issues.push(result.issue);
          if (result.matched) checkedPoints += 1;
        }

        for (const exemption of seriesSpec.exemptions || []) {
          if (!exemption || typeof exemption !== 'object' || Array.isArray(exemption)) {
            issues.push(`${seriesLabel}.exemptions 条目必须是对象`);
            continue;
          }
          const unknown = Object.keys(exemption).filter((key) => !['dataPointer', 'dataPointers', 'reason'].includes(key));
          if (unknown.length) issues.push(`${seriesLabel}.exemptions 含未知字段: ${unknown.join(', ')}`);
          const hasPointer = typeof exemption.dataPointer === 'string';
          const hasPointers = Array.isArray(exemption.dataPointers);
          if (hasPointer === hasPointers || (hasPointers && exemption.dataPointers.length === 0)) {
            issues.push(`${seriesLabel}.exemptions 必须且只能声明 dataPointer 或非空 dataPointers`);
            continue;
          }
          if (typeof exemption.reason !== 'string' || exemption.reason.trim().length < 4) {
            issues.push(`${seriesLabel}: exemption 理由过短`);
            continue;
          }
          for (const rawPointer of hasPointer ? [exemption.dataPointer] : exemption.dataPointers) {
            const parsed = parseDataPointer(rawPointer);
            if (parsed.error) {
              issues.push(`${seriesLabel}: ${parsed.error}`);
              continue;
            }
            if (covered.has(parsed.canonical)) {
              issues.push(`${seriesLabel} 重复绑定/豁免 dataPointer: ${parsed.canonical}`);
              continue;
            }
            if (!leaves.has(parsed.canonical)) {
              issues.push(`${seriesLabel} 豁免指针不存在或不是数值/null 叶子: ${parsed.canonical}`);
              continue;
            }
            covered.add(parsed.canonical);
            exemptLeaves += 1;
          }
        }

        const unboundLeaves = [...leaves.keys()].filter((pointer) => !covered.has(pointer));
        if (unboundLeaves.length) {
          issues.push(`${seriesLabel} 有 ${unboundLeaves.length} 个数值/null 叶子未绑定或豁免: ${unboundLeaves.slice(0, 8).join(', ')}`);
        }
      });
      for (const index of declared.keys()) {
        if (!optionSeries[index] || !Array.isArray(optionSeries[index].data) || optionSeries[index].data.length === 0) {
          issues.push(`#${chartSpec.id}: 合同声明的 series[${index}] 不存在或无 data`);
        }
      }
    }
    runtime.charts.forEach((chart) => {
      if (!contractIds.has(chart.id)) issues.push(`图表 #${chart.id || '(无 id)'} 未进入运行时合同`);
    });
  }

  console.log(`运行时 DOM: ${runtime.bindings.length} 处 data-metric，${runtime.numericNodes.length} 个可见数字文本节点`);
  console.log(`ECharts 运行时: ${runtime.charts.length} 张图，${checkedPoints} 个业务数值叶子匹配，${exemptSeries} 个辅助系列、${exemptLeaves} 个结构叶子显式豁免`);
}

if (issues.length) {
  console.error(`✗ 渲染后数字真值 Gate 失败: ${issues.length} 项`);
  issues.slice(0, 40).forEach((issue) => console.error(`  - ${issue}`));
  if (issues.length > 40) console.error(`  - 其余 ${issues.length - 40} 项已省略`);
  process.exit(1);
}

console.log('✓ 渲染后 DOM 与 ECharts 数字均与 metrics.json 一致');
