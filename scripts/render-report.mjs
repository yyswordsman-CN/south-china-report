#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RendererError, blocked } from './renderer/errors.mjs';
import { loadInputs } from './renderer/load-inputs.mjs';
import { validateSpec } from './renderer/validate-spec.mjs';
import { renderComponents, renderRuntimeScripts } from './renderer/render-components.mjs';
import { renderContracts } from './renderer/render-contracts.mjs';
import { renderTemplate } from './renderer/render-template.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registeredTemplates = new Map([
  ['scroll-narrative', path.join(root, 'templates', 'scroll-narrative-skeleton.html')],
]);

function usage(message) {
  if (message) console.error(message);
  console.error('node scripts/render-report.mjs --metrics metrics.json --insights insights.json --spec report-spec.json --out report.html [--force] [--density compact|standard] [--template scroll-narrative]');
}

function parseArgs(argv) {
  const result = { force: false, template: 'scroll-narrative', density: null };
  const valueFlags = new Set(['--metrics', '--insights', '--spec', '--out', '--density', '--template']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    if (!valueFlags.has(arg)) blocked('invalid_arguments', `未知参数或位置参数: ${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) blocked('invalid_arguments', `${arg} 缺少参数`);
    result[arg.slice(2)] = value;
  }
  for (const key of ['metrics', 'insights', 'spec', 'out']) {
    if (!result[key]) blocked('invalid_arguments', `缺少必填参数 --${key}`);
  }
  if (result.density && !['compact', 'standard'].includes(result.density)) {
    blocked('invalid_arguments', '--density 只接受 compact|standard');
  }
  if (!registeredTemplates.has(result.template)) {
    blocked('unsupported_template', `首版只支持 --template scroll-narrative，得到 ${result.template}`);
  }
  return result;
}

async function packageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string') blocked('invalid_package_version', 'package.json 缺少 version');
  return packageJson.version;
}

export async function renderReport(options) {
  const inputs = await loadInputs({
    metricsPath: options.metrics,
    insightsPath: options.insights,
    specPath: options.spec,
  });
  await validateSpec(inputs.spec.value, inputs.metrics.value, path.join(root, 'schemas', 'report-spec.schema.json'));
  const spec = inputs.spec.value;
  const density = options.density || spec.report.density;
  const rendered = renderComponents(spec, inputs.metrics.value, inputs.insights.value);
  const generatorVersion = await packageVersion();
  const contracts = renderContracts({
    metrics: inputs.metrics.value,
    metricsSha256: inputs.metrics.sha256,
    insightsSha256: inputs.insights.sha256,
    generatorVersion,
    manifest: rendered.manifest,
  });
  const html = await renderTemplate({
    templatePath: registeredTemplates.get(options.template),
    density,
    title: `${spec.report.title} · ${spec.report.subtitle}`,
    contracts,
    content: rendered.html,
    scripts: renderRuntimeScripts(rendered.chartDefinitions),
  });
  const outputPath = await writeAtomic(options.out, html, { force: options.force });
  const outputSha256 = createHash('sha256').update(html).digest('hex');
  return {
    status: 'OK',
    renderer: 'south-china-report',
    renderer_version: generatorVersion,
    schema_version: spec.schema_version,
    template: options.template,
    density,
    output: outputPath,
    output_sha256: outputSha256,
    metrics_sha256: inputs.metrics.sha256,
    insights_sha256: inputs.insights.sha256,
    components: spec.components.length,
    charts: rendered.chartDefinitions.length,
    skipped: rendered.manifest.skipped,
  };
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      usage();
      return;
    }
    const summary = await renderReport(options);
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    if (error instanceof RendererError) {
      console.error(JSON.stringify({
        status: 'BLOCKED',
        reason_code: error.reasonCode,
        message: error.message,
        details: error.details,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    console.error(JSON.stringify({
      status: 'BLOCKED',
      reason_code: 'renderer_internal_error',
      message: error.message,
    }, null, 2));
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) await main();
