/**
 * HTML 报告演示模式增强插件
 * 支持翻页笔、键盘控制、切换动画、全屏播放
 */

class PresentationMode {
    constructor() {
        this.sections = [];
        this.currentIndex = 0;
        this.isPresenting = false;
        this.touchStartX = 0;
        this.init();
    }

    init() {
        // 收集所有 section
        this.sections = Array.from(document.querySelectorAll('.section'));

        // 创建控制条
        this.createControlBar();

        // 绑定事件
        this.bindEvents();

        // 添加样式
        this.injectStyles();
    }

    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 演示模式样式 */
            body.presenting {
                overflow: hidden;
            }
            
            body.presenting .sidebar {
                transform: translateX(-100%);
                transition: transform 0.3s ease;
            }
            
            body.presenting .main-content {
                margin-left: 0 !important;
                padding: 0 !important;
            }
            
            body.presenting .section {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                padding: 40px 60px 80px 60px;  /* 上40 左右60 下80(留给控制条) */
                overflow-y: auto;
                overflow-x: hidden;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.4s ease, transform 0.4s ease;
                transform: translateX(100px);
                background: var(--bg-body);
                z-index: 1;
            }
            
            body.presenting .section.active {
                opacity: 1;
                pointer-events: auto;
                transform: translateX(0);
                z-index: 2;
            }
            
            /* 确保 section 内容滚动流畅 */
            body.presenting .section::-webkit-scrollbar {
                width: 8px;
            }
            
            body.presenting .section::-webkit-scrollbar-track {
                background: rgba(0, 0, 0, 0.05);
            }
            
            body.presenting .section::-webkit-scrollbar-thumb {
                background: rgba(59, 130, 246, 0.3);
                border-radius: 4px;
            }
            
            body.presenting .section::-webkit-scrollbar-thumb:hover {
                background: rgba(59, 130, 246, 0.5);
            }
            
            body.presenting .section.prev {
                transform: translateX(-100px);
            }
            
            /* 控制条 */
            .presentation-control {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                height: 60px;
                background: linear-gradient(to top, rgba(15, 23, 42, 0.95), transparent);
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 40px;
                z-index: 1000;
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
            }
            
            body.presenting .presentation-control {
                opacity: 1;
                pointer-events: auto;
            }
            
            .presentation-control:hover {
                background: linear-gradient(to top, rgba(15, 23, 42, 1), rgba(15, 23, 42, 0.8));
            }
            
            .control-left, .control-center, .control-right {
                display: flex;
                align-items: center;
                gap: 20px;
            }
            
