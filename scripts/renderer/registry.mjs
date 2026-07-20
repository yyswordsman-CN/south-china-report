import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocked } from './errors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryPath = path.join(root, 'schemas', 'component-registry.json');

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8'));
} catch (error) {
  blocked('registry_read_failed', `无法读取组件注册表: ${registryPath}`, [error.message]);
}

export const REGISTRY_VERSION = registry.registry_version;
export const COMPONENT_TYPES = new Set(Object.keys(registry.components || {}));
export const REPORT_TYPE_TEMPLATES = new Map(Object.entries(registry.report_types || {}));
export const TEMPLATE_PATHS = new Map(Object.entries(registry.templates || {}).map(
  ([name, relative]) => [name, path.join(root, relative)],
));

export function templateForReportType(reportType) {
  const template = REPORT_TYPE_TEMPLATES.get(reportType);
  if (!template) blocked('unsupported_report_type', `不支持的报告类型: ${reportType}`);
  return template;
}

export function assertTemplateCompatible(reportType, template) {
  const expected = templateForReportType(reportType);
  if (template !== expected) {
    blocked('template_report_type_mismatch', `report.type=${reportType} 必须使用 ${expected}，得到 ${template}`);
  }
}

export function assertRegistryVersion(spec) {
  if (spec.registry_version != null && spec.registry_version !== REGISTRY_VERSION) {
    blocked('registry_version_mismatch', `report-spec registry_version=${spec.registry_version}，Renderer=${REGISTRY_VERSION}`);
  }
}
