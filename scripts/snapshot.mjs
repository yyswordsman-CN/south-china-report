#!/usr/bin/env node
/**
 * snapshot.mjs — 报告截图与响应式硬闸门
 *
 * 用法: node scripts/snapshot.mjs <report.html> <out-dir/>
 * 产出: desktop.png (1440) / desktop-1360.png / mobile.png (430) /
 *       mobile-390.png / snap-<id>.png
 *
 * 退出码: 0=全部验证通过, 2=页面或布局验证失败,
 *         3=Playwright/Chromium 不可用（截图未验证）。
 */
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [,, reportArg, outArg] = process.argv;
if (!reportArg || !outArg) {
  console.error('用法: node scripts/snapshot.mjs <report.html> <out-dir/>');
  process.exit(1);
}

const reportPath = path.resolve(reportArg);
const outDir = path.resolve(outArg);
if (!existsSync(reportPath)) {
  console.error('报告不存在:', reportPath);
  process.exit(1);
}
if (outDir === path.parse(outDir).root) {
  console.error('拒绝将文件系统根目录作为截图输出目录:', outDir);
  process.exit(1);
}
const outParent = path.dirname(outDir);
mkdirSync(outParent, { recursive: true });
const reportUrl = pathToFileURL(reportPath).href;

const VIEWPORTS = [
  { id: 'desktop-1440', width: 1440, height: 900, dpr: 1.5, file: 'desktop.png' },
  { id: 'desktop-1360', width: 1360, height: 900, dpr: 1.5, file: 'desktop-1360.png' },
  { id: 'mobile-430', width: 430, height: 900, dpr: 2, file: 'mobile.png' },
  { id: 'mobile-390', width: 390, height: 844, dpr: 2, file: 'mobile-390.png' },
];

// 截图前强制 reveal 显示、冻结动效并把 CountUp 写成精确终值。
// 保留 data-to 的小数位，不再用 Math.floor 丢失精度。
const PREP = () => new Promise((resolve) => {
  document.querySelectorAll('.reveal').forEach((element) => element.classList.add('visible'));
  document.querySelectorAll('.hero-scroll-hint').forEach((element) => { element.style.display = 'none'; });

  const style = document.createElement('style');
  style.dataset.snapshotGate = 'true';
  style.textContent = '*{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
  document.head.appendChild(style);

  const setFinalValues = () => {
    document.querySelectorAll('[data-to]').forEach((element) => {
      const raw = String(element.getAttribute('data-to') || '').trim();
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value)) return;
      const decimalPart = raw.match(/\.(\d+)/)?.[1] || '';
      const decimals = Number(element.getAttribute('data-decimals') ?? decimalPart.length);
      const safeDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 12 ? decimals : decimalPart.length;
      const formatted = value.toLocaleString('en-US', {
        minimumFractionDigits: safeDecimals,
        maximumFractionDigits: safeDecimals,
      });
      element.textContent = `${element.getAttribute('data-prefix') || ''}${formatted}${element.getAttribute('data-suffix') || ''}`;
    });
  };

  const hasAnimatedValues = Boolean(document.querySelector('[data-to]'));
  const hasCharts = Boolean(document.querySelector('.chart-container, .tile-chart, [data-chart], [id^="chart-"]')) ||
    (typeof window.echarts?.getInstanceByDom === 'function' &&
      Array.from(document.querySelectorAll('*')).some((element) => Boolean(window.echarts.getInstanceByDom(element))));
  setFinalValues();
  window.dispatchEvent(new Event('resize'));
  // 旧报告可能已启动 1200–2000ms 的 requestAnimationFrame CountUp。
  // 等它结束后再写一次精确终值，避免截到中间帧。
  setTimeout(() => {
    setFinalValues();
    window.dispatchEvent(new Event('resize'));
    setTimeout(resolve, 100);
  }, hasAnimatedValues ? 2100 : (hasCharts ? 900 : 0));
});

function attachTelemetry(page, viewportId) {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText || '未知原因'})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return {
    assert() {
      if (errors.length > 0) {
        throw new Error(`${viewportId} 捕获到页面错误:\n- ${errors.join('\n- ')}`);
      }
    },
  };
}

