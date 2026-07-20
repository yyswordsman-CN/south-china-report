#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-renderer-e2e-'));
const report = path.join(work, 'report.html');
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  run(process.execPath, [
    path.join(root, 'scripts', 'render-report.mjs'),
    '--metrics', metrics,
    '--insights', insights,
    '--spec', path.join(root, 'demo-report', 'report-spec.json'),
    '--out', report,
  ]);
  const validator = run(process.execPath, [path.join(root, 'scripts', 'validate-report.mjs'), report]);
  assert.match(validator.stdout, /FAIL[^\n]*: 0|FAIL.*0/s);
  const numbers = run(process.execPath, [
    path.join(root, 'scripts', 'verify-numbers.mjs'), report, metrics, '--insights', insights,
  ]);
  assert.match(numbers.stdout, /覆盖率 100\.0%/);

  const html = readFileSync(report, 'utf8');
  const runtimeBody = html.match(/id="south-china-report-runtime-contract">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(runtimeBody, '生成报告必须携带 runtime contract');
  const runtime = JSON.parse(runtimeBody);
  assert.equal(runtime.version, 2);
  assert.equal(runtime.charts.length, 3);
  assert.deepEqual(runtime.charts.map((chart) => chart.id), ['chart-trend-total', 'chart-region-bars', 'chart-portfolio-slope']);

  console.log('[PASS] renderer e2e: Demo 在线报告通过 validator、数字真值与 runtime 合同检查');
} finally {
  rmSync(work, { recursive: true, force: true });
}
