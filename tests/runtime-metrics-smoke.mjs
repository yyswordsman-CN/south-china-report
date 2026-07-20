#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifier = path.join(root, 'scripts', 'verify-runtime.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'south-china-runtime-metrics-'));
const metricsPath = path.join(work, 'metrics.json');
writeFileSync(metricsPath, JSON.stringify({
  sales: 42,
  ratio: -12.5,
  scatter: { points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
  tree: { total: 100, children: [{ value: 60 }, { value: 40 }] },
  custom: [{ x: 1, y: 2, size: 8 }, { x: 2, y: 3, size: 12 }],
}));

function html({ chartValue = 42, domValue = 42, includeContract = true, injectUnbound = false, extraNumeric = false } = {}) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    ${includeContract ? `<script type="application/json" id="south-china-report-runtime-contract">{
      "version":1,"charts":[{"id":"chart-sales","series":[{"index":0,"metrics":["sales",{"path":"ratio","transform":"abs"}]}]}]
    }</script>` : ''}
    <style>body{font:16px sans-serif}.chart-container{width:320px;height:180px}</style></head><body>
    <main><h1>运行时数字样例</h1><p>销售额 <span data-metric="sales">${domValue}</span></p>
    <div id="chart-sales" class="chart-container" role="img" aria-label="销售与同比图"><canvas></canvas></div></main>
    <script>
      const chart = document.getElementById('chart-sales');
      const instance = {getOption(){return {series:[{data:[${extraNumeric ? `{value:${chartValue},symbolSize:10}` : chartValue},12.5]}]};}};
      window.echarts = {getInstanceByDom(element){return element === chart ? instance : null;}};
      ${injectUnbound ? `const extra=document.createElement('p');extra.textContent='运行时新增 99';document.querySelector('main').appendChild(extra);` : ''}
    </script></body></html>`;
}

function runContent(name, content) {
  const report = path.join(work, `${name}.html`);
  writeFileSync(report, content);
  return spawnSync(process.execPath, [verifier, report, metricsPath], { encoding: 'utf8' });
}

function run(name, options) {
  return runContent(name, html(options));
}

const structuredData = [
  { data: [[1, 10], [2, 20]] },
  { data: [{ name: '全部', value: 100, children: [{ name: '甲', value: 60 }, { name: '乙', value: 40 }] }] },
  { data: [
    { name: '点甲', value: [1, 2, 8], label: { formatter: '+8.0pp' }, itemStyle: { opacity: 0.8 } },
    { name: '点乙', value: [2, 3, 12], itemStyle: { opacity: 0.8 } },
  ] },
];

const structuredContract = {
  version: 2,
  charts: [{
    id: 'chart-structured',
    series: [
      {
        index: 0,
        bindings: [
          { dataPointer: '/0/0', metric: 'scatter.points.0.x' },
          { dataPointer: '/0/1', metric: 'scatter.points.0.y' },
          { dataPointer: '/1/0', metric: 'scatter.points.1.x' },
          { dataPointer: '/1/1', metric: 'scatter.points.1.y' },
        ],
      },
      {
        index: 1,
        bindings: [
          { dataPointer: '/0/value', metric: 'tree.total' },
          { dataPointer: '/0/children/0/value', metric: 'tree.children.0.value' },
          { dataPointer: '/0/children/1/value', metric: 'tree.children.1.value' },
        ],
      },
      {
        index: 2,
        bindings: [
          { dataPointer: '/0/value/0', metric: 'custom.0.x' },
          { dataPointer: '/0/value/1', metric: 'custom.0.y' },
          { dataPointer: '/0/value/2', metric: 'custom.0.size' },
          { dataPointer: '/0/label/formatter', metric: 'custom.0.size' },
          { dataPointer: '/1/value/0', metric: 'custom.1.x' },
          { dataPointer: '/1/value/1', metric: 'custom.1.y' },
          { dataPointer: '/1/value/2', metric: 'custom.1.size' },
        ],
        exemptions: [
          { dataPointer: '/0/itemStyle/opacity', reason: '视觉透明度常量，不表达业务值' },
          { dataPointer: '/1/itemStyle/opacity', reason: '视觉透明度常量，不表达业务值' },
        ],
      },
    ],
  }],
};

function structuredHtml(contract = structuredContract, data = structuredData) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <script type="application/json" id="south-china-report-runtime-contract">${JSON.stringify(contract)}</script>
    <style>body{font:16px sans-serif}.chart-container{width:320px;height:180px}</style></head><body>
    <main><h1>结构化图表样例</h1><div id="chart-structured" class="chart-container" role="img" aria-label="结构化图表"><canvas></canvas></div></main>
    <script>
      const chart = document.getElementById('chart-structured');
      const option = ${JSON.stringify({ series: data })};
      const instance = {getOption(){return option;}};
      window.echarts = {getInstanceByDom(element){return element === chart ? instance : null;}};
    </script></body></html>`;
}

