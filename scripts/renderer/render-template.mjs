import { readFile } from 'node:fs/promises';
import { blocked } from './errors.mjs';
import { escapeHtml } from './format-value.mjs';

const TITLE_ANCHOR = '<!-- SCR:REPORT_TITLE -->';
const ROOT_ANCHOR = 'data-scr-root-anchor="REPORT_ROOT"';
const REGIONS = {
  contracts: ['<!-- SCR:REPORT_CONTRACTS -->', '<!-- SCR:END_CONTRACTS -->'],
  content: ['<!-- SCR:REPORT_CONTENT -->', '<!-- SCR:END_CONTENT -->'],
  scripts: ['<!-- SCR:REPORT_SCRIPTS -->', '<!-- SCR:END_SCRIPTS -->'],
};

function occurrences(source, token) {
  return source.split(token).length - 1;
}

function replaceUnique(source, token, replacement, label) {
  const count = occurrences(source, token);
  if (count !== 1) blocked('template_anchor_invalid', `${label} 锚点必须恰好出现一次，实际 ${count}`);
  return source.replace(token, replacement);
}

function replaceRegion(source, [start, end], replacement, label) {
  const startCount = occurrences(source, start);
  const endCount = occurrences(source, end);
  if (startCount !== 1 || endCount !== 1) {
    blocked('template_anchor_invalid', `${label} 起止锚点必须各出现一次，实际 ${startCount}/${endCount}`);
  }
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < startIndex) blocked('template_anchor_invalid', `${label} 锚点顺序错误`);
  return source.slice(0, startIndex) + replacement + source.slice(endIndex + end.length);
}

export async function renderTemplate({ templatePath, density, title, contracts, content, scripts }) {
  let template;
  try {
    template = await readFile(templatePath, 'utf8');
  } catch (error) {
    blocked('template_read_failed', `无法读取模板: ${templatePath}`, [error.message]);
  }
  template = replaceUnique(template, TITLE_ANCHOR, escapeHtml(title), 'REPORT_TITLE');
  const rootTag = density === 'compact'
    ? '<html lang="zh-CN" data-density="compact">'
    : '<html lang="zh-CN">';
  const rootPattern = /<html\s+lang="zh-CN"\s+data-density="compact"\s+data-scr-root-anchor="REPORT_ROOT">/g;
  const rootMatches = template.match(rootPattern) || [];
  if (rootMatches.length !== 1 || occurrences(template, ROOT_ANCHOR) !== 1) {
    blocked('template_anchor_invalid', `REPORT_ROOT 锚点必须恰好出现一次，实际 ${rootMatches.length}`);
  }
  template = template.replace(rootPattern, rootTag);
  template = replaceRegion(template, REGIONS.contracts, contracts, 'REPORT_CONTRACTS');
  template = replaceRegion(template, REGIONS.content, content, 'REPORT_CONTENT');
  template = replaceRegion(template, REGIONS.scripts, scripts, 'REPORT_SCRIPTS');
  return template;
}
