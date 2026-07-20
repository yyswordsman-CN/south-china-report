import assert from 'node:assert/strict';
import {
  buildSlopeOption,
  categoryLayout,
  dynamicValueDomain,
  ellipsizeLabel,
  semanticDeltaState,
} from '../scripts/chart-semantics.mjs';

assert.equal(semanticDeltaState(10, 12, 'higher_is_better'), 'favorable');
assert.equal(semanticDeltaState(10, 12, 'lower_is_better'), 'unfavorable');
assert.equal(semanticDeltaState(12, 10, 'lower_is_better'), 'favorable');
assert.equal(semanticDeltaState(-10, -4, 'neutral'), 'neutral');

const domain = dynamicValueDomain([-1_000_000, -5, 0, 8, 900_000_000]);
assert.ok(domain.min < -1_000_000);
assert.ok(domain.max > 900_000_000);
assert.deepEqual(dynamicValueDomain([0, 100], { boundedPercent: true }), { min: 0, max: 100 });

const labels = ['极长的跨业务分类标签用于验证紧凑布局不会被单行挤坏', '短标签'];
assert.equal(categoryLayout(labels, 390).orientation, 'horizontal');
assert.ok(Array.from(ellipsizeLabel(labels[0], 12)).length <= 12);

const option = buildSlopeOption([
  { name: '平均处理时长', before: 48, after: 36 },
  { name: '缺陷率', before: 1.2, after: 1.8 },
], { periodLabels: ['基线期', '当前期'], direction: 'lower_is_better', unit: 'minute' });
assert.deepEqual(option.xAxis.data, ['基线期', '当前期']);
assert.equal(option.series[0].encode.semanticState, 'favorable');
assert.equal(option.series[1].encode.semanticState, 'unfavorable');
assert.ok(option.yAxis.min < 1.2 && option.yAxis.max > 48);
assert.throws(() => buildSlopeOption([], { direction: 'neutral' }), /periodLabels/);

console.log('[PASS] chart semantics: 方向、动态轴域、长标签、高基数与显式期间标签均通过');