async function attachNetworkGuard(page, viewportId) {
  const blocked = [];
  const localProtocols = new Set(['file:', 'data:', 'about:', 'blob:']);
  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    let protocol;
    try {
      protocol = new URL(requestUrl).protocol;
    } catch {
      blocked.push(requestUrl);
      await route.abort('blockedbyclient');
      return;
    }
    if (localProtocols.has(protocol)) await route.continue();
    else {
      blocked.push(requestUrl);
      await route.abort('blockedbyclient');
    }
  });
  await page.routeWebSocket('**/*', async (webSocket) => {
    blocked.push(webSocket.url());
    await webSocket.close({ code: 1008, reason: 'snapshot offline gate' });
  });
  return {
    assert() {
      if (blocked.length > 0) {
        throw new Error(`${viewportId} 阻断外部网络请求（请先生成离线版再截图）:\n- ${blocked.join('\n- ')}`);
      }
    },
  };
}

async function inspectPage(page, viewport) {
  return page.evaluate(({ width, id }) => {
    const root = document.documentElement;
    const body = document.body;
    const issues = [];
    const describeElement = (element) => {
      const classes = element.classList?.length ? `.${Array.from(element.classList).join('.')}` : '';
      return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}`;
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (element.closest('[hidden], [inert]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };
    const accessibleName = (element) => {
      const ariaLabel = (element.getAttribute('aria-label') || '').trim();
      if (ariaLabel) return ariaLabel;

      const labelledBy = (element.getAttribute('aria-labelledby') || '').trim();
      if (labelledBy) {
        const label = labelledBy.split(/\s+/)
          .map((labelId) => document.getElementById(labelId))
          .filter(Boolean)
          .map((labelElement) => (labelElement.getAttribute('aria-label') || labelElement.textContent || '').trim())
          .filter(Boolean)
          .join(' ');
        if (label) return label;
      }

      if (element.labels?.length) {
        const label = Array.from(element.labels).map((item) => (item.textContent || '').trim()).filter(Boolean).join(' ');
        if (label) return label;
      }
      const wrappingLabel = element.closest('label');
      if (wrappingLabel && wrappingLabel !== element) {
        const label = (wrappingLabel.textContent || '').trim();
        if (label) return label;
      }
      if (element.matches('img, input[type="image"]')) {
        const alt = (element.getAttribute('alt') || '').trim();
        if (alt) return alt;
      }
      if (element.matches('input[type="button"], input[type="submit"], input[type="reset"]')) {
        const value = (element.getAttribute('value') || '').trim();
        if (value) return value;
      }
      const childImageAlt = Array.from(element.querySelectorAll?.('img[alt]') || [])
        .map((image) => (image.getAttribute('alt') || '').trim()).filter(Boolean).join(' ');
      if (childImageAlt) return childImageAlt;
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) return text;
      return (element.getAttribute('title') || '').trim();
    };
    const rootScrollWidth = Math.max(root.scrollWidth, body?.scrollWidth || 0);
    const clientWidth = root.clientWidth;
    // 始终检查未被局部滚动/裁切容器承接的元素越界；不仅看根 scrollWidth。
    // 否则 body { overflow-x: clip } 会把真实断版伪装成“无横向滚动”。
    const overflowers = Array.from(document.querySelectorAll('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.right <= width + 1 && rect.left >= -1) return false;
        let parent = element.parentElement;
        while (parent && parent !== body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (['auto', 'scroll', 'hidden', 'clip'].includes(overflowX)) return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const name = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${Array.from(element.classList).join('.')}` : ''}`;
        return `${name} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`;
      });
    if (rootScrollWidth > clientWidth + 1 || clientWidth !== width) {
      issues.push(`横向溢出: viewport=${width}, clientWidth=${clientWidth}, scrollWidth=${rootScrollWidth}${overflowers.length ? `; 候选=${overflowers.join(', ')}` : ''}`);
    } else if (overflowers.length > 0) {
      issues.push(`元素越出视口（根层裁切不算响应式通过）: ${overflowers.join(', ')}`);
    }

    // 自动化无障碍闸门：DOM 语义、键盘合同和 WCAG AA 文本对比度。
    // Chromium AX 树与真实 Tab 路径在 page.evaluate 之后由 Playwright 复核。
    const language = (root.getAttribute('lang') || '').trim();
    if (!language) issues.push('无障碍: <html> 缺少 lang 属性');
    if (!(document.title || '').trim()) issues.push('无障碍: 文档缺少非空 <title>');

    const headings = Array.from(document.querySelectorAll('h1'));
    if (headings.length !== 1) issues.push(`无障碍: 页面必须且只能有一个 h1，当前 ${headings.length} 个`);
    const visibleHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(isVisible);
    for (let index = 1; index < visibleHeadings.length; index += 1) {
      const previous = Number(visibleHeadings[index - 1].tagName.slice(1));
      const current = Number(visibleHeadings[index].tagName.slice(1));
      if (current > previous + 1) {
        issues.push(`无障碍: 标题层级从 h${previous} 跳到 h${current}: ${JSON.stringify((visibleHeadings[index].textContent || '').trim())}`);
      }
    }

    const idOwners = new Map();
    document.querySelectorAll('[id]').forEach((element) => {
      const elementId = element.getAttribute('id') || '';
      if (!elementId.trim()) {
        issues.push(`无障碍: ${describeElement(element)} 的 id 为空`);
        return;
      }
      if (idOwners.has(elementId)) issues.push(`无障碍: 重复 id ${JSON.stringify(elementId)}`);
      else idOwners.set(elementId, element);
    });

    document.querySelectorAll('img').forEach((image) => {
      if (isVisible(image) && !image.hasAttribute('alt')) {
        issues.push(`无障碍: 可见图片缺少 alt: ${describeElement(image)}`);
      }
    });

    const interactiveSelector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary',
      '[contenteditable="true"]', '[role="button"]', '[role="link"]', '[role="checkbox"]',
      '[role="radio"]', '[role="switch"]', '[role="menuitem"]', '[role="tab"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    Array.from(document.querySelectorAll(interactiveSelector))
      .filter((element, index, all) => all.indexOf(element) === index && isVisible(element))
      .forEach((element) => {
        if (!accessibleName(element)) issues.push(`无障碍: 可见交互控件缺少可访问名称: ${describeElement(element)}`);
        const tabindex = element.getAttribute('tabindex');
        if (tabindex != null && Number(tabindex) > 0) {
          issues.push(`无障碍: 禁止正数 tabindex=${JSON.stringify(tabindex)}，应保持 DOM 自然顺序: ${describeElement(element)}`);
        }
      });

    document.querySelectorAll('[onclick]').forEach((element) => {
      if (!isVisible(element)) return;
      if (!element.matches(interactiveSelector)) {
        issues.push(`无障碍: onclick 元素不可通过键盘访问: ${describeElement(element)}`);
      }
    });

    for (const attribute of ['aria-labelledby', 'aria-describedby']) {
      document.querySelectorAll(`[${attribute}]`).forEach((element) => {
        const ids = (element.getAttribute(attribute) || '').trim().split(/\s+/).filter(Boolean);
        if (ids.length === 0) issues.push(`无障碍: ${describeElement(element)} 的 ${attribute} 为空`);
        ids.forEach((reference) => {
          if (!document.getElementById(reference)) {
            issues.push(`无障碍: ${describeElement(element)} 的 ${attribute} 引用不存在的 id ${JSON.stringify(reference)}`);
          }
        });
      });
    }

    Array.from(document.querySelectorAll('[role="region"]')).filter(isVisible).forEach((region) => {
      const ariaLabel = (region.getAttribute('aria-label') || '').trim();
      const labelledBy = (region.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean)
        .map((reference) => document.getElementById(reference))
        .filter(Boolean)
        .map((label) => (label.textContent || '').trim())
        .filter(Boolean)
        .join(' ');
      if (!ariaLabel && !labelledBy) issues.push(`无障碍: region 缺少可访问名称: ${describeElement(region)}`);
    });

    Array.from(document.querySelectorAll('[aria-hidden="true"]')).forEach((hiddenTree) => {
      const focusable = Array.from(hiddenTree.querySelectorAll(interactiveSelector)).find(isVisible);
      if (focusable) issues.push(`无障碍: aria-hidden 区域含可聚焦元素: ${describeElement(focusable)}`);
    });

    const mainLandmarks = Array.from(document.querySelectorAll('main, [role="main"]'))
      .filter((element, index, all) => all.indexOf(element) === index && isVisible(element));
    if (mainLandmarks.length !== 1) issues.push(`无障碍: 页面应有且仅有一个可见 main landmark，当前 ${mainLandmarks.length} 个`);

    Array.from(document.querySelectorAll('table')).filter(isVisible).forEach((table) => {
      const headers = Array.from(table.querySelectorAll('thead th, th[scope="col"], th[scope="row"]'));
      if (headers.length === 0) {
        issues.push(`无障碍: 可见表格缺少表头: ${describeElement(table)}`);
      } else {
        headers.filter((header) => !accessibleName(header)).forEach((header) => {
          issues.push(`无障碍: 表头缺少可访问名称: ${describeElement(header)}`);
        });
      }
    });

    // CSS 计算值对比度。对渐变背景逐色标取最差值；不把大字号当成普通字号放宽。
    const parseColor = (value) => {
      const match = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] == null ? 1 : Number(match[4]) };
    };
    const composite = (front, back) => {
      const alpha = front.a + back.a * (1 - front.a);
      if (alpha <= 0) return { r: 255, g: 255, b: 255, a: 1 };
      return {
        r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
        g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
        b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
        a: alpha,
      };
    };
    const luminance = (color) => {
      const channel = (raw) => {
        const value = raw / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const contrast = (first, second) => {
      const a = luminance(first);
      const b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const elementBackgrounds = (element, skipOwnImage = false) => {
      const lineage = [];
      for (let current = element; current; current = current.parentElement) lineage.unshift(current);
      let candidates = [{ r: 255, g: 255, b: 255, a: 1 }];
      let unknownImage = false;
      lineage.forEach((node) => {
        const style = getComputedStyle(node);
        const background = parseColor(style.backgroundColor);
        if (background && background.a > 0) candidates = candidates.map((base) => composite(background, base));
        if (style.backgroundImage && style.backgroundImage !== 'none' && !(skipOwnImage && node === element)) {
          const stops = Array.from(style.backgroundImage.matchAll(/rgba?\([^)]*\)/gi))
            .map((match) => parseColor(match[0])).filter(Boolean);
          if (stops.length > 0) {
            candidates = candidates.flatMap((base) => stops.map((stop) => composite(stop, base))).slice(0, 24);
          } else unknownImage = true;
        }
      });
      return { candidates, unknownImage };
    };
    const contrastIssues = [];
    const contrastUnknown = [];
    const directTextElements = Array.from(document.body.querySelectorAll('*')).filter((element) => {
      if (!isVisible(element) || element.closest('script,style,template,noscript,svg,canvas')) return false;
      return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent || '').trim());
    });
    directTextElements.forEach((element) => {
      const style = getComputedStyle(element);
      const foreground = parseColor(style.color);
      if (!foreground) return;
      const opacity = Number(style.opacity);
      if (Number.isFinite(opacity)) foreground.a *= opacity;
      const textFill = parseColor(style.webkitTextFillColor);
      const gradientText = Boolean(textFill && textFill.a === 0
        && (style.webkitBackgroundClip === 'text' || style.backgroundClip === 'text')
        && style.backgroundImage && style.backgroundImage !== 'none');
      const gradientStops = gradientText
        ? Array.from(style.backgroundImage.matchAll(/rgba?\([^)]*\)/gi)).map((match) => parseColor(match[0])).filter(Boolean)
        : [];
      const foregrounds = gradientStops.length > 0 ? gradientStops : [foreground];
      const backgrounds = elementBackgrounds(element, gradientText);
      if (backgrounds.unknownImage) {
        contrastUnknown.push(describeElement(element));
        return;
      }
      const ratios = backgrounds.candidates.flatMap((background) => foregrounds.map((color) => contrast(composite(color, background), background)));
      const minimum = Math.min(...ratios);
      const fontSize = Number.parseFloat(style.fontSize) || 0;
      const rawWeight = Number.parseInt(style.fontWeight, 10);
      const fontWeight = Number.isFinite(rawWeight) ? rawWeight : (style.fontWeight === 'bold' ? 700 : 400);
      const largeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = largeText ? 3 : 4.5;
      if (minimum + 1e-6 < required) {
        const preview = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
        contrastIssues.push(`${describeElement(element)} ${minimum.toFixed(2)}:1 < ${required}:1 (${JSON.stringify(preview)})`);
      }
    });
    if (contrastIssues.length > 0) {
      issues.push(`无障碍: WCAG AA 文本对比度不足 ${contrastIssues.length} 处: ${contrastIssues.slice(0, 8).join('; ')}`);
    }
    if (contrastUnknown.length > 0) {
      issues.push(`无障碍: ${contrastUnknown.length} 处文字背景含无法解析的图片，不能自动证明对比度: ${contrastUnknown.slice(0, 5).join(', ')}`);
    }

    const snapIds = Array.from(document.querySelectorAll('[data-snap]')).map((element) => element.getAttribute('data-snap') || '');
    const seen = new Set();
    snapIds.forEach((snapId) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(snapId)) issues.push(`data-snap 不安全或为空: ${JSON.stringify(snapId)}`);
      if (seen.has(snapId)) issues.push(`data-snap 重复: ${JSON.stringify(snapId)}`);
      seen.add(snapId);
    });

    const allElements = Array.from(document.querySelectorAll('*'));
    const instanceElements = typeof window.echarts?.getInstanceByDom === 'function'
      ? allElements.filter((element) => Boolean(window.echarts.getInstanceByDom(element)))
      : [];
    const declaredElements = Array.from(document.querySelectorAll('.chart-container, .tile-chart, [data-chart], [id^="chart-"]'));
    const chartElements = [...new Set([...instanceElements, ...declaredElements])]
      // 兼容旧报告只用 chart-* id 的容器，同时排除 chart-*-title / description 等标签。
      .filter((element) => element.matches('.chart-container, .tile-chart, [data-chart]')
        || Boolean(element.querySelector('canvas, svg'))
        || Boolean(typeof window.echarts !== 'undefined' && window.echarts.getInstanceByDom(element)))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).display !== 'none';
      });
    if (chartElements.length > 0 && typeof window.echarts === 'undefined') {
      issues.push(`存在 ${chartElements.length} 个图表容器，但 ECharts 未加载`);
    } else if (chartElements.length > 0) {
      chartElements.forEach((element) => {
        const instance = window.echarts.getInstanceByDom(element);
        const hasSurface = Boolean(element.querySelector('canvas, svg'));
        if (!instance || !hasSurface) issues.push(`图表未完成渲染: #${element.id || '(无 id)'}`);
        if (instance && !element.id) issues.push('ECharts 图表容器缺少稳定 id，无法绑定运行时合同');
        if (!accessibleName(element)) issues.push(`无障碍: 图表缺少 aria-label/aria-labelledby: ${describeElement(element)}`);
      });
    }

    const visibleText = body?.innerText || '';
    if (/\b(?:NaN|undefined)\b/.test(visibleText)) issues.push('页面可见文本包含 NaN/undefined');

    document.querySelectorAll('.hero-title').forEach((title) => {
      const text = Array.from((title.textContent || '').trim());
      if (text.length < 5 || !text.some((char) => /[\u3400-\u9fff]/.test(char))) return;
      const characters = [];
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        Array.from(node.textContent || '').forEach((character, index) => {
          if (character.trim()) characters.push({ node, index });
        });
      }
      const lines = new Map();
      characters.forEach(({ node, index }) => {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        const rect = range.getBoundingClientRect();
        const key = Math.round(rect.top);
        lines.set(key, (lines.get(key) || 0) + 1);
      });
      const counts = Array.from(lines.values());
      if (counts.length > 1 && counts[counts.length - 1] === 1) issues.push(`Hero 标题存在末行孤字: ${JSON.stringify(title.textContent.trim())}`);
    });

    return {
      id,
      width,
      clientWidth,
      scrollWidth: rootScrollWidth,
      snapIds,
      chartCount: chartElements.length,
      accessibility: {
        language,
        h1Count: headings.length,
        mainCount: mainLandmarks.length,
        headingCount: visibleHeadings.length,
        contrastSamples: directTextElements.length,
      },
      issues,
    };
  }, viewport);
}

