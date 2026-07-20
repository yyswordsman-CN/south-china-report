#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererError, blocked } from './renderer/errors.mjs';
import { loadInputs } from './renderer/load-inputs.mjs';
import { validateSpec } from './renderer/validate-spec.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED_TOP_LEVEL = new Set(['report', 'narrative', 'actions']);

function merge(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const output = target && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) output[key] = merge(output[key], value);
  return output;
}

function parseArgs(argv) {
  const options = { force: false };
  const flags = new Set(['--metrics', '--insights', '--spec', '--patch', '--out']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') { options.force = true; continue; }
    if (!flags.has(arg)) blocked('invalid_arguments', `未知参数: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) blocked('invalid_arguments', `${arg} 缺少参数`);
    options[arg.slice(2)] = value;
  }
  for (const key of ['metrics', 'insights', 'spec', 'patch', 'out']) if (!options[key]) blocked('invalid_arguments', `缺少 --${key}`);
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs({ metricsPath: options.metrics, insightsPath: options.insights, specPath: options.spec });
  if (inputs.spec.value.lifecycle?.status !== 'draft') blocked('revision_requires_draft', 'Agent 只能修改 draft spec，不能直接改 final');
  let patch;
  try { patch = JSON.parse(await readFile(options.patch, 'utf8')); }
  catch (error) { blocked('invalid_patch', `无法读取有效 patch JSON: ${error.message}`); }
  const unexpected = Object.keys(patch).filter((key) => !ALLOWED_TOP_LEVEL.has(key));
  if (unexpected.length) blocked('patch_scope_violation', `Agent patch 只能修改 report/narrative/actions: ${unexpected.join(', ')}`);
  const revised = merge(inputs.spec.value, patch);
  revised.planner = revised.planner || { name: 'rule-planner', version: '1.0', strategy: 'agent-assisted', decisions: [] };
  revised.planner.strategy = 'agent-assisted';
  revised.planner.decisions = [
    ...revised.planner.decisions.filter((item) => item.id !== 'agent-revision'),
    {
      id: 'agent-revision',
      status: 'hypothesis',
      reason_code: 'agent-copy-needs-review',
      validation_needed: '需审阅 Governing Thought、PAC 和行动项是否与 Evidence 和业务语境一致。',
    },
  ];
  await validateSpec(revised, inputs.metrics.value, path.join(root, 'schemas', 'report-spec.schema.json'), inputs.insights.value);
  const output = await writeAtomic(options.out, `${JSON.stringify(revised, null, 2)}\n`, { force: options.force });
  console.log(JSON.stringify({ status: 'DRAFT', output, strategy: revised.planner.strategy }, null, 2));
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'revision_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
