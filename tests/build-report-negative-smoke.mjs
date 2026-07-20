#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builder = path.join(root, 'scripts', 'build-report.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-build-report-negative-'));
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');
const goldSpec = JSON.parse(readFileSync(path.join(root, 'demo-report', 'report-spec.json'), 'utf8'));

function run(spec, outDir, extra = []) {
  return spawnSync(process.execPath, [
    builder,
    '--metrics', metrics,
    '--insights', insights,
    '--spec', spec,
    '--out-dir', outDir,
    ...extra,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function jsonResult(result) {
  assert.ok(result.stdout.trim(), result.stderr || 'build-report 没有输出机器摘要');
  return JSON.parse(result.stdout);
}

try {
  const invalidSpec = structuredClone(goldSpec);
  invalidSpec.components[0].primary_metric.path = 'measure_results.amount.missing';
  const invalidSpecPath = path.join(work, 'invalid-spec.json');
  writeFileSync(invalidSpecPath, `${JSON.stringify(invalidSpec, null, 2)}\n`);
  const invalidTarget = path.join(work, 'invalid-target');
  const invalid = run(invalidSpecPath, invalidTarget);
  assert.equal(invalid.status, 2, `${invalid.stdout}\n${invalid.stderr}`);
  const invalidResult = jsonResult(invalid);
  assert.equal(invalidResult.status, 'BLOCKED');
  assert.equal(invalidResult.reason_code, 'unresolved_path');
  assert.equal(existsSync(invalidTarget), false);
  assert.equal(existsSync(invalidResult.diagnostics_dir), true);
  const invalidSummary = JSON.parse(readFileSync(path.join(invalidResult.diagnostics_dir, 'build-summary.json'), 'utf8'));
  assert.equal(invalidSummary.steps[0].id, 'render');
  assert.equal(invalidSummary.steps[0].status, 'BLOCKED');

  const placeholderSpec = structuredClone(goldSpec);
  placeholderSpec.report.title = '[报告主体]经营结论';
  const placeholderSpecPath = path.join(work, 'placeholder-spec.json');
  writeFileSync(placeholderSpecPath, `${JSON.stringify(placeholderSpec, null, 2)}\n`);
  const protectedTarget = path.join(work, 'protected-target');
  mkdirSync(protectedTarget);
  writeFileSync(path.join(protectedTarget, 'sentinel.txt'), 'keep-me\n');
  const laterFailure = run(placeholderSpecPath, protectedTarget, ['--force']);
  assert.equal(laterFailure.status, 2, `${laterFailure.stdout}\n${laterFailure.stderr}`);
  const laterResult = jsonResult(laterFailure);
  assert.equal(laterResult.reason_code, 'online_validator_failed');
  assert.equal(readFileSync(path.join(protectedTarget, 'sentinel.txt'), 'utf8'), 'keep-me\n');
  assert.equal(existsSync(path.join(protectedTarget, 'report.html')), false);
  assert.equal(existsSync(path.join(laterResult.diagnostics_dir, 'report.html')), true);
  const laterSummary = JSON.parse(readFileSync(path.join(laterResult.diagnostics_dir, 'build-summary.json'), 'utf8'));
  assert.deepEqual(laterSummary.steps.map((step) => step.status), ['OK', 'BLOCKED']);

  const unsafeOut = path.dirname(metrics);
  const unsafe = run(path.join(root, 'demo-report', 'report-spec.json'), unsafeOut, ['--force']);
  assert.equal(unsafe.status, 2, unsafe.stdout || unsafe.stderr);
  assert.equal(jsonResult(unsafe).reason_code, 'output_contains_input');

  console.log('[PASS] build-report negative: 失败诊断保留、既有目录保护与输入目录安全边界均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
