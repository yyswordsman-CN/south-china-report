#!/usr/bin/env node
/**
 * make-offline.mjs — 将报告资源内联为单文件 HTML。
 *
 * 支持: script/link/style/img/source/video/audio/track 的 src/srcset/poster，
 *       以及外链 CSS、内联 CSS 中的 @import/url()。
 * 安全: 默认仅 HTTPS + 已知 CDN allowlist，拒绝私网/localhost/重定向绕过，
 *       限制超时、单资源和总体积，本地资源不得逃出 HTML 所在目录。
 * 边界: 原生 fetch 无法把预检 DNS 结果 pin 到实际连接；自定义 --allow-host
 *       仍存在 DNS rebinding TOCTOU 风险，应只加入受控且稳定的可信域名。
 * 写入: 只在所有资源成功内联后原子替换输出；禁止 out == input。
 *
 * 用法:
 *   node scripts/make-offline.mjs report.html [--out report.offline.html] [--force] [--fonts]
 *     [--allow-host cdn.example.com] [--allow-local-root /safe/root]
 *     [--timeout-ms 15000] [--max-resource-mb 10] [--max-total-mb 25]
 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ALLOWED_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

function usage(message) {
  if (message) console.error(message);
  console.error('node scripts/make-offline.mjs <report.html> [--out out.html] [--force] [--fonts] [--allow-host host] [--allow-local-root path] [--timeout-ms n] [--max-resource-mb n] [--max-total-mb n]');
  process.exit(1);
}

function parsePositiveNumber(raw, flag) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) usage(`${flag} 必须是正数`);
  return value;
}

const argv = process.argv.slice(2);
let inputArg = null;
let outputArg = null;
let forceOutput = false;
let withFonts = false;
let timeoutMs = 15000;
let maxResourceBytes = 10 * 1024 * 1024;
let maxTotalBytes = 25 * 1024 * 1024;
const allowedHosts = new Set(DEFAULT_ALLOWED_HOSTS);
const customAllowedHosts = new Set();
const extraLocalRoots = [];

for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  const takeValue = () => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage(`${arg} 缺少参数`);
    index += 1;
    return value;
  };
  if (arg === '--out') outputArg = takeValue();
  else if (arg === '--force') forceOutput = true;
  else if (arg === '--fonts') withFonts = true;
  else if (arg === '--allow-host') {
    const host = takeValue().toLowerCase().replace(/\.$/, '');
    allowedHosts.add(host);
    customAllowedHosts.add(host);
  }
  else if (arg === '--allow-local-root') extraLocalRoots.push(path.resolve(takeValue()));
  else if (arg === '--timeout-ms') timeoutMs = parsePositiveNumber(takeValue(), arg);
  else if (arg === '--max-resource-mb') maxResourceBytes = parsePositiveNumber(takeValue(), arg) * 1024 * 1024;
  else if (arg === '--max-total-mb') maxTotalBytes = parsePositiveNumber(takeValue(), arg) * 1024 * 1024;
  else if (arg.startsWith('--')) usage(`未知参数: ${arg}`);
  else if (!inputArg) inputArg = arg;
  else usage(`多余的位置参数: ${arg}`);
}

if (!inputArg) usage();
const inputPath = path.resolve(inputArg);
if (!existsSync(inputPath)) usage(`输入文件不存在: ${inputPath}`);
const outputPath = path.resolve(outputArg || inputPath.replace(/\.html?$/i, '') + '.offline.html');
if (outputPath === inputPath) usage('拒绝覆盖输入文件: --out 不能与输入路径相同');
if (existsSync(outputPath) && !forceOutput) usage(`输出文件已存在，拒绝覆盖: ${outputPath}（如确认替换，显式传 --force）`);
if (customAllowedHosts.size > 0) {
  console.warn(`[WARN] 自定义 --allow-host 仅做 DNS 预检，原生 fetch 无法 pin 解析结果；仍存在 DNS rebinding TOCTOU 边界。仅使用可信域名: ${Array.from(customAllowedHosts).join(', ')}`);
}

const inputRealPath = realpathSync(inputPath);
const localRoots = [realpathSync(path.dirname(inputRealPath))];
for (const root of extraLocalRoots) {
  if (!existsSync(root)) usage(`--allow-local-root 不存在: ${root}`);
  localRoots.push(realpathSync(root));
}

const mimeByExtension = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

const resourceCache = new Map();
const unresolved = [];
const activity = [];
let totalResourceBytes = 0;
let removedRemoteFonts = false;

function isPrivateAddress(address) {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::' || normalized === '0.0.0.0') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (/^\d+\.\d+\.\d+\.\d+$/.test(normalized) ? normalized : null);
  if (!ipv4) return false;
  const [a, b] = ipv4.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
    (a >= 224);
}

function hostIsAllowed(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.has(host) || Array.from(allowedHosts).some((entry) => entry.startsWith('*.') && host.endsWith(entry.slice(1)));
}

async function assertSafeRemoteUrl(url) {
  if (url.protocol !== 'https:') throw new Error(`仅允许 HTTPS 资源: ${url.href}`);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`拒绝本机/局域网主机: ${hostname}`);
  }
  if (!hostIsAllowed(hostname)) {
    throw new Error(`主机不在 allowlist: ${hostname} (如确认可信，显式传 --allow-host ${hostname})`);
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`DNS 解析到私网/非法地址: ${hostname}`);
  }
}

async function readResponseWithLimit(response, url, signal) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxResourceBytes) throw new Error(`单资源超限 ${Math.ceil(declared / 1024 / 1024)}MB: ${url}`);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const cancelOnAbort = () => { reader.cancel('resource timeout').catch(() => {}); };
  signal.addEventListener('abort', cancelOnAbort, { once: true });
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (signal.aborted) throw new Error(`资源读取超时: ${url}`);
        break;
      }
      length += value.byteLength;
      if (length > maxResourceBytes) {
        await reader.cancel();
        throw new Error(`单资源超限 ${(maxResourceBytes / 1024 / 1024).toFixed(1)}MB: ${url}`);
      }
      chunks.push(Buffer.from(value));
    }
    if (signal.aborted) throw new Error(`资源读取超时: ${url}`);
  } catch (error) {
    if (signal.aborted) throw new Error(`资源读取超时: ${url}`);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelOnAbort);
  }
  return Buffer.concat(chunks, length);
}

async function fetchRemote(url) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertSafeRemoteUrl(current);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120 Safari/537.36' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`重定向缺少 Location: ${current.href}`);
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${current.href}`);
      const bytes = await readResponseWithLimit(response, current.href, controller.signal);
      return { bytes, contentType: response.headers.get('content-type')?.split(';')[0] || '', finalUrl: current };
    } catch (error) {
      if (timedOut) throw new Error(`资源请求或读取超过 ${timeoutMs}ms: ${current.href}`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`重定向过多: ${url}`);
}

function isInsideRoot(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function loadResource(rawUrl, baseUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed || trimmed.startsWith('#') || /^data:/i.test(trimmed)) return null;
  if (/^blob:/i.test(trimmed)) throw new Error(`blob: 资源无法固化: ${trimmed}`);
  const resolved = new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed, baseUrl);
  const cacheKey = resolved.href;
  if (resourceCache.has(cacheKey)) return resourceCache.get(cacheKey);

  let result;
  if (resolved.protocol === 'file:') {
    const localPath = fileURLToPath(resolved);
    if (!existsSync(localPath)) throw new Error(`本地资源不存在: ${localPath}`);
    const realPath = realpathSync(localPath);
    if (!localRoots.some((root) => isInsideRoot(realPath, root))) {
      throw new Error(`本地资源越界: ${realPath} (如确认可信，显式传 --allow-local-root)`);
    }
    const bytes = readFileSync(realPath);
    if (bytes.length > maxResourceBytes) throw new Error(`单资源超限 ${(bytes.length / 1024 / 1024).toFixed(1)}MB: ${realPath}`);
    result = { bytes, contentType: mimeByExtension[path.extname(realPath).toLowerCase()] || 'application/octet-stream', finalUrl: pathToFileURL(realPath) };
  } else if (resolved.protocol === 'https:') {
    result = await fetchRemote(resolved);
  } else {
    throw new Error(`不支持的资源协议 ${resolved.protocol}: ${resolved.href}`);
  }

  totalResourceBytes += result.bytes.length;
  if (totalResourceBytes > maxTotalBytes) {
    throw new Error(`资源总体积超限 ${(maxTotalBytes / 1024 / 1024).toFixed(1)}MB`);
  }
  resourceCache.set(cacheKey, result);
  return result;
}

function toDataUri(resource) {
  const mime = resource.contentType || mimeByExtension[path.extname(resource.finalUrl.pathname).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${resource.bytes.toString('base64')}`;
}

const SAFE_RASTER_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon',
]);
const SAFE_AUDIO_MIMES = new Set(['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/aac', 'audio/flac']);
const SAFE_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/ogg']);

function decodeSchemeEntities(value) {
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (match, hex, decimal) => {
      const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    })
    .replace(/&colon;/gi, ':')
    .replace(/&(tab|newline);/gi, (_match, name) => name.toLowerCase() === 'tab' ? '\t' : '\n');
}

function normalizedSchemeValue(rawUrl) {
  return decodeSchemeEntities(String(rawUrl || '')).trim().replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}

function dataMime(rawUrl) {
  const normalized = decodeSchemeEntities(String(rawUrl || '')).trim();
  const match = normalized.match(/^data:([^;,]*)/i);
  if (!match) return null;
  return (match[1] || 'text/plain').toLowerCase();
}

function dataMimeAllowed(tagName, attribute, mime) {
  const tag = tagName.toLowerCase();
  const attr = attribute.toLowerCase();
  if (['script', 'link', 'iframe', 'embed', 'object', 'base'].includes(tag)) return false;
  if (attr === 'srcset' || attr === 'poster' || ['img', 'image', 'input'].includes(tag)) return SAFE_RASTER_MIMES.has(mime);
  if (tag === 'audio') return SAFE_AUDIO_MIMES.has(mime);
  if (tag === 'video') return SAFE_VIDEO_MIMES.has(mime);
  if (tag === 'track') return mime === 'text/vtt';
  if (tag === 'source') return SAFE_RASTER_MIMES.has(mime) || SAFE_AUDIO_MIMES.has(mime) || SAFE_VIDEO_MIMES.has(mime);
  if (tag === 'use') return false;
  return mime === 'text/plain' || SAFE_RASTER_MIMES.has(mime) || SAFE_AUDIO_MIMES.has(mime) || SAFE_VIDEO_MIMES.has(mime);
}

function urlPolicyError(rawUrl, tagName, attribute) {
  const normalized = normalizedSchemeValue(rawUrl);
  if (/^(?:javascript|vbscript):/.test(normalized)) return `拒绝危险 URL scheme: ${normalized.slice(0, normalized.indexOf(':') + 1)}`;
  const mime = dataMime(rawUrl);
  if (mime && !dataMimeAllowed(tagName, attribute, mime)) return `拒绝 active/不安全 data: MIME ${mime}`;
  return null;
}

function recordUrlPolicy(rawUrl, tagName, attribute, context = `<${tagName} ${attribute}>`) {
  const error = urlPolicyError(rawUrl, tagName, attribute);
  if (!error) return false;
  unresolved.push(`${context}: ${String(rawUrl).slice(0, 160)} -> ${error}`);
  return true;
}

function safeDataUri(resource, tagName, attribute, context) {
  const uri = toDataUri(resource);
  return recordUrlPolicy(uri, tagName, attribute, context) ? null : uri;
}

function trimFontFaceSrc(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/gi, (block) => {
    const candidates = [];
    for (const declaration of block.matchAll(/src\s*:\s*([^;]+);/gi)) {
      for (const entry of declaration[1].matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/gi)) {
        candidates.push({ full: entry[0], format: (entry[4] || '').toLowerCase() });
      }
    }
    if (candidates.length === 0) return block;
    const keep = candidates.find(({ format }) => format === 'woff2') || candidates.find(({ format }) => format === 'woff') || candidates[0];
    return block.replace(/src\s*:\s*[^;]+;/gi, '').replace(/\{/, `{\n  src: ${keep.full};`);
  });
}

async function tryInline(rawUrl, baseUrl, context) {
  try {
    return await loadResource(rawUrl, baseUrl);
  } catch (error) {
    unresolved.push(`${context}: ${rawUrl} -> ${error.message}`);
    return null;
  }
}

async function inlineCss(cssInput, baseUrl, context, depth = 0) {
  if (depth > 4) {
    unresolved.push(`${context}: CSS @import 嵌套超过 4 层`);
    return cssInput;
  }
  let css = trimFontFaceSrc(cssInput);

  const imports = Array.from(css.matchAll(/@import\s+(?:url\(\s*)?(['"]?)([^'"\s)]+)\1\s*\)?\s*([^;]*);/gi));
  for (const match of imports) {
    const resource = await tryInline(match[2], baseUrl, `${context} @import`);
    if (!resource) continue;
    const imported = await inlineCss(resource.bytes.toString('utf8'), resource.finalUrl, `${context} @import ${match[2]}`, depth + 1);
    const media = match[3]?.trim();
    css = css.replace(match[0], media ? `@media ${media}{\n${imported}\n}` : imported);
  }

  const urls = Array.from(css.matchAll(/url\(\s*(['"]?)(?!data:|#)([^'")]+)\1\s*\)/gi));
  for (const match of urls) {
    const resource = await tryInline(match[2].trim(), baseUrl, `${context} url()`);
    if (!resource) continue;
    css = css.replace(match[0], `url("${toDataUri(resource)}")`);
  }
  return css;
}

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index + 1;
  }
  return -1;
}

function nextStartTag(html, from = 0) {
  let cursor = from;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) return null;
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    const nameMatch = html.slice(start + 1).match(/^\s*([A-Za-z][\w:-]*)/);
    if (!nameMatch) { cursor = start + 1; continue; }
    const end = findTagEnd(html, start);
    if (end < 0) return null;
    return { start, end, name: nameMatch[1].toLowerCase(), text: html.slice(start, end) };
  }
  return null;
}

function findElementEnd(html, tag) {
  const closeStart = html.toLowerCase().indexOf(`</${tag.name}`, tag.end);
  if (closeStart < 0) return null;
  const closeEnd = findTagEnd(html, closeStart);
  return closeEnd < 0 ? null : { closeStart, closeEnd };
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function getAttr(tag, name) {
  const match = tag.match(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}
function escapeAttr(value) { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function setAttr(tag, name, value) {
  const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  if (expression.test(tag)) return tag.replace(expression, `$1"${escapeAttr(value)}"`);
  return tag.replace(/\s*\/?\s*>$/, (ending) => ` ${name}="${escapeAttr(value)}"${ending}`);
}
function removeAttr(tag, name) {
  return tag.replace(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi'), '');
}

// 轻量 JS lexer：跳过注释与普通字符串，保留语法 token，用来识别不能在
// 单文件中继续解析的模块依赖。无需引入 parser，但覆盖 side-effect import、
// import-from、export-from 与 dynamic import；字符串里的示例代码不会误报。
function tokenizeJavaScript(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (/\s/.test(char)) { index += 1; continue; }
    if (char === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          value += source.slice(index, index + 2);
          index += 2;
        } else if (source[index] === quote) {
          index += 1;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      tokens.push({ type: 'string', value });
      continue;
    }
    if (char === '`') {
      // 静态 import/export 不能合法地藏在模板文本中。为避免示例文本误报，
      // 整体跳过 template literal；非字面量 dynamic import 仍会由常规代码捕获。
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index] === '`') { index += 1; break; }
        else index += 1;
      }
      continue;
    }
    if (/[$A-Z_a-z]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[$\w]/.test(source[index])) index += 1;
      tokens.push({ type: 'identifier', value: source.slice(start, index) });
      continue;
    }
    tokens.push({ type: 'punctuator', value: char });
    index += 1;
  }
  return tokens;
}

function findModuleDependencies(source) {
  const tokens = tokenizeJavaScript(source);
  const dependencies = [];
  const add = (kind, token) => dependencies.push(`${kind}: ${token?.type === 'string' ? JSON.stringify(token.value) : '(非字面量)'}`);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier' || !['import', 'export'].includes(token.value)) continue;
    if (tokens[index - 1]?.value === '.') continue; // import.meta / obj.export

    const next = tokens[index + 1];
    if (token.value === 'import' && next?.value === '(') {
      add('dynamic import', tokens[index + 2]);
      continue;
    }
    if (token.value === 'import' && next?.type === 'string') {
      add('side-effect import', next);
      continue;
    }

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const current = tokens[cursor];
      if (current.value === ';') break;
      if (cursor > index + 1 && current.type === 'identifier' && ['import', 'export'].includes(current.value)) break;
      if (current.type === 'identifier' && current.value === 'from') {
        add(`${token.value}-from`, tokens[cursor + 1]);
        break;
      }
    }
  }
  return dependencies;
}

async function transformElements(html, elementName, callback) {
  let output = '';
  let cursor = 0;
  while (true) {
    let tag = nextStartTag(html, cursor);
    while (tag && tag.name !== elementName) tag = nextStartTag(html, tag.end);
    if (!tag) break;
    const elementEnd = findElementEnd(html, tag);
    if (!elementEnd) {
      unresolved.push(`${elementName}: 缺少闭合标签`);
      break;
    }
    const element = html.slice(tag.start, elementEnd.closeEnd);
    const content = html.slice(tag.end, elementEnd.closeStart);
    output += html.slice(cursor, tag.start) + await callback({ tag, element, content });
    cursor = elementEnd.closeEnd;
  }
  return output + html.slice(cursor);
}

async function transformStartTags(html, callback) {
  let output = '';
  let cursor = 0;
  while (true) {
    const tag = nextStartTag(html, cursor);
    if (!tag) break;
    output += html.slice(cursor, tag.start);
    if (tag.name === 'script' || tag.name === 'style') {
      const elementEnd = findElementEnd(html, tag);
      if (!elementEnd) {
        output += tag.text;
        cursor = tag.end;
      } else {
        output += html.slice(tag.start, elementEnd.closeEnd);
        cursor = elementEnd.closeEnd;
      }
      continue;
    }
    output += await callback(tag);
    cursor = tag.end;
  }
  return output + html.slice(cursor);
}

async function inlineSrcset(srcset, baseUrl, context) {
  // 不能直接 split(',')：data URI 自身包含逗号。按 srcset 的 URL + descriptor
  // 形态扫描，确保 `data:... 1x, ./local.png 2x` 的后续候选不会被漏掉。
  const candidates = [];
  let cursor = 0;
  while (cursor < srcset.length) {
    while (cursor < srcset.length && /[\s,]/.test(srcset[cursor])) cursor += 1;
    if (cursor >= srcset.length) break;
    const start = cursor;
    const isData = srcset.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    let dataCommaSeen = false;
    while (cursor < srcset.length && !/\s/.test(srcset[cursor])) {
      if (srcset[cursor] === ',') {
        if (!isData) break;
        if (!dataCommaSeen) dataCommaSeen = true; // data:[mime],payload 的必需逗号
        else if (/\s/.test(srcset[cursor + 1] || '')) break; // 无 descriptor 的候选分隔符
      }
      cursor += 1;
    }
    const url = srcset.slice(start, cursor);
    const descriptorStart = cursor;
    while (cursor < srcset.length && srcset[cursor] !== ',') cursor += 1;
    const descriptor = srcset.slice(descriptorStart, cursor);
    if (cursor < srcset.length) cursor += 1;
    candidates.push({ url, descriptor });
  }
  const output = [];
  for (const candidate of candidates) {
    if (/^data:/i.test(candidate.url)) {
      recordUrlPolicy(candidate.url, 'img', 'srcset', context);
      output.push(`${candidate.url}${candidate.descriptor}`.trim());
      continue;
    }
    const resource = await tryInline(candidate.url, baseUrl, context);
    const uri = resource ? safeDataUri(resource, 'img', 'srcset', context) : null;
    output.push(uri ? `${uri}${candidate.descriptor}` : `${candidate.url}${candidate.descriptor}`.trim());
  }
  return output.join(', ');
}

const documentUrl = pathToFileURL(inputRealPath);
let html = readFileSync(inputRealPath, 'utf8');
const sourceSha256 = createHash('sha256').update(html, 'utf8').digest('hex');

// <base href> 仅用于解析相对资源，不放宽网络或本地边界。
let baseUrl = documentUrl;
for (let tag = nextStartTag(html, 0); tag; tag = nextStartTag(html, tag.end)) {
  if (tag.name === 'base' && getAttr(tag.text, 'href')) {
    const href = getAttr(tag.text, 'href');
    if (!urlPolicyError(href, 'base', 'href')) baseUrl = new URL(href, documentUrl);
    break;
  }
}

// 先处理普通资源标签，扫描器会跳过 script/style 内容，不会误修 JS 字符串。
html = await transformStartTags(html, async (tag) => {
  let updated = tag.text;
  if (tag.name === 'base') {
    const href = getAttr(updated, 'href');
    if (href) recordUrlPolicy(href, 'base', 'href');
    activity.push(`removed <base>: ${getAttr(updated, 'href') || '(无 href)'}`);
    return '<!-- offline: base URL removed after resource resolution -->';
  }
  if (tag.name === 'link') {
    const href = getAttr(updated, 'href');
    const rel = (getAttr(updated, 'rel') || '').toLowerCase().split(/\s+/);
    if (!href) return updated;
    if (rel.includes('stylesheet')) {
      if (/fonts\.googleapis\.com/i.test(href) && !withFonts) {
        removedRemoteFonts = true;
        activity.push(`removed remote fonts: ${href}`);
        return '<!-- offline: remote fonts removed; system font tokens injected -->';
      }
      const resource = await tryInline(href, baseUrl, '<link rel="stylesheet">');
      if (!resource) return updated;
      const css = await inlineCss(resource.bytes.toString('utf8'), resource.finalUrl, `stylesheet ${href}`);
      const media = getAttr(updated, 'media');
      activity.push(`inlined stylesheet: ${href} (${Math.round(resource.bytes.length / 1024)}KB)`);
      return `<style${media ? ` media="${escapeAttr(media)}"` : ''}>/* inlined: ${href} */\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
    }
    if (rel.some((value) => ['preconnect', 'dns-prefetch', 'preload', 'modulepreload'].includes(value))) {
      activity.push(`removed network hint: ${href}`);
      return '<!-- offline: network hint removed -->';
    }
    if (rel.some((value) => ['icon', 'apple-touch-icon', 'mask-icon'].includes(value))) {
      // strict-offline 对 link data: fail-closed；图标不是报告运行所必需，直接移除。
      activity.push(`removed nonessential icon link: ${href}`);
      return '<!-- offline: nonessential icon link removed -->';
    }
    if (/^(?:https?:)?\/\//i.test(href)) return '<!-- offline: non-runtime remote link metadata removed -->';
    return updated;
  }

  const srcTags = new Set(['img', 'source', 'video', 'audio', 'track', 'input']);
  if (srcTags.has(tag.name)) {
    const src = getAttr(updated, 'src');
    if (src) {
      if (!recordUrlPolicy(src, tag.name, 'src')) {
        const resource = await tryInline(src, baseUrl, `<${tag.name} src>`);
        const uri = resource ? safeDataUri(resource, tag.name, 'src', `<${tag.name} src>`) : null;
        if (uri) updated = setAttr(updated, 'src', uri);
      }
    }
    const srcset = getAttr(updated, 'srcset');
    if (srcset) updated = setAttr(updated, 'srcset', await inlineSrcset(srcset, baseUrl, `<${tag.name} srcset>`));
    const poster = getAttr(updated, 'poster');
    if (poster) {
      if (!recordUrlPolicy(poster, tag.name, 'poster')) {
        const resource = await tryInline(poster, baseUrl, `<${tag.name} poster>`);
        const uri = resource ? safeDataUri(resource, tag.name, 'poster', `<${tag.name} poster>`) : null;
        if (uri) updated = setAttr(updated, 'poster', uri);
      }
    }
  }
  if (tag.name === 'image' || tag.name === 'use') {
    for (const attribute of ['href', 'xlink:href']) {
      const href = getAttr(updated, attribute);
      if (!href || href.startsWith('#')) continue;
      if (recordUrlPolicy(href, tag.name, attribute)) continue;
      const resource = await tryInline(href, baseUrl, `<${tag.name} ${attribute}>`);
      const uri = resource ? safeDataUri(resource, tag.name, attribute, `<${tag.name} ${attribute}>`) : null;
      if (uri) updated = setAttr(updated, attribute, uri);
    }
  }
  if (tag.name === 'iframe' && getAttr(updated, 'src') && !/^data:|^about:blank/i.test(getAttr(updated, 'src'))) {
    unresolved.push(`<iframe src>: ${getAttr(updated, 'src')} -> iframe 无法安全内联为单文件`);
  }
  if (tag.name === 'iframe' && getAttr(updated, 'srcdoc') !== null) {
    unresolved.push('<iframe srcdoc>: 主动 HTML 上下文无法安全固化为单文件');
  }
  if (tag.name === 'embed' && getAttr(updated, 'src')) {
    unresolved.push(`<embed src>: ${getAttr(updated, 'src')} -> 主动嵌入上下文无法安全内联`);
  }
  if (tag.name === 'object' && getAttr(updated, 'data')) {
    unresolved.push(`<object data>: ${getAttr(updated, 'data')} -> 主动嵌入上下文无法安全内联`);
  }
  const inlineStyle = getAttr(updated, 'style');
  if (inlineStyle && /url\(/i.test(inlineStyle)) {
    updated = setAttr(updated, 'style', await inlineCss(inlineStyle, baseUrl, `<${tag.name} style>`));
  }
  return updated;
});

