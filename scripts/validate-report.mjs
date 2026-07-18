#!/usr/bin/env node
/**
 * validate-report.mjs — 报告 HTML 静态校验脚本 (V2)
 *
 * 用法: node scripts/validate-report.mjs <report.html> [--strict-offline]
 *
 * 校验级别:
 *   P0 — 必须通过 (阻断交付)
 *   P1 — 应该修复 (标记 WARN)
 *   P2 — 建议优化 (标记 INFO)
 *
 * --strict-offline: 离线自包含检测由 P2 升级为 P1 (飞书/内网/截图交付前建议加此档复检)
 *
 * 灵感来源: guizang-ppt-skill/scripts/validate-swiss-deck.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── 配置 ───────────────────────────────────────────────
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/gu;

const WEAK_TITLE_WORDS = [
  '分析', '情况', '对比', '汇总', '统计', '概览', '概况', '总结',
  '数据', '报表', '图表', '明细', '一览', '状况'
];

const ANTI_DEFAULT_PATTERNS = [
  // 只命中 2–8 列的等宽网格 (真正读起来像 KPI 卡片墙的范围);
  // 9+ 列 (如 Bento 的 repeat(12,1fr) 基座) 是布局基座, tiles 再 span, 不算卡片墙, 放过
  { id: 'equal-grid', pattern: /grid-template-columns:\s*repeat\([2-8],\s*1fr\)/g, msg: '均等网格 (可能是 KPI 卡片墙)', level: 'P1' },
  { pattern: /border-radius:\s*50%/g, msg: '圆形元素 (确认是否必要)', level: 'P2' },
];

// ─── 工具函数 ─────────────────────────────────────────────
function colorize(text, color) {
  const codes = { red: '31', green: '32', yellow: '33', blue: '34', gray: '90', bold: '1' };
  return `\x1b[${codes[color] || '0'}m${text}\x1b[0m`;
}

// 紧凑档判定: 只看 <html> 开标签上的属性, 不能全文匹配
// (否则会命中 CSS 选择器 :root[data-density="compact"] 与注释, 对默认档误报)
function isCompactDensity(html) {
  const htmlTag = html.match(/<html[^>]*>/i);
  return htmlTag ? /\bdata-density\s*=\s*["']compact["']/i.test(htmlTag[0]) : false;
}

// 提取所有 <style> 块内容 (多处复用)
function extractStyle(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  return styleMatch ? styleMatch.join('\n') : '';
}

function badge(level) {
  switch (level) {
    case 'P0': return colorize(' FAIL ', 'red');
    case 'P1': return colorize(' WARN ', 'yellow');
    case 'P2': return colorize(' INFO ', 'blue');
    case 'PASS': return colorize(' PASS ', 'green');
    default: return level;
  }
}

// ─── 校验函数 ─────────────────────────────────────────────

function checkEmoji(html) {
  const results = [];
  const lines = html.split('\n');

  // 零 Emoji 是全局红线: 全文逐行检查, 不跳过 <script>/<style>/<head>。
  // 早期"只查 body、跳过 script"会漏掉藏在多行 <script> 里的图表文案 emoji
  // —— title.text / series.name / label 里的 emoji 会真实渲染到图表上却被漏检。
  // EMOJI_REGEX 仅匹配真 emoji 码位区间, 正常 HTML/CSS/JS 语法字符不落入, 误报风险极低。
  lines.forEach((line, i) => {
    const matches = line.match(EMOJI_REGEX);
    if (matches) {
      results.push({
        level: 'P0',
        rule: 'Emoji 禁令',
        msg: `第 ${i + 1} 行发现 Emoji: ${matches.join(' ')}`,
        line: i + 1
      });
    }
  });

  if (results.length === 0) {
    results.push({ level: 'PASS', rule: 'Emoji 禁令', msg: '无 Emoji 检出' });
  }
  return results;
}

function checkTabularNums(html) {
  const results = [];

  // 检测完整属性声明 (而非全文出现 "tabular-nums" 子串即算通过)
  const styleContent = extractStyle(html) || html;
  const hasRule = /font-variant-numeric\s*:\s*[^;}]*tabular-nums/.test(styleContent);

  if (!hasRule) {
    results.push({
      level: 'P0',
      rule: 'tabular-nums',
      msg: '未发现 font-variant-numeric: tabular-nums 声明 (数字列无法对齐)'
    });
  } else {
    results.push({ level: 'PASS', rule: 'tabular-nums', msg: 'font-variant-numeric: tabular-nums 已声明' });
  }

  return results;
}

function checkChartContainers(html) {
  const results = [];
  const styleContent = extractStyle(html);
  const HEIGHT_RE = /(?:min-)?height\s*:/; // 沿用现有多形态高度识别 (height / min-height)

  // ── 1) 收集被 echarts.init(...) 引用的容器 id (直接 getElementById 形式 + 变量回溯形式) ──
  //     bento 走 `var ct = getElementById('chart-trend'); echarts.init(ct)`; scroll 走直接形式。
  const scripts = (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || []).join('\n');
  const initIds = new Set();
  let em;
  const initDirectRe = /echarts\.init\(\s*document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((em = initDirectRe.exec(scripts)) !== null) initIds.add(em[1]);
  const initVarRe = /echarts\.init\(\s*([A-Za-z_$][\w$]*)\s*[),]/g;
  while ((em = initVarRe.exec(scripts)) !== null) {
    const v = em[1];
    if (v === 'document') continue;
    const am = new RegExp('\\b' + v + '\\s*=\\s*document\\.getElementById\\(\\s*[\'"]([^\'"]+)[\'"]').exec(scripts);
    if (am) initIds.add(am[1]);
  }

  // ── 2) 收集候选容器开标签 (真正的 ECharts init 容器) ──
  //     信号: class 含 chart-container / tile-chart; 或 id 以 chart 开头; 或 id 被 echarts.init 引用。
  //     先剥离 <script>/<style>, 避免匹配 JS/CSS 文本里的类标签片段。
  const CHART_CLASSES = ['chart-container', 'tile-chart'];
  const domHtml = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const candidates = new Map(); // key(id 或整标签) → { tag, id, classes }
  const seenIds = new Set();
  const tagRe = /<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g;
  let tm;
  while ((tm = tagRe.exec(domHtml)) !== null) {
    const tag = tm[0];
    const clsM = tag.match(/class\s*=\s*["']([^"']*)["']/);
    const classes = clsM ? clsM[1].trim().split(/\s+/).filter(Boolean) : [];
    const idM = tag.match(/id\s*=\s*["']([^"']+)["']/);
    const id = idM ? idM[1] : null;
    const isChartClass = classes.some(c => CHART_CLASSES.includes(c));
    const isChartId = id && /^chart/i.test(id);
    const isInitId = id && initIds.has(id);
    if (isChartClass || isChartId || isInitId) {
      const key = id || tag;
      if (!candidates.has(key)) candidates.set(key, { tag, id, classes });
      if (id) seenIds.add(id);
    }
  }
  // echarts.init 引用但 DOM 里没找到开标签的 id (如运行时动态创建): 仅按 #id{height} 检查
  initIds.forEach(id => { if (!seenIds.has(id)) candidates.set(id, { tag: '', id, classes: [] }); });

  const list = [...candidates.values()];
  if (list.length === 0) return results; // 无任何图表容器 (如 audit-pack) → 跳过, 不产生结果

  // ── 3) 高度识别: inline style / #id{height} 选择器 / .class{height} 规则 (沿用现有逻辑) ──
  const idHeight = new Set();
  const idRuleRegex = /#([A-Za-z0-9_-]+)[^{}]*\{([^}]*)\}/g;
  let im;
  while ((im = idRuleRegex.exec(styleContent)) !== null) {
    if (HEIGHT_RE.test(im[2])) idHeight.add(im[1]);
  }
  const classHasHeight = (cls) => {
    const re = new RegExp('\\.' + cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{}]*\\{([^}]*)\\}', 'g');
    let mm;
    while ((mm = re.exec(styleContent)) !== null) {
      if (HEIGHT_RE.test(mm[1])) return true;
    }
    return false;
  };
  const covered = list.filter(({ tag, id, classes }) => {
    if (tag && /style\s*=\s*["'][^"']*(?:min-)?height\s*:/.test(tag)) return true;
    if (id && idHeight.has(id)) return true;
    if (classes.some(classHasHeight)) return true;
    return false;
  }).length;

  const total = list.length;
  const scope = 'chart-container/tile-chart/id^=chart/echarts.init';
  if (covered === total) {
    results.push({ level: 'PASS', rule: '图表容器高度', msg: `${total} 个 ECharts 容器 (${scope}) 均已设高 (CSS 规则 / inline style / id 选择器)` });
  } else if (covered > 0) {
    results.push({ level: 'WARN', rule: '图表容器高度', msg: `${total} 个容器 (${scope}) 中 ${total - covered} 个未见显式高度 (CSS/inline/id 均未命中) — 若靠 JS 设高请人工确认非 0 高度` });
  } else {
    results.push({ level: 'P0', rule: '图表容器高度', msg: `发现 ${total} 个 ECharts 容器 (${scope}) 但未见任何显式 height (CSS/inline/id 均无; ECharts 会渲染为 0 高度)` });
  }
  return results;
}

function checkTokenCompleteness(html) {
  const results = [];

  // 检查 :root 中的 CSS 变量数量
  const rootMatch = html.match(/:root\s*\{([^}]+)\}/);
  if (rootMatch) {
    const varCount = (rootMatch[1].match(/--[\w-]+:/g) || []).length;
    if (varCount < 40) {
      results.push({
        level: 'P1',
        rule: 'Token 完整性',
        msg: `仅发现 ${varCount} 个 CSS 变量 (V2 标准 ≥ 40 个)`
      });
    } else {
      results.push({
        level: 'PASS',
        rule: 'Token 完整性',
        msg: `发现 ${varCount} 个 CSS 变量`
      });
    }
  } else {
    results.push({
      level: 'P1',
      rule: 'Token 完整性',
      msg: '未发现 :root 块'
    });
  }

  return results;
}

function checkHeroTitle(html) {
  const results = [];

  // 提取 Hero 标题
  const heroTitleMatch = html.match(/<h1[^>]*class="[^"]*hero-title[^"]*"[^>]*>([^<]+)</);
  if (heroTitleMatch) {
    const title = heroTitleMatch[1].trim();

    // 检查弱标题词
    const foundWeak = WEAK_TITLE_WORDS.filter(w => title.includes(w));
    if (foundWeak.length > 0) {
      results.push({
        level: 'P1',
        rule: 'Hero 标题',
        msg: `标题 "${title}" 包含描述性词汇 [${foundWeak.join(', ')}]，可能不是 Governing Thought`
      });
    } else {
      results.push({
        level: 'PASS',
        rule: 'Hero 标题',
        msg: `Hero 标题 "${title}" — 非描述性，OK`
      });
    }
  }

  return results;
}

function checkChapterTitles(html) {
  const results = [];

  // 提取所有 chapter-title
  const titleRegex = /<[^>]*class="[^"]*chapter-title[^"]*"[^>]*>([^<]+(?:<br\s*\/?>)?[^<]*)<\//g;
  let match;
  let chapterIndex = 0;

  while ((match = titleRegex.exec(html)) !== null) {
    chapterIndex++;
    const title = match[1].replace(/<br\s*\/?>/g, '').trim();

    if (title.length > 30) {
      results.push({
        level: 'P1',
        rule: `Chapter ${chapterIndex} 标题`,
        msg: `标题 "${title}" 超过 30 字 (当前 ${title.length} 字)`
      });
    }

    const foundWeak = WEAK_TITLE_WORDS.filter(w => title.includes(w));
    if (foundWeak.length > 0 && !title.includes('，')) {
      results.push({
        level: 'P1',
        rule: `Chapter ${chapterIndex} 标题`,
        msg: `标题 "${title}" 可能是描述性标签，不是 Action Title`
      });
    }
  }

  if (chapterIndex === 0) {
    results.push({
      level: 'P2',
      rule: 'Chapter 标题',
      msg: '未检测到 .chapter-title 元素'
    });
  }

  return results;
}

function checkSpacingDiscipline(html) {
  const results = [];

  // 提取 <style> 块内容
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  if (!styleMatch) return results;

  const styleContent = styleMatch.join('\n');

  // 检查非 token 的随意像素值 (排除在 :root 和 keyframes 中的定义)
  const suspiciousPixels = [];
  const pixelRegex = /(?:margin|padding|gap|top|bottom|left|right):\s*(\d+)px/g;
  let pixelMatch;

  while ((pixelMatch = pixelRegex.exec(styleContent)) !== null) {
    const val = parseInt(pixelMatch[1]);
    // 只对布局级间距 (>12px) 强制 8pt 网格; ≤12px 多为边框/描边/光学微调, 放过以降噪
    if (val > 12 && val % 4 !== 0) {
      suspiciousPixels.push(`${val}px`);
    }
  }

  if (suspiciousPixels.length > 0) {
    results.push({
      level: 'P2',
      rule: '间距纪律',
      msg: `发现 ${suspiciousPixels.length} 个非 4 倍数间距值: ${suspiciousPixels.slice(0, 5).join(', ')}${suspiciousPixels.length > 5 ? '...' : ''}`
    });
  } else {
    results.push({
      level: 'PASS',
      rule: '间距纪律',
      msg: '间距值均符合 4 的倍数规范'
    });
  }

  return results;
}

function checkAntiDefaultPatterns(html, compact = false) {
  const results = [];

  ANTI_DEFAULT_PATTERNS.forEach(({ id, pattern, msg, level }) => {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // 紧凑档允许更密网格 (密度轴 V2.3): 均等网格由 P1 降级为 P2
      let lvl = level;
      let note = '';
      if (compact && id === 'equal-grid') {
        lvl = 'P2';
        note = ' — 紧凑档允许更密网格';
      }
      results.push({ level: lvl, rule: 'Anti-Default', msg: `${msg} (${matches.length} 处)${note}` });
    }
  });

  return results;
}

// 密度轴 (V2.3): 报告处于哪一档, 供用户确认风格选择生效
function checkDensityAxis(html) {
  const compact = isCompactDensity(html);
  return [{
    level: 'P2',
    rule: '密度轴',
    msg: compact
      ? '紧凑销售报告风已启用 (--density:0.6 + 组件级版式重组)'
      : '叙事标准档 (默认, --density:1)',
  }];
}

function checkFontTripartite(html) {
  const results = [];

  const hasDisplay = html.includes('--font-display') || html.includes('Plus Jakarta Sans');
  const hasEditorial = html.includes('--font-editorial') || html.includes('DM Sans');
  const hasData = html.includes('--font-data') || html.includes('JetBrains Mono');

  if (!hasDisplay) {
    results.push({ level: 'P1', rule: '字体三角色', msg: '未发现 Display 字体 (Plus Jakarta Sans)' });
  }
  if (!hasEditorial) {
    results.push({ level: 'P1', rule: '字体三角色', msg: '未发现 Editorial 字体 (DM Sans)' });
  }
  if (!hasData) {
    results.push({ level: 'P1', rule: '字体三角色', msg: '未发现 Data 字体 (JetBrains Mono)' });
  }
  if (hasDisplay && hasEditorial && hasData) {
    results.push({ level: 'PASS', rule: '字体三角色', msg: 'Display/Editorial/Data 三角色字体齐全' });
  }

  return results;
}

function checkPullQuoteQuality(html) {
  const results = [];
  const pullQuoteRegex = /<blockquote[^>]*>([^<]+(?:<br\s*\/?>)?[^<]*)<\//g;
  let match;

  while ((match = pullQuoteRegex.exec(html)) !== null) {
    const quote = match[1].replace(/<br\s*\/?>/g, '').trim();

    // 检查是否纯粹是数字复述
    const numberCount = (quote.match(/\d+[%,.]*\d*/g) || []).length;
    const totalWords = quote.length;

    if (numberCount >= 3 && totalWords < 40) {
      results.push({
        level: 'P1',
        rule: 'Pull Quote 质量',
        msg: `引言可能是数据复述: "${quote.substring(0, 40)}..."`
      });
    }
  }

  // .pull-quote 容器 (div/aside/p) 路径: 同一启发式, 避免只查 blockquote 漏检
  const pqDivRe = /<(div|aside|p)[^>]*class="[^"]*pull-quote[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;
  while ((match = pqDivRe.exec(html)) !== null) {
    if (/<blockquote/i.test(match[2])) continue; // blockquote 路径已查过
    const quote = match[2].replace(/<[^>]*>/g, '').trim();
    const numberCount = (quote.match(/\d+[%,.]*\d*/g) || []).length;
    if (numberCount >= 3 && quote.length < 40) {
      results.push({ level: 'P1', rule: 'Pull Quote 质量', msg: `引言可能是数据复述: "${quote.substring(0, 40)}..."` });
    }
  }

  return results;
}