            .control-btn {
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid rgba(59, 130, 246, 0.3);
                color: #60A5FA;
                padding: 8px 16px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .control-btn:hover {
                background: rgba(59, 130, 246, 0.3);
                border-color: rgba(59, 130, 246, 0.5);
                transform: translateY(-2px);
            }
            
            .control-btn:active {
                transform: translateY(0);
            }
            
            .control-btn.primary {
                background: linear-gradient(135deg, #3B82F6, #2563EB);
                border: none;
                color: white;
            }
            
            .page-indicator {
                color: #94A3B8;
                font-size: 14px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            
            .page-current {
                color: #60A5FA;
                font-size: 20px;
            }
            
            .progress-bar {
                width: 300px;
                height: 4px;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 2px;
                overflow: hidden;
            }
            
            .progress-fill {
                height: 100%;
                background: linear-gradient(90deg, #3B82F6, #60A5FA);
                transition: width 0.3s ease;
            }
            
            /* 页面标题覆盖 */
            body.presenting .page-header {
                margin-top: 0;
                padding-top: 20px;
            }
            
            /* 快捷键提示 */
            .keyboard-hint {
                position: fixed;
                top: 20px;
                right: 20px;
                background: rgba(15, 23, 42, 0.9);
                color: #94A3B8;
                padding: 15px 20px;
                border-radius: 8px;
                font-size: 12px;
                z-index: 999;
                opacity: 0;
                transition: opacity 0.3s ease;
                pointer-events: none;
            }
            
            .keyboard-hint.show {
                opacity: 1;
            }
            
            .keyboard-hint kbd {
                background: rgba(59, 130, 246, 0.2);
                border: 1px solid rgba(59, 130, 246, 0.3);
                padding: 2px 8px;
                border-radius: 4px;
                color: #60A5FA;
                font-family: monospace;
                margin: 0 4px;
            }
            
            /* 目录侧边栏 */
            .toc-sidebar {
                position: fixed;
                right: 0;
                top: 0;
                width: 350px;
                height: 100vh;
                background: rgba(15, 23, 42, 0.98);
                padding: 40px 30px;
                z-index: 1001;
                transform: translateX(100%);
                transition: transform 0.3s ease;
                overflow-y: auto;
            }
            
            .toc-sidebar.open {
                transform: translateX(0);
            }
            
            .toc-title {
                font-size: 18px;
                font-weight: 700;
                color: #fff;
                margin-bottom: 20px;
                border-bottom: 2px solid rgba(59, 130, 246, 0.3);
                padding-bottom: 10px;
            }
            
            .toc-item {
                padding: 12px 15px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                color: #94A3B8;
                margin-bottom: 8px;
                transition: all 0.2s;
                border-left: 3px solid transparent;
            }
            
            .toc-item:hover {
                background: rgba(59, 130, 246, 0.15);
                color: #fff;
                border-left-color: #3B82F6;
            }
            
            .toc-item.active {
                background: rgba(59, 130, 246, 0.25);
                color: #60A5FA;
                border-left-color: #60A5FA;
                font-weight: 600;
            }
            
            /* 缩放适配 */
            @media (max-height: 800px) {
                body.presenting .section {
                    padding: 30px 40px 70px 40px;
                    font-size: 13px;
                }
                
                body.presenting .page-header h1 {
                    font-size: 22px !important;
                }
                
                body.presenting .kpi-card,
                body.presenting .report-card {
                    margin-bottom: 15px !important;
                }
            }
            
            @media (max-height: 700px) {
                body.presenting .section {
                    padding: 20px 30px 60px 30px;
                    font-size: 12px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    createControlBar() {
        const control = document.createElement('div');
        control.className = 'presentation-control';
        control.innerHTML = `
            <div class="control-left">
                <button class="control-btn" id="btn-prev">
                    <span>◀</span> 上一页
                </button>
                <button class="control-btn" id="btn-next">
                    下一页 <span>▶</span>
                </button>
            </div>
            <div class="control-center">
                <div class="page-indicator">
                    <span class="page-current">1</span>
                    <span>/</span>
                    <span class="page-total">${this.sections.length}</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%"></div>
                </div>
            </div>
            <div class="control-right">
                <button class="control-btn" id="btn-toc">
                    目录
                </button>
                <button class="control-btn" id="btn-fullscreen">
                    全屏
                </button>
                <button class="control-btn primary" id="btn-exit">
                    退出演示
                </button>
            </div>
        `;
        document.body.appendChild(control);

        // 创建快捷键提示
        const hint = document.createElement('div');
        hint.className = 'keyboard-hint';
        hint.innerHTML = `
            快捷键：<kbd>←</kbd><kbd>→</kbd> 翻页 | <kbd>空格</kbd> 下一页 | <kbd>F</kbd> 全屏 | <kbd>T</kbd> 目录 | <kbd>Esc</kbd> 退出
        `;
        document.body.appendChild(hint);

        // 创建目录
        this.createTOC();

        // 绑定按钮事件
        document.getElementById('btn-prev').addEventListener('click', () => this.prev());
        document.getElementById('btn-next').addEventListener('click', () => this.next());
        document.getElementById('btn-fullscreen').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('btn-exit').addEventListener('click', () => this.exit());
        document.getElementById('btn-toc').addEventListener('click', () => this.toggleTOC());
    }

    createTOC() {
        const toc = document.createElement('div');
        toc.className = 'toc-sidebar';
        toc.innerHTML = `
            <div class="toc-title">报告目录</div>
            ${this.sections.map((section, idx) => {
            const title = section.querySelector('.page-header h1, h2')?.textContent || `第 ${idx + 1} 页`;
            return `<div class="toc-item" data-index="${idx}">${idx + 1}. ${title}</div>`;
        }).join('')}
        `;
        document.body.appendChild(toc);

        // 目录点击跳转
        toc.querySelectorAll('.toc-item').forEach(item => {
            item.addEventListener('click', () => {
                const index = parseInt(item.dataset.index);
                this.goto(index);
                this.toggleTOC();
            });
        });
    }

    bindEvents() {
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (!this.isPresenting) return;

            switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                case 'PageDown':
                case ' ':
                    e.preventDefault();
                    this.next();
                    break;
                case 'ArrowLeft':
                case 'ArrowUp':
                case 'PageUp':
                    e.preventDefault();
                    this.prev();
                    break;
                case 'Home':
                    e.preventDefault();
                    this.goto(0);
                    break;
                case 'End':
                    e.preventDefault();
                    this.goto(this.sections.length - 1);
                    break;
                case 'Escape':
                    e.preventDefault();
                    this.exit();
                    break;
                case 'f':
                case 'F':
                    e.preventDefault();
                    this.toggleFullscreen();
                    break;
                case 't':
                case 'T':
                    e.preventDefault();
                    this.toggleTOC();
                    break;
            }
        });

        // 触摸滑动（翻页笔可能模拟触摸）
        document.addEventListener('touchstart', (e) => {
            if (!this.isPresenting) return;
            this.touchStartX = e.touches[0].clientX;
        });

        document.addEventListener('touchend', (e) => {
            if (!this.isPresenting) return;
            const touchEndX = e.changedTouches[0].clientX;
            const diff = touchEndX - this.touchStartX;

            if (Math.abs(diff) > 50) {
                if (diff > 0) {
                    this.prev();
                } else {
                    this.next();
                }
            }
        });

        // 鼠标滚轮（可选）
        let wheelTimeout;
        document.addEventListener('wheel', (e) => {
            if (!this.isPresenting) return;

            clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(() => {
                if (e.deltaY > 30) {
                    this.next();
                } else if (e.deltaY < -30) {
                    this.prev();
                }
            }, 150);
        }, { passive: true });
    }

    start() {
        this.isPresenting = true;
        document.body.classList.add('presenting');

        // 预初始化所有图表（避免切换时挤压闪烁）
        this.preInitAllCharts();

        // 跳转到第一页
        this.goto(0);

        // 显示快捷键提示 3 秒
        const hint = document.querySelector('.keyboard-hint');
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 3000);
    }

    // 预初始化所有图表尺寸
    preInitAllCharts() {
        // 临时显示所有 section（透明度为 0.01，避免闪烁）
        this.sections.forEach(section => {
            const originalOpacity = section.style.opacity;
            section.style.opacity = '0.01';
            section.style.pointerEvents = 'none';
            section.style.position = 'fixed';
            section.style.top = '0';
            section.style.left = '0';
            section.style.width = '100vw';
            section.style.height = '100vh';

            // 触发图表resize
            this.resizeCharts(section);

            // 恢复原状态
            section.style.opacity = originalOpacity;
        });
    }

    exit() {
        this.isPresenting = false;
        document.body.classList.remove('presenting');
        this.sections.forEach(s => s.classList.remove('active', 'prev'));

        // 恢复滚动到当前 section
        if (this.sections[this.currentIndex]) {
            this.sections[this.currentIndex].scrollIntoView({ behavior: 'smooth' });
        }
    }

    goto(index) {
        if (index < 0 || index >= this.sections.length) return;

        // 移除所有激活状态
        this.sections.forEach((s, i) => {
            s.classList.remove('active', 'prev');
            if (i < index) {
                s.classList.add('prev');
            }
        });

        // 激活当前页
        this.sections[index].classList.add('active');
        this.currentIndex = index;

        // 滚动到顶部
        this.sections[index].scrollTop = 0;

        // 立即触发 ECharts resize（避免挤压效果）
        this.resizeCharts(this.sections[index]);

        // 动画结束后再次触发（确保准确）
        setTimeout(() => {
            this.resizeCharts(this.sections[index]);
        }, 450);

        // 更新控制条
        this.updateControl();

        // 更新目录
        this.updateTOC();
    }

    // 刷新当前页面的所有 ECharts 实例
    resizeCharts(section) {
        if (!section) return;

        // 查找当前 section 内的所有图表容器
        const chartContainers = section.querySelectorAll('[id^="chart-"]');

        chartContainers.forEach(container => {
            // 获取 ECharts 实例
            const chartInstance = echarts.getInstanceByDom(container);
            if (chartInstance) {
                // 强制刷新图表尺寸
                chartInstance.resize();
            }
        });

        // 也触发全局 chartInstances（兼容原有代码）
        if (window.chartInstances && Array.isArray(window.chartInstances)) {
            window.chartInstances.forEach(chart => {
                try {
                    chart.resize();
                } catch (e) {
                    // 忽略已销毁的实例
                }
            });
        }
    }

    next() {
        if (this.currentIndex < this.sections.length - 1) {
            this.goto(this.currentIndex + 1);
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.goto(this.currentIndex - 1);
        }
    }

    updateControl() {
        const current = document.querySelector('.page-current');
        const progress = document.querySelector('.progress-fill');

        current.textContent = this.currentIndex + 1;
        const percentage = ((this.currentIndex + 1) / this.sections.length) * 100;
        progress.style.width = percentage + '%';

        // 更新按钮状态
        document.getElementById('btn-prev').disabled = this.currentIndex === 0;
        document.getElementById('btn-next').disabled = this.currentIndex === this.sections.length - 1;
    }

    updateTOC() {
        document.querySelectorAll('.toc-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === this.currentIndex);
        });
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }

    toggleTOC() {
        document.querySelector('.toc-sidebar').classList.toggle('open');
    }
}

// 初始化
const presentation = new PresentationMode();

// 添加启动按钮到导航栏
window.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        const btn = document.createElement('button');
        btn.className = 'control-btn primary';
        btn.style.cssText = 'width: 100%; margin-top: auto; padding: 12px;';
        btn.innerHTML = '开始演示';
        btn.addEventListener('click', () => presentation.start());
        sidebar.appendChild(btn);
    }
});

// 暴露全局接口
window.PresentationMode = presentation;
