#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'scripts', 'render-report.mjs');
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');
const gold = JSON.parse(readFileSync(path.join(root, 'demo-report', 'report-spec.json'), 'utf8'));
const work = mkdtempSync(path.join(tmpdir(), 'south-china-renderer-negative-'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectBlocked(name, mutate, reasonCode) {
  const value = clone(gold);
  mutate(value);
  const specPath = path.join(work, `${name}.json`);
  const outputPath = path.join(work, `${name}.html`);
  writeFileSync(specPath, JSON.stringify(value, null, 2));
  const result = spawnSync(process.execPath, [
    renderer,
    '--metrics', metrics,
    '--insights', insights,
    '--spec', specPath,
    '--out', outputPath,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, `${name}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, new RegExp(`"reason_code": "${reasonCode}"`), `${name}\n${result.stderr}`);
  assert.equal(existsSync(outputPath), false, `${name} 阻断后不得留下最终文件`);
}

try {
  expectBlocked('unknown-component', (spec) => { spec.components[3].type = 'free_html'; }, 'unsupported_component');
  expectBlocked('invalid-path', (spec) => { spec.components[0].primary_metric.path = 'measure_results.amount.missing'; }, 'unresolved_path');
  expectBlocked('prototype-path', (spec) => { spec.components[0].primary_metric.path = 'measure_results.__proto__.current'; }, 'unsafe_path');
  expectBlocked('duplicate-id', (spec) => { spec.components[1].id = spec.components[0].id; }, 'duplicate_id');
  expectBlocked('missing-evidence', (spec) => { delete spec.narrative.governing_thought.evidence; }, 'invalid_report_spec');
  expectBlocked('hypothesis-without-validation', (spec) => {
    spec.narrative.governing_thought.claim_kind = 'hypothesis';
    delete spec.narrative.governing_thought.evidence;
    spec.narrative.governing_thought.reason = '需要进一步核查';
  }, 'invalid_report_spec');
  expectBlocked('unsafe-html-script', (spec) => { spec.report.title = '<script>alert(1)</script>'; }, 'unsafe_content');
  expectBlocked('wrong-unit', (spec) => { spec.components[0].primary_metric.assert_unit = 'minute'; }, 'unit_mismatch');
  expectBlocked('wrong-direction', (spec) => { spec.components[0].primary_metric.assert_direction = 'lower_is_better'; }, 'direction_mismatch');
  expectBlocked('wrong-comparison-label', (spec) => {
    spec.components.find((item) => item.type === 'slope_chart').assert_comparison_labels.current = '2026H2';
  }, 'comparison_label_mismatch');
  expectBlocked('naked-number', (spec) => { spec.report.subtitle = '二零二六年 H1 分析'; }, 'unbound_numeric_literal');

  const staleInsightsPath = path.join(work, 'stale-insights.json');
  const staleInsights = JSON.parse(readFileSync(insights, 'utf8'));
  staleInsights.meta.metrics_sha256 = '0'.repeat(64);
  writeFileSync(staleInsightsPath, `${JSON.stringify(staleInsights, null, 2)}\n`);
  const staleOutput = path.join(work, 'stale-insights.html');
  const staleResult = spawnSync(process.execPath, [
    renderer,
    '--metrics', metrics,
    '--insights', staleInsightsPath,
    '--spec', path.join(root, 'demo-report', 'report-spec.json'),
    '--out', staleOutput,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(staleResult.status, 2, staleResult.stderr || staleResult.stdout);
  assert.match(staleResult.stderr, /"reason_code": "insights_metrics_sha_mismatch"/);
  assert.equal(existsSync(staleOutput), false, '旧 insights 阻断后不得留下最终文件');

  console.log('[PASS] renderer negative: 组件、路径、原型链、Evidence、注入、旧 SHA 与语义漂移均 fail-closed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
