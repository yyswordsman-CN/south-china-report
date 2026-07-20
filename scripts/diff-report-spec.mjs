#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { RendererError, blocked } from './renderer/errors.mjs';
import { writeAtomic } from './renderer/write-atomic.mjs';

function compare(left, right, currentPath = '', changes = []) {
  if (Object.is(left, right)) return changes;
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) compare(left[index], right[index], `${currentPath}.${index}`, changes);
    return changes;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      compare(left[key], right[key], currentPath ? `${currentPath}.${key}` : key, changes);
    }
    return changes;
  }
  changes.push({
    path: currentPath,
    category: currentPath.split('.')[0] || 'root',
    kind: left === undefined ? 'added' : (right === undefined ? 'removed' : 'changed'),
    before: left ?? null,
    after: right ?? null,
  });
  return changes;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (!['--before', '--after', '--out'].includes(arg) || !value) blocked('invalid_arguments', '需要 --before --after，--out 可选');
    options[arg.slice(2)] = value;
  }
  for (const key of ['before', 'after']) if (!options[key]) blocked('invalid_arguments', `缺少 --${key}`);
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  const [before, after] = await Promise.all([options.before, options.after].map(async (file) => JSON.parse(await readFile(file, 'utf8'))));
  const changes = compare(before, after);
  const result = {
    status: 'OK',
    equal: changes.length === 0,
    change_count: changes.length,
    categories: Object.fromEntries([...new Set(changes.map((item) => item.category))].sort().map(
      (category) => [category, changes.filter((item) => item.category === category).length],
    )),
    changes,
  };
  const payload = `${JSON.stringify(result, null, 2)}\n`;
  if (options.out) await writeAtomic(options.out, payload);
  console.log(payload.trimEnd());
} catch (error) {
  const payload = error instanceof RendererError
    ? { status: 'BLOCKED', reason_code: error.reasonCode, message: error.message, details: error.details }
    : { status: 'BLOCKED', reason_code: 'diff_internal_error', message: error.message };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 2;
}
