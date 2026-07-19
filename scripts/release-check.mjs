#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, collectReleaseFiles, readReleaseProfile, releaseDigest } from './release-lib.mjs';

const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const profile = readReleaseProfile();
const files = collectReleaseFiles(profile);
const issues = [];
const version = pkg.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) issues.push(`package version 非 SemVer: ${version}`);
if (lock.version !== version || lock.packages?.['']?.version !== version) issues.push('package-lock 两处版本与 package.json 不一致');
for (const relative of ['SKILL.md', 'README.md', 'USAGE-GUIDE.md', 'CHANGELOG.md']) {
  if (!read(relative).includes(`V${version}`)) issues.push(`${relative} 未声明当前版本 V${version}`);
}
const skill = read('SKILL.md');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
if (!frontmatter) issues.push('SKILL.md 缺少合法 frontmatter 边界');
else {
  const nameMatches = frontmatter[1].match(/^name:\s*(.+)$/m);
  const descriptionMatches = frontmatter[1].match(/^description:\s*(.+)$/m);
  if (!nameMatches || nameMatches[1].trim() !== 'south-china-report') issues.push('SKILL.md frontmatter.name 必须是 south-china-report');
  if (!descriptionMatches || descriptionMatches[1].replace(/^['"]|['"]$/g, '').trim().length < 80) issues.push('SKILL.md description 过短或缺失');
}
for (const critical of [
  'scripts/prep-source.py', 'scripts/validate-report.mjs', 'scripts/verify-numbers.mjs',
  'scripts/verify-runtime.mjs', 'scripts/snapshot.mjs', 'scripts/install-skill.mjs',
  'references/runtime-metrics-contract.md', 'references/release-process.md',
  '.github/workflows/ci.yml', 'templates/scroll-narrative-skeleton.html',
  'templates/bento-brief.html', 'templates/audit-pack.html', 'tests/test_multisource_e2e.py',
]) if (!files.has(critical)) issues.push(`发布清单遗漏关键文件: ${critical}`);

if (issues.length) {
  console.error(`✗ release check 失败: ${issues.length} 项`);
  issues.forEach((issue) => console.error(`  - ${issue}`));
  process.exit(1);
}
console.log(`✓ release check 通过: V${version}, ${files.size} files, digest=${releaseDigest(files)}`);
