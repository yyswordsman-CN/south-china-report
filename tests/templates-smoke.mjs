#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'scripts', 'validate-report.mjs');
const templates = [
  'audit-pack.html',
  'bento-brief.html',
  'scroll-narrative-skeleton.html',
];

for (const name of templates) {
  const report = path.join(root, 'templates', name);
  const html = readFileSync(report, 'utf8');
  assert.match(
    html,
    /<html\b[^>]*\bdata-density="compact"[^>]*>/i,
    `${name} 必须以紧凑密度作为出厂默认`,
  );
  const result = spawnSync(process.execPath, [validator, report, '--template-mode'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    `${name} 模板校验必须通过\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /紧凑销售报告风已启用/, `${name} validator 应确认紧凑默认已生效`);
}

const scroll = readFileSync(path.join(root, 'templates', 'scroll-narrative-skeleton.html'), 'utf8');
assert.match(
  scroll,
  /<section data-snap="chapter-01">[\s\S]*?id="chart-trend"[\s\S]*?<\/section>\s*<div class="divider">/,
  'chapter-01 分区必须同时包含标题、证据与趋势图',
);
assert.match(
  scroll,
  /<section data-snap="chapter-02">[\s\S]*?id="chart-waterfall"[\s\S]*?<\/section>\s*<div class="divider">/,
  'chapter-02 分区必须同时包含标题、证据与瀑布图',
);
assert.match(
  scroll,
  /class="data-detail-section reveal"\s+data-snap="data-detail"/,
  '明细区必须提供可独立截图的 data-snap',
);

console.log(`[PASS] template smoke: ${templates.length} 个模板均通过，scroll 核心分区含完整证据`);
