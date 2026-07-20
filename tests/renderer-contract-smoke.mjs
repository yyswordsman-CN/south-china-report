#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'scripts', 'render-report.mjs');
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');
const spec = path.join(root, 'demo-report', 'report-spec.json');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-renderer-contract-'));

function run(output, extra = [], specPath = spec) {
  return spawnSync(process.execPath, [
    renderer,
    '--metrics', metrics,
    '--insights', insights,
    '--spec', specPath,
    '--out', output,
    ...extra,
  ], { cwd: root, encoding: 'utf8' });
}

try {
  const metricsBefore = readFileSync(metrics);
  const insightsBefore = readFileSync(insights);
  const schema = JSON.parse(readFileSync(path.join(root, 'schemas', 'report-spec.schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
  const specs = [
    spec,
    ...['finance', 'people', 'inventory', 'quality', 'service', 'survey'].map((name) =>
      path.join(root, 'evals', 'specs', 'generalized', `${name}.report-spec.json`)),
  ];
  for (const specPath of specs) {
    const value = JSON.parse(readFileSync(specPath, 'utf8'));
    assert.equal(validate(value), true, `${specPath}\n${JSON.stringify(validate.errors, null, 2)}`);
  }

  const template = readFileSync(path.join(root, 'templates', 'scroll-narrative-skeleton.html'), 'utf8');
  for (const anchor of [
    'SCR:REPORT_TITLE', 'REPORT_ROOT', 'SCR:REPORT_CONTRACTS', 'SCR:END_CONTRACTS',
    'SCR:REPORT_CONTENT', 'SCR:END_CONTENT', 'SCR:REPORT_SCRIPTS', 'SCR:END_SCRIPTS',
  ]) {
    assert.equal(template.split(anchor).length - 1, 1, `模板锚点 ${anchor} 必须唯一`);
  }

  const first = path.join(work, 'first.html');
  const second = path.join(work, 'second.html');
  const firstResult = run(first);
  assert.equal(firstResult.status, 0, firstResult.stderr || firstResult.stdout);
  const secondResult = run(second);
  assert.equal(secondResult.status, 0, secondResult.stderr || secondResult.stdout);
  assert.deepEqual(readFileSync(first), readFileSync(second), '同一输入重复渲染必须字节一致');

  const html = readFileSync(first, 'utf8');
  assert.doesNotMatch(html, /SCR:(?:REPORT|END)_/);
  assert.doesNotMatch(html, /E-TEMPLATE|H-TEMPLATE|\[报告主体\]|chart-waterfall/);
  assert.match(html, /id="south-china-report-meta"/);
  assert.match(html, /id="south-china-report-evidence-contract"/);
  assert.match(html, /id="south-china-report-runtime-contract"/);
  assert.equal((html.match(/\bdata-snap="/g) || []).length, 6);

  const overwriteDenied = run(first);
  assert.equal(overwriteDenied.status, 2);
  assert.match(overwriteDenied.stderr, /"reason_code": "output_exists"/);
  const forced = run(first, ['--force', '--density', 'standard']);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  const standardRoot = readFileSync(first, 'utf8').match(/<html\b[^>]*>/i)?.[0] || '';
  assert.doesNotMatch(standardRoot, /data-density="compact"/);

  const optionalSpecPath = path.join(work, 'optional.report-spec.json');
  const optionalSpec = JSON.parse(readFileSync(spec, 'utf8'));
  const optionalChart = optionalSpec.components.find((component) => component.id === 'region-bars');
  optionalChart.optional = true;
  optionalChart.data_path = 'measure_dimensions.amount.missing_dimension';
  writeFileSync(optionalSpecPath, `${JSON.stringify(optionalSpec, null, 2)}\n`);
  const optionalOutput = path.join(work, 'optional.html');
  const optionalResult = run(optionalOutput, [], optionalSpecPath);
  assert.equal(optionalResult.status, 0, optionalResult.stderr || optionalResult.stdout);
  const optionalSummary = JSON.parse(optionalResult.stdout);
  assert.deepEqual(optionalSummary.skipped, [{
    component_id: 'region-bars',
    component_type: 'bar_chart',
    reason_code: 'unresolved_path',
  }]);
  assert.doesNotMatch(readFileSync(optionalOutput, 'utf8'), /id="chart-region-bars"/);
  assert.deepEqual(readFileSync(metrics), metricsBefore, 'Renderer 不得修改 metrics.json');
  assert.deepEqual(readFileSync(insights), insightsBefore, 'Renderer 不得修改 insights.json');

  console.log('[PASS] renderer contract: Schema 金样、唯一锚点、原子覆盖、可选降级与字节复现均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
