#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(root, 'scripts', 'snapshot.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-render-pressure-'));
const input = path.join(fixtureDir, 'pressure.html');
const output = path.join(fixtureDir, 'shots');

try {
  const categories = Array.from({ length: 24 }, (_, index) => `分类 ${String(index + 1).padStart(2, '0')} · 极长跨业务标签用于验证自动换行与高基数承载`);
  writeFileSync(input, `<!doctype html><html lang="zh-CN" data-density="compact"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>跨业务渲染压力门禁</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#fff;color:#172033;font:15px/1.55 system-ui,sans-serif}
      main{width:min(1180px,calc(100% - 32px));margin:auto;padding:24px 0}.mast{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(220px,.4fr);gap:16px;border-bottom:1px solid #cbd5e1;padding-bottom:16px}
      h1,h2,p{margin:0}.mast p,.label,.metric{overflow-wrap:anywhere}.value{font:700 clamp(24px,5vw,48px)/1.05 ui-monospace,monospace;font-variant-numeric:tabular-nums}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;margin-top:16px}.card{min-width:0;border:1px solid #cbd5e1;padding:12px}
      .bars{display:grid;gap:8px;margin-top:12px}.bar{display:grid;grid-template-columns:minmax(120px,1fr) minmax(100px,2fr) auto;align-items:center;gap:8px}.track{height:12px;background:#e2e8f0;position:relative}.fill{height:100%;background:#245c8e}.negative{background:#9f3a38;transform-origin:right}
      .table-wrap{max-width:100%;overflow:auto;margin-top:16px;border:1px solid #cbd5e1}table{width:100%;min-width:720px;border-collapse:collapse}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left}td:last-child,th:last-child{text-align:right;font-family:ui-monospace,monospace}
      @media(max-width:600px){main{width:min(100% - 20px,1180px);padding:12px 0}.mast{grid-template-columns:1fr}.bar{grid-template-columns:minmax(0,1fr) 96px auto;font-size:12px}}
    </style></head><body><main>
      <section class="mast" data-snap="pressure-hero"><div><h1>长标签、高基数、极端值与负数仍保持可读</h1><p>紧凑布局通过重排承载信息，不缩小到不可读，也不固定轴域裁掉极端值。</p></div><div><div class="metric">极端值范围</div><div class="value">−1M…900M</div></div></section>
      <section data-snap="pressure-cards"><h2>多单位指标</h2><div class="grid">
        <article class="card"><div class="label">平均处理时长（越低越好）</div><div class="value">36 min</div></article>
        <article class="card"><div class="label">缺陷率（越低越好）</div><div class="value">1.8%</div></article>
        <article class="card"><div class="label">快照库存（中性方向，含冲销）</div><div class="value">−5</div></article>
        <article class="card"><div class="label">评分（百分比之外的独立单位）</div><div class="value">88 pt</div></article>
      </div></section>
      <section data-snap="pressure-bars"><h2>长标签与正负值</h2><div class="bars">${categories.slice(0, 12).map((label, index) => `<div class="bar"><span class="label">${label}</span><span class="track"><span class="fill ${index % 5 === 0 ? 'negative' : ''}" style="display:block;width:${20 + index * 6}%"></span></span><span>${index % 5 === 0 ? '−' : ''}${10 ** (index % 6)}</span></div>`).join('')}</div></section>
      <section data-snap="pressure-table"><h2>高基数明细</h2><div class="table-wrap"><table><thead><tr><th scope="col">分组</th><th scope="col">单位</th><th scope="col">方向</th><th scope="col">数值</th></tr></thead><tbody>${categories.map((label, index) => `<tr><td>${label}</td><td>${index % 2 ? 'percent' : 'unit'}</td><td>${index % 3 === 0 ? 'lower_is_better' : 'neutral'}</td><td>${index % 4 === 0 ? '-' : ''}${(index + 1) * 1234567}</td></tr>`).join('')}</tbody></table></div></section>
    </main></body></html>`, 'utf8');

  const result = spawnSync(process.execPath, [snapshot, input, output], { encoding: 'utf8' });
  if (result.status === 3) {
    console.error('[UNVERIFIED] render pressure smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  for (const file of ['desktop.png', 'desktop-1360.png', 'mobile.png', 'mobile-390.png',
    'snap-pressure-hero.png', 'snap-pressure-cards.png', 'snap-pressure-bars.png', 'snap-pressure-table.png']) {
    assert.equal(existsSync(path.join(output, file)), true, `缺少压力门禁截图 ${file}`);
  }
  console.log('[PASS] render pressure: 四视口长标签、高基数、极端值、负数、百分比与紧凑布局通过');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
