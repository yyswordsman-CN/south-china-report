import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'scr-templates-'));
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${script} exit=${result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

for (const [type, template] of [['strategic_narrative', 'scroll-narrative'], ['executive_brief', 'bento-brief'], ['audit_pack', 'audit-pack']]) {
  const draft = path.join(temp, `${type}.draft.json`);
  const final = path.join(temp, `${type}.json`);
  const html = path.join(temp, `${type}.html`);
  run('plan-report.mjs', ['--metrics', metrics, '--insights', insights, '--out', draft, '--report-type', type]);
  run('finalize-report-spec.mjs', ['--metrics', metrics, '--insights', insights, '--spec', draft, '--out', final, '--reviewed-by', 'release-gate', '--reviewed-at', '2026-07-20T00:00:00Z']);
  const rendered = JSON.parse(run('render-report.mjs', ['--metrics', metrics, '--insights', insights, '--spec', final, '--out', html]).stdout);
  assert.equal(rendered.template, template);
  assert.doesNotMatch(readFileSync(html, 'utf8'), /\[REPORT_|\[METRIC_|待校验/);
  run('validate-report.mjs', [html]);
  run('verify-numbers.mjs', [html, metrics, '--insights', insights]);
  const offline = path.join(temp, `${type}.offline.html`);
  run('make-offline.mjs', [html, '--out', offline]);
  run('validate-report.mjs', [offline, '--strict-offline']);
  run('verify-runtime.mjs', [offline, metrics]);
  run('snapshot.mjs', [offline, path.join(temp, `${type}.shots`)]);
}

console.log('renderer multitemplate smoke: PASS');
