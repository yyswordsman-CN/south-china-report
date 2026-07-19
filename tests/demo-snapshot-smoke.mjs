#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(root, 'scripts', 'snapshot.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-demo-snapshot-'));

try {
  for (const report of ['report.offline.html', 'report-compact.offline.html']) {
    const output = path.join(work, report.replace('.offline.html', '-shots'));
    const result = spawnSync(process.execPath, [snapshot, path.join(root, 'demo-report', report), output], { encoding: 'utf8' });
    if (result.status === 3) {
      console.error('[UNVERIFIED] demo snapshot smoke 需要 Playwright/Chromium');
      process.exit(3);
    }
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /a11y=DOM\/AX\/Tab\/contrast 通过/);
    for (const file of ['desktop.png', 'desktop-1360.png', 'mobile.png', 'mobile-390.png']) {
      assert.equal(existsSync(path.join(output, file)), true, `${report} 缺少 ${file}`);
    }
  }
  console.log('[PASS] demo snapshot smoke: 标准/紧凑离线版四视口与增强无障碍均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
