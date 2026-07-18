#!/usr/bin/env node
/**
 * snapshot.mjs — 报告截图 Gate (south-china-report)
 * 借鉴 anthropic-skills:sales-report-html 的 snapshot, 适配本 Skill 的 reveal/密度轴。
 *
 * 用法: node snapshot.mjs <report.html> <out-dir/>
 * 产出: desktop.png (1440 整页) / mobile.png (430 整页) / snap-<id>.png (每个 data-snap 区块)
 *
 * 关键: 截图前强制 .reveal→visible + 等 ECharts 渲染完 —— 否则叙事标准档未滚到的区块
 *       停在 opacity:0 会截出空白 (本 Skill 早前实测踩过的坑)。
 * 无 Playwright/Chromium 时: 明确报"截图未验证"并退出, 不假装验证过。
 */
// 注意: playwright 改为在 shoot() 内 **动态 import** (见下)。
// 若在此写静态 `import { chromium } from 'playwright'`, 无 Playwright 环境会在模块解析阶段
// 直接抛 ERR_MODULE_NOT_FOUND, try/catch 根本包不住, 文档承诺的"截图未验证"降级路径不可达。
import path from 'path';
import { mkdirSync, existsSync } from 'fs';
import { pathToFileURL } from 'url';

const [,, reportArg, outArg] = process.argv;
if (!reportArg || !outArg) { console.error('用法: node snapshot.mjs <report.html> <out-dir/>'); process.exit(1); }
const reportPath = path.resolve(reportArg);
const outDir = path.resolve(outArg);
if (!existsSync(reportPath)) { console.error('报告不存在:', reportPath); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const url = pathToFileURL(reportPath).href;

// 截图前在页面内执行: 强制显示 + 冻结动效 + 等图表渲染
const PREP = () => new Promise(res => {
  document.querySelectorAll('.reveal').forEach(e => e.classList.add('visible'));
  document.querySelectorAll('.hero-scroll-hint').forEach(e => e.style.display = 'none');
  // 冻结动画/过渡 (V2.10.1, 外部审计缺陷): CountUp 时长 2000ms > 等待 900ms,
  // 不冻结会截到数字中间帧; 直接把 [data-to] 元素写成终值, 不赌时序
  const st = document.createElement('style');
  st.textContent = '*{animation:none!important;transition:none!important}';
  document.head.appendChild(st);
  document.querySelectorAll('[data-to]').forEach(e => {
    const v = parseFloat(e.getAttribute('data-to'));
    if (!isNaN(v)) e.textContent = Math.floor(v).toLocaleString() + (e.getAttribute('data-suffix') || '');
  });
  // 触发 resize 让 ECharts 按最终视口重算, 再给渲染留时间
  window.dispatchEvent(new Event('resize'));
  setTimeout(res, 900);
});

async function shoot() {
  // 动态 import: 无 Playwright 时在此优雅降级为"截图未验证", 而非顶层 import 直接崩溃。
  // 退出码沿用脚本既有的 3 = "未验证"约定 (与下方 Chromium 启动失败一致), 不抛未捕获异常。
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    console.error('✗ 截图未验证：未安装 Playwright。');
    console.error('  请运行 `npx playwright install chromium` 或 `npm i -D playwright` 后重试。');
    console.error('  未生成任何截图 —— 请自行打开报告核对 (标签重叠/图表空白/移动端断版), 勿当作已验证。');
    console.error('  (降级原因:', e.message, ')');
    process.exit(3);
  }
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    console.error('✗ 无法启动 Chromium —— 截图未验证。原因:', e.message);
    console.error('  请自行打开报告核对 (标签重叠/图表空白/移动端断版), 勿当作已验证。');
    process.exit(3);
  }
  const done = [];
  // 桌面整页
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await d.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
  await d.evaluate(PREP);
  await d.screenshot({ path: path.join(outDir, 'desktop.png'), fullPage: true }); done.push('desktop.png');
  // 移动整页
  const m = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
  await m.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
  await m.evaluate(PREP);
  await m.screenshot({ path: path.join(outDir, 'mobile.png'), fullPage: true }); done.push('mobile.png');
  // 分区 (data-snap) —— 每块单独出图, 可直接发群
  const s = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await s.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(()=>{});
  await s.evaluate(PREP);
  const ids = await s.$$eval('[data-snap]', els => els.map(e => e.getAttribute('data-snap')));
  for (const id of ids) {
    // 文件名消毒 (V2.10.1, 外部审计缺陷): id 来自 HTML 属性, 含 ../ 或特殊字符时
    // 会写出 outDir 之外 (路径穿越) — 只保留安全字符, 其余替换为 _
    const safe = String(id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    if (!safe) continue;
    const el = await s.$(`[data-snap="${id}"]`);
    if (el) { await el.screenshot({ path: path.join(outDir, `snap-${safe}.png`) }); done.push(`snap-${safe}.png`); }
  }
  await browser.close();
  console.log('✓ 截图完成 →', outDir);
  done.forEach(f => console.log('   ', f));
  console.log('\n请逐张自查: 图表无空白/undefined/NaN, 文字无截断/重叠, 移动端无横向滚动, 分区图可独立看懂。');
}
shoot();
