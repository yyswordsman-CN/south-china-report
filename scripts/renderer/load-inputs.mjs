import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { blocked } from './errors.mjs';
import { walkOwnValues } from './resolve-path.mjs';

function sha256(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

async function loadJson(filePath, label) {
  let payload;
  try {
    payload = await readFile(filePath);
  } catch (error) {
    blocked('input_read_failed', `无法读取 ${label}: ${filePath}`, [error.message]);
  }
  let value;
  try {
    value = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    blocked('invalid_json', `${label} 不是有效 JSON: ${filePath}`, [error.message]);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    blocked('invalid_json_root', `${label} 顶层必须是对象: ${filePath}`);
  }
  walkOwnValues(value, () => {});
  return { path: path.resolve(filePath), payload, value, sha256: sha256(payload) };
}

export async function loadInputs({ metricsPath, insightsPath, specPath }) {
  const [metrics, insights, spec] = await Promise.all([
    loadJson(metricsPath, 'metrics.json'),
    loadJson(insightsPath, 'insights.json'),
    loadJson(specPath, 'report-spec.json'),
  ]);

  const status = metrics.value?.data_status?.status;
  if (status === 'BLOCKED') {
    blocked('metrics_blocked', 'metrics.json 的 data_status=BLOCKED，Renderer 不生成报告', metrics.value.data_status.errors || []);
  }
  if (metrics.value?.schema_version !== '1.0') {
    blocked('metrics_schema_mismatch', 'metrics.schema_version 必须为 1.0');
  }
  if (insights.value?.schema_version !== '1.0') {
    blocked('insights_schema_mismatch', 'insights.schema_version 必须为 1.0');
  }
  if (insights.value?.meta?.metrics_sha256 !== metrics.sha256) {
    blocked('insights_metrics_sha_mismatch', 'insights.meta.metrics_sha256 与实际 metrics.json 不一致');
  }

  return { metrics, insights, spec };
}
