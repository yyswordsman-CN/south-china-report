import path from 'node:path';
import {
  existsSync, lstatSync, readFileSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readReleaseProfile() {
  const profilePath = path.join(ROOT, 'release-profile.json');
  let profile;
  try { profile = JSON.parse(readFileSync(profilePath, 'utf8')); }
  catch (error) { throw new Error(`release-profile.json 无法解析: ${error.message}`); }
  if (profile.schema_version !== 1 || profile.skill !== 'south-china-report') {
    throw new Error('release-profile.json 的 schema_version/skill 非法');
  }
  for (const key of ['include', 'exclude_paths', 'exclude_names', 'exclude_suffixes', 'allowed_target_metadata']) {
    if (!Array.isArray(profile[key]) || profile[key].some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`release-profile.json.${key} 必须是非空字符串数组`);
    }
  }
  return profile;
}

function safeRelative(raw) {
  const normalized = String(raw).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`发布路径不安全: ${JSON.stringify(raw)}`);
  }
  return normalized;
}

function shouldExclude(relative, profile) {
  const normalized = relative.replaceAll('\\', '/');
  if (profile.exclude_paths.some((item) => normalized === item || normalized.startsWith(`${item}/`))) return true;
  const parts = normalized.split('/');
  if (parts.some((part) => profile.exclude_names.includes(part))) return true;
  return profile.exclude_suffixes.some((suffix) => normalized.endsWith(suffix));
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

export function collectReleaseFiles(profile = readReleaseProfile()) {
  const files = new Map();
  const visit = (relative) => {
    const safe = safeRelative(relative);
    if (shouldExclude(safe, profile)) return;
    const absolute = path.join(ROOT, safe);
    if (!existsSync(absolute)) throw new Error(`发布清单路径不存在: ${safe}`);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`发布清单禁止符号链接: ${safe}`);
    if (stat.isFile()) {
      files.set(safe, { absolute, sha256: sha256File(absolute), mode: stat.mode & 0o777 });
      return;
    }
    if (!stat.isDirectory()) throw new Error(`发布清单只支持文件/目录: ${safe}`);
    readdirSync(absolute, { withFileTypes: true })
      .map((entry) => entry.name).sort()
      .forEach((name) => visit(`${safe}/${name}`));
  };
  profile.include.map(safeRelative).forEach(visit);
  return files;
}

export function releaseDigest(files) {
  const digest = createHash('sha256');
  [...files.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([relative, file]) => {
    digest.update(`${relative}\0${file.sha256}\n`);
  });
  return digest.digest('hex');
}

export function compareTarget(target, files, profile = readReleaseProfile()) {
  const missing = [];
  const changed = [];
  const extra = [];
  for (const [relative, file] of files) {
    const candidate = path.join(target, relative);
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) missing.push(relative);
    else if (sha256File(candidate) !== file.sha256) changed.push(relative);
  }
  if (existsSync(target)) {
    const visit = (directory, prefix = '') => {
      readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) extra.push(`${relative} (symlink)`);
        else if (entry.isDirectory()) visit(absolute, relative);
        else if (entry.isFile() && !files.has(relative) && !profile.allowed_target_metadata.includes(relative)) extra.push(relative);
      });
    };
    visit(target);
  }
  return { missing, changed, extra, clean: missing.length === 0 && changed.length === 0 && extra.length === 0 };
}