html = await transformElements(html, 'style', async ({ tag, content }) => {
  const css = await inlineCss(content, baseUrl, '<style>');
  return `${tag.text}${css.replace(/<\/style/gi, '<\\/style')}</style>`;
});

html = await transformElements(html, 'script', async ({ tag, content }) => {
  const type = (getAttr(tag.text, 'type') || '').trim().toLowerCase().split(';')[0];
  const src = getAttr(tag.text, 'src');
  if (type === 'importmap') {
    unresolved.push(`<script type="importmap">${src ? `: ${src}` : ''} -> importmap 依赖解析/打包未实现，拒绝生成伪离线文件`);
    return `${tag.text}${content}</script>`;
  }
  if (!src) {
    const dependencies = findModuleDependencies(content)
      .filter((dependency) => type === 'module' || dependency.startsWith('dynamic import:'));
    dependencies.forEach((dependency) => unresolved.push(`<script${type === 'module' ? ' type="module"' : ''}>: ${dependency} -> 模块依赖未打包`));
    return `${tag.text}${content}</script>`;
  }
  if (recordUrlPolicy(src, 'script', 'src')) return `${tag.text}${content}</script>`;
  const resource = await tryInline(src, baseUrl, '<script src>');
  if (!resource) return `${tag.text}${content}</script>`;
  let openTag = removeAttr(tag.text, 'src');
  openTag = removeAttr(openTag, 'integrity');
  openTag = removeAttr(openTag, 'crossorigin');
  openTag = removeAttr(openTag, 'referrerpolicy');
  const script = resource.bytes.toString('utf8');
  const dependencies = findModuleDependencies(script)
    .filter((dependency) => type === 'module' || dependency.startsWith('dynamic import:'));
  dependencies.forEach((dependency) => unresolved.push(`<script${type === 'module' ? ' type="module"' : ''}>: ${src} -> ${dependency} 未打包`));
  activity.push(`inlined script: ${src} (${Math.round(resource.bytes.length / 1024)}KB)`);
  return `${openTag}/* inlined: ${src} */\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`;
});

