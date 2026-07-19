/**
 * South China Report 演示模式。
 *
 * 同时支持本 Skill 的 scroll narrative、bento brief 和 audit pack。
 * 可通过 data-presentation-page 显式指定页；未指定时按三套模板的
 * 稳定组件类自动分页。常规滚动阅读不需引入此脚本。
 */
(function initialisePresentationMode() {
  'use strict';

  const PAGE_SELECTOR = [
    '[data-presentation-page]',
    '.hero', '.chapter', '.full-chart-section', '.data-detail-section', '.closing',
    '.brief-header', '.bento-tile', '.audit-strip',
    '.audit-header', '.audit-section', '.audit-footer',
  ].join(',');

  class PresentationMode {
    constructor() {
      this.pages = [];
      this.currentIndex = 0;
      this.isPresenting = false;
      this.touchStartX = 0;
      this.controls = null;
      this.toc = null;
      this.boundKeydown = (event) => this.onKeydown(event);
      this.boundTouchStart = (event) => { this.touchStartX = event.touches[0]?.clientX || 0; };
      this.boundTouchEnd = (event) => this.onTouchEnd(event);
    }

    init() {
      const explicit = Array.from(document.querySelectorAll('[data-presentation-page]'));
      const candidates = explicit.length > 0 ? explicit : Array.from(document.querySelectorAll(PAGE_SELECTOR));
      this.pages = candidates.filter((page, index, all) =>
        all.indexOf(page) === index && !all.some((other) => other !== page && other.contains(page))
      );
      if (this.pages.length === 0) {
        console.warn('PresentationMode: 未找到可演示页。');
        return this;
      }
      this.pages.forEach((page) => page.classList.add('presentation-page'));
      this.injectStyles();
      this.createControls();
      this.createStartButton();
      document.addEventListener('keydown', this.boundKeydown);
      document.addEventListener('touchstart', this.boundTouchStart, { passive: true });
      document.addEventListener('touchend', this.boundTouchEnd, { passive: true });
      return this;
    }

    injectStyles() {
      if (document.querySelector('style[data-presentation-mode]')) return;
      const style = document.createElement('style');
      style.dataset.presentationMode = 'true';
      style.textContent = `
        body.presenting { overflow: hidden !important; }
        body.presenting .scroll-progress,
        body.presenting .hero-scroll-hint { display: none !important; }
        body.presenting .presentation-page {
          position: fixed !important; inset: 0 !important; width: 100vw !important;
          height: calc(100vh - 64px) !important; max-width: none !important; min-height: 0 !important;
          margin: 0 !important; padding: clamp(24px, 4vw, 56px) !important;
          overflow: auto !important; overscroll-behavior: contain;
          background: var(--surface-primary, #fff); color: var(--text-primary, #1a1a2e);
          opacity: 0 !important; transform: translateX(48px) !important;
          pointer-events: none !important; z-index: 2000 !important;
          transition: opacity 240ms ease, transform 240ms ease !important;
        }
        body.presenting .presentation-page.presentation-active {
          opacity: 1 !important; transform: none !important; pointer-events: auto !important;
        }
        body.presenting .presentation-page.presentation-before { transform: translateX(-48px) !important; }
        body.presenting .presentation-page.reveal,
        body.presenting .presentation-page .reveal { opacity: 1 !important; transform: none !important; }
        body.presenting .hero,
        body.presenting .closing { background: linear-gradient(160deg, var(--brand-deepest, #001d3d), var(--brand-deep, #003566), var(--brand-mid, #0353a4)); color: var(--text-inverse, #fff); }
        .presentation-controls {
          position: fixed; left: 0; right: 0; bottom: 0; height: 64px; z-index: 2100;
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
          padding: 8px clamp(16px, 3vw, 40px); background: rgba(0, 29, 61, .96); color: #fff;
          transform: translateY(100%); transition: transform 200ms ease;
        }
        body.presenting .presentation-controls { transform: none; }
        .presentation-controls button, .presentation-start {
          border: 1px solid rgba(255,255,255,.25); border-radius: 8px; background: rgba(255,255,255,.10);
          color: inherit; padding: 8px 12px; font: 600 13px/1.2 var(--font-editorial, sans-serif); cursor: pointer;
        }
        .presentation-controls button:disabled { opacity: .4; cursor: not-allowed; }
        .presentation-controls button:focus-visible, .presentation-start:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
        .presentation-progress { flex: 1; max-width: 360px; height: 4px; border-radius: 4px; background: rgba(255,255,255,.18); overflow: hidden; }
        .presentation-progress > span { display: block; height: 100%; width: 0; background: #93c5fd; transition: width 200ms ease; }
        .presentation-index { min-width: 72px; text-align: center; font: 600 13px/1 var(--font-data, monospace); }
        .presentation-toc {
          position: fixed; top: 0; right: 0; bottom: 64px; z-index: 2200; width: min(360px, 88vw);
          padding: 24px; background: rgba(0,29,61,.98); color: #fff; overflow-y: auto;
          transform: translateX(100%); transition: transform 200ms ease;
        }
        .presentation-toc.open { transform: none; }
        .presentation-toc button { width: 100%; margin: 0 0 8px; padding: 10px 12px; text-align: left; border: 0; border-left: 3px solid transparent; background: transparent; color: #cbd5e1; cursor: pointer; }
        .presentation-toc button.active { border-left-color: #93c5fd; background: rgba(147,197,253,.12); color: #fff; }
        .presentation-start { position: fixed; right: 20px; bottom: 20px; z-index: 1900; background: var(--brand-deep, #003566); color: #fff; }
        body.presenting .presentation-start { display: none; }
        @media (max-width: 640px) {
          .presentation-controls { gap: 6px; padding-inline: 8px; }
          .presentation-controls button { padding-inline: 8px; }
          .presentation-progress { display: none; }
          body.presenting .presentation-page { padding: 20px !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .presentation-page, .presentation-controls, .presentation-toc, .presentation-progress > span { transition: none !important; }
        }
      `;
      document.head.appendChild(style);
    }

    pageTitle(page, index) {
      return page.dataset.presentationTitle ||
        page.querySelector('.hero-title, .chapter-title, .full-chart-title, .data-detail-title, .closing-title, .brief-title, .tile-label, .audit-title, .audit-section-title')?.textContent?.trim() ||
        `第 ${index + 1} 页`;
    }

    createControls() {
      const controls = document.createElement('div');
      controls.className = 'presentation-controls';
      controls.setAttribute('role', 'toolbar');
      controls.setAttribute('aria-label', '演示控制');
      controls.innerHTML = `
        <button type="button" data-action="prev">上一页</button>
        <span class="presentation-index" aria-live="polite">1 / ${this.pages.length}</span>
        <span class="presentation-progress" aria-hidden="true"><span></span></span>
        <button type="button" data-action="next">下一页</button>
        <button type="button" data-action="toc">目录</button>
        <button type="button" data-action="fullscreen">全屏</button>
        <button type="button" data-action="exit">退出</button>`;
      controls.addEventListener('click', (event) => {
        const action = event.target.closest('button')?.dataset.action;
        if (action && typeof this[action] === 'function') this[action]();
      });
      document.body.appendChild(controls);
      this.controls = controls;

      const toc = document.createElement('nav');
      toc.className = 'presentation-toc';
      toc.setAttribute('aria-label', '演示目录');
      this.pages.forEach((page, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.index = String(index);
        button.textContent = `${index + 1}. ${this.pageTitle(page, index)}`;
        button.addEventListener('click', () => { this.goto(index); this.toc.classList.remove('open'); });
        toc.appendChild(button);
      });
      document.body.appendChild(toc);
      this.toc = toc;
    }

    createStartButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'presentation-start';
      button.textContent = '开始演示';
      button.addEventListener('click', () => this.start());
      document.body.appendChild(button);
    }

    start() {
      if (this.pages.length === 0) return;
      this.isPresenting = true;
      document.body.classList.add('presenting');
      this.goto(Math.min(this.currentIndex, this.pages.length - 1));
    }

    exit() {
      this.isPresenting = false;
      document.body.classList.remove('presenting');
      this.toc?.classList.remove('open');
      this.pages.forEach((page) => page.classList.remove('presentation-active', 'presentation-before'));
      this.pages[this.currentIndex]?.scrollIntoView({ block: 'start' });
    }

    goto(index) {
      if (index < 0 || index >= this.pages.length) return;
      this.pages.forEach((page, pageIndex) => {
        page.classList.toggle('presentation-active', pageIndex === index);
        page.classList.toggle('presentation-before', pageIndex < index);
      });
      this.currentIndex = index;
      this.pages[index].scrollTop = 0;
      this.resizeCharts(this.pages[index]);
      setTimeout(() => this.resizeCharts(this.pages[index]), 260);
      this.updateControls();
    }

    next() { this.goto(this.currentIndex + 1); }
    prev() { this.goto(this.currentIndex - 1); }
    toc() { this.toc?.classList.toggle('open'); }
    async fullscreen() {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (error) {
        console.warn('PresentationMode: 无法切换全屏:', error.message);
      }
    }

    resizeCharts(container) {
      if (!container || !window.echarts?.getInstanceByDom) return;
      container.querySelectorAll('.chart-container, .tile-chart, [id^="chart-"]').forEach((element) => {
        window.echarts.getInstanceByDom(element)?.resize();
      });
    }

    updateControls() {
      if (!this.controls) return;
      this.controls.querySelector('[data-action="prev"]').disabled = this.currentIndex === 0;
      this.controls.querySelector('[data-action="next"]').disabled = this.currentIndex === this.pages.length - 1;
      this.controls.querySelector('.presentation-index').textContent = `${this.currentIndex + 1} / ${this.pages.length}`;
      this.controls.querySelector('.presentation-progress > span').style.width = `${((this.currentIndex + 1) / this.pages.length) * 100}%`;
      this.toc?.querySelectorAll('button').forEach((button, index) => button.classList.toggle('active', index === this.currentIndex));
    }

    onKeydown(event) {
      if (!this.isPresenting) return;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); this.next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); this.prev(); }
      else if (event.key === 'Home') { event.preventDefault(); this.goto(0); }
      else if (event.key === 'End') { event.preventDefault(); this.goto(this.pages.length - 1); }
      else if (event.key === 'Escape') { event.preventDefault(); this.exit(); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); this.fullscreen(); }
      else if (event.key.toLowerCase() === 't') { event.preventDefault(); this.toc(); }
    }

    onTouchEnd(event) {
      if (!this.isPresenting) return;
      const delta = (event.changedTouches[0]?.clientX || 0) - this.touchStartX;
      if (Math.abs(delta) > 50) delta > 0 ? this.prev() : this.next();
    }
  }

  const boot = () => {
    const instance = new PresentationMode().init();
    window.PresentationMode = PresentationMode;
    window.presentationMode = instance;
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
