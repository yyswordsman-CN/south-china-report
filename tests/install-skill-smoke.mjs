#!/usr/bin/env node
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installer = path.join(root, 'scripts', 'install-skill.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-install-'));
const target = path.join(work, 'south-china-report');

function run(mode) {
  return spawnSync(process.execPath, [installer, '--target', target, mode], { encoding: 'utf8' });
}

try {
  const dryRun = run('--dry-run');
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.match(dryRun.stdout, /未写入任何文件/);

  const firstApply = run('--apply');
  assert.equal(firstApply.status, 0, firstApply.stderr || firstApply.stdout);
  assert.match(firstApply.stdout, /已原子安装/);
  assert.equal(run('--check').status, 0);

  appendFileSync(path.join(target, 'SKILL.md'), '\n本行模拟安装副本漂移。\n');
  const drift = run('--check');
  assert.equal(drift.status, 1, drift.stderr || drift.stdout);
  assert.match(`${drift.stdout}\n${drift.stderr}`, /变更 1|发布真源不一致/);

  const secondApply = run('--apply');
  assert.equal(secondApply.status, 0, secondApply.stderr || secondApply.stdout);
  assert.equal(run('--check').status, 0);
  assert.equal(readdirSync(work).some((name) => name.startsWith('.south-china-report.backup-')), true);

  console.log('[PASS] install skill smoke: dry-run、原子安装、漂移检测、备份恢复链均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
