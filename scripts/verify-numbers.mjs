#!/usr/bin/env node
/**
 * verify-numbers.mjs — 数字一致性 Gate (south-china-report)
 * 用法: node scripts/verify-numbers.mjs <report.html> <metrics.json>
 * 约定: 元素加 data-metric="a.b.0.c" (metrics.json 的点分路径, 数组用数字下标);
 *       标记放叶子元素(内部不再嵌同名标签); 金额绑 *_wan 字段, 显示"亿"自动 /1e4 换算;
 *       容差 = 显示精度末位的一半 (显示1位小数 → ±0.05);
 *       CountUp 元素(带 data-to)自动取 data-to + data-suffix 拼接后比对, 不读占位内文(通常为"0")。
 * 退出码: 0=全部一致或未接线; 1=存在错配。评审缺点3的机器守门。
 */
import { readFileSync } from 'fs';

const [,, htmlPath, metricsPath] = process.argv;
if (!htmlPath || !metricsPath) {
  console.error('用法: node verify-numbers.mjs <report.html> <metrics.json>');
  process.exit(1);
}
const html = readFileSync(htmlPath, 'utf-8');
const metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));

function lookup(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : (Array.isArray(o) && /^\d+$/.test(k) ? o[Number(k)] : o[k])), obj);
}
function parseDisplay(raw) {
  const t = raw.replace(/\s+/g, '').replace(/[▲△]/g, '+').replace(/[▼▽]/g, '-').replace(/−/g, '-');
  const m = t.match(/([+-]?)([\d,]+(?:\.\d+)?)(亿|万|%|pp)?/);
  if (!m) return null;
  let value = parseFloat(m[2].replace(/,/g, ''));
  if (m[1] === '-') value = -value;
  return { value, unit: m[3] || '', decimals: (m[2].split('.')[1] || '').length };
}

const tagRe = /<([a-zA-Z0-9]+)([^>]*\bdata-metric="([^"]+)"[^>]*)>([\s\S]*?)<\/\1>/g;
let m, checked = 0;
const failed = [];
while ((m = tagRe.exec(html)) !== null) {
  const path = m[3];
  const attrs = m[2];
  // CountUp 元素(带 data-to)静态内文是动画占位符(通常"0"), 读内文必然误报;
  // 改为直接取 data-to + data-suffix 拼接后的目标值参与比对。
  const toMatch = attrs.match(/\bdata-to="([^"]*)"/);
  const suffixMatch = attrs.match(/\bdata-suffix="([^"]*)"/);
  const text = toMatch ? (toMatch[1] + (suffixMatch ? suffixMatch[1] : '')) : m[4].replace(/<[^>]*>/g, '');
  checked++;
  const disp = parseDisplay(text);
  if (!disp) { failed.push(`${path}: 显示文本无法解析数字 ("${text.slice(0, 30)}")`); continue; }
  const raw = lookup(metrics, path);
  if (typeof raw !== 'number') { failed.push(`${path}: metrics.json 无此数值 (得到 ${JSON.stringify(raw)})`); continue; }
  let expected = raw;
  const leaf = path.split('.').pop();
  if (disp.unit === '亿' && /_wan$/.test(leaf)) expected = raw / 1e4;
  const tol = Math.pow(10, -disp.decimals) / 2 + 1e-9;
  if (Math.abs(disp.value - expected) > tol) {
    failed.push(`${path}: 显示 ${disp.value}${disp.unit} ≠ 期望 ${expected} (容差 ±${tol.toFixed(disp.decimals + 1)})`);
  }
}
if (checked === 0) { console.log('未发现 data-metric 标记 — 数字一致性未接线 (不阻断, 建议按模板示范绑定)。'); process.exit(0); }
if (failed.length) {
  console.error(`✗ 数字一致性失败: ${failed.length}/${checked} 处与 metrics.json 不符`);
  failed.forEach(f => console.error('   - ' + f));
  process.exit(1);
}
console.log(`✓ 数字一致性通过 (${checked} 处 data-metric 全部匹配)`);