async function inspectKeyboardPath(page, viewportId) {
  const expected = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
    };
    const selector = [
      'a[href]', 'button:not([disabled])', 'input:not([type="hidden"]):not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])', 'summary', '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    return Array.from(document.querySelectorAll(selector))
      .filter((element, index, all) => all.indexOf(element) === index && isVisible(element) && element.tabIndex >= 0)
      .map((element, index) => {
        const focusId = `snapshot-focus-${index}`;
        element.setAttribute('data-snapshot-focus-id', focusId);
        return focusId;
      });
  });

  if (expected.length === 0) return { count: 0, issues: [] };
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  const reached = [];
  const issues = [];
  for (let index = 0; index < expected.length; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return { id: '', visible: false, indicator: false, name: '' };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
      const indicator = (style.outlineStyle !== 'none' && outlineWidth > 0)
        || (style.boxShadow && style.boxShadow !== 'none');
      return {
        id: element.getAttribute('data-snapshot-focus-id') || '',
        visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight,
        indicator,
        name: element.id || element.getAttribute('aria-label') || element.tagName.toLowerCase(),
      };
    });
    if (!state.id) {
      issues.push(`${viewportId}: 第 ${index + 1} 次 Tab 未落到预期可聚焦元素`);
      break;
    }
    reached.push(state.id);
    if (!state.visible) issues.push(`${viewportId}: 焦点元素不在可视区域: ${state.name}`);
    if (!state.indicator) issues.push(`${viewportId}: 焦点元素缺少可见 focus indicator: ${state.name}`);
  }
  const missing = expected.filter((id) => !reached.includes(id));
  if (missing.length > 0) issues.push(`${viewportId}: Tab 路径漏过 ${missing.length}/${expected.length} 个可聚焦元素`);
  if (new Set(reached).size !== reached.length) issues.push(`${viewportId}: Tab 路径在覆盖全部元素前发生循环/焦点陷阱`);
  return { count: expected.length, issues };
}

