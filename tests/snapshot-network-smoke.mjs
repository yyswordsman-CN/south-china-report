#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'snapshot.mjs');
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'south-china-snapshot-network-'));
const input = path.join(fixtureDir, 'network-attempt.html');
const output = path.join(fixtureDir, 'shots');
let received = 0;
const server = createServer((_request, response) => {
  received += 1;
  response.end('unexpected');
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  writeFileSync(input, `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width"><title>截图网络阻断测试</title></head>
    <body><main><h1>网络阻断样例</h1></main>
    <script>fetch('http://127.0.0.1:${address.port}/leak?secret=business-data').catch(function(){});</script>
    </body></html>`);

  const child = spawn(process.execPath, [script, input, output], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const status = await new Promise((resolve) => child.once('close', resolve));
  if (status === 3) {
    console.error('[UNVERIFIED] snapshot network smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(status, 2, stderr || stdout);
  assert.match(`${stdout}\n${stderr}`, /阻断外部网络请求/);
  assert.equal(received, 0, '截图页的 HTTP 请求不得到达目标服务');
  console.log('[PASS] snapshot network smoke: 报告脚本的外部 HTTP 请求在出站前被阻断并使 Gate 失败');
} finally {
  await new Promise((resolve) => server.close(resolve));
  rmSync(fixtureDir, { recursive: true, force: true });
}