function checkTypographyDiscipline(html) {
  const results = [];
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  if (!styleMatch) return results;
  const styleContent = styleMatch.join('\n');

  // Apple §15: tracking 尺寸专属, 组件内禁止写死 letter-spacing 字面量, 须走 --tracking-* Token
  const hardTracking = (styleContent.match(/letter-spacing:\s*-?\d*\.?\d+em/g) || []);
  if (hardTracking.length > 0) {
    results.push({
      level: 'P1',
      rule: '排版纪律 (Apple §15)',
      msg: `发现 ${hardTracking.length} 处硬编码 letter-spacing 字面量 [${hardTracking.slice(0, 3).join(', ')}${hardTracking.length > 3 ? '...' : ''}], 应使用 var(--tracking-*)`
    });
  } else {
    results.push({ level: 'PASS', rule: '排版纪律 (Apple §15)', msg: 'letter-spacing 均走 --tracking-* Token' });
  }

  return results;
}

function checkAccessibilityFallback(html) {
  const results = [];
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  const styleContent = styleMatch ? styleMatch.join('\n') : '';

  // Apple §14: 毛玻璃须有 prefers-reduced-transparency 实底降级
  const usesGlass = /backdrop-filter\s*:/.test(styleContent);
  const hasReducedTransparency = /@media\s*\(prefers-reduced-transparency/.test(styleContent);
  if (usesGlass && !hasReducedTransparency) {
    results.push({
      level: 'P1',
      rule: '无障碍降级 (Apple §14)',
      msg: '使用了 backdrop-filter 但缺少 @media (prefers-reduced-transparency: reduce) 实底降级'
    });
  }

  // Apple §14: 动效须有 prefers-reduced-motion 降级
  const usesMotion = /\.reveal\b/.test(styleContent) ||
    /animation\s*:/.test(styleContent) ||
    /@keyframes/.test(styleContent) ||
    /transition\s*:/.test(styleContent);
  const hasReducedMotion = /@media\s*\(prefers-reduced-motion/.test(styleContent);
  if (usesMotion && !hasReducedMotion) {
    results.push({
      level: 'P1',
      rule: '无障碍降级 (Apple §14)',
      msg: '使用了动效但缺少 @media (prefers-reduced-motion: reduce) 降级'
    });
  }

  if (results.length === 0) {
    results.push({ level: 'PASS', rule: '无障碍降级 (Apple §14)', msg: '毛玻璃/动效均具备降级信号' });
  }

  return results;
}

// 禁用图表检测 (借鉴 sales-report-html finalize + 本 Skill IBCS/anti-default 硬规则)
function checkBannedCharts(html) {
  const results = [];
  const style = extractStyle(html);
  const scripts = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n');
  const banned = [
    { re: /type:\s*['"]pie['"]/g, name: '饼图/环形图', fix: '构成用 100%堆叠条形/Treemap (≤3类且用户明确要才可用饼)' },
    { re: /type:\s*['"]radar['"]/g, name: '雷达图', fix: '多维对比用分组条形/Small Multiples' },
    { re: /type:\s*['"]gauge['"]/g, name: '仪表盘', fix: '达成用子弹图/进度条' },
    { re: /type:\s*['"]funnel['"]/g, name: '漏斗图(装饰型)', fix: '转化用水平条形+转化率标签' },
    { re: /grid3D|bar3D|globe|echarts-gl/g, name: '3D 图表', fix: '一律拍平为 2D' },
  ];
  banned.forEach(({ re, name, fix }) => {
    if (re.test(scripts)) results.push({ level: 'P1', rule: '禁用图表', msg: `检出 ${name} — ${fix} (违反 IBCS/anti-default; 确需用须在交付说明写明理由)` });
  });
  // 双 Y 轴: yAxis 为含 2 个对象的数组
  const dualAxis = /yAxis:\s*\[\s*\{[\s\S]{0,400}?\},\s*\{/g;
  if (dualAxis.test(scripts)) results.push({ level: 'P1', rule: '禁用图表', msg: '疑似双 Y 轴 (yAxis 数组含 2 项) — 默认拆上下双图/Small Multiples; 确需须写明两轴逻辑关系' });
  if (results.length === 0) results.push({ level: 'PASS', rule: '禁用图表', msg: '无饼图/雷达/仪表/3D/双轴' });
  return results;
}

// 离线自包含检测 (飞书/内网发送场景常离线; CDN echarts/字体会挂)
// level 默认 P2 (建议), --strict-offline 时调用方传 'P1' 升级为阻断项
function checkOfflineSelfContained(html, level = 'P2') {
  const results = [];
  const ext = [];
  if (/<script[^>]*src=["']https?:\/\//.test(html)) ext.push('外链 <script> (如 CDN echarts)');
  if (/<link[^>]*href=["']https?:\/\//.test(html)) ext.push('外链 <link> (如远程字体/CSS)');
  // CSS 侧外链 (会被 <script>/<link> 检测漏掉): @import / @font-face src / url() / <img>
  if (/@import\s+(url\()?["']?https?:\/\//.test(html)) ext.push('CSS @import 远程样式');
  if (/@font-face[\s\S]{0,200}?url\(\s*["']?https?:\/\//.test(html)) ext.push('@font-face 远程字体');
  if (/<img[^>]*src=["']https?:\/\//.test(html) || /<image[^>]*href=["']https?:\/\//.test(html)) ext.push('远程 <img>/<image>');
  if (/(background|background-image)\s*:[^;}]*url\(\s*["']?https?:\/\//.test(html)) ext.push('CSS background 远程图');
  if (ext.length) results.push({ level, rule: '离线自包含', msg: `发现${ext.join('、')} — 截图/内网/飞书场景可能离线, 建议把 echarts 与字体内联为单文件` });
  else results.push({ level: 'PASS', rule: '离线自包含', msg: '无外链资源 (可离线打开)' });
  return results;
}

// Token 引用完整性: var(--x) 引用但未定义且无 fallback → P1 (评审缺点2的机器守门)
function checkUndefinedTokens(html) {
  const results = [];
  // 注释剥离: 移除 /* */ 与 <!-- --> 注释，防止注释中的 var() 被误报
  const scanText = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

  const styleContent = extractStyle(scanText);
  const defined = new Set();
  let m;
  const defRe = /--([\w.-]+)\s*:/g;
  while ((m = defRe.exec(styleContent)) !== null) defined.add(m[1]);
  const missing = new Map();
  const useRe = /var\(\s*--([\w.-]+)\s*(,)?/g;
  while ((m = useRe.exec(scanText)) !== null) {
    if (m[2]) continue; // 带 fallback 视为安全
    if (!defined.has(m[1])) missing.set(m[1], (missing.get(m[1]) || 0) + 1);
  }
  if (missing.size) {
    const list = [...missing.entries()].map(([k, c]) => `--${k}(${c}处)`).join(', ');
    results.push({ level: 'P1', rule: 'Token 引用完整性', msg: `未定义且无 fallback 的 var() 引用: ${list}` });
  } else {
    results.push({ level: 'PASS', rule: 'Token 引用完整性', msg: '所有 var() 引用均已定义或带 fallback' });
  }
  return results;
}

// ─── 主入口 ─────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log(colorize('用法: node validate-report.mjs <report.html> [--strict-offline]', 'yellow'));
    process.exit(1);
  }

  const strictOffline = args.includes('--strict-offline');
  const positional = args.filter(a => !a.startsWith('--'));
  if (positional.length === 0) {
    console.log(colorize('用法: node validate-report.mjs <report.html> [--strict-offline]', 'yellow'));
    process.exit(1);
  }
  const filePath = resolve(positional[0]);
  let html;

  try {
    html = readFileSync(filePath, 'utf-8');
  } catch (e) {
    console.error(colorize(`无法读取文件: ${filePath}`, 'red'));
    process.exit(1);
  }

  console.log('\n' + colorize('═══════════════════════════════════════', 'bold'));
  console.log(colorize('  报告质量校验 (V2)', 'bold'));
  console.log(colorize(`  文件: ${positional[0]}${strictOffline ? '  [--strict-offline]' : ''}`, 'gray'));
  console.log(colorize('═══════════════════════════════════════\n', 'bold'));

  // 运行所有检查
  const compact = isCompactDensity(html);
  const allResults = [
    ...checkEmoji(html),
    ...checkTabularNums(html),
    ...checkChartContainers(html),
    ...checkTokenCompleteness(html),
    ...checkUndefinedTokens(html),
    ...checkHeroTitle(html),
    ...checkChapterTitles(html),
    ...checkSpacingDiscipline(html),
    ...checkAntiDefaultPatterns(html, compact),
    ...checkFontTripartite(html),
    ...checkPullQuoteQuality(html),
    ...checkTypographyDiscipline(html),
    ...checkAccessibilityFallback(html),
    ...checkBannedCharts(html),
    ...checkOfflineSelfContained(html, strictOffline ? 'P1' : 'P2'),
    ...checkDensityAxis(html),
  ];

  // 输出结果
  const p0s = allResults.filter(r => r.level === 'P0');
  const p1s = allResults.filter(r => r.level === 'P1');
  const p2s = allResults.filter(r => r.level === 'P2');
  const passes = allResults.filter(r => r.level === 'PASS');

  passes.forEach(r => console.log(`${badge('PASS')} ${r.rule}: ${r.msg}`));
  p2s.forEach(r => console.log(`${badge('P2')} ${r.rule}: ${r.msg}`));
  p1s.forEach(r => console.log(`${badge('P1')} ${r.rule}: ${r.msg}`));
  p0s.forEach(r => console.log(`${badge('P0')} ${r.rule}: ${r.msg}`));

  // 汇总
  console.log('\n' + colorize('───────────────────────────────────────', 'gray'));
  console.log(`  ${colorize('PASS', 'green')}: ${passes.length}  |  ${colorize('INFO', 'blue')}: ${p2s.length}  |  ${colorize('WARN', 'yellow')}: ${p1s.length}  |  ${colorize('FAIL', 'red')}: ${p0s.length}`);

  if (p0s.length > 0) {
    console.log('\n' + colorize('  ✗ 存在 P0 阻断项，报告不可交付', 'red'));
    process.exit(1);
  } else if (p1s.length > 0) {
    console.log('\n' + colorize('  △ 通过，但有 WARN 项需关注', 'yellow'));
    process.exit(0);
  } else {
    console.log('\n' + colorize('  ✓ 全部通过', 'green'));
    process.exit(0);
  }
}

main();