async function inspectAccessibilityTree(page, viewportId) {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes = [] } = await session.send('Accessibility.getFullAXTree');
    const active = nodes.filter((node) => !node.ignored);
    const roleOf = (node) => String(node.role?.value || '');
    const nameOf = (node) => String(node.name?.value || '').trim();
    const property = (node, name) => node.properties?.find((item) => item.name === name)?.value?.value;
    const issues = [];
    const roots = active.filter((node) => roleOf(node) === 'RootWebArea');
    if (roots.length !== 1) issues.push(`${viewportId}: AX 树应有且仅有一个 RootWebArea，当前 ${roots.length}`);
    const mains = active.filter((node) => roleOf(node) === 'main');
    if (mains.length !== 1) issues.push(`${viewportId}: AX 树应有且仅有一个 main，当前 ${mains.length}`);
    active.filter((node) => property(node, 'focusable') === true && roleOf(node) !== 'RootWebArea').forEach((node) => {
      if (!nameOf(node) && !['generic', 'group'].includes(roleOf(node))) {
        issues.push(`${viewportId}: AX 可聚焦节点缺少名称 (role=${roleOf(node) || 'unknown'})`);
      }
    });
    active.filter((node) => ['heading', 'button', 'link', 'img', 'region'].includes(roleOf(node))).forEach((node) => {
      if (!nameOf(node) && !(['img'].includes(roleOf(node)) && property(node, 'ignored') === true)) {
        issues.push(`${viewportId}: AX ${roleOf(node)} 节点缺少可读名称`);
      }
    });
    return { nodeCount: active.length, issues };
  } finally {
    await session.detach();
  }
}

