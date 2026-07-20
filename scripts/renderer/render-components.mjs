import {
  addClaim,
  addDomMetric,
  addSkipped,
  claimAttributes,
  createBindingManifest,
  evidenceId,
} from './binding-manifest.mjs';
import { blocked, RendererError } from './errors.mjs';
import {
  escapeAttribute,
  escapeHtml,
  formatMetric,
  renderDimensionLabel,
  safeJsonForScript,
  unitLabel,
} from './format-value.mjs';
import { renderChart } from './render-charts.mjs';
import { resolvePath } from './resolve-path.mjs';

function metricSemanticState(metrics, metricPath, semantic) {
  if (semantic.direction === 'neutral' || !semantic.direction) return 'neutral';
  const parts = metricPath.split('.');
  let favorable = null;
  if (parts[0] === 'measure_results' && parts.length >= 3) {
    const leaf = parts[2];
    if (['current', 'change_abs', 'change_pct'].includes(leaf)) {
      favorable = metrics.measure_results?.[parts[1]]?.favorable;
    }
  } else if (parts[0] === 'measure_dimensions' && parts.length >= 5 && /^\d+$/.test(parts[3])) {
    const row = metrics.measure_dimensions?.[parts[1]]?.[parts[2]]?.[Number(parts[3])];
    if (['current', 'value', 'change_abs', 'change_pct', 'delta'].includes(parts[4])) favorable = row?.favorable;
  }
  if (favorable === true) return 'favorable';
  if (favorable === false) return 'unfavorable';
  return 'neutral';
}

function renderMetric(manifest, metrics, ref, { className = '', key = false } = {}) {
  const formatted = formatMetric(metrics, ref);
  addDomMetric(manifest, ref.path, { key });
  const classAttr = className ? ` class="${escapeAttribute(className)}"` : '';
  const semanticState = metricSemanticState(metrics, ref.path, formatted.semantic);
  return {
    ...formatted,
    semanticState,
    html: `<span${classAttr} data-metric="${escapeAttribute(ref.path)}" data-direction="${escapeAttribute(formatted.semantic.direction || 'neutral')}" data-semantic-state="${semanticState}">${escapeHtml(formatted.text)}</span>`,
  };
}

function registerClaims(spec, manifest) {
  const governing = spec.narrative.governing_thought;
  const governingId = evidenceId('GOVERNING', spec.report.id, governing.claim_kind);
  addClaim(manifest, { id: governingId, kind: governing.claim_kind, ...governing });

  const chapterClaims = new Map();
  for (const chapter of spec.narrative.chapters) {
    const claimId = evidenceId('CHAPTER', chapter.id, chapter.claim_kind);
    addClaim(manifest, {
      id: claimId,
      kind: chapter.claim_kind,
      evidence: chapter.evidence,
      reason: chapter.reason,
      validation_needed: chapter.validation_needed,
    });
    chapterClaims.set(chapter.id, claimId);
  }

  const actionClaims = new Map();
  for (const action of spec.actions) {
    const claimId = evidenceId('ACTION', action.id, action.claim_kind);
    addClaim(manifest, {
      id: claimId,
      kind: action.claim_kind,
      evidence: action.evidence,
      reason: action.reason,
      validation_needed: action.validation_needed,
    });
    actionClaims.set(action.id, claimId);
  }

  const allActionsEvidence = spec.actions.every((action) => action.claim_kind === 'action');
  const closingId = evidenceId('CLOSING', spec.report.id, allActionsEvidence ? 'action' : 'hypothesis');
  if (allActionsEvidence) {
    addClaim(manifest, {
      id: closingId,
      kind: 'action',
      evidence: [...new Set(spec.actions.flatMap((action) => action.evidence || []))],
    });
  } else {
    addClaim(manifest, {
      id: closingId,
      kind: 'hypothesis',
      reason: '行动组合包含待验证的管理假设',
      validation_needed: '按每项行动的责任、期限与验证指标逐项复核',
    });
  }
  return { governingId, chapterClaims, actionClaims, closingId, closingKind: allActionsEvidence ? 'action' : 'hypothesis' };
}

