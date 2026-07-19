#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = path.join(root, 'scripts', 'snapshot.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-template-a11y-'));
const fakeEcharts = `<script>
  (function(){
    const instances = new WeakMap();
    window.echarts = {
      graphic:{LinearGradient:function(){return '#0353a4';}},
      init:function(element){
        const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;canvas.style.cssText='display:block;width:100%;height:100%';element.appendChild(canvas);
        const instance={option:{},setOption:function(option){this.option=option;},getOption:function(){return this.option;},resize:function(){}};
        instances.set(element,instance);return instance;
      },
      getInstanceByDom:function(element){return instances.get(element)||null;},
      registerTheme:function(){}
    };
  })();
</script>`;

try {
  for (const name of ['scroll-narrative-skeleton.html', 'bento-brief.html', 'audit-pack.html']) {
    let html = readFileSync(path.join(root, 'templates', name), 'utf8');
    html = html.replace(/<link\b[^>]*>/gi, '').replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
    html = html.replace('</head>', `${fakeEcharts}</head>`);
    const input = path.join(work, name);
    const output = path.join(work, `${name}-shots`);
    writeFileSync(input, html);
    const result = spawnSync(process.execPath, [snapshot, input, output], { encoding: 'utf8' });
    if (result.status === 3) {
      console.error('[UNVERIFIED] template accessibility smoke 需要 Playwright/Chromium');
      process.exit(3);
    }
    assert.equal(result.status, 0, `${name}\n${result.stderr || result.stdout}`);
    assert.match(result.stdout, /a11y=DOM\/AX\/Tab\/contrast 通过/);
  }
  console.log('[PASS] template accessibility smoke: 三模板四视口 DOM/AX/Tab/contrast 均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