function auditFinalDocumentUrls(documentHtml) {
  const urlAttributes = ['href', 'xlink:href', 'src', 'poster', 'data', 'action', 'formaction', 'cite', 'background', 'manifest'];
  let cursor = 0;
  while (true) {
    const tag = nextStartTag(documentHtml, cursor);
    if (!tag) break;
    for (const attribute of urlAttributes) {
      const raw = getAttr(tag.text, attribute);
      if (raw) recordUrlPolicy(raw, tag.name, attribute);
    }
    const ping = getAttr(tag.text, 'ping');
    if (ping) ping.split(/\s+/).filter(Boolean).forEach((raw) => recordUrlPolicy(raw, tag.name, 'ping'));
    if (tag.name === 'meta' && /^refresh$/i.test((getAttr(tag.text, 'http-equiv') || '').trim())) {
      const content = getAttr(tag.text, 'content') || '';
      const refreshUrl = content.match(/(?:^|;)\s*url\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s]+))/i);
      if (refreshUrl) recordUrlPolicy(refreshUrl[1] ?? refreshUrl[2] ?? refreshUrl[3], 'meta', 'content', '<meta http-equiv="refresh">');
    }
    if (tag.name === 'script' || tag.name === 'style') {
      const elementEnd = findElementEnd(documentHtml, tag);
      cursor = elementEnd ? elementEnd.closeEnd : tag.end;
    } else cursor = tag.end;
  }
}

