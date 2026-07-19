#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'snapshot.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-snapshot-a11y-'));
const validInput = path.join(fixtureDir, 'valid.html');
const invalidInput = path.join(fixtureDir, 'invalid.html');
const validOutput = path.join(fixtureDir, 'valid-shots');
const invalidOutput = path.join(fixtureDir, 'invalid-shots');
const pixel = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

try {
  writeFileSync(validInput, `<!doctype html>
    <html lang="zh-CN"><head><meta name="viewport" content="width=device-width"><title>基础无障碍正向样例</title>
    <style>button,img,.chart-container{display:block;width:100px;height:30px}</style></head><body>
    <main id="main-content">
      <h1>基础无障碍正向样例</h1>
      <img src="${pixel}" alt="">
      <button type="button" aria-label="打开详情"></button>
      <table><thead><tr><th scope="col">指标</th></tr></thead><tbody><tr><td>签收量</td></tr></tbody></table>
      <div id="chart-sales" class="chart-container" role="img" aria-label="月度签收趋势"><canvas></canvas></div>
    </main>
    <script>window.echarts={getInstanceByDom:function(){return {};}};</script>
    </body></html>`);

  const valid = spawnSync(process.execPath, [script, validInput, validOutput], { encoding: 'utf8' });
  if (valid.status === 3) {
    console.error('[UNVERIFIED] snapshot a11y smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  for (const file of ['desktop.png', 'desktop-1360.png', 'mobile.png', 'mobile-390.png']) {
    assert.equal(existsSync(path.join(validOutput, file)), true, `正向样例缺少 ${file}`);
  }

  writeFileSync(invalidInput, `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width">
    <style>button,img,.chart-container{display:block;width:100px;height:30px}</style></head><body>
      <h1>重复标题一</h1><h1>重复标题二</h1>
      <div id="duplicate"></div><div id="duplicate"></div>
      <img src="${pixel}">
      <button type="button"></button>
      <table><tbody><tr><td>无表头</td></tr></tbody></table>
      <div id="chart-sales" class="chart-container"><canvas></canvas></div>
      <script>window.echarts={getInstanceByDom:function(){return {};}};</script>
    </body></html>`);

  const invalid = spawnSync(process.execPath, [script, invalidInput, invalidOutput], { encoding: 'utf8' });
  assert.equal(invalid.status, 2, invalid.stderr || invalid.stdout);
  const log = `${invalid.stdout}\n${invalid.stderr}`;
  for (const expected of [
    /<html> 缺少 lang/,
    /只能有一个 h1/,
    /重复 id/,
    /图片缺少 alt/,
    /交互控件缺少可访问名称/,
    /main landmark/,
    /表格缺少表头/,
    /图表缺少 aria-label\/aria-labelledby/,
  ]) assert.match(log, expected);
  assert.equal(existsSync(path.join(invalidOutput, 'desktop.png')), false, '无障碍闸门失败时不得输出通过截图');

  console.log('[PASS] snapshot a11y smoke: 四视口正向样例通过，8 类基础无障碍缺陷均会阻断');
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