function renderHero(component, spec, metrics, manifest, claims) {
  const primary = renderMetric(manifest, metrics, component.primary_metric, { className: 'hero-number', key: true });
  const label = component.primary_metric.label || primary.semantic.measureId || '核心指标';
  const unit = unitLabel(primary.semantic);
  return `<section class="hero" data-snap="hero">
  <div class="hero-badge">${escapeHtml(spec.report.organization)} · ${escapeHtml(spec.report.subject)}</div>
  <h1 class="hero-title" ${claimAttributes(claims.governingId, spec.narrative.governing_thought.claim_kind)}>${escapeHtml(spec.narrative.governing_thought.text)}</h1>
  <p class="hero-subtitle">${escapeHtml(spec.report.subtitle)}</p>
  ${primary.html}
  <div class="hero-number-label">${escapeHtml(label)}${unit ? ` · ${escapeHtml(unit)}` : ''}</div>
  <div class="hero-scroll-hint" aria-hidden="true">向下滚动阅读完整报告</div>
</section>`;
}

function renderKpis(component, metrics, manifest) {
  const items = component.metrics.map((ref) => {
    const metric = renderMetric(manifest, metrics, ref, { className: 'kpi-strip-value', key: true });
    const label = ref.label || metric.semantic.measureId || '指标';
    const unit = unitLabel(metric.semantic);
    return `<div class="kpi-strip-item">
  ${metric.html}
  <div class="kpi-strip-label">${escapeHtml(label)}</div>
  ${unit ? `<div class="kpi-strip-change">${escapeHtml(unit)}</div>` : ''}
</div>`;
  });
  return `<div class="kpi-strip reveal" data-component-id="${escapeAttribute(component.id)}">${items.join('\n')}</div>`;
}

function renderChapterIntro(chapter, index, claimId) {
  const number = String(index + 1).padStart(2, '0');
  return `<section class="chapter reveal">
  <div class="chapter-number">CHAPTER <span data-number-exempt="章节序号">${number}</span></div>
  <h2 class="chapter-title" ${claimAttributes(claimId, chapter.claim_kind)}>${escapeHtml(chapter.title)}</h2>
  <p class="chapter-lead" ${claimAttributes(claimId, chapter.claim_kind)}>${escapeHtml(chapter.lead)}</p>
</section>`;
}

function renderInsight(component, manifest) {
  const claimId = evidenceId('INSIGHT', component.id, component.claim_kind);
  addClaim(manifest, {
    id: claimId,
    kind: component.claim_kind,
    evidence: component.evidence,
    reason: component.reason,
    validation_needed: component.validation_needed,
  });
  const iconClass = component.tone === 'neutral' ? 'opportunity' : component.tone;
  return `<div class="chapter reveal" data-component-id="${escapeAttribute(component.id)}">
  <div class="insight-grid">
    <article class="insight-card" ${claimAttributes(claimId, component.claim_kind)}>
      <div class="insight-card-icon ${escapeAttribute(iconClass)}" aria-hidden="true"></div>
      <h3>${escapeHtml(component.title)}</h3>
      <p>${escapeHtml(component.text)}</p>
    </article>
  </div>
</div>`;
}

function sortRows(rows, field, sort) {
  const indexed = rows.map((row, index) => ({ row, index }));
  if (sort && sort !== 'none') {
    const direction = sort === 'asc' ? 1 : -1;
    indexed.sort((left, right) => {
      const a = left.row?.[field];
      const b = right.row?.[field];
      if (!Number.isFinite(a) && !Number.isFinite(b)) return left.index - right.index;
      if (!Number.isFinite(a)) return 1;
      if (!Number.isFinite(b)) return -1;
      return (a - b) * direction || left.index - right.index;
    });
  }
  return indexed;
}

