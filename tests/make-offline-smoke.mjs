#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'make-offline.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-offline-smoke-'));
const digest = (value) => createHash('sha256').update(value).digest('hex');

function run(args, options = {}) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', ...options });
}

try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  writeFileSync(path.join(fixtureDir, 'icon.png'), png);
  writeFileSync(path.join(fixtureDir, 'icon-2.png'), png);
  writeFileSync(path.join(fixtureDir, 'app.js'), 'window.offlineSmoke = true;');
  writeFileSync(path.join(fixtureDir, 'dep.js'), 'export const value = 1;');
  writeFileSync(path.join(fixtureDir, 'module.js'), 'import "./dep.js"; window.moduleLoaded = true;');
  writeFileSync(path.join(fixtureDir, 'nested.css'), '.nested{mask-image:url(\'./icon-2.png\')}');
  writeFileSync(path.join(fixtureDir, 'style.css'), '@import \'./nested.css\'; .hero{background-image:url("./icon.png")}');

  const input = path.join(fixtureDir, 'report.html');
  const output = path.join(fixtureDir, 'report.offline.html');
  writeFileSync(input, `<!doctype html><html><head>
    <base href='./'>
    <link rel='stylesheet' href='./style.css'>
    <script src='./app.js'></script>
    </head><body>
    <img src='./icon.png' srcset='./icon.png 1x, ./icon-2.png 2x' alt='fixture'>
    <img src='./icon.png' srcset='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs= 1x, ./icon-2.png 2x' alt='mixed srcset fixture'>
    <img src='./icon.png' srcset='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=, ./icon-2.png 2x' alt='mixed srcset without first descriptor'>
    <svg><image href='./icon.png'></image></svg>
    <div style="background:url('./icon-2.png')"></div>
    <script type="module">window.inlineModuleWithoutDependencies = true;</script>
    </body></html>`);

  const success = run([input, '--out', output]);
  assert.equal(success.status, 0, success.stderr || success.stdout);
  assert.ok(existsSync(output), '应生成离线产物');
  const offline = readFileSync(output, 'utf8');
  assert.match(offline, /data:image\/png;base64,/);
  assert.match(offline, /window\.offlineSmoke = true/);
  assert.doesNotMatch(offline, /(?:src|href|srcset)\s*=\s*["'][^"']*(?:\.\/|https?:\/\/)/i);
  assert.doesNotMatch(offline, /url\(\s*["']?(?:\.\/|https?:\/\/)/i);
  assert.doesNotMatch(offline, /<base\b[^>]*href/i);
  assert.match(
    offline,
    new RegExp(`<meta name="south-china-report-offline-source-sha256" content="${digest(readFileSync(input))}">`),
    '离线产物必须记录输入 HTML 的 SHA-256',
  );
  assert.match(success.stdout, /未内联清单:\s*\n\s*\(空\)/);

  const outputHash = digest(readFileSync(output));
  const refusesExisting = run([input, '--out', output]);
  assert.equal(refusesExisting.status, 1, '默认不得覆盖既有输出');
  assert.match(refusesExisting.stderr, /输出文件已存在，拒绝覆盖/);
  assert.equal(digest(readFileSync(output)), outputHash, '默认拒绝覆盖时既有输出必须保持不变');
  writeFileSync(path.join(fixtureDir, 'app.js'), 'window.offlineSmoke = "forced-update";');
  const forced = run([input, '--out', output, '--force']);
  assert.equal(forced.status, 0, forced.stderr || forced.stdout);
  assert.match(readFileSync(output, 'utf8'), /forced-update/, '--force 应原子替换既有输出');

  const originalHash = digest(readFileSync(input));
  const samePath = run([input, '--out', input]);
  assert.equal(samePath.status, 1, '输出路径与输入相同时必须拒绝');
  assert.equal(digest(readFileSync(input)), originalHash, '拒绝后不得改写输入');

  const unsafeInput = path.join(fixtureDir, 'unsafe.html');
  const unsafeOutput = path.join(fixtureDir, 'unsafe.offline.html');
  writeFileSync(unsafeInput, '<!doctype html><img src="https://127.0.0.1/private.png">');
  const unsafe = run([unsafeInput, '--out', unsafeOutput, '--allow-host', '127.0.0.1']);
  assert.equal(unsafe.status, 2, '私网 IP 必须被拒绝');
  assert.equal(existsSync(unsafeOutput), false, '失败时不得写半成品');

  const slowFetchMock = path.join(fixtureDir, 'slow-fetch-mock.mjs');
  const timeoutCancelMarker = path.join(fixtureDir, 'body-reader-cancelled.txt');
  writeFileSync(slowFetchMock, `import { writeFileSync } from 'node:fs';
  globalThis.fetch = async function(_url, options) {
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial body')); },
      cancel() { writeFileSync(${JSON.stringify(timeoutCancelMarker)}, 'cancelled'); }
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/javascript' } });
  };`);
  const timeoutInput = path.join(fixtureDir, 'timeout.html');
  const timeoutOutput = path.join(fixtureDir, 'timeout.offline.html');
  writeFileSync(timeoutInput, '<!doctype html><script src="https://93.184.216.34/slow.js"></script>');
  const timeout = run([
    timeoutInput, '--out', timeoutOutput, '--allow-host', '93.184.216.34', '--timeout-ms', '50',
  ], { env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${slowFetchMock}`.trim() } });
  assert.equal(timeout.status, 2, '超时必须覆盖响应 body 的完整读取');
  assert.match(`${timeout.stdout}\n${timeout.stderr}`, /读取超过 50ms|读取超时/);
  assert.equal(existsSync(timeoutCancelMarker), true, 'body 读取超时时必须 cancel reader');
  assert.equal(existsSync(timeoutOutput), false, 'body 读取超时时不得写半成品');

  const activeDataInput = path.join(fixtureDir, 'active-data.html');
  const activeDataOutput = path.join(fixtureDir, 'active-data.offline.html');
  writeFileSync(activeDataInput, `<!doctype html><html><head>
    <base href="data:text/html,unsafe">
    <link rel="stylesheet" href="data:text/css,body{}">
    <script src="data:text/javascript,fetch('https://example.com/leak')"></script>
    </head><body>
    <iframe src="data:text/html,%3Cscript%3Efetch('https://example.com/leak')%3C/script%3E"></iframe>
    <embed src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E">
    <object data="data:application/xml,%3Cx/%3E"></object>
    <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="unsafe svg">
    <a href="java&#x73;cript:alert(1)">unsafe link</a>
    <form action="VBScript:msgbox(1)"></form>
    </body></html>`);
  const activeData = run([activeDataInput, '--out', activeDataOutput]);
  assert.equal(activeData.status, 2, '主动 data: MIME 与脚本 scheme 必须 fail-closed');
  const activeLog = `${activeData.stdout}\n${activeData.stderr}`;
  assert.match(activeLog, /data: MIME/);
  assert.match(activeLog, /javascript:/);
  assert.match(activeLog, /vbscript:/);
  assert.equal(existsSync(activeDataOutput), false, '主动 data: 失败时不得写半成品');

  const moduleInput = path.join(fixtureDir, 'module-dependencies.html');
  const moduleOutput = path.join(fixtureDir, 'module-dependencies.offline.html');
  writeFileSync(moduleInput, `<!doctype html><html><head>
    <script type="importmap">{"imports":{"dep":"./dep.js"}}</script>
    <script type="module">
      import "./dep.js";
      import { value } from "./dep.js";
      export { value } from "./dep.js";
    </script>
    <script type="module" src="./module.js"></script>
    <script type="module" src="data:text/javascript,import%20%22./dep.js%22"></script>
    <script>import("./dep.js");</script>
    </head></html>`);
  const modules = run([moduleInput, '--out', moduleOutput]);
  assert.equal(modules.status, 2, '未打包的模块依赖和 importmap 必须阻断');
  const moduleLog = `${modules.stdout}\n${modules.stderr}`;
  assert.match(moduleLog, /importmap/);
  assert.match(moduleLog, /side-effect import/);
  assert.match(moduleLog, /import-from/);
  assert.match(moduleLog, /export-from/);
  assert.match(moduleLog, /dynamic import/);
  assert.equal(existsSync(moduleOutput), false, '模块依赖失败时不得写半成品');

  console.log('[PASS] make-offline smoke: 资源内联、混合 srcset、模块/active data 阻断、原子写入/显式覆盖与私网阻断均通过');
} finally {
  // fixtureDir 由 mkdtempSync 创建且路径精确，只清理本测试的临时目录。
  rmSync(fixtureDir, { recursive: true, force: true });
}
