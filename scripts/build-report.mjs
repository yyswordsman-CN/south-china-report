#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUMMARY_FILE = 'build-summary.json';
const MAX_CHILD_OUTPUT = 64 * 1024 * 1024;

class BuildError extends Error {
  constructor(reasonCode, message, { status = 'BLOCKED', exitCode = 2, details = [] } = {}) {
    super(message);
    this.name = 'BuildError';
    this.reasonCode = reasonCode;
    this.status = status;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function blocked(reasonCode, message, details = []) {
  throw new BuildError(reasonCode, message, { details });
}

function usage() {
  return 'node scripts/build-report.mjs --metrics metrics.json --insights insights.json --spec report-spec.json --out-dir report-build [--force] [--density compact|standard] [--template scroll-narrative] [--skip-snapshot]';
}

function parseArgs(argv) {
  const result = {
    force: false,
    skipSnapshot: false,
    density: null,
    template: 'scroll-narrative',
  };
  const valueFlags = new Set(['--metrics', '--insights', '--spec', '--out-dir', '--density', '--template']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--force') {
      result.force = true;
      continue;
    }
    if (arg === '--skip-snapshot') {
      result.skipSnapshot = true;
      continue;
    }
    if (!valueFlags.has(arg)) blocked('invalid_arguments', `未知参数或位置参数: ${arg}`, [usage()]);
    const value = argv[++index];
    if (!value || value.startsWith('--')) blocked('invalid_arguments', `${arg} 缺少参数`, [usage()]);
    const key = arg === '--out-dir' ? 'outDir' : arg.slice(2);
    result[key] = value;
  }
  for (const key of ['metrics', 'insights', 'spec', 'outDir']) {
    if (!result[key]) blocked('invalid_arguments', `缺少必填参数 --${key === 'outDir' ? 'out-dir' : key}`, [usage()]);
  }
  if (result.density && !['compact', 'standard'].includes(result.density)) {
    blocked('invalid_arguments', '--density 只接受 compact|standard');
  }
  if (result.template !== 'scroll-narrative') {
    blocked('unsupported_template', `首版只支持 --template scroll-narrative，得到 ${result.template}`);
  }
  return result;
}

function sha256Buffer(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

function fileFingerprint(filePath) {
  const payload = readFileSync(filePath);
  return { sha256: sha256Buffer(payload), bytes: payload.length };
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function excerpt(value, limit = 8) {
  const lines = stripAnsi(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-limit);
}

function tryParseJson(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function parseValidatorSummary(stdout) {
  const text = stripAnsi(stdout);
  const match = text.match(/PASS\s*:\s*(\d+)\s*\|\s*INFO\s*:\s*(\d+)\s*\|\s*WARN\s*:\s*(\d+)\s*\|\s*FAIL\s*:\s*(\d+)/);
  return match ? {
    pass: Number(match[1]), info: Number(match[2]), warn: Number(match[3]), fail: Number(match[4]),
  } : { messages: excerpt(text) };
}

function parseStepSummary(id, stdout, stderr) {
  const text = stripAnsi(`${stdout}\n${stderr}`);
  if (id === 'render') return tryParseJson(stdout) || tryParseJson(stderr) || { messages: excerpt(text) };
  if (id === 'validate-online' || id === 'validate-offline') return parseValidatorSummary(stdout);
  if (id === 'verify-numbers') {
    const bindings = text.match(/数字绑定:\s*(\d+)\s*处全部匹配/);
    const coverage = text.match(/可见数字覆盖:\s*(\d+)\/(\d+).*覆盖率\s*([\d.]+)%/);
    return {
      bindings: bindings ? Number(bindings[1]) : null,
      visible_numeric_nodes: coverage ? Number(coverage[2]) : null,
      covered_numeric_nodes: coverage ? Number(coverage[1]) : null,
      coverage_percent: coverage ? Number(coverage[3]) : null,
      messages: excerpt(text, 3),
    };
  }
  if (id === 'make-offline') {
    const match = text.match(/\[PASS\]\s+离线版已写出:\s+(.+?)\s+\(([^)]+)\)/);
    return match ? { output: match[1], size: match[2] } : { messages: excerpt(text) };
  }
  if (id === 'verify-runtime') {
    const dom = text.match(/运行时 DOM:\s*(\d+)\s*处 data-metric，(\d+)\s*个可见数字文本节点/);
    const charts = text.match(/ECharts 运行时:\s*(\d+)\s*张图，(\d+)\s*个业务数值叶子匹配/);
    return {
      bindings: dom ? Number(dom[1]) : null,
      visible_numeric_nodes: dom ? Number(dom[2]) : null,
      charts: charts ? Number(charts[1]) : null,
      chart_metric_leaves: charts ? Number(charts[2]) : null,
      messages: excerpt(text, 3),
    };
  }
  if (id === 'snapshot') {
    const viewports = [...text.matchAll(/\[PASS\]\s+(desktop-1440|desktop-1360|mobile-430|mobile-390):/g)].map((match) => match[1]);
    return { verified_viewports: viewports, messages: excerpt(text, 6) };
  }
  return { messages: excerpt(text) };
}

function displayCommand(args, stagingDir) {
  return ['node', ...args.map((value) => {
    const absolute = path.resolve(String(value));
    if (absolute === stagingDir) return '$BUILD_DIR';
    if (absolute.startsWith(`${stagingDir}${path.sep}`)) {
      return `$BUILD_DIR/${path.relative(stagingDir, absolute).split(path.sep).join('/')}`;
    }
    return String(value);
  })];
}

function normalizeStageReferences(value, stagingDir) {
  if (typeof value === 'string') return value.split(stagingDir).join('$BUILD_DIR');
  if (Array.isArray(value)) return value.map((item) => normalizeStageReferences(item, stagingDir));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeStageReferences(item, stagingDir)]));
  }
  return value;
}

