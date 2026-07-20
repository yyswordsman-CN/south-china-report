#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RendererError, blocked } from './renderer/errors.mjs';
import { createDraftSpec, loadPlannerInputs, validatePlannedSpec } from './renderer/plan-spec.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { force: false, reportType: 'strategic_narrative', audience: 'L2', density: 'compact' };
  const flags = new Set(['--metrics', '--insights', '--out', '--report-type', '--audience', '--density', '--organization', '--subject', '--subtitle', '--id']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') { options.force = true; continue; }
    if (!flags.has(arg)) blocked('invalid_arguments', `未知参数: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) blocked('invalid_arguments', `${arg} 缺少参数`);
    const key = arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = value;
  }
  for (const key of ['metrics', 'insights', 'out']) if (!options[key]) blocked('invalid_arguments', `缺少 --${key}`);
  if (!['strategic_narrative', 'executive_brief', 'audit_pack'].includes(options.reportType)) {
    blocked('invalid_arguments', '--report-type 只接受 strategic_narrative|executive_brief|audit_pack');
  }
  if (!['L1', 'L2', 'L3'].includes(options.audience)) blocked('invalid_arguments', '--audience 只接受 L1|L2|L3');
  if (!['compact', 'standard'].includes(options.density)) blocked('invalid_arguments', '--density 只接受 compact|standard');
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const { metrics, insights } = await loadPlannerInputs(options.metrics, options.insights);
  const spec = createDraftSpec(metrics, insights, options);
  await validatePlannedSpec(spec, metrics, insights, root);
  const payload = `${JSON.stringify(spec, null, 2)}\n`;
  const output = await writeAtomic(options.out, payload, { force: options.force });
  console.log(JSON.stringify({
    status: 'DRAFT',
    output,
    lifecycle: spec.lifecycle.status,
    decisions: Object.fromEntries(['evidence', 'hypothesis', 'unsupported'].map((status) => [
      status,
      spec.planner.decisions.filter((item) => item.status === status).length,
    ])),
  }, null, 2));
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'planner_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
