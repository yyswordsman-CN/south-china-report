import { blocked } from './errors.mjs';
import { parseEvidencePath, resolvePath } from './resolve-path.mjs';

export function createBindingManifest(metrics, insights) {
  return {
    roots: { metrics, insights },
    claims: new Map(),
    domMetrics: [],
    charts: [],
    keyMetricPaths: new Set(),
    skipped: [],
  };
}

export function evidenceId(prefix, rawId, kind) {
  const normalized = String(rawId).replace(/[^A-Za-z0-9_-]/g, '-').toUpperCase();
  return `${kind === 'hypothesis' ? 'H' : 'E'}-${prefix}-${normalized}`.slice(0, 64);
}

export function addClaim(manifest, { id, kind, evidence = [], reason, validation_needed: validationNeeded }) {
  if (manifest.claims.has(id)) blocked('duplicate_claim_id', `Evidence claim.id 重复: ${id}`);
  let claim;
  if (kind === 'hypothesis') {
    if (!reason || !validationNeeded) blocked('invalid_hypothesis', `${id} hypothesis 必须写 reason 与 validation_needed`);
    claim = { id, kind, reason, validation_needed: validationNeeded };
  } else {
    if (!Array.isArray(evidence) || evidence.length === 0) blocked('missing_evidence', `${id} 必须绑定 Evidence`);
    const sources = evidence.map((rawPath) => {
      const source = parseEvidencePath(rawPath);
      resolvePath(manifest.roots[source.file], source.path, { label: `${id} evidence` });
      return source;
    });
    claim = { id, kind, sources };
  }
  manifest.claims.set(id, claim);
  return id;
}

export function claimAttributes(claimId, kind) {
  return `data-evidence-id="${claimId}"${kind === 'hypothesis' ? ' data-claim-kind="hypothesis"' : ''}`;
}

export function addDomMetric(manifest, path, { key = false } = {}) {
  const value = resolvePath(manifest.roots.metrics, path, { label: `DOM metric ${path}` });
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    blocked('non_numeric_metric', `DOM metric 必须是有限数值: ${path}`);
  }
  manifest.domMetrics.push(path);
  if (key) manifest.keyMetricPaths.add(path);
}

export function addChart(manifest, chart) {
  if (manifest.charts.some((item) => item.id === chart.id)) blocked('duplicate_chart_id', `图表 ID 重复: ${chart.id}`);
  for (const series of chart.series) {
    for (const path of series.metrics || []) {
      const value = resolvePath(manifest.roots.metrics, path, { label: `runtime metric ${path}` });
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        blocked('non_numeric_runtime_metric', `Runtime metric 必须是有限数值: ${path}`);
      }
    }
  }
  manifest.charts.push(chart);
}

export function addSkipped(manifest, component, reasonCode) {
  manifest.skipped.push({ component_id: component.id, component_type: component.type, reason_code: reasonCode });
}

export function evidenceContract(manifest) {
  return { version: 1, claims: [...manifest.claims.values()] };
}

export function runtimeContract(manifest) {
  if (manifest.charts.length === 0) return null;
  return { version: 2, charts: manifest.charts };
}
