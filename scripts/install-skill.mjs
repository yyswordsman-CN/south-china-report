#!/usr/bin/env node
/**
 * 安全安装/同步：默认只读比较；--apply 采用 staging + 原子替换并保留旧目录备份。
 *
 * node scripts/install-skill.mjs --target /path/south-china-report --dry-run
 * node scripts/install-skill.mjs --target /path/south-china-report --check
 * node scripts/install-skill.mjs --target /path/south-china-report --apply
 */
import path from 'node:path';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import {
  ROOT, collectReleaseFiles, compareTarget, readReleaseProfile, releaseDigest,
} from './release-lib.mjs';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const targetIndex = argv.indexOf('--target');
const modes = ['--dry-run', '--check', '--apply'].filter((flag) => argv.includes(flag));
if (targetIndex < 0 || !argv[targetIndex + 1] || modes.length !== 1 || argv.length !== 3) {
  console.error('用法: node scripts/install-skill.mjs --target <.../south-china-report> --dry-run|--check|--apply');
  process.exit(2);
}

const mode = modes[0];
const target = path.resolve(argv[targetIndex + 1]);
if (path.basename(target) !== 'south-china-report') {
  console.error('安全拒绝: 安装目标目录名必须严格为 south-china-report:', target);
  process.exit(2);
}
if (target === ROOT || target.startsWith(`${ROOT}${path.sep}`) || ROOT.startsWith(`${target}${path.sep}`)) {
  console.error('安全拒绝: 源目录和目标目录不得相同或互相嵌套');
  process.exit(2);
}

let profile;
let files;
try {
  profile = readReleaseProfile();
  files = collectReleaseFiles(profile);
} catch (error) {
  console.error('发布清单无效:', error.message);
  process.exit(2);
}
const digest = releaseDigest(files);
const comparison = compareTarget(target, files, profile);
const show = (label, values) => {
  if (values.length === 0) return;
  console.log(`${label} ${values.length}:`);
  values.slice(0, 30).forEach((value) => console.log(`  - ${value}`));
  if (values.length > 30) console.log(`  - 其余 ${values.length - 30} 项省略`);
};

console.log(`发布源: ${ROOT}`);
console.log(`安装目标: ${target}`);
console.log(`清单文件: ${files.size}，digest=${digest}`);
show('缺失', comparison.missing);
show('变更', comparison.changed);
show('额外', comparison.extra);

if (mode === '--check') {
  if (!existsSync(target) || !comparison.clean) {
    console.error('✗ 安装副本与发布真源不一致');
    process.exit(1);
  }
  console.log('✓ 安装副本与发布真源逐文件一致');
  process.exit(0);
}

if (mode === '--dry-run') {
  console.log(comparison.clean ? '✓ dry-run: 无需同步' : '△ dry-run: 检出漂移；未写入任何文件');
  process.exit(0);
}

const parent = path.dirname(target);
mkdirSync(parent, { recursive: true });
const staging = mkdtempSync(path.join(parent, '.south-china-report.staging-'));
let backup = null;
let published = false;
let replacementPlaced = false;
try {
  for (const [relative, file] of files) {
    const destination = path.join(staging, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(file.absolute, destination);
    chmodSync(destination, file.mode);
  }
  const version = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  writeFileSync(path.join(staging, '.south-china-report-install.json'), `${JSON.stringify({
    schema_version: 1,
    skill: 'south-china-report',
    version,
    release_digest: digest,
    installed_at: new Date().toISOString(),
  }, null, 2)}\n`);
  if (existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backup = path.join(parent, `.south-china-report.backup-${stamp}`);
    renameSync(target, backup);
  }
  renameSync(staging, target);
  replacementPlaced = true;
  const after = compareTarget(target, files, profile);
  if (!after.clean) throw new Error('发布后逐文件复检未通过');
  published = true;
  console.log(`✓ 已原子安装 south-china-report ${version}`);
  if (backup) console.log(`旧安装可恢复备份: ${backup}`);
} catch (error) {
  let restored = false;
  if (backup && existsSync(backup)) {
    if (replacementPlaced && existsSync(target)) {
      const failed = path.join(parent, `.south-china-report.failed-${Date.now()}`);
      renameSync(target, failed);
    }
    if (!existsSync(target)) {
      renameSync(backup, target);
      restored = true;
    }
  }
  console.error(`✗ 安装失败${restored ? '，旧副本已恢复' : ''}:`, error.message);
  process.exitCode = 1;
} finally {
  if (!published && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
}
