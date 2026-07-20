import { blocked } from './errors.mjs';
import { evidenceContract, runtimeContract } from './binding-manifest.mjs';
import { safeJsonForScript } from './format-value.mjs';
import { resolvePath } from './resolve-path.mjs';

function requireHex(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) blocked('invalid_provenance', `${label} 必须是 64 位 SHA-256`);
  return value;
}

function reportMeta({ metrics, metricsSha256, insightsSha256, generatorVersion, manifest }) {
  const sourcePath = metrics.meta?.source_path;
  const sourceSha256 = metrics.meta?.source_sha256;
  const lock = metrics.meta?.period_lock;
  const reportMode = metrics.analysis_scope?.mode || metrics.meta?.analysis_mode || 'period';
  if (!sourcePath || !sourceSha256) blocked('invalid_provenance', 'metrics.meta.source_path/source_sha256 为 Renderer 必填');
  if (!['period', 'snapshot'].includes(reportMode)) {
    blocked('unsupported_report_mode', `Renderer 只支持 period|snapshot，得到 ${reportMode}`);
  }
  let requestedPeriod;
  let dataCutoff;
  if (reportMode === 'snapshot') {
    requestedPeriod = 'snapshot';
    dataCutoff = {
      data_as_of: null,
      comparison_as_of: null,
      completeness: 'snapshot',
      like_for_like: false,
    };
  } else {
    if (!lock?.label || !lock?.data_as_of || !lock?.comparison_as_of) {
      blocked('invalid_period_meta', 'period 模式必须提供 period_lock 的期间与比较截止');
    }
    const completeness = lock.completeness === 'partial' ? 'partial_same_cutoff' : lock.completeness;
    if (!['complete', 'partial_same_cutoff'].includes(completeness) || lock.like_for_like !== true) {
      blocked('invalid_data_cutoff', 'period_lock 必须提供 complete|partial_same_cutoff 且 like_for_like=true');
    }
    requestedPeriod = lock.label;
    dataCutoff = {
      data_as_of: lock.data_as_of,
      comparison_as_of: lock.comparison_as_of,
      completeness,
      like_for_like: true,
    };
  }
  const keyMetrics = {};
  for (const metricPath of manifest.keyMetricPaths) {
    keyMetrics[metricPath] = resolvePath(metrics, metricPath, { label: `key metric ${metricPath}` });
  }
  if (Object.keys(keyMetrics).length === 0) blocked('missing_key_metrics', 'Renderer 至少需要一个 key metric');

  const source = {
    path: sourcePath,
    sha256: requireHex(sourceSha256, 'source.sha256'),
  };
  for (const [metaKey, outputKey] of [
    ['result_snapshot_rows', 'result_snapshot_rows'],
    ['result_schema_sha256', 'result_schema_sha256'],
    ['result_snapshot_sha256', 'result_snapshot_sha256'],
  ]) {
    if (metrics.meta?.[metaKey] != null) source[outputKey] = metrics.meta[metaKey];
  }
  return {
    schema_version: '1.0',
    generator: { name: 'south-china-report', version: generatorVersion },
    requested_period: requestedPeriod,
    data_cutoff: dataCutoff,
    source,
    report_mode: reportMode,
    key_metrics: keyMetrics,
    metrics_sha256: requireHex(metricsSha256, 'metrics_sha256'),
    insights_sha256: requireHex(insightsSha256, 'insights_sha256'),
  };
}

export function renderContracts(context) {
  const meta = reportMeta(context);
  const evidence = evidenceContract(context.manifest);
  if (!evidence.claims.length) blocked('missing_evidence', 'Evidence contract claims 不能为空');
  const runtime = runtimeContract(context.manifest);
  const scripts = [
    `<script type="application/json" id="south-china-report-meta">${safeJsonForScript(meta, 2)}</script>`,
    `<script type="application/json" id="south-china-report-evidence-contract">${safeJsonForScript(evidence, 2)}</script>`,
  ];
  if (runtime) {
    scripts.push(`<script type="application/json" id="south-china-report-runtime-contract">${safeJsonForScript(runtime, 2)}</script>`);
  }
  return scripts.join('\n');
}