async function openVerifiedPage(browser, viewport) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
  });
  const networkGuard = await attachNetworkGuard(page, viewport.id);
  const telemetry = attachTelemetry(page, viewport.id);
  await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.evaluate(PREP);
  await page.waitForTimeout(100);
  networkGuard.assert();
  telemetry.assert();
  const inspection = await inspectPage(page, viewport);
  const keyboard = await inspectKeyboardPath(page, viewport.id);
  const axTree = await inspectAccessibilityTree(page, viewport.id);
  const issues = [...inspection.issues, ...keyboard.issues, ...axTree.issues];
  if (issues.length > 0) {
    throw new Error(`${viewport.id} 验证失败:\n- ${issues.join('\n- ')}`);
  }
  inspection.accessibility.keyboardTargets = keyboard.count;
  inspection.accessibility.axNodes = axTree.nodeCount;
  return { page, inspection };
}

function publishStagedDirectory(stagingDir) {
  let backupDir = null;
  if (existsSync(outDir)) {
    backupDir = path.join(outParent, `.${path.basename(outDir)}.previous-${process.pid}-${Date.now()}`);
    renameSync(outDir, backupDir);
  }
  try {
    // staging 与目标位于同一父目录，rename 是同文件系统原子发布。
    renameSync(stagingDir, outDir);
  } catch (error) {
    // 发布失败时恢复原成功目录；绝不把旧产物当本轮临时文件清理。
    if (backupDir && existsSync(backupDir) && !existsSync(outDir)) renameSync(backupDir, outDir);
    throw error;
  }
  if (backupDir && existsSync(backupDir)) {
    try {
      rmSync(backupDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[WARN] 新截图已发布，但旧目录备份清理失败: ${backupDir} (${error.message})`);
    }
  }
}

async function shoot() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    console.error('[UNVERIFIED] 未安装 Playwright，未执行截图和响应式验证。');
    console.error('请运行 `npm i -D playwright && npx playwright install chromium` 后重试。');
    console.error('原因:', error.message);
    process.exit(3);
  }

  let browser;
  try {
    const executablePath = process.env.SCR_CHROMIUM_EXECUTABLE?.trim();
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    console.error('[UNVERIFIED] Chromium 启动失败:', error.message);
    process.exit(3);
  }

  const pages = new Map();
  const written = [];
  const stagingDir = mkdtempSync(path.join(outParent, `.${path.basename(outDir)}.staging-`));
  let published = false;
  try {
    for (const viewport of VIEWPORTS) {
      const result = await openVerifiedPage(browser, viewport);
      pages.set(viewport.id, result.page);
      await result.page.screenshot({ path: path.join(stagingDir, viewport.file), fullPage: true });
      written.push(viewport.file);
      console.log(`[PASS] ${viewport.id}: clientWidth=${result.inspection.clientWidth}, scrollWidth=${result.inspection.scrollWidth}, charts=${result.inspection.chartCount}, a11y=DOM/AX/Tab/contrast 通过 (${result.inspection.accessibility.axNodes} AX nodes, ${result.inspection.accessibility.keyboardTargets} focus targets)`);
    }

    const sectionPage = pages.get('desktop-1360');
    const snapLocator = sectionPage.locator('[data-snap]');
    const count = await snapLocator.count();
    for (let index = 0; index < count; index += 1) {
      const element = snapLocator.nth(index);
      const snapId = await element.getAttribute('data-snap');
      // inspectPage 已保证 id 非空、唯一且只包含安全字符，无需再用原值拼 CSS selector。
      const file = `snap-${snapId}.png`;
      await element.screenshot({ path: path.join(stagingDir, file) });
      written.push(file);
    }

    publishStagedDirectory(stagingDir);
    published = true;
    console.log('\n[PASS] 截图与响应式闸门全部通过:', outDir);
    written.forEach((file) => console.log('  ', file));
  } catch (error) {
    console.error('[FAIL] 截图闸门未通过:', error.message);
    process.exitCode = 2;
  } finally {
    if (!published && existsSync(stagingDir)) rmSync(stagingDir, { recursive: true, force: true });
    await browser.close();
  }
}

await shoot();