auditFinalDocumentUrls(html);

if (removedRemoteFonts && !withFonts) {
  const systemFonts = `
<style id="offline-system-fonts">
/* Offline font contract: no network dependency; deterministic platform stacks. */
:root {
  --font-display: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-editorial: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-data: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}
</style>`;
  html = /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${systemFonts}\n</head>`) : `${systemFonts}\n${html}`;
}

// 为离线产物写入在线真源指纹；后续 Gate 可在不联网重打包的前提下阻断“在线已改、离线仍旧”。
const provenanceMeta = `<meta name="south-china-report-offline-source-sha256" content="${sourceSha256}">`;
html = /<head\b[^>]*>/i.test(html)
  ? html.replace(/<head\b[^>]*>/i, (head) => `${head}\n${provenanceMeta}`)
  : `${provenanceMeta}\n${html}`;

console.log('资源内联清单:');
if (activity.length === 0) console.log('  (无需内联的外部资源)');
else activity.forEach((item) => console.log(`  - ${item}`));
console.log('未内联清单:');
if (unresolved.length === 0) console.log('  (空)');
else unresolved.forEach((item) => console.error(`  - ${item}`));

if (unresolved.length > 0) {
  console.error(`[FAIL] 共 ${unresolved.length} 项资源未内联，未写出任何产物。`);
  process.exit(2);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`);
try {
  writeFileSync(temporaryPath, html, { encoding: 'utf8', flag: 'wx' });
  if (forceOutput) renameSync(temporaryPath, outputPath);
  else {
    // link() 具备 no-replace 语义：即使并发进程在前置检查后创建了目标，
    // 也不会被静默覆盖；目标链接建立时临时文件已经完整落盘。
    linkSync(temporaryPath, outputPath);
    unlinkSync(temporaryPath);
  }
} catch (error) {
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  console.error('[FAIL] 原子写入失败:', error.message);
  process.exit(2);
}

const outputBytes = Buffer.byteLength(html, 'utf8');
console.log(`[PASS] 离线版已写出: ${outputPath} (${(outputBytes / 1024 / 1024).toFixed(2)}MB)`);
console.log('请继续运行 validate-report.mjs --strict-offline 复核。');
