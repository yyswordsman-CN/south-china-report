#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = path.join(root, 'demo-report');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-demo-migration-'));

const variants = [
  {
    density: 'standard',
    current: 'report.html',
    legacy: path.join('legacy', 'report.manual-v3.2.html'),
  },
  {
    density: 'compact',
    current: 'report-compact.html',
    legacy: path.join('legacy', 'report-compact.manual-v3.2.html'),
  },
];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
}

function contract(html, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = html.match(new RegExp(`id="${escaped}">([\\s\\S]*?)<\\/script>`))?.[1];
  assert.ok(body, `HTML 缺少 ${id}`);
  return JSON.parse(body);
}

function count(html, pattern) {
  return html.match(pattern)?.length || 0;
}

try {
  const metricsPath = path.join(demo, 'metrics.json');
  const insightsPath = path.join(demo, 'insights.json');
  const specPath = path.join(demo, 'report-spec.json');
  const metrics = JSON.parse(readFileSync(metricsPath, 'utf8'));
  const metricsSha = createHash('sha256').update(readFileSync(metricsPath)).digest('hex');

  assert.deepEqual(
    {
      total_cur_wan: metrics.period.total_cur_wan,
      qty_cur: metrics.period.qty_cur,
      total_yoy: metrics.period.total_yoy,
      qty_yoy: metrics.period.qty_yoy,
      price_yoy: metrics.period.price_yoy,
    },
    { total_cur_wan: 6372, qty_cur: 20792, total_yoy: -12.6, qty_yoy: -18.5, price_yoy: 7.2 },
    'R4 迁移基线数字发生变化，需先人工复核',
  );

  for (const variant of variants) {
    const currentPath = path.join(demo, variant.current);
    const legacyPath = path.join(demo, variant.legacy);
    assert.equal(existsSync(legacyPath), true, `缺少一个版本周期的回退文件: ${variant.legacy}`);
    assert.equal(existsSync(currentPath), true, `缺少 Renderer Demo: ${variant.current}`);

    const renderedPath = path.join(work, variant.current);
    run(process.execPath, [
      path.join(root, 'scripts', 'render-report.mjs'),
      '--metrics', metricsPath,
      '--insights', insightsPath,
      '--spec', specPath,
      '--out', renderedPath,
      '--density', variant.density,
    ]);

    const current = readFileSync(currentPath, 'utf8');
    const direct = readFileSync(renderedPath, 'utf8');
    const legacy = readFileSync(legacyPath, 'utf8');
    assert.equal(current, direct, `${variant.current} 必须由 report-spec + Renderer 逐字节重建`);
    assert.match(legacy, /LEGACY\/MANUAL: V3\.2/);

    const meta = contract(current, 'south-china-report-meta');
    const evidence = contract(current, 'south-china-report-evidence-contract');
    const legacyEvidence = contract(legacy, 'south-china-report-evidence-contract');
    assert.equal(meta.requested_period, '2026H1');
    assert.equal(meta.source.sha256, metrics.meta.source_sha256);
    assert.equal(meta.metrics_sha256, metricsSha);
    assert.equal(meta.report_mode, 'period');
    assert.equal(count(current, /class="chapter-title"/g), count(legacy, /class="chapter-title"/g));
    assert.equal(count(current, /class="chart-container"/g), count(legacy, /class="chart-container"/g));
    assert.equal(
      count(current, /class="[^"]*\baction-item\b[^"]*"/g),
      count(legacy, /class="[^"]*\baction-item\b[^"]*"/g),
    );
    assert.ok(evidence.claims.length >= legacyEvidence.claims.length, '迁移后 Evidence claims 不得少于旧手工版');

    const compact = /^<html[^>]*data-density="compact"/m.test(current);
    assert.equal(compact, variant.density === 'compact', `${variant.current} 密度属性错误`);
  }

  console.log('[PASS] demo renderer migration: 双密度由 spec/Renderer 重建，4 章/4 图/3 行动与手工基线等价');
} finally {
  rmSync(work, { recursive: true, force: true });
}
