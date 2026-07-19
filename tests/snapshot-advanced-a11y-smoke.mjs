#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(root, 'scripts', 'snapshot.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-advanced-a11y-'));

function run(name, html) {
  const input = path.join(work, `${name}.html`);
  const output = path.join(work, `${name}-shots`);
  writeFileSync(input, html);
  return { result: spawnSync(process.execPath, [snapshot, input, output], { encoding: 'utf8' }), output };
}

try {
  const valid = run('valid', `<!doctype html><html lang="zh-CN"><head>
    <meta name="viewport" content="width=device-width"><title>高级无障碍正向样例</title>
    <style>
      body{font:16px sans-serif;color:#111827;background:#fff}
      button:focus,a:focus,[tabindex]:focus{outline:3px solid #1d4ed8;outline-offset:2px}
      .panel{padding:16px;background:#f8fafc;color:#475569}
    </style></head><body><main>
      <h1>高级无障碍正向样例</h1><h2>可操作区</h2>
      <p id="help">点击后查看审计证据</p>
      <button type="button" aria-describedby="help">查看证据</button>
      <a href="#detail">跳到明细</a>
      <section class="panel" id="detail" role="region" aria-label="报告明细" tabindex="0">明细内容</section>
    </main></body></html>`);
  if (valid.result.status === 3) {
    console.error('[UNVERIFIED] advanced a11y smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(valid.result.status, 0, valid.result.stderr || valid.result.stdout);
  assert.equal(existsSync(path.join(valid.output, 'mobile-390.png')), true);
  assert.match(valid.result.stdout, /3 focus targets/);

  const invalid = run('invalid', `<!doctype html><html lang="zh-CN"><head>
    <meta name="viewport" content="width=device-width"><title>高级无障碍反例</title>
    <style>
      body{font:16px sans-serif;color:#111827;background:#fff}
      .low{color:#aaa;background:#fff}
      button:focus,[tabindex]:focus{outline:none;box-shadow:none}
    </style></head><body><main>
      <h1>高级无障碍反例</h1><h3>错误跳级标题</h3>
      <p class="low">低对比度正文</p>
      <button type="button" tabindex="2" aria-describedby="missing-help">错误按钮</button>
      <div onclick="void 0">只能鼠标点击</div>
      <section role="region" tabindex="0">无名称区域</section>
      <div aria-hidden="true"><button type="button">隐藏树按钮</button></div>
    </main></body></html>`);
  assert.equal(invalid.result.status, 2, invalid.result.stderr || invalid.result.stdout);
  const log = `${invalid.result.stdout}\n${invalid.result.stderr}`;
  for (const expected of [
    /标题层级从 h1 跳到 h3/,
    /禁止正数 tabindex/,
    /aria-describedby 引用不存在/,
    /onclick 元素不可通过键盘访问/,
    /region 缺少可访问名称/,
    /aria-hidden 区域含可聚焦元素/,
    /WCAG AA 文本对比度不足/,
    /缺少可见 focus indicator/,
  ]) assert.match(log, expected);
  assert.equal(existsSync(path.join(invalid.output, 'desktop.png')), false);

  console.log('[PASS] advanced a11y smoke: 标题/ARIA/AX/Tab/focus/contrast 正负例均生效');
} finally {
  rmSync(work, { recursive: true, force: true });
}