function renderTable(component, metrics, manifest, { detail = false } = {}) {
  const rows = resolvePath(metrics, component.data_path, { label: `${component.id}.data_path` });
  const primaryField = component.columns[0].field;
  const selected = sortRows(rows, primaryField, component.sort || 'none')
    .filter(({ row }) => typeof row?.name === 'string' && component.columns.every((column) => Number.isFinite(row?.[column.field])))
    .slice(0, component.limit || (detail ? 100 : 20));
  if (selected.length === 0) return { skipped: 'no_eligible_table_rows' };

  const headers = component.columns.map((column) => `<th scope="col" class="num">${escapeHtml(column.label)}</th>`).join('');
  const body = selected.map(({ row, index }) => {
    const cells = component.columns.map((column) => {
      const path = `${component.data_path}.${index}.${column.field}`;
      const metric = renderMetric(manifest, metrics, {
        path,
        format: column.format || 'auto',
        precision: column.precision,
      });
      return `<td class="num">${metric.html}</td>`;
    }).join('');
    return `<tr><td>${renderDimensionLabel(row.name)}</td>${cells}</tr>`;
  }).join('\n');
  const snap = detail ? ` data-snap="detail-${escapeAttribute(component.id)}"` : '';
  const wrapperClass = detail ? 'data-detail-section reveal' : 'data-detail-section reveal';
  return {
    html: `<div class="${wrapperClass}"${snap} data-component-id="${escapeAttribute(component.id)}" role="region" aria-labelledby="${escapeAttribute(component.id)}-title" tabindex="0">
  <div class="data-detail-header"><div>
    <div class="data-detail-title" id="${escapeAttribute(component.id)}-title">${escapeHtml(component.title)}</div>
    <div class="data-detail-subtitle">${escapeHtml(component.subtitle)}</div>
  </div></div>
  <table class="data-table" aria-labelledby="${escapeAttribute(component.id)}-title">
    <thead><tr><th scope="col">对象</th>${headers}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</div>`,
  };
}

function renderActions(component, spec, claims) {
  const items = spec.actions.map((action, index) => {
    const claimId = claims.actionClaims.get(action.id);
    const number = String(index + 1);
    return `<li class="action-item action-card" ${claimAttributes(claimId, action.claim_kind)}>
  <span class="action-number" data-number-exempt="行动序号">${number}</span>
  <div class="action-content">
    <h3>${escapeHtml(action.object)} · ${escapeHtml(action.action)}</h3>
    <p>期限：${escapeHtml(action.deadline)}；验证：${escapeHtml(action.validation_metric)}</p>
    <span class="action-tag ${escapeAttribute(action.priority)}">${escapeHtml(action.priority.toUpperCase())}</span>
  </div>
</li>`;
  }).join('\n');
  return `<section class="closing" data-snap="closing" data-component-id="${escapeAttribute(component.id)}">
  <div class="closing-inner reveal">
    <h2 class="closing-title" ${claimAttributes(claims.closingId, claims.closingKind)}>${escapeHtml(component.title)}</h2>
    <ul class="action-list">${items}</ul>
    <div class="closing-footer"><span>${escapeHtml(spec.report.organization)} · ${escapeHtml(spec.report.subject)}</span><span>由确定性 Renderer 生成</span></div>
  </div>
</section>`;
}

function requireOrSkip(component, rendered, manifest) {
  if (!rendered?.skipped) return rendered;
  if (!component.optional) {
    blocked('component_not_applicable', `必需组件 ${component.id} 无法渲染: ${rendered.skipped}`);
  }
  addSkipped(manifest, component, rendered.skipped);
  return { html: `<!-- SCR:SKIPPED component=${component.id} reason=${rendered.skipped} -->` };
}

function renderOptional(component, callback, manifest) {
  try {
    return requireOrSkip(component, callback(), manifest);
  } catch (error) {
    const skippableReasons = new Set(['unresolved_path', 'invalid_component_data', 'comparison_unavailable']);
    if (component.optional && error instanceof RendererError && skippableReasons.has(error.reasonCode)) {
      addSkipped(manifest, component, error.reasonCode);
      return { html: `<!-- SCR:SKIPPED component=${component.id} reason=${error.reasonCode} -->` };
    }
    throw error;
  }
}

