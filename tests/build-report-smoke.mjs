#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(root, 'scripts', 'build-report.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-build-report-'));
const common = [
  '--metrics', path.join(root, 'demo-report', 'metrics.json'),
  '--insights', path.join(root, 'demo-report', 'insights.json'),
  '--spec', path.join(root, 'demo-report', 'report-spec.json'),
];

function run(outDir, extra = []) {
  return spawnSync(process.execPath, [builder, ...common, '--out-dir', outDir, ...extra], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function jsonResult(result) {
  assert.ok(result.stdout.trim(), result.stderr || 'build-report 没有输出机器摘要');
  return JSON.parse(result.stdout);
}

try {
  const completeDir = path.join(work, 'complete');
  const complete = run(completeDir);
  assert.equal(complete.status, 0, `${complete.stdout}\n${complete.stderr}`);
  const completeResult = jsonResult(complete);
  assert.equal(completeResult.status, 'OK');
  assert.equal(completeResult.delivery_ready, true);
  assert.equal(completeResult.published_output_dir, completeDir);
  for (const relative of ['report.html', 'report.offline.html', 'build-summary.json']) {
    assert.equal(existsSync(path.join(completeDir, relative)), true, `缺少 ${relative}`);
  }
  const shots = readdirSync(path.join(completeDir, 'shots'));
  for (const required of ['desktop.png', 'desktop-1360.png', 'mobile.png', 'mobile-390.png']) {
    assert.equal(shots.includes(required), true, `缺少 ${required}`);
  }
  const summary = JSON.parse(readFileSync(path.join(completeDir, 'build-summary.json'), 'utf8'));
  assert.equal(summary.status, 'OK');
  assert.equal(summary.steps.length, 7);
  assert.equal(summary.steps.every((step) => step.status === 'OK'), true);
  assert.equal(summary.steps.every((step) => existsSync(path.join(completeDir, step.stdout_log))), true);
  assert.equal(summary.steps.every((step) => existsSync(path.join(completeDir, step.stderr_log))), true);
  assert.doesNotMatch(JSON.stringify(summary), /\.staging-/);

  const originalReport = readFileSync(path.join(completeDir, 'report.html'));
  const overwriteDenied = run(completeDir);
  assert.equal(overwriteDenied.status, 2, overwriteDenied.stdout || overwriteDenied.stderr);
  assert.equal(jsonResult(overwriteDenied).reason_code, 'output_exists');
  assert.deepEqual(readFileSync(path.join(completeDir, 'report.html')), originalReport);

  const devDir = path.join(work, 'dev-unverified');
  const skipped = run(devDir, ['--skip-snapshot']);
  assert.equal(skipped.status, 3, `${skipped.stdout}\n${skipped.stderr}`);
  const skippedResult = jsonResult(skipped);
  assert.equal(skippedResult.status, 'UNVERIFIED');
  assert.equal(skippedResult.delivery_ready, false);
  assert.equal(skippedResult.reason_code, 'snapshot_skipped_by_request');
  assert.equal(existsSync(path.join(devDir, 'report.html')), true);
  assert.equal(existsSync(path.join(devDir, 'report.offline.html')), true);
  assert.equal(existsSync(path.join(devDir, 'shots')), false);
  const skippedSummary = JSON.parse(readFileSync(path.join(devDir, 'build-summary.json'), 'utf8'));
  assert.equal(skippedSummary.steps.at(-1).status, 'SKIPPED');
  assert.equal(skippedSummary.steps.at(-1).reason_code, 'snapshot_skipped_by_request');

  console.log('[PASS] build-report smoke: 完整七段 Gate、原子发布、默认拒绝覆盖与显式 UNVERIFIED 均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
