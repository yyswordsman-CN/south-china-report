#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'snapshot.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-snapshot-negative-'));
const input = path.join(fixtureDir, 'invalid.html');
const output = path.join(fixtureDir, 'shots');

try {
  writeFileSync(input, `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>
    <section data-snap="../unsafe"></section>
    <section data-snap="../unsafe"></section>
    <div style="width: 1800px; height: 20px">overflow</div>
  </body></html>`);
  const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  if (result.status === 3) {
    console.error('[UNVERIFIED] snapshot negative smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const log = `${result.stdout}\n${result.stderr}`;
  assert.match(log, /横向溢出/);
  assert.match(log, /data-snap 不安全/);
  assert.match(log, /data-snap 重复/);
  assert.equal(existsSync(path.join(output, 'desktop.png')), false, '闸门失败时不得标记桌面截图为通过');
  console.log('[PASS] snapshot negative smoke: 横向溢出、不安全/重复 data-snap 均会阻断');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
