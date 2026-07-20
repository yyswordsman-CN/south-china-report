#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedWork = process.env.SCR_R3_OUTPUT_DIR?.trim();
const work = requestedWork
  ? path.resolve(requestedWork)
  : mkdtempSync(path.join(tmpdir(), 'south-china-renderer-r3-'));
const retainArtifacts = Boolean(requestedWork);
const domains = ['finance', 'people', 'inventory', 'quality', 'service', 'survey'];
const forbiddenDefaults = ['战区', '渠道', '产品', '客户', '销售'];
const colors = { favorable: '#047857', unfavorable: '#b91c1c', neutral: '#0353a4' };

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    label + '\n' + command + ' ' + args.join(' ') +
      '\nSTDOUT:\n' + result.stdout + '\nSTDERR:\n' + result.stderr,
  );
  return result;
}

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chartDefinitions(html) {
  const match = html.match(/const chartDefinitions = (\[[\s\S]*?\]);\n  const chartInstances/);
  assert.ok(match, '生成报告必须包含可解析的确定性 chartDefinitions');
  return JSON.parse(match[1]);
}

function metricSpan(html, metricPath) {
  const escaped = metricPath.replace(/[.*+?^()|[\]\\{}$]/g, '\\$&');
  return html.match(new RegExp('<span[^>]*data-metric="' + escaped + '"[^>]*>[^<]+<\\/span>'))?.[0] || '';
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

try {
  mkdirSync(path.join(work, 'inputs'), { recursive: true });
  mkdirSync(path.join(work, 'reports'), { recursive: true });
  const outputs = new Map();

  for (const domain of domains) {
    const inputDir = path.join(work, 'inputs', domain);
    const reportDir = path.join(work, 'reports', domain);
    mkdirSync(inputDir, { recursive: true });
    const metricsPath = path.join(inputDir, 'metrics.json');
    const insightsPath = path.join(inputDir, 'insights.json');
    const mapPath = path.join(root, 'evals', 'fixtures', 'generalized', domain + '.map.json');
    const specPath = path.join(root, 'evals', 'specs', 'generalized', domain + '.report-spec.json');

    run('python3', ['-B', path.join(root, 'scripts', 'prep-source.py'), 'build', '--map', mapPath, '--out', metricsPath], domain + ': metrics build');
    run('python3', ['-B', path.join(root, 'scripts', 'stat-insights.py'), metricsPath, '--out', insightsPath], domain + ': insights build');
    run(process.execPath, [
      path.join(root, 'scripts', 'build-report.mjs'),
      '--metrics', metricsPath,
      '--insights', insightsPath,
      '--spec', specPath,
      '--out-dir', reportDir,
    ], domain + ': seven-stage build');

    const metrics = readJson(metricsPath);
    const summary = readJson(path.join(reportDir, 'build-summary.json'));
    const html = readFileSync(path.join(reportDir, 'report.html'), 'utf8');
    const charts = chartDefinitions(html);
    assert.equal(summary.status, 'OK', domain + ': build-summary 必须为 OK');
    assert.equal(summary.delivery_ready, true, domain + ': 七段 Gate 后必须可交付');
    assert.equal(summary.steps.length, 7, domain + ': 必须执行完整七段 Gate');
    assert.equal(summary.steps.every((step) => step.status === 'OK'), true, domain + ': 七段 Gate 必须全绿');
    for (const viewport of ['desktop.png', 'desktop-1360.png', 'mobile.png', 'mobile-390.png']) {
      assert.equal(existsSync(path.join(reportDir, 'shots', viewport)), true, domain + ': 缺少 ' + viewport);
    }
    const text = visibleText(html);
    for (const term of forbiddenDefaults) {
      assert.equal(text.includes(term), false, domain + ': 无对应输入时不得出现默认词“' + term + '”');
    }
    outputs.set(domain, { metrics, summary, html, charts, reportDir });
  }

  for (const domain of ['people', 'inventory']) {
    const { metrics, charts, summary } = outputs.get(domain);
    assert.equal(metrics.analysis_scope.mode, 'snapshot');
    assert.equal(metrics.method_applicability.pvm.status, 'SKIPPED');
    assert.equal(metrics.method_applicability.pvm.reason_code, 'snapshot_has_no_time_baseline');
    assert.equal(metrics.method_applicability.mk_trend.status, 'SKIPPED');
    assert.equal(
      charts.some((chart) => chart.id.includes('trend') || chart.id.includes('slope')),
      false,
      domain + ': snapshot 不得生成趋势或斜率图',
    );
    const renderSummary = summary.steps.find((step) => step.id === 'render')?.summary;
    if (domain === 'people') {
      assert.deepEqual(renderSummary?.skipped, [{
        component_id: 'trend-people',
        component_type: 'trend_chart',
        reason_code: 'unresolved_path',
      }]);
    }
  }

  const finance = outputs.get('finance');
  assert.equal(finance.metrics.measure_results.cost.direction, 'lower_is_better');
  assert.equal(finance.metrics.measure_results.cost.favorable, true);
  assert.match(
    metricSpan(finance.html, 'measure_results.cost.current'),
    /data-semantic-state="favorable"/,
    '成本下降后，本期成本 KPI 必须使用有利语义色',
  );
  assert.equal(finance.metrics.method_applicability['hhi:revenue'].reason_code, 'descriptive_only_without_policy');
  assert.equal(visibleText(finance.html).includes('集中度风险'), false, '未配置 HHI 政策时不得生成风险定级');

  const inventory = outputs.get('inventory');
  const inventoryChart = inventory.charts.find((chart) => chart.id === 'chart-bar-inventory');
  assert.ok(inventoryChart, '库存高基数条形图必须生成');
  const inventoryData = inventoryChart.option.series.flatMap((series) => series.data);
  assert.equal(inventoryData.length, 18, '高基数夹具不得静默丢失类别');
  assert.deepEqual(
    inventoryData
      .map((item) => typeof item === 'number' ? item : item.value)
      .filter((value) => [5000000, 0, -5].includes(value))
      .sort((a, b) => b - a),
    [5000000, 0, -5],
    '极端值、零值和负数必须原值进入图表',
  );
  assert.equal(inventoryChart.option.xAxis.every((axis) => axis.scale === false), true, '水平条形图分区必须都保留零基线');
  assert.equal(inventoryChart.option.series.length, 2, '极端库存必须与其余对象分区展示');
  assert.deepEqual(
    [inventoryChart.responsive.split_number, inventoryChart.responsive.show_max_label],
    [2, false],
    '移动端必须减少刻度并隐藏可能越界的末端标签',
  );
  assert.match(inventory.html, /独立零基线，不可跨区比较条长/);
  assert.match(
    inventory.html,
    /id="chart-bar-inventory"[^>]*style="height:\s*(?:[6-9]\d\d|\d{4,})px"/,
    '高基数条形图必须按类别数量扩展高度',
  );

  const quality = outputs.get('quality');
  const qualityChart = quality.charts.find((chart) => chart.id === 'chart-slope-quality');
  assert.ok(qualityChart, '质量斜率图必须生成');
  assert.equal(quality.metrics.measure_results.defect_rate.direction, 'lower_is_better');
  assert.equal(
    qualityChart.option.series.every((series) => series.lineStyle.color === colors.favorable),
    true,
    '缺陷率下降必须使用有利语义色',
  );
  assert.equal(
    metricSpan(quality.html, 'measure_results.defect_rate.current').includes('>1.9%<'),
    true,
    '百分比必须按真实存储尺度显示',
  );

  const service = outputs.get('service');
  const serviceChart = service.charts.find((chart) => chart.id === 'chart-bar-service');
  assert.ok(serviceChart, '服务时长条形图必须生成');
  const serviceData = serviceChart.option.series.flatMap((series) => series.data);
  const serviceValues = serviceData.map((item) => item.value);
  assert.deepEqual(serviceValues, [9999, 36, 22], 'lower_is_better 应把最高风险对象排在首位');
  assert.deepEqual(
    serviceData.map((item) => item.itemStyle.color),
    [colors.unfavorable, colors.favorable, colors.favorable],
    '处理时长上升/下降必须分别使用不利/有利语义色',
  );
  assert.match(
    metricSpan(service.html, 'measure_results.resolution_time.current'),
    /data-semantic-state="unfavorable"/,
  );

  const survey = outputs.get('survey');
  assert.equal(
    metricSpan(survey.html, 'measure_results.response_rate.current').includes('>58.8%<'),
    true,
    '调查百分比不得放大或缩小一百倍',
  );
  const surveyChart = survey.charts.find((chart) => chart.id === 'chart-slope-survey');
  assert.equal(
    surveyChart.option.series.every((series) => series.lineStyle.color === colors.favorable),
    true,
    '得分改善必须使用有利语义色',
  );

  const suffix = retainArtifacts ? '；产物保留于 ' + work : '';
  console.log('[PASS] renderer R3 generalized: 六类真实链路、七段 Gate、快照降级、方向语义与压力边界均通过' + suffix);
} finally {
  if (!retainArtifacts) rmSync(work, { recursive: true, force: true });
}
