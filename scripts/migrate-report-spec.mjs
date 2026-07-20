#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { RendererError, blocked } from './renderer/errors.mjs';
import { REGISTRY_VERSION } from './renderer/registry.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';
import { loadInputs } from './renderer/load-inputs.mjs';
import { validateSpec } from './renderer/validate-spec.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  for (const key of ['metrics', 'insights', 'spec', 'out', 'reviewedBy', 'reviewedAt']) if (!options[key]) blocked('invalid_arguments', `缺少 ${key}`);
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  let spec;
  try { spec = JSON.parse(await readFile(options.spec, 'utf8')); }
  catch (error) { blocked('invalid_json', `无法读取 report-spec: ${error.message}`); }
  const from = spec.registry_version || 'legacy';
  if (from !== 'legacy' && from !== REGISTRY_VERSION) blocked('unsupported_registry_migration', `不支持 ${from} -> ${REGISTRY_VERSION}`);
  const migrated = structuredClone(spec);
  migrated.registry_version = REGISTRY_VERSION;
  migrated.lifecycle = migrated.lifecycle || {
    status: 'final',
    reviewed_by: options.reviewedBy,
    reviewed_at: options.reviewedAt,
  };
  const inputs = await loadInputs({ metricsPath: options.metrics, insightsPath: options.insights, specPath: options.spec });
  await validateSpec(migrated, inputs.metrics.value, path.join(root, 'schemas', 'report-spec.schema.json'), inputs.insights.value);
  const output = await writeAtomic(options.out, `${JSON.stringify(migrated, null, 2)}\n`, { force: options.force });
  console.log(JSON.stringify({ status: 'MIGRATED', from, to: REGISTRY_VERSION, changed: from !== REGISTRY_VERSION, output }, null, 2));
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'migration_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