function arbitraryNamedHtml({ value = 42, includeContract = true } = {}) {
  const contract = includeContract
    ? '<script type="application/json" id="south-china-report-runtime-contract">' + JSON.stringify({
      version: 1,
      charts: [{ id: 'salesGraph', series: [{ index: 0, metrics: ['sales'] }] }],
    }) + '</script>'
    : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">${contract}
    <style>#salesGraph{width:320px;height:180px}</style></head><body><main><h1>任意命名图表</h1>
    <div id="salesGraph" role="img" aria-label="销售图"><canvas></canvas></div></main>
    <script>
      const target=document.getElementById('salesGraph');
      const instance={getOption(){return {series:[{data:[${value}]}]};}};
      window.echarts={getInstanceByDom(element){return element===target?instance:null;}};
    </script></body></html>`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

try {
  const valid = run('valid');
  if (valid.status === 3) {
    console.error('[UNVERIFIED] runtime metrics smoke 需要 Playwright/Chromium');
    process.exit(3);
  }
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.match(valid.stdout, /2 个业务数值叶子匹配/);

  const wrongChart = run('wrong-chart', { chartValue: 41 });
  assert.equal(wrongChart.status, 1, wrongChart.stderr || wrongChart.stdout);
  assert.match(`${wrongChart.stdout}\n${wrongChart.stderr}`, /图表=41 ≠ metrics=42/);

  const wrongDom = run('wrong-dom', { domValue: 41 });
  assert.equal(wrongDom.status, 1, wrongDom.stderr || wrongDom.stdout);
  assert.match(`${wrongDom.stdout}\n${wrongDom.stderr}`, /渲染后显示 41/);

  const unbound = run('unbound', { injectUnbound: true });
  assert.equal(unbound.status, 1, unbound.stderr || unbound.stdout);
  assert.match(`${unbound.stdout}\n${unbound.stderr}`, /数字文本未绑定/);

  const missingContract = run('missing-contract', { includeContract: false });
  assert.equal(missingContract.status, 1, missingContract.stderr || missingContract.stdout);
  assert.match(`${missingContract.stdout}\n${missingContract.stderr}`, /缺少有效 #south-china-report-runtime-contract/);

  const scalarEscape = run('scalar-extra-numeric', { extraNumeric: true });
  assert.equal(scalarEscape.status, 1, scalarEscape.stderr || scalarEscape.stdout);
  assert.match(`${scalarEscape.stdout}\n${scalarEscape.stderr}`, /嵌套数值请使用 V2 bindings/);

  const arbitraryNamed = runContent('arbitrary-named-valid', arbitraryNamedHtml());
  assert.equal(arbitraryNamed.status, 0, arbitraryNamed.stderr || arbitraryNamed.stdout);
  assert.match(arbitraryNamed.stdout, /ECharts 运行时: 1 张图/);

  const arbitraryWrong = runContent('arbitrary-named-wrong', arbitraryNamedHtml({ value: 999 }));
  assert.equal(arbitraryWrong.status, 1, arbitraryWrong.stderr || arbitraryWrong.stdout);
  assert.match(`${arbitraryWrong.stdout}\n${arbitraryWrong.stderr}`, /图表=999 ≠ metrics=42/);

  const arbitraryMissingContract = runContent('arbitrary-named-no-contract', arbitraryNamedHtml({ includeContract: false }));
  assert.equal(arbitraryMissingContract.status, 1, arbitraryMissingContract.stderr || arbitraryMissingContract.stdout);
  assert.match(`${arbitraryMissingContract.stdout}\n${arbitraryMissingContract.stderr}`, /缺少有效 #south-china-report-runtime-contract/);

  const structured = runContent('structured-valid', structuredHtml());
  assert.equal(structured.status, 0, structured.stderr || structured.stdout);
  assert.match(structured.stdout, /14 个业务数值叶子匹配/);
  assert.match(structured.stdout, /2 个结构叶子显式豁免/);

  const unboundContract = clone(structuredContract);
  unboundContract.charts[0].series[2].bindings.pop();
  const structuredUnbound = runContent('structured-unbound', structuredHtml(unboundContract));
  assert.equal(structuredUnbound.status, 1, structuredUnbound.stderr || structuredUnbound.stdout);
  assert.match(`${structuredUnbound.stdout}\n${structuredUnbound.stderr}`, /数值\/null 叶子未绑定或豁免/);

  const wrongTreeContract = clone(structuredContract);
  wrongTreeContract.charts[0].series[1].bindings[0].metric = 'tree.children.0.value';
  const wrongTree = runContent('structured-wrong-tree', structuredHtml(wrongTreeContract));
  assert.equal(wrongTree.status, 1, wrongTree.stderr || wrongTree.stdout);
  assert.match(`${wrongTree.stdout}\n${wrongTree.stderr}`, /图表=100 ≠ metrics=60/);

  const duplicateContract = clone(structuredContract);
  duplicateContract.charts[0].series[0].exemptions = [
    { dataPointer: '/0/0', reason: '故意制造重复覆盖用于负向验证' },
  ];
  const duplicate = runContent('structured-duplicate', structuredHtml(duplicateContract));
  assert.equal(duplicate.status, 1, duplicate.stderr || duplicate.stdout);
  assert.match(`${duplicate.stdout}\n${duplicate.stderr}`, /重复绑定\/豁免 dataPointer/);

  const unsafeContract = clone(structuredContract);
  unsafeContract.charts[0].series[0].bindings[0].dataPointer = '/0/__proto__/value';
  const unsafe = runContent('structured-unsafe-pointer', structuredHtml(unsafeContract));
  assert.equal(unsafe.status, 1, unsafe.stderr || unsafe.stdout);
  assert.match(`${unsafe.stdout}\n${unsafe.stderr}`, /禁止原型链键/);

  const legacyStructuredContract = clone(structuredContract);
  legacyStructuredContract.version = 1;
  const legacyStructured = runContent('structured-v1-rejected', structuredHtml(legacyStructuredContract));
  assert.equal(legacyStructured.status, 1, legacyStructured.stderr || legacyStructured.stdout);
  assert.match(`${legacyStructured.stdout}\n${legacyStructured.stderr}`, /结构化 bindings 仅支持合同 version=2/);

  console.log('[PASS] runtime metrics smoke: V1 标量兼容，V2 坐标/树/custom 叶子绑定与安全负例均通过');
} finally {
  rmSync(work, { recursive: true, force: true });
}
