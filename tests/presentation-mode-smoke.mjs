#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (error) {
  console.error('[UNVERIFIED] presentation-mode smoke 需要 Playwright:', error.message);
  process.exit(3);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presentationScript = path.join(root, 'scripts', 'presentation-mode.js');
const cases = [
  { name: 'scroll', file: 'scroll-narrative-skeleton.html', minPages: 6, minSnaps: 4 },
  { name: 'bento', file: 'bento-brief.html', minPages: 8, minSnaps: 8 },
  { name: 'audit', file: 'audit-pack.html', minPages: 6, minSnaps: 6 },
];
const echartsStub = `window.echarts={
  init:function(){return {setOption:function(){},resize:function(){}}},
  graphic:{LinearGradient:function(){return {}}}
};`;

const browser = await chromium.launch();
const summaries = [];
try {
  for (const testCase of cases) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route('https://**/*', async (route) => {
      if (/echarts(?:\.min)?\.js/i.test(route.request().url())) {
        await route.fulfill({ status: 200, contentType: 'text/javascript', body: echartsStub });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/css', body: '/* external visual assets stubbed for smoke */' });
      }
    });

    try {
      await page.goto(pathToFileURL(path.join(root, 'templates', testCase.file)).href, { waitUntil: 'networkidle' });
      await page.addScriptTag({ path: presentationScript });
      const initial = await page.evaluate(() => {
        const snapIds = Array.from(document.querySelectorAll('[data-snap]')).map((element) => element.getAttribute('data-snap'));
        return {
          pageCount: window.presentationMode?.pages.length,
          snapCount: snapIds.length,
          uniqueSnapCount: new Set(snapIds).size,
          hasStart: Boolean(document.querySelector('.presentation-start')),
          hasControls: Boolean(document.querySelector('.presentation-controls')),
        };
      });
      assert.ok(initial.pageCount >= testCase.minPages, `${testCase.name} 应自动分出至少 ${testCase.minPages} 个演示页`);
      assert.ok(initial.snapCount >= testCase.minSnaps, `${testCase.name} 应提供核心分区截图标记`);
      assert.equal(initial.uniqueSnapCount, initial.snapCount, `${testCase.name} data-snap 必须唯一`);
      assert.equal(initial.hasStart, true);
      assert.equal(initial.hasControls, true);

      const states = await page.evaluate(() => {
        window.presentationMode.start();
        const started = {
          presenting: document.body.classList.contains('presenting'),
          active: document.querySelectorAll('.presentation-active').length,
          index: window.presentationMode.currentIndex,
        };
        window.presentationMode.next();
        const advanced = { active: document.querySelectorAll('.presentation-active').length, index: window.presentationMode.currentIndex };
        window.presentationMode.exit();
        return { started, advanced, exited: !document.body.classList.contains('presenting') };
      });
      assert.deepEqual(states.started, { presenting: true, active: 1, index: 0 });
      assert.deepEqual(states.advanced, { active: 1, index: 1 });
      assert.equal(states.exited, true);
      assert.deepEqual(errors, [], `${testCase.name} 不应产生页面错误`);
      summaries.push(`${testCase.name}:${initial.pageCount}页/${initial.snapCount}分区`);
    } finally {
      await page.close();
    }
  }
  console.log(`[PASS] presentation-mode smoke: ${summaries.join('，')}，启动/翻页/退出均通过`);
} finally {
  await browser.close();
}