export function renderComponents(spec, metrics, insights) {
  const manifest = createBindingManifest(metrics, insights);
  const claims = registerClaims(spec, manifest);
  const definitions = [];
  const components = spec.components;
  const hero = components.find((item) => item.type === 'hero');
  const kpis = components.find((item) => item.type === 'kpi_strip');
  const details = components.filter((item) => item.type === 'data_detail');
  const closing = components.find((item) => item.type === 'closing_actions');
  const sections = [renderHero(hero, spec, metrics, manifest, claims), renderKpis(kpis, metrics, manifest)];

  for (const [chapterIndex, chapter] of spec.narrative.chapters.entries()) {
    const chapterComponents = components.filter((item) => item.chapter_id === chapter.id);
    const chapterHtml = [renderChapterIntro(chapter, chapterIndex, claims.chapterClaims.get(chapter.id))];
    for (const component of chapterComponents) {
      if (component.type === 'chapter_intro') continue;
      if (component.type === 'insight_callout') {
        chapterHtml.push(renderInsight(component, manifest));
      } else if (['rank_table', 'comparison_table'].includes(component.type)) {
        const rendered = renderOptional(component, () => renderTable(component, metrics, manifest), manifest);
        chapterHtml.push(rendered.html);
      } else if (['trend_chart', 'bar_chart', 'slope_chart'].includes(component.type)) {
        const rendered = renderOptional(component, () => renderChart(component, metrics, manifest), manifest);
        chapterHtml.push(rendered.html);
        if (rendered.definition) definitions.push(rendered.definition);
      } else {
        blocked('unsupported_component', `章节内不支持组件 ${component.type}`);
      }
    }
    sections.push(`<section data-snap="chapter-${escapeAttribute(chapter.id)}">${chapterHtml.join('\n')}</section>`);
    sections.push('<div class="divider"><hr></div>');
  }

  for (const detail of details) {
    const rendered = renderOptional(detail, () => renderTable(detail, metrics, manifest, { detail: true }), manifest);
    sections.push(rendered.html);
  }
  sections.push(renderActions(closing, spec, claims));
  return { html: sections.join('\n'), manifest, chartDefinitions: definitions };
}

export function renderRuntimeScripts(chartDefinitions) {
  const definitions = safeJsonForScript(chartDefinitions);
  return `<script>
(function () {
  const chartDefinitions = ${definitions};
  const chartInstances = [];
  function initializeReport() {
    document.querySelectorAll('.reveal').forEach(function (element) { element.classList.add('visible'); });
    chartDefinitions.forEach(function (definition) {
      const element = document.getElementById(definition.id);
      if (!element || !window.echarts) return;
      if (definition.responsive && definition.responsive.kind === 'horizontal_bar' &&
          element.clientWidth <= definition.responsive.max_width) {
        const grids = Array.isArray(definition.option.grid) ? definition.option.grid : [definition.option.grid];
        grids.forEach(function (grid) { grid.left = 12; grid.right = 20; });
        const axes = Array.isArray(definition.option.yAxis) ? definition.option.yAxis : [definition.option.yAxis];
        axes.forEach(function (axis) {
          axis.axisLabel = {
            width: definition.responsive.label_width,
            overflow: 'truncate',
            lineHeight: 16
          };
        });
        const valueAxes = Array.isArray(definition.option.xAxis) ? definition.option.xAxis : [definition.option.xAxis];
        valueAxes.forEach(function (axis) {
          axis.splitNumber = definition.responsive.split_number;
          axis.axisLabel = {
            fontSize: 10,
            hideOverlap: true,
            showMaxLabel: definition.responsive.show_max_label
          };
        });
      }
      const instance = echarts.init(element);
      instance.setOption(definition.option);
      chartInstances.push(instance);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeReport);
  else initializeReport();
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { chartInstances.forEach(function (chart) { chart.resize(); }); }, 120);
  });
  window.addEventListener('scroll', function () {
    const progress = document.getElementById('scrollProgress');
    if (!progress) return;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    progress.style.width = (height > 0 ? document.documentElement.scrollTop / height * 100 : 0) + '%';
  }, { passive: true });
})();
</script>`;
}
