#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'snapshot.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-snapshot-atomic-'));
const input = path.join(fixtureDir, 'mobile-fails.html');
const output = path.join(fixtureDir, 'shots');

try {
  writeFileSync(input, `<!doctype html><html lang="zh-CN"><head><title>截图原子写入测试</title>
    <meta name="viewport" content="width=device-width">
    <style>.mobile-only-overflow{display:none}@media(max-width:500px){.mobile-only-overflow{display:block;width:1000px;height:20px}}</style>
    </head><body><main><h1>先通过桌面再触发移动端失败</h1><div class="mobile-only-overflow">overflow</div></main></body></html>`);
  mkdirSync(output);
  writeFileSync(path.join(output, 'desktop.png'), 'known-good-desktop');
  writeFileSync(path.join(output, 'sentinel.txt'), 'keep-existing-directory');
  const before = readdirSync(output).sort();

  const result = spawnSync(process.execPath, [script, input, output], { encoding: 'utf8' });
  if (result.status === 3) {
    console.error('[UNVERIFIED] snapshot atomic smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /mobile-430 验证失败|横向溢出|元素越出视口/);
  assert.deepEqual(readdirSync(output).sort(), before, '失败不得混入本轮部分截图或删除既有目录内容');
  assert.equal(readFileSync(path.join(output, 'desktop.png'), 'utf8'), 'known-good-desktop');
  assert.equal(readFileSync(path.join(output, 'sentinel.txt'), 'utf8'), 'keep-existing-directory');
  const stagingLeftovers = readdirSync(fixtureDir).filter((name) => name.includes('.staging-'));
  assert.deepEqual(stagingLeftovers, [], '失败后必须清理本轮 staging 目录');
  console.log('[PASS] snapshot atomic smoke: 移动端后置失败不会留下桌面部分截图，既有成功目录保持不变');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
