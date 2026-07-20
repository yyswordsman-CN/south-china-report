#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererError, blocked } from './renderer/errors.mjs';
import { loadInputs } from './renderer/load-inputs.mjs';
import { validateSpec } from './renderer/validate-spec.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = { force: false };
  const flags = new Set(['--metrics', '--insights', '--spec', '--out', '--reviewed-by', '--reviewed-at']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') { options.force = true; continue; }
    if (!flags.has(arg)) blocked('invalid_arguments', `未知参数: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) blocked('invalid_arguments', `${arg} 缺少参数`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  for (const key of ['metrics', 'insights', 'spec', 'out', 'reviewedBy', 'reviewedAt']) {
    if (!options[key]) blocked('invalid_arguments', `缺少必填参数 ${key}`);
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs({ metricsPath: options.metrics, insightsPath: options.insights, specPath: options.spec });
  if (inputs.spec.value.lifecycle?.status !== 'draft') blocked('spec_not_draft', '只能定稿 lifecycle.status=draft 的 spec');
  const finalized = structuredClone(inputs.spec.value);
  finalized.lifecycle = { status: 'final', reviewed_by: options.reviewedBy, reviewed_at: options.reviewedAt };
  await validateSpec(finalized, inputs.metrics.value, path.join(root, 'schemas', 'report-spec.schema.json'), inputs.insights.value);
  const output = await writeAtomic(options.out, `${JSON.stringify(finalized, null, 2)}\n`, { force: options.force });
  console.log(JSON.stringify({ status: 'FINAL', output, reviewed_by: options.reviewedBy, reviewed_at: options.reviewedAt }, null, 2));
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'finalize_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
