#!/usr/bin/env node
/**
 * validate-report.mjs — 报告 HTML 静态校验脚本 (V2)
 *
 * 用法: node scripts/validate-report.mjs <report.html> [--strict-offline] [--template-mode]
 *
 * 校验级别:
 *   P0 — 必须通过 (阻断交付)
 *   P1 — 应该修复 (标记 WARN)
 *   P2 — 建议优化 (标记 INFO)
 *
 * --strict-offline: 任一外部或相对资源依赖均为 P0，退出码非 0。
 * --template-mode: 仅用于校验未实例化模板，显式放行占位符和审计示例状态。
 *
 * 灵感来源: guizang-ppt-skill/scripts/validate-swiss-deck.mjs
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── 配置 ───────────────────────────────────────────────
const EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{20E3}]/gu;
const RESULT_LEVELS = new Set(['P0', 'P1', 'P2', 'PASS']);

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
// (否则会命中 CSS 选择器 :root[data-density="compact"] 与注释, 对标准档误报)
function isCompactDensity(html) {
  const htmlTag = html.match(/<html[^>]*>/i);
  return htmlTag ? /\bdata-density\s*=\s*["']compact["']/i.test(htmlTag[0]) : false;
}

// 提取所有 <style> 块内容 (多处复用)
function extractStyle(html) {
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/g);
  return styleMatch ? styleMatch.join('\n') : '';
}

function stripNonRendered(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<template\b[\s\S]*?<\/template>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
}

function parseAttributes(source) {
  const attrs = new Map();
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function cssSelectorsWithDeclaration(style, propertyPattern) {
  const selectors = [];
  const clean = style.replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(clean)) !== null) {
    if (propertyPattern.test(match[2])) {
      selectors.push(...match[1].split(',').map(s => s.trim()).filter(Boolean));
    }
    propertyPattern.lastIndex = 0;
  }
  return selectors;
}

function elementMatchesSimpleSelector(tag, attrs, selector) {
  // 静态 Gate 只承诺覆盖常见 tag/#id/.class/[data-*] 选择器；复杂伪类取其末端简单选择器。
  const simple = selector.replace(/::?[\w-]+(?:\([^)]*\))?/g, '').trim().split(/\s+|>|\+|~/).pop() || '';
  const id = attrs.get('id') || '';
  const classes = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
  const tagMatch = simple.match(/^[a-z][\w-]*/i);
  if (tagMatch && tagMatch[0].toLowerCase() !== tag.toLowerCase()) return false;
  for (const m of simple.matchAll(/#([\w-]+)/g)) if (id !== m[1]) return false;
  for (const m of simple.matchAll(/\.([\w-]+)/g)) if (!classes.has(m[1])) return false;
  for (const m of simple.matchAll(/\[([^\]=~^$*|\s]+)(?:\s*([~^$*|]?=)\s*["']?([^\]"']*)["']?)?\]/g)) {
    const actual = attrs.get(m[1].toLowerCase());
    if (actual == null) return false;
    if (m[2] === '=' && actual !== m[3]) return false;
    if (m[2] === '~=' && !actual.split(/\s+/).includes(m[3])) return false;
    if (m[2] === '^=' && !actual.startsWith(m[3])) return false;
    if (m[2] === '$=' && !actual.endsWith(m[3])) return false;
    if (m[2] === '*=' && !actual.includes(m[3])) return false;
  }
  return Boolean(tagMatch || /[#.\[]/.test(simple) || simple === '*');
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
  const styleContent = extractStyle(html);
  const declaration = /font-variant-numeric\s*:\s*[^;}]*tabular-nums/g;
  const selectors = cssSelectorsWithDeclaration(styleContent, declaration);
  // font-variant-numeric 是可继承属性；在 html/body/:root 上声明会真实覆盖全部后代数字。
  const globallyInherited = selectors.some(selector => /^(?:html|body|:root|\*)$/i.test(selector.trim()));
  const dom = stripNonRendered(html);
  const candidates = [];
  const tagRe = /<([a-z][\w:-]*)([^>]*)>/gi;
  let match;
  while ((match = tagRe.exec(dom)) !== null) {
    const attrs = parseAttributes(match[2]);
    const classes = attrs.get('class') || '';
    const isNumericRole = attrs.has('data-metric') || attrs.has('data-to') ||
      /(?:^|\s)(?:num|number|metric|amount|percentage|kpi(?:-[\w-]+)?|[\w-]*value[\w-]*)(?:\s|$)/i.test(classes);
    if (!isNumericRole) continue;
    const inlineCovered = /font-variant-numeric\s*:\s*[^;"']*tabular-nums/i.test(attrs.get('style') || '');
    const cssCovered = globallyInherited || selectors.some(selector => elementMatchesSimpleSelector(match[1], attrs, selector));
    candidates.push({ covered: inlineCovered || cssCovered, tag: match[1], classes });
  }

  if (selectors.length === 0 && !candidates.some(c => c.covered)) {
    results.push({
      level: 'P0',
      rule: 'tabular-nums',
      msg: '未发现 font-variant-numeric: tabular-nums 声明 (数字列无法对齐)'
    });
  } else if (candidates.length === 0) {
    results.push({
      level: 'P1',
      rule: 'tabular-nums',
      msg: '发现 tabular-nums 声明，但未识别到带数字语义的 DOM 元素，无法证明覆盖范围'
    });
  } else {
    const covered = candidates.filter(c => c.covered).length;
    if (covered === candidates.length) {
      results.push({ level: 'PASS', rule: 'tabular-nums', msg: `${covered}/${candidates.length} 个数字语义元素均被 tabular-nums 规则覆盖` });
    } else if (covered === 0) {
      results.push({ level: 'P0', rule: 'tabular-nums', msg: `0/${candidates.length} 个数字语义元素被 tabular-nums 规则覆盖；声明存在但没有落到实际数字组件` });
    } else {
      results.push({ level: 'P0', rule: 'tabular-nums', msg: `${covered}/${candidates.length} 个数字语义元素被覆盖，仍有 ${candidates.length - covered} 个未覆盖；成品数字排版覆盖必须为 100%` });
    }
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
    // `chart-trend-title` / `chart-*-description` 是无障碍标签，不是渲染容器。
    // 保留旧报告仅靠 chart-* id 的兼容信号，但排除常见语义附属节点。
    const isChartId = id && /^chart(?:-|$)/i.test(id) &&
      !/(?:^|-)(?:title|description|subtitle|label|legend|annotation)$/i.test(id);
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
    results.push({ level: 'P1', rule: '图表容器高度', msg: `${total} 个容器 (${scope}) 中 ${total - covered} 个未见显式高度 (CSS/inline/id 均未命中) — 若靠 JS 设高请人工确认非 0 高度` });
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

  // 允许 Action Title 内含 data-metric 等行内元素；旧正则遇到 <span> 会把真实标题漏成 0 个。
  const dom = stripNonRendered(html);
  const titleRegex = /<([a-z][\w:-]*)\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bchapter-title\b)([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let match;
  let chapterIndex = 0;

  while ((match = titleRegex.exec(dom)) !== null) {
    const attrs = parseAttributes(match[2]);
    const classes = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
    if (!classes.has('chapter-title')) continue;
    chapterIndex++;
    const title = match[3]
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&(?:lt|gt|amp|quot|apos);/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

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
      : '叙事标准档 (显式可选, --density:1)',
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

function checkDeliveryPlaceholders(html, templateMode = false) {
  const results = [];
  const dom = stripNonRendered(html);
  const text = dom.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const findings = [];
  const placeholderPatterns = [
    /\[(?:报告主体|机构|业务线|期间|校验时间|数据来源|待校验[^\]]*|按实际结果回填)\]/g,
    /(?:TODO|TBD|PLACEHOLDER)(?![\w-])/gi,
    /(?:请|待)(?:替换|回填|填写)(?:真实|实际)?(?:数据|内容|结果|时间|主体|期间)?/g,
  ];
  for (const pattern of placeholderPatterns) {
    const matches = text.match(pattern) || [];
    findings.push(...matches.slice(0, 10));
  }

  const isAudit = /\baudit-(?:container|header|section|stamp)\b/i.test(dom) || /数据审计包/.test(text);
  const htmlTag = (html.match(/<html\b[^>]*>/i) || [''])[0];
  const auditFinalized = /\bdata-audit-finalized\s*=\s*["']true["']/i.test(htmlTag);
  let auditPassCount = 0;
  if (isAudit) {
    const statusRe = /<([a-z][\w:-]*)([^>]*)>\s*(?:PASS|MATCH)\s*<\/\1>/gi;
    let statusMatch;
    while ((statusMatch = statusRe.exec(dom)) !== null) {
      const classes = new Set((parseAttributes(statusMatch[2]).get('class') || '').split(/\s+/).filter(Boolean));
      if (classes.has('status-dot') && classes.has('pass')) auditPassCount++;
    }
  }

  if (findings.length === 0 && (auditPassCount === 0 || auditFinalized)) {
    results.push({ level: 'PASS', rule: '成品占位符', msg: '未发现模板占位符、待校验状态或未经确认的审计 PASS/MATCH' });
    return results;
  }

  const details = [];
  if (findings.length) details.push(`占位/待回填 ${[...new Set(findings)].slice(0, 6).join('、')}`);
  if (auditPassCount && !auditFinalized) details.push(`审计包含 ${auditPassCount} 个 PASS/MATCH，但 <html> 未声明 data-audit-finalized="true"`);
  results.push({
    level: templateMode ? 'P2' : 'P0',
    rule: '成品占位符',
    msg: `${details.join('；')}${templateMode ? ' — 已按 --template-mode 显式放行，仅可作为模板使用' : ' — 成品不可交付'}`
  });
  return results;
}

function isMetaPlaceholder(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return /(?:TODO|TBD|PENDING|PLACEHOLDER)/i.test(text) ||
    /\[[^\]]*(?:REQUESTED|PERIOD|SOURCE|SHA|METRIC|PATH|期间|来源|指标|路径)[^\]]*\]/i.test(text) ||
    /^(?:待|请)(?:填写|回填|替换|确认)/.test(text);
}

// 成品报告必须携带可机读、可追溯的最小契约；可见正文无占位符不代表 meta 已实例化。
function checkReportMetaContract(html, templateMode = false) {
  const issues = [];
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const matches = [];
  for (const script of scripts) {
    const open = script.match(/^<script\b([^>]*)>/i);
    if (!open) continue;
    const attrs = parseAttributes(open[1]);
    if (attrs.get('id') === 'south-china-report-meta') matches.push({ script, attrs });
  }

  if (matches.length !== 1) {
    issues.push(matches.length === 0
      ? '缺少唯一的 #south-china-report-meta 报告契约'
      : `#south-china-report-meta 出现 ${matches.length} 次，id 必须唯一`);
  }

  const candidate = matches[0];
  let meta = null;
  if (candidate) {
    if ((candidate.attrs.get('type') || '').toLowerCase() !== 'application/json') {
      issues.push('#south-china-report-meta 必须声明 type="application/json"');
    }
    const body = candidate.script
      .replace(/^<script\b[^>]*>/i, '')
      .replace(/<\/script>\s*$/i, '')
      .trim();
    try {
      meta = JSON.parse(body);
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        issues.push('报告 meta 根节点必须是 JSON 对象');
        meta = null;
      }
    } catch (error) {
      issues.push('报告 meta JSON 无法解析: ' + error.message);
    }
  }

  if (meta) {
    const scanMeta = (value, path = 'meta') => {
      if (value === null) {
        issues.push(path + ' 不得为 null');
        return;
      }
      if (typeof value === 'string') {
        if (isMetaPlaceholder(value)) issues.push(path + ' 仍是占位值 ' + JSON.stringify(value));
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => scanMeta(item, path + '[' + index + ']'));
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if (isMetaPlaceholder(key)) issues.push(path + ' 存在占位键 ' + JSON.stringify(key));
          scanMeta(child, path + '.' + key);
        }
      }
    };
    scanMeta(meta);
    const requireString = (path, value) => {
      if (typeof value !== 'string' || !value.trim()) issues.push(path + ' 必须是非空字符串');
      else if (isMetaPlaceholder(value)) issues.push(path + ' 仍是占位值 ' + JSON.stringify(value));
    };
    requireString('requested_period', meta.requested_period);
    requireString('report_mode', meta.report_mode);
    requireString('source.path', meta.source?.path);
    if (typeof meta.source?.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(meta.source.sha256)) {
      issues.push('source.sha256 必须是实际源文件的 64 位 SHA-256');
    }
    if (Object.prototype.hasOwnProperty.call(meta, 'metrics_sha256') &&
      (typeof meta.metrics_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(meta.metrics_sha256))) {
      issues.push('metrics_sha256 存在时必须是 metrics.json 的 64 位 SHA-256');
    }

    const keyMetrics = meta.key_metrics;
    if (!keyMetrics || typeof keyMetrics !== 'object' || Array.isArray(keyMetrics)) {
      issues.push('key_metrics 必须是 JSON 对象');
    } else {
      const entries = Object.entries(keyMetrics);
      if (entries.length === 0) {
        if (typeof meta.no_business_metrics_reason !== 'string' || !meta.no_business_metrics_reason.trim() ||
          isMetaPlaceholder(meta.no_business_metrics_reason)) {
          issues.push('空 key_metrics 仅能在 no_business_metrics_reason 写明真实原因时使用');
        }
      }
      for (const [key, value] of entries) {
        if (!key.trim() || isMetaPlaceholder(key)) issues.push('key_metrics 存在空键或占位键 ' + JSON.stringify(key));
        if (key.split('.').some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) {
          issues.push('key_metrics 键禁止使用原型链片段 ' + JSON.stringify(key));
        }
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push('key_metrics[' + JSON.stringify(key) + '] 必须是有限数值，得到 ' + JSON.stringify(value));
        }
      }
    }
  }

  if (issues.length === 0) {
    return [{ level: 'PASS', rule: '报告元数据契约', msg: '#south-china-report-meta 唯一、可解析且必填字段已实例化' }];
  }
  return [{
    level: templateMode ? 'P2' : 'P0',
    rule: '报告元数据契约',
    msg: issues.slice(0, 8).join('；') + (issues.length > 8 ? `；其余 ${issues.length - 8} 项已省略` : '') +
      (templateMode ? ' — 已按 --template-mode 放行，实例化成品前必须补齐' : ' — 成品不可交付'),
  }];
}

