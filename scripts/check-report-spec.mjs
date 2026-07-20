#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererError, blocked } from './renderer/errors.mjs';
import { loadInputs } from './renderer/load-inputs.mjs';
import { validateSpec } from './renderer/validate-spec.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (!['--metrics', '--insights', '--spec'].includes(arg) || !value) blocked('invalid_arguments', '需要 --metrics --insights --spec');
    options[arg.slice(2)] = value;
  }
  for (const key of ['metrics', 'insights', 'spec']) if (!options[key]) blocked('invalid_arguments', `缺少 --${key}`);
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const inputs = await loadInputs({ metricsPath: options.metrics, insightsPath: options.insights, specPath: options.spec });
  await validateSpec(
    inputs.spec.value,
    inputs.metrics.value,
    path.join(root, 'schemas', 'report-spec.schema.json'),
    inputs.insights.value,
  );
  console.log(JSON.stringify({
    status: 'VALID',
    lifecycle: inputs.spec.value.lifecycle?.status || 'legacy-final',
    schema_version: inputs.spec.value.schema_version,
    registry_version: inputs.spec.value.registry_version || 'legacy',
  }, null, 2));
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'spec_check_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
