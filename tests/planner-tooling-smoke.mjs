import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'scr-planner-'));
const metrics = path.join(root, 'demo-report', 'metrics.json');
const insights = path.join(root, 'demo-report', 'insights.json');

function run(script, args, expected = 0) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, expected, `${script} exit=${result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

const draft = path.join(temp, 'draft.json');
run('plan-report.mjs', ['--metrics', metrics, '--insights', insights, '--out', draft]);
const planned = JSON.parse(readFileSync(draft, 'utf8'));
assert.equal(planned.lifecycle.status, 'draft');
assert.deepEqual(new Set(planned.planner.decisions.map((item) => item.status)), new Set(['evidence', 'hypothesis', 'unsupported']));
run('check-report-spec.mjs', ['--metrics', metrics, '--insights', insights, '--spec', draft]);

const preview = path.join(temp, 'preview.html');
const blocked = run('render-report.mjs', ['--metrics', metrics, '--insights', insights, '--spec', draft, '--out', preview], 2);
assert.match(blocked.stderr, /draft_spec_not_allowed/);
run('render-report.mjs', ['--metrics', metrics, '--insights', insights, '--spec', draft, '--out', preview, '--allow-draft']);
assert.match(readFileSync(preview, 'utf8'), /data-report-status="draft"/);

const patchFile = path.join(temp, 'patch.json');
writeFileSync(patchFile, JSON.stringify({ report: { subtitle: '经 Agent 协助修订的待审阅草稿' } }));
const revised = path.join(temp, 'revised.json');
run('revise-report-spec.mjs', ['--metrics', metrics, '--insights', insights, '--spec', draft, '--patch', patchFile, '--out', revised]);
assert.equal(JSON.parse(readFileSync(revised, 'utf8')).planner.strategy, 'agent-assisted');

const final = path.join(temp, 'final.json');
run('finalize-report-spec.mjs', ['--metrics', metrics, '--insights', insights, '--spec', revised, '--out', final, '--reviewed-by', 'release-gate', '--reviewed-at', '2026-07-20T00:00:00Z']);
const output = path.join(temp, 'report.html');
run('render-report.mjs', ['--metrics', metrics, '--insights', insights, '--spec', final, '--out', output]);
const before = statSync(output).mtimeMs;
const incremental = run('render-report.mjs', ['--metrics', metrics, '--insights', insights, '--spec', final, '--out', output, '--incremental']);
assert.equal(JSON.parse(incremental.stdout).reused, true);
assert.equal(statSync(output).mtimeMs, before);

const diff = run('diff-report-spec.mjs', ['--before', draft, '--after', revised]);
assert.equal(JSON.parse(diff.stdout).equal, false);
const legacy = path.join(temp, 'legacy.json');
const legacySpec = structuredClone(planned);
delete legacySpec.registry_version;
delete legacySpec.lifecycle;
delete legacySpec.planner;
writeFileSync(legacy, JSON.stringify(legacySpec));
const migrated = path.join(temp, 'migrated.json');
run('migrate-report-spec.mjs', ['--metrics', metrics, '--insights', insights, '--spec', legacy, '--out', migrated, '--reviewed-by', 'release-gate', '--reviewed-at', '2026-07-20T00:00:00Z']);
assert.equal(JSON.parse(readFileSync(migrated, 'utf8')).registry_version, '1.0');

console.log('planner/tooling smoke: PASS');