// 禁用图表检测 (借鉴 sales-report-html finalize + 本 Skill IBCS/anti-default 硬规则)
function checkBannedCharts(html) {
  const results = [];
  // 排除内联 ECharts/第三方 bundle，避免库自身注册 pie/radar 等类型导致误报。
  const scripts = (html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [])
    .filter(tag => !/\bid\s*=\s*["']south-china-report-meta["']/i.test(tag))
    .map(tag => (tag.match(/<script[^>]*>([\s\S]*?)<\/script>/i) || ['', ''])[1])
    .filter(code => !(code.length > 100000 && /zrender|echarts\.version|registerSeriesModel/.test(code)))
    .join('\n');
  const banned = [
    { type: 'pie', name: '饼图/环形图', fix: '构成用 100%堆叠条形/Treemap (≤3类且用户明确要才可用饼)' },
    { type: 'radar', name: '雷达图', fix: '多维对比用分组条形/Small Multiples' },
    { type: 'gauge', name: '仪表盘', fix: '达成用子弹图/进度条' },
    { type: 'funnel', name: '漏斗图(装饰型)', fix: '转化用水平条形+转化率标签' },
    { re: /grid3D|bar3D|globe|echarts-gl/g, name: '3D 图表', fix: '一律拍平为 2D' },
  ];
  banned.forEach(({ type, re, name, fix }) => {
    if (type) {
      const escaped = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 覆盖 type:'pie'、"type":"pie"、['type']:'pie' 等常见对象/JSON 写法。
      re = new RegExp(`(?:\\btype\\b|["']type["']|\\[\\s*["']type["']\\s*\\])\\s*:\\s*["']${escaped}["']`, 'g');
    }
    if (re.test(scripts)) results.push({ level: 'P1', rule: '禁用图表', msg: `检出 ${name} — ${fix} (违反 IBCS/anti-default; 确需用须在交付说明写明理由)` });
  });
  // 双 Y 轴: yAxis 为含 2 个对象的数组
  const dualAxis = /(?:\byAxis\b|["']yAxis["']|\[\s*["']yAxis["']\s*\])\s*:\s*\[\s*\{[\s\S]{0,800}?\},\s*\{/g;
  if (dualAxis.test(scripts)) results.push({ level: 'P1', rule: '禁用图表', msg: '疑似双 Y 轴 (yAxis 数组含 2 项) — 默认拆上下双图/Small Multiples; 确需须写明两轴逻辑关系' });
  if (results.length === 0) results.push({ level: 'PASS', rule: '禁用图表', msg: '无饼图/雷达/仪表/3D/双轴' });
  return results;
}

function isEmbeddedReference(value) {
  const ref = String(value || '').trim().replace(/^["']|["']$/g, '');
  // javascript:/vbscript: 是主动执行协议，可内嵌 fetch 外传，绝不能当作“自包含”。
  return !ref || ref.startsWith('#') || /^data:/i.test(ref) || /^about:blank(?:#.*)?$/i.test(ref);
}

function isSafeDataResource(tag, attribute, value) {
  const ref = String(value || '').trim();
  if (!/^data:/i.test(ref)) return null;
  const mime = (ref.match(/^data:([^;,\s]*)/i)?.[1] || 'text/plain').toLowerCase();
  const rasterImage = /^image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i.test(mime);
  if (attribute === 'poster') return rasterImage;
  if (['img', 'image', 'input'].includes(tag)) return rasterImage;
  if (tag === 'source') return rasterImage || /^audio\//i.test(mime) || /^video\//i.test(mime);
  if (tag === 'audio') return /^audio\//i.test(mime);
  if (tag === 'video') return /^video\//i.test(mime);
  if (tag === 'track') return mime === 'text/vtt';
  // script/link/iframe/embed/object/base 等主动上下文一律 fail-closed，防止 data: HTML/SVG/JS 内嵌外传。
  return false;
}

// 离线自包含检测：严格档覆盖远程、协议相对、相对/绝对本地资源及常见动态加载。
function checkOfflineSelfContained(html, strict = false) {
  const results = [];
  const findings = [];
  const add = (kind, value) => {
    const sample = String(value || '').trim().slice(0, 100);
    if (!findings.some(f => f.kind === kind && f.sample === sample)) findings.push({ kind, sample });
  };

  const resourceAttrs = {
    script: ['src'], link: ['href'], img: ['src', 'srcset'], source: ['src', 'srcset'],
    video: ['src', 'poster'], audio: ['src'], iframe: ['src'], embed: ['src'], object: ['data'],
    image: ['href', 'xlink:href'], input: ['src'], track: ['src'], base: ['href'],
  };
  // 只解析真实 markup；先清空 script/style 内文，避免 JS 字符串里的 `<img src="...">` 被当成 DOM 资源。
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, '<script$1></script>')
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style>/gi, '<style$1></style>');
  const tagRe = /<([a-z][\w:-]*)([^>]*)>/gi;
  let tagMatch;
  while ((tagMatch = tagRe.exec(markup)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    const attrs = parseAttributes(tagMatch[2]);
    const inlineStyle = attrs.get('style') || '';
    let inlineUrl;
    const inlineUrlRe = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
    while ((inlineUrl = inlineUrlRe.exec(inlineStyle)) !== null) {
      if (!isEmbeddedReference(inlineUrl[2])) add('inline style url()', inlineUrl[2]);
    }
    const names = resourceAttrs[tag];
    if (!names) continue;
    for (const name of names) {
      if (!attrs.has(name)) continue;
      const raw = attrs.get(name);
      if (name === 'srcset') {
        // 移除可内嵌的 data: 候选后，只要还有 URL 候选（含 bare relative.png）即视为依赖。
        const residual = raw
          .replace(/data:[^,\s]+,[^\s]+(?:\s+\d+(?:\.\d+)?[wx])?/gi, '')
          .replace(/[\s,]+/g, ' ')
          .trim();
        if (residual) add(tag + '[' + name + ']', raw);
      } else if (isSafeDataResource(tag, name, raw) === false) {
        add(tag + '[' + name + '] active data URI', raw);
      } else if (!isEmbeddedReference(raw)) {
        add(tag + '[' + name + ']', raw);
      }
    }
  }

  const style = extractStyle(html);
  let match;
  const urlRe = /url\(\s*(["']?)(.*?)\1\s*\)/gi;
  while ((match = urlRe.exec(style)) !== null) if (!isEmbeddedReference(match[2])) add('CSS url()', match[2]);
  const importRe = /@import\s+(?:url\(\s*)?(["']?)([^"'\s;)]+)\1/gi;
  while ((match = importRe.exec(style)) !== null) if (!isEmbeddedReference(match[2])) add('CSS @import', match[2]);

  const scriptTags = (html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [])
    .filter(tag => !/\bid\s*=\s*["']south-china-report-meta["']/i.test(tag));
  const scriptBodies = scriptTags.map(tag => (tag.match(/<script[^>]*>([\s\S]*?)<\/script>/i) || ['', ''])[1]);
  // 字面 URL/import/fetch 必须扫描所有脚本；不得因体积或 zrender/ECharts 字样跳过整段。
  const scripts = scriptBodies.join('\n');
  // 仅“非字面表达式”启发式排除已内联的大型第三方 bundle，避免库内 DOM 实现细节误报。
  const unresolvedScanScripts = scriptBodies
    .filter(code => !(code.length > 100000 && /zrender|echarts\.version|registerSeriesModel/.test(code)))
    .join('\n');

  // importmap 需要浏览器模块解析器才能证明依赖闭包；静态单文件 Gate 采用 fail-closed。
  const importMapTags = scriptTags.filter(tag => {
    const open = tag.match(/^<script\b([^>]*)>/i);
    return open && (parseAttributes(open[1]).get('type') || '').toLowerCase() === 'importmap';
  });
  if (importMapTags.length) add('importmap', `发现 ${importMapTags.length} 个 importmap，静态校验无法证明映射后依赖已全内联`);

  const staticModulePatterns = [
    { kind: 'static import-from', re: /\bimport\s+(?!\()[^;\n]*?\sfrom\s*(["'])([^"']+)\1/gi },
    { kind: 'side-effect import', re: /\bimport\s*(["'])([^"']+)\1/gi },
    { kind: 'export-from', re: /\bexport\s+(?:\*|\{[^}]*\})[^;\n]*?\sfrom\s*(["'])([^"']+)\1/gi },
  ];
  for (const { kind, re } of staticModulePatterns) {
    while ((match = re.exec(scripts)) !== null) if (!isEmbeddedReference(match[2])) add(kind, match[2]);
  }
  const dynamicPatterns = [
    { kind: 'fetch()', re: /\bfetch\s*\(\s*(["'])(.*?)\1/gi },
    { kind: 'dynamic import()', re: /\bimport\s*\(\s*(["'])(.*?)\1/gi },
    { kind: 'Worker()', re: /\bnew\s+(?:Shared)?Worker\s*\(\s*(["'])(.*?)\1/gi },
    { kind: 'new URL()', re: /\bnew\s+URL\s*\(\s*(["'])(.*?)\1/gi },
    { kind: 'XHR.open()', re: /\.open\s*\(\s*["'](?:GET|POST|PUT|PATCH|DELETE)["']\s*,\s*(["'])(.*?)\1/gi },
    { kind: 'axios()', re: /\baxios\.(?:get|post|put|patch|delete)\s*\(\s*(["'])(.*?)\1/gi },
    { kind: 'dynamic src/href', re: /\.(?:src|href)\s*=\s*(["'])(.*?)\1/gi },
  ];
  for (const { kind, re } of dynamicPatterns) {
    while ((match = re.exec(scripts)) !== null) if (!isEmbeddedReference(match[2])) add(kind, match[2]);
  }
  // 变量、模板字符串等无法在静态阶段证明已内嵌；严格自包含 Gate 按“不可证明即失败”处理。
  const unresolvedDynamic = [
    { kind: 'fetch() dynamic', re: /\bfetch\s*\(\s*(?!["'])/i },
    { kind: 'dynamic import() dynamic', re: /\bimport\s*\(\s*(?!["'])/i },
    { kind: 'Worker() dynamic', re: /\bnew\s+(?:Shared)?Worker\s*\(\s*(?!["'])/i },
    { kind: 'dynamic src/href expression', re: /\.(?:src|href)\s*=\s*(?!["'])/i },
  ];
  for (const { kind, re } of unresolvedDynamic) if (re.test(unresolvedScanScripts)) add(kind, '非字面量 URL，静态校验无法证明已内嵌');

  if (findings.length) {
    const samples = findings.slice(0, 8).map(f => f.kind + ': ' + f.sample).join('；');
    results.push({
      level: strict ? 'P0' : 'P2',
      rule: '离线自包含',
      msg: '发现 ' + findings.length + ' 项外部/相对资源依赖 — ' + samples + (findings.length > 8 ? '；…' : '')
    });
  } else {
    results.push({ level: 'PASS', rule: '离线自包含', msg: '未发现远程、协议相对、相对文件或常见动态资源依赖' });
  }
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
    console.log(colorize('用法: node validate-report.mjs <report.html> [--strict-offline] [--template-mode]', 'yellow'));
    process.exit(1);
  }

  const strictOffline = args.includes('--strict-offline');
  const templateMode = args.includes('--template-mode');
  const unknownFlags = args.filter(a => a.startsWith('--') && !['--strict-offline', '--template-mode'].includes(a));
  if (unknownFlags.length) {
    console.error(colorize(`未知参数: ${unknownFlags.join(', ')}`, 'red'));
    process.exit(2);
  }
  const positional = args.filter(a => !a.startsWith('--'));
  if (positional.length === 0) {
    console.log(colorize('用法: node validate-report.mjs <report.html> [--strict-offline] [--template-mode]', 'yellow'));
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
  console.log(colorize(`  文件: ${positional[0]}${strictOffline ? '  [--strict-offline]' : ''}${templateMode ? '  [--template-mode]' : '  [成品模式]'}`, 'gray'));
  console.log(colorize('═══════════════════════════════════════\n', 'bold'));

  // 运行所有检查
  const compact = isCompactDensity(html);
  const rawResults = [
    ...checkEmoji(html),
    ...checkDeliveryPlaceholders(html, templateMode),
    ...checkReportMetaContract(html, templateMode),
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
    ...checkOfflineSelfContained(html, strictOffline),
    ...checkDensityAxis(html),
  ];

  // WARN 是旧版内部别名，统一归并为 P1；任何未知等级均视为验证器自身 P0，禁止静默丢弃。
  const allResults = rawResults.map((result, index) => {
    if (result?.level === 'WARN') return { ...result, level: 'P1', msg: `${result.msg} [legacy WARN→P1]` };
    if (!result || !RESULT_LEVELS.has(result.level)) {
      return {
        level: 'P0',
        rule: '验证器内部等级',
        msg: `第 ${index + 1} 个检查返回未知等级 ${JSON.stringify(result?.level)}，已按失败处理`,
      };
    }
    return result;
  });

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
