#!/usr/bin/env node
// run-evals.mjs — 对一份【已生成的报告】执行某 eval 的机器断言 (evals.json 的 machine_checks)。
// 定位: 回归工具, 不生成报告 (生成需 agent)。给已产出的 report.html 验证它是否满足该 eval 的可机器化断言;
//       主观项 (Hero 语义/PAC 闭环) 标 MANUAL 交人工。
// 用法: node scripts/run-evals.mjs <report.html> --eval <id> [--metrics metrics.json]
import { readFileSync } from 'fs';
// V2.10.1 (外部审计缺陷): execSync 拼 shell 字符串时, 双引号内 $()/反引号仍会被 shell 展开,
// 路径可注入命令 — 改 execFileSync 传参数组, 完全绕开 shell。
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS = join(__dirname, '..', 'evals', 'evals.json');
const VALIDATOR = join(__dirname, 'validate-report.mjs');
const VERIFY = join(__dirname, 'verify-numbers.mjs');

// ── 解析参数 ──
const args = process.argv.slice(2);
let report = null, evalId = null, metrics = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--eval') evalId = parseInt(args[++i], 10);
  else if (args[i] === '--metrics') metrics = args[++i];
  else if (!report) report = args[i];
}
if (!report || evalId == null || Number.isNaN(evalId)) {
  console.error('用法: node scripts/run-evals.mjs <report.html> --eval <id> [--metrics metrics.json]');
  process.exit(2);
}

let suite;
try { suite = JSON.parse(readFileSync(EVALS, 'utf8')); }
catch (e) { console.error(`无法解析 evals.json: ${e.message}`); process.exit(2); }
const ev = suite.evals.find(e => e.id === evalId);
if (!ev) { console.error(`未找到 eval id=${evalId} (可用: ${suite.evals.map(e => e.id).join(', ')})`); process.exit(2); }
if (!Array.isArray(ev.machine_checks)) { console.error(`eval ${evalId} 无 machine_checks`); process.exit(2); }

let html;
try { html = readFileSync(report, 'utf8'); }
catch { console.error(`无法读取报告: ${report}`); process.exit(2); }

const count = (pat) => (html.match(new RegExp(pat, 'g')) || []).length;

function runCheck(c) {
  switch (c.type) {
    case 'validator_exit0':
      try { execFileSync('node', [VALIDATOR, report], { stdio: 'pipe' }); return { ok: true, got: 'exit 0 (无 P0 FAIL)' }; }
      catch (e) { return { ok: false, got: `exit ${e.status ?? '?'} (有 P0 FAIL, 详情见 validate-report.mjs)` }; }
    case 'grep_count_min': { const n = count(c.pattern); return { ok: n >= c.min, got: `命中 ${n} (需 ≥${c.min})` }; }
    case 'grep_count_max': { const n = count(c.pattern); return { ok: n <= c.max, got: `命中 ${n} (需 ≤${c.max})` }; }
    case 'density': {
      // 密度档只读 <html> 开标签属性, 不全文 grep —— 否则会命中紧凑档的 CSS 选择器 :root[data-density="compact"] 而误判 (V2.3.1 同类陷阱)
      const tag = (html.match(/<html[^>]*>/i) || [''])[0];
      const actual = /data-density\s*=\s*["']compact["']/.test(tag) ? 'compact' : 'standard';
      return { ok: actual === c.expect, got: `<html> 开标签判定为 ${actual} (需 ${c.expect})` };
    }
    case 'data_metric_or_verify':
      if (metrics) {
        try { execFileSync('node', [VERIFY, report, metrics], { stdio: 'pipe' }); return { ok: true, got: 'verify-numbers exit 0' }; }
        catch (e) { return { ok: false, got: `verify-numbers exit ${e.status ?? '?'} (数字不符)` }; }
      } else {
        const n = count('data-metric="'); return { ok: n >= c.min, got: `未给 --metrics, 退化查 data-metric 命中 ${n} (需 ≥${c.min})` };
      }
    case 'manual': return { manual: true, got: '需人工判定' };
    default: return { ok: false, got: `未知 check 类型: ${c.type}` };
  }
}

// ── 执行 ──
console.log(`\n  Eval #${ev.id} "${ev.name}"  —  报告: ${report}\n`);
let pass = 0, fail = 0, manual = 0;
for (const c of ev.machine_checks) {
  const r = runCheck(c);
  let tag;
  if (r.manual) { tag = 'MANUAL'; manual++; }
  else if (r.ok) { tag = ' PASS '; pass++; }
  else { tag = ' FAIL '; fail++; }
  console.log(`  [${tag}] ${String(c.id).padEnd(17)}${c.desc}  →  ${r.got}`);
}
console.log(`\n  PASS: ${pass}  |  FAIL: ${fail}  |  MANUAL: ${manual}${manual ? ' (须人工复核)' : ''}\n`);
process.exit(fail > 0 ? 1 : 0);