function stepReason(id, exitCode, stdout, stderr) {
  if (id === 'render') {
    const payload = tryParseJson(stderr) || tryParseJson(stdout);
    if (payload?.reason_code) return payload.reason_code;
  }
  if (exitCode === 3) return id === 'snapshot' ? 'snapshot_unverified' : 'runtime_unverified';
  return {
    'validate-online': 'online_validator_failed',
    'verify-numbers': 'number_verification_failed',
    'make-offline': 'offline_build_failed',
    'validate-offline': 'strict_offline_validator_failed',
    'verify-runtime': 'runtime_verification_failed',
    snapshot: 'snapshot_failed',
  }[id] || 'gate_failed';
}

function runStep({ stagingDir, summary }, definition) {
  const index = summary.steps.length + 1;
  const prefix = String(index).padStart(2, '0');
  const stdoutLog = `logs/${prefix}-${definition.id}.stdout.log`;
  const stderrLog = `logs/${prefix}-${definition.id}.stderr.log`;
  console.error(`[RUN] ${definition.id}: ${definition.label}`);
  const result = spawnSync(process.execPath, definition.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_CHILD_OUTPUT,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || (result.error ? `${result.error.message}\n` : '');
  writeFileSync(path.join(stagingDir, stdoutLog), stdout);
  writeFileSync(path.join(stagingDir, stderrLog), stderr);
  const exitCode = Number.isInteger(result.status) ? result.status : 2;
  const status = exitCode === 0 ? 'OK' : (exitCode === 3 ? 'UNVERIFIED' : 'BLOCKED');
  const reasonCode = exitCode === 0 ? null : stepReason(definition.id, exitCode, stdout, stderr);
  const record = {
    id: definition.id,
    label: definition.label,
    status,
    exit_code: exitCode,
    reason_code: reasonCode,
    command: displayCommand(definition.args, stagingDir),
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    summary: normalizeStageReferences(parseStepSummary(definition.id, stdout, stderr), stagingDir),
  };
  summary.steps.push(record);
  if (exitCode === 0) {
    console.error(`[PASS] ${definition.id}`);
    return record;
  }
  console.error(`[${status}] ${definition.id}: ${reasonCode}`);
  throw new BuildError(reasonCode, `${definition.label}未通过`, {
    status,
    exitCode: status === 'UNVERIFIED' ? 3 : 2,
    details: excerpt(`${stdout}\n${stderr}`, 12),
  });
}

function addSkippedSnapshot({ stagingDir, summary }) {
  const stdoutLog = 'logs/07-snapshot.stdout.log';
  const stderrLog = 'logs/07-snapshot.stderr.log';
  const message = '[UNVERIFIED] 按 --skip-snapshot 跳过截图与四视口验证；该目录不得标记为可交付成品。\n';
  writeFileSync(path.join(stagingDir, stdoutLog), message);
  writeFileSync(path.join(stagingDir, stderrLog), '');
  summary.steps.push({
    id: 'snapshot',
    label: '四视口截图、布局与无障碍 Gate',
    status: 'SKIPPED',
    exit_code: null,
    reason_code: 'snapshot_skipped_by_request',
    command: null,
    stdout_log: stdoutLog,
    stderr_log: stderrLog,
    summary: { messages: [message.trim()] },
  });
}

function artifactInventory(directory) {
  const candidates = ['report.html', 'report.offline.html'];
  const shots = path.join(directory, 'shots');
  if (existsSync(shots)) {
    for (const name of readdirSync(shots).sort()) {
      const relative = `shots/${name}`;
      if (statSync(path.join(directory, relative)).isFile()) candidates.push(relative);
    }
  }
  return candidates.filter((relative) => existsSync(path.join(directory, relative))).map((relative) => ({
    path: relative,
    ...fileFingerprint(path.join(directory, relative)),
  }));
}

function writeSummary(directory, summary) {
  writeFileSync(path.join(directory, SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`);
}

function diagnosticPath(target) {
  const parent = path.dirname(target);
  const base = path.basename(target);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = path.join(parent, `${base}.failed-${stamp}-${process.pid}`);
  let suffix = 1;
  while (existsSync(candidate)) candidate = path.join(parent, `${base}.failed-${stamp}-${process.pid}-${suffix++}`);
  return candidate;
}

function retainDiagnostics(stagingDir, target, summary) {
  const destination = diagnosticPath(target);
  try {
    renameSync(stagingDir, destination);
    summary.diagnostics_dir = destination;
    writeSummary(destination, summary);
    return destination;
  } catch (error) {
    summary.diagnostics_dir = stagingDir;
    summary.diagnostic_warning = `诊断目录重命名失败，保留原 staging: ${error.message}`;
    writeSummary(stagingDir, summary);
    return stagingDir;
  }
}

function publishDirectory(stagingDir, target, { force }) {
  let backup = null;
  if (existsSync(target)) {
    if (!force) blocked('output_exists', `输出目录已存在，拒绝覆盖: ${target}`);
    backup = path.join(path.dirname(target), `.${path.basename(target)}.previous-${process.pid}-${Date.now()}`);
    renameSync(target, backup);
  }
  try {
    renameSync(stagingDir, target);
  } catch (error) {
    if (backup && existsSync(backup) && !existsSync(target)) renameSync(backup, target);
    throw new BuildError('publish_failed', `最终目录原子发布失败: ${error.message}`);
  }
  if (backup && existsSync(backup)) {
    try {
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      console.error(`[WARN] 新目录已发布，但旧目录备份清理失败: ${backup} (${error.message})`);
    }
  }
}

function assertSafeOutput(options) {
  const target = path.resolve(options.outDir);
  if (target === path.parse(target).root) blocked('unsafe_output', '拒绝将文件系统根目录作为 --out-dir');
  if (existsSync(target) && !statSync(target).isDirectory()) {
    blocked('output_not_directory', `--out-dir 已存在且不是目录: ${target}`);
  }
  const comparableTarget = existsSync(target) ? realpathSync(target) : target;
  for (const [label, raw] of [['metrics', options.metrics], ['insights', options.insights], ['spec', options.spec]]) {
    const input = path.resolve(raw);
    if (input === comparableTarget || input.startsWith(`${comparableTarget}${path.sep}`)) {
      blocked('output_contains_input', `--out-dir 包含 ${label} 输入，拒绝可能删除或覆盖真源: ${target}`);
    }
  }
  if (existsSync(target) && !options.force) blocked('output_exists', `输出目录已存在，拒绝覆盖: ${target}（如确认替换，显式传 --force）`);
  return target;
}

function packageVersion() {
  return JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
}

function machineResult(summary) {
  return {
    status: summary.status,
    delivery_ready: summary.delivery_ready,
    reason_code: summary.reason_code,
    published_output_dir: summary.published_output_dir,
    diagnostics_dir: summary.diagnostics_dir,
    summary_file: summary.published_output_dir
      ? path.join(summary.published_output_dir, SUMMARY_FILE)
      : (summary.diagnostics_dir ? path.join(summary.diagnostics_dir, SUMMARY_FILE) : null),
  };
}

export function buildReport(options) {
  const target = assertSafeOutput(options);
  const parent = path.dirname(target);
  mkdirSync(parent, { recursive: true });
  const stagingDir = mkdtempSync(path.join(parent, `.${path.basename(target)}.staging-`));
  mkdirSync(path.join(stagingDir, 'logs'));

  const metrics = path.resolve(options.metrics);
  const insights = path.resolve(options.insights);
  const spec = path.resolve(options.spec);
  const online = path.join(stagingDir, 'report.html');
  const offline = path.join(stagingDir, 'report.offline.html');
  const shots = path.join(stagingDir, 'shots');
  const summary = {
    schema_version: 1,
    build_tool: { name: 'south-china-report', version: packageVersion(), phase: 'R3' },
    status: 'RUNNING',
    delivery_ready: false,
    reason_code: null,
    requested_output_dir: target,
    published_output_dir: null,
    diagnostics_dir: null,
    inputs: {
      metrics: { path: metrics },
      insights: { path: insights },
      spec: { path: spec },
    },
    outputs: [],
    steps: [],
    publish: { status: 'NOT_PUBLISHED', atomic_directory_rename: true, force: options.force },
  };
  const context = { stagingDir, summary };

  try {
    const renderArgs = [
      path.join(ROOT, 'scripts', 'render-report.mjs'),
      '--metrics', metrics,
      '--insights', insights,
      '--spec', spec,
      '--out', online,
      '--template', options.template,
    ];
    if (options.density) renderArgs.push('--density', options.density);
    const render = runStep(context, { id: 'render', label: '确定性 Renderer', args: renderArgs });
    summary.inputs.metrics.sha256 = render.summary.metrics_sha256;
    summary.inputs.insights.sha256 = render.summary.insights_sha256;
    summary.inputs.spec.sha256 = fileFingerprint(spec).sha256;

    runStep(context, {
      id: 'validate-online',
      label: '在线版结构与 Evidence Gate',
      args: [path.join(ROOT, 'scripts', 'validate-report.mjs'), online],
    });
    runStep(context, {
      id: 'verify-numbers',
      label: '静态数字与双 SHA Gate',
      args: [path.join(ROOT, 'scripts', 'verify-numbers.mjs'), online, metrics, '--insights', insights],
    });
    runStep(context, {
      id: 'make-offline',
      label: '严格离线单文件构建',
      args: [path.join(ROOT, 'scripts', 'make-offline.mjs'), online, '--out', offline],
    });
    runStep(context, {
      id: 'validate-offline',
      label: '严格离线结构复检',
      args: [path.join(ROOT, 'scripts', 'validate-report.mjs'), offline, '--strict-offline'],
    });
    runStep(context, {
      id: 'verify-runtime',
      label: '运行时 DOM 与 ECharts 真值 Gate',
      args: [path.join(ROOT, 'scripts', 'verify-runtime.mjs'), offline, metrics],
    });

    if (options.skipSnapshot) {
      addSkippedSnapshot(context);
      summary.status = 'UNVERIFIED';
      summary.reason_code = 'snapshot_skipped_by_request';
      summary.delivery_ready = false;
    } else {
      runStep(context, {
        id: 'snapshot',
        label: '四视口截图、布局与无障碍 Gate',
        args: [path.join(ROOT, 'scripts', 'snapshot.mjs'), offline, shots],
      });
      summary.status = 'OK';
      summary.delivery_ready = true;
    }

    summary.outputs = artifactInventory(stagingDir);
    summary.published_output_dir = target;
    summary.publish.status = options.skipSnapshot ? 'PUBLISHED_UNVERIFIED' : 'PUBLISHED';
    writeSummary(stagingDir, summary);
    publishDirectory(stagingDir, target, { force: options.force });
    return { summary, exitCode: options.skipSnapshot ? 3 : 0 };
  } catch (error) {
    const buildError = error instanceof BuildError
      ? error
      : new BuildError('build_internal_error', error.message || String(error));
    summary.status = buildError.status;
    summary.delivery_ready = false;
    summary.reason_code = buildError.reasonCode;
    summary.published_output_dir = null;
    summary.error = { message: buildError.message, details: buildError.details };
    summary.outputs = artifactInventory(stagingDir);
    summary.publish.status = 'NOT_PUBLISHED';
    writeSummary(stagingDir, summary);
    retainDiagnostics(stagingDir, target, summary);
    return { summary, exitCode: buildError.exitCode };
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const result = buildReport(options);
    console.log(JSON.stringify(machineResult(result.summary), null, 2));
    process.exitCode = result.exitCode;
  } catch (error) {
    const buildError = error instanceof BuildError
      ? error
      : new BuildError('build_internal_error', error.message || String(error));
    const summary = {
      status: buildError.status,
      delivery_ready: false,
      reason_code: buildError.reasonCode,
      published_output_dir: null,
      diagnostics_dir: null,
      error: { message: buildError.message, details: buildError.details },
    };
    console.log(JSON.stringify(machineResult(summary), null, 2));
    process.exitCode = buildError.exitCode;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
