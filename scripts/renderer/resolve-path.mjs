import { blocked } from './errors.mjs';

export const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function splitSafePath(rawPath, label = 'path') {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    blocked('invalid_path', `${label} 必须是非空点分路径`);
  }
  const parts = rawPath.split('.');
  if (parts.some((part) => !part || /\s/.test(part))) {
    blocked('invalid_path', `${label} 不是合法点分路径: ${JSON.stringify(rawPath)}`);
  }
  const dangerous = parts.find((part) => DANGEROUS_KEYS.has(part));
  if (dangerous) {
    blocked('unsafe_path', `${label} 禁止访问原型链键 ${JSON.stringify(dangerous)}`);
  }
  return parts;
}

export function resolvePath(root, rawPath, { label = 'path', allowNull = false } = {}) {
  const parts = splitSafePath(rawPath, label);
  let cursor = root;
  for (const part of parts) {
    if (cursor == null || (typeof cursor !== 'object' && !Array.isArray(cursor))) {
      blocked('unresolved_path', `${label} 无法解析: ${rawPath}`);
    }
    const key = Array.isArray(cursor) && /^\d+$/.test(part) ? Number(part) : part;
    if (!Object.prototype.hasOwnProperty.call(cursor, key)) {
      blocked('unresolved_path', `${label} 不存在: ${rawPath}`);
    }
    cursor = cursor[key];
  }
  if (cursor === undefined || (!allowNull && cursor === null)) {
    blocked('unresolved_path', `${label} 解析为空: ${rawPath}`);
  }
  return cursor;
}

export function parseEvidencePath(rawPath) {
  const parts = splitSafePath(rawPath, 'evidence path');
  const file = parts.shift();
  if (!['metrics', 'insights'].includes(file) || parts.length === 0) {
    blocked('invalid_evidence_path', `Evidence 只允许 metrics|insights 点分路径: ${rawPath}`);
  }
  return { file, path: parts.join('.') };
}

export function walkOwnValues(value, visitor, path = '$', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) blocked('cyclic_input', `输入包含循环引用: ${path}`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) blocked('unsafe_key', `输入禁止原型链键: ${path}.${key}`);
    visitor(child, `${path}.${key}`, key);
    walkOwnValues(child, visitor, `${path}.${key}`, seen);
  }
  seen.delete(value);
}
