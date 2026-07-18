#!/usr/bin/env node
/**
 * make-offline.mjs — 报告离线内联 (south-china-report)
 * 用法: node scripts/make-offline.mjs <report.html> [--out out.html] [--fonts]
 * 默认: 内联外链 <script>(如 CDN echarts, 必内联) 与外链 CSS(如 remixicon, 其 url() 字体
 *       base64 内联 — 图标字体缺了就裂); Google Fonts <link> 移除(CJK 全集数 MB, 字体栈
 *       已有 PingFang/系统回退)。--fonts 时 Google Fonts 也全内联并输出体积警告。
 * 网络失败: 明确报错退出 2, 不写半成品。评审缺点5的落地脚本。
 */
import { readFileSync, writeFileSync } from 'fs';

const argv = process.argv.slice(2);
const inPath = argv.find(a => !a.startsWith('--'));
const withFonts = argv.includes('--fonts');
const outIdx = argv.indexOf('--out');
// --out 后必须跟一个非 "--" 开头的值; 缺失或紧跟另一个 flag 都是用法错误(exit 1),
// 不应落入下面 try 的 catch-all(那是网络/资源不可达用的 exit 2)。
if (outIdx >= 0 && (outIdx + 1 >= argv.length || argv[outIdx + 1].startsWith('--'))) {
  console.error('用法: node make-offline.mjs <report.html> [--out out.html] [--fonts] — --out 缺少输出路径');
  process.exit(1);
}
const outPath = outIdx >= 0 ? argv[outIdx + 1] : (inPath || '').replace(/\.html?$/i, '') + '.offline.html';
if (!inPath) { console.error('用法: node make-offline.mjs <report.html> [--out out.html] [--fonts]'); process.exit(1); }

const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' };
async function fetchText(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }
async function fetchB64(url) { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return Buffer.from(await r.arrayBuffer()).toString('base64'); }
const abs = (u, base) => new URL(u, base).href;

// @font-face 的 src 常见写法(如 remixicon/fontspring bulletproof 语法)会并列
// eot/woff2/woff/ttf/svg 五种格式, 全部 base64 内联会把体积撑大几 MB。
// 现代浏览器只会用 format("woff2")(其次 woff), 其余格式对离线单文件交付是纯冗余。
// 在 url() 内联循环之前, 先把每个 @font-face 块的 src 裁剪到只剩 woff2(无 woff2 时退回 woff)。
function trimFontFaceSrc(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const entries = [];
    const srcDeclRe = /src\s*:\s*([^;]+);/g;
    let declMatch;
    while ((declMatch = srcDeclRe.exec(block))) {
      const entryRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/g;
      let entryMatch;
      while ((entryMatch = entryRe.exec(declMatch[1]))) {
        entries.push({ full: entryMatch[0], format: (entryMatch[4] || '').toLowerCase() });
      }
    }
    if (entries.length === 0) return block; // 没有可解析的 src, 原样保留
    const keep = entries.find(e => e.format === 'woff2') || entries.find(e => e.format === 'woff') || entries[0];
    return block.replace(/src\s*:\s*[^;]+;/g, '').replace(/\{/, `{\n  src: ${keep.full};`);
  });
}

try {
  let html = readFileSync(inPath, 'utf-8');
  // 1) 外链 <script src>
  for (const m of [...html.matchAll(/<script[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>\s*<\/script>/g)]) {
    const js = await fetchText(m[1]);
    html = html.replace(m[0], `<script>/* inlined: ${m[1]} */\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`);
    console.log(`inlined <script>: ${m[1]} (${(js.length / 1024).toFixed(0)}KB)`);
  }
  // 2) 外链 <link rel=stylesheet>
  for (const m of [...html.matchAll(/<link[^>]*\bhref="(https?:\/\/[^"]+)"[^>]*>/g)]) {
    if (!/rel="?stylesheet/.test(m[0])) continue;
    const isGoogleFonts = /fonts\.googleapis\.com/.test(m[1]);
    if (isGoogleFonts && !withFonts) {
      html = html.replace(m[0], `<!-- offline: 移除远程字体 ${m[1]} (系统字体回退; 需内联用 --fonts) -->`);
      console.log(`removed fonts <link>: ${m[1]} (系统字体回退)`);
      continue;
    }
    let css = await fetchText(m[1]);
    css = trimFontFaceSrc(css); // 先裁剪 @font-face src 到单一格式, 再进入 url() 内联循环
    let assetBytes = 0;
    // 匹配绝对(https://、协议相对 //)与相对路径(如 CDN CSS 常见的 remixicon.woff2?t=...),
    // 排除已是 data: 的 url() 与文档内片段引用 url(#id)(不是网络资源, 常见于 SVG filter);
    // 相对路径以当前 CSS 的 href 为 base 解析绝对地址。
    for (const u of [...css.matchAll(/url\((['"]?)(?!data:|#)([^)'"]+)\1\)/g)]) {
      const assetUrl = abs(u[2].startsWith('//') ? 'https:' + u[2] : u[2], m[1]);
      const ext = assetUrl.split('.').pop().split(/[?#]/)[0].toLowerCase();
      const mime = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', svg: 'image/svg+xml', png: 'image/png' }[ext] || 'application/octet-stream';
      const b64 = await fetchB64(assetUrl);
      assetBytes += b64.length * 0.75;
      css = css.replace(u[0], `url(data:${mime};base64,${b64})`);
    }
    html = html.replace(m[0], `<style>/* inlined: ${m[1]} */\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`);
    console.log(`inlined <link>: ${m[1]}${assetBytes ? ` (+资产 ${(assetBytes / 1024).toFixed(0)}KB)` : ''}`);
  }
  writeFileSync(outPath, html);
  const htmlBytes = Buffer.byteLength(html, 'utf-8');
  console.log(`✓ 离线版已写出: ${outPath} (${(htmlBytes / 1024 / 1024).toFixed(2)}MB)。请跑 validate-report.mjs --strict-offline 复核。`);
} catch (e) {
  console.error('✗ 内联失败(网络/资源不可达), 未写出产物:', e.message);
  process.exit(2);
}
