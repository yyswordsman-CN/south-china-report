// =============================================================
// ECharts 企业级主题集合 V2 (3 套主题)
// 对齐 design-tokens.md V2 三套主题: Deep Ocean / Executive Dark / Warm Earth
// 外链引用: 用 script 标签 src="echarts-corporate-themes.js" 加载
// 内联到单文件报告时: 直接把本文件内容放进一对 script 标签即可
//   (注意: 本文件刻意不含字面闭合 script 标签, 以免内联时提前截断)
// 使用: echarts.init(dom, 'corporate-blue')
// =============================================================

(function() {
    // ─── Theme 1: Corporate Blue (默认/Deep Ocean 主题对应) ───
    // 前 6 系列严格对齐 design-tokens §3.6 --chart-1..6 (唯一真相源); 第 7/8 为克制中性扩展
    echarts.registerTheme('corporate-blue', {
        color: ['#0353a4','#059669','#d97706','#7c3aed','#0891b2','#be123c','#64748b','#94a3b8'],
        backgroundColor: 'transparent',
        textStyle: {
            fontFamily: 'DM Sans, Noto Sans SC, -apple-system, sans-serif', /* V2: --font-editorial */
            color: '#334155'
        },
        title: {
            textStyle: { color: '#0B1120', fontSize: 16, fontWeight: 600, fontFamily: 'DM Sans, Noto Sans SC, -apple-system, sans-serif' },
            subtextStyle: { color: '#64748B', fontSize: 12 }
        },
        legend: {
            textStyle: { color: '#64748B', fontSize: 12 },
            pageTextStyle: { color: '#64748B' },
            itemWidth: 14, itemHeight: 8, itemGap: 16
        },
        tooltip: {
            backgroundColor: 'rgba(255,255,255,0.96)',
            borderColor: '#E2E8F0',
            borderWidth: 1,
            textStyle: { color: '#334155', fontSize: 12, fontFamily: 'DM Sans, Noto Sans SC, -apple-system, sans-serif' },
            extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 8px; padding: 12px 16px;'
        },
        categoryAxis: {
            axisLine: { lineStyle: { color: '#E2E8F0' } },
            axisTick: { show: false },
            axisLabel: { color: '#64748B', fontSize: 12 },
            splitLine: { show: false }
        },
        valueAxis: {
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#94A3B8', fontSize: 11 },
            splitLine: { lineStyle: { color: '#F1F5F9', type: 'dashed' } },
            nameTextStyle: { color: '#94A3B8', fontSize: 11 }
        },
        bar: {
            barMaxWidth: 40,
            itemStyle: { borderRadius: [4, 4, 0, 0] }
        },
        line: {
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5 }
        },
        pie: {
            itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 },
            label: { fontSize: 12, lineHeight: 16 }
        },
        animationDuration: 1200,
        animationEasing: 'cubicOut'
    });

    // ─── Theme 2: Executive Dark (高管汇报/年度总结, 对应 data-theme="executive-dark") ───
    echarts.registerTheme('executive-dark', {
        color: ['#F59E0B','#3B82F6','#10B981','#FB7185','#A78BFA','#22D3EE','#F472B6','#94A3B8'],
        backgroundColor: 'transparent',
        textStyle: {
            fontFamily: 'DM Sans, Noto Sans SC, -apple-system, sans-serif', /* V2: --font-editorial */
            color: '#CBD5E1'
        },
        title: {
            textStyle: { color: '#F8FAFC', fontSize: 16, fontWeight: 600 },
            subtextStyle: { color: '#94A3B8', fontSize: 12 }
        },
        legend: {
            textStyle: { color: '#94A3B8', fontSize: 12 },
            pageTextStyle: { color: '#94A3B8' },
            itemWidth: 14, itemHeight: 8, itemGap: 16
        },
        tooltip: {
            backgroundColor: 'rgba(30,41,59,0.96)',
            borderColor: '#475569',
            borderWidth: 1,
            textStyle: { color: '#F1F5F9', fontSize: 12 },
            extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.3); border-radius: 8px; padding: 12px 16px;'
        },
        categoryAxis: {
            axisLine: { lineStyle: { color: '#475569' } },
            axisTick: { show: false },
            axisLabel: { color: '#94A3B8', fontSize: 12 },
            splitLine: { show: false }
        },
        valueAxis: {
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#64748B', fontSize: 11 },
            splitLine: { lineStyle: { color: '#1E293B', type: 'dashed' } },
            nameTextStyle: { color: '#64748B', fontSize: 11 }
        },
        bar: {
            barMaxWidth: 40,
            itemStyle: { borderRadius: [4, 4, 0, 0] }
        },
        line: {
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5 }
        },
        pie: {
            itemStyle: { borderColor: '#1E293B', borderWidth: 2 },
            label: { fontSize: 12, lineHeight: 16, color: '#CBD5E1' }
        },
        animationDuration: 1200,
        animationEasing: 'cubicOut'
    });

    // ─── Theme 3: Warm Earth (策略文档/长篇分析, 对应 data-theme="warm-earth") ───
    echarts.registerTheme('warm-earth', {
        color: ['#EA580C','#65A30D','#0284C7','#DC2626','#7C3AED','#0891B2','#DB2777','#78716C'],
        backgroundColor: 'transparent',
        textStyle: {
            fontFamily: 'DM Sans, Noto Sans SC, -apple-system, sans-serif', /* V2: --font-editorial */
            color: '#44403C'
        },
        title: {
            textStyle: { color: '#292524', fontSize: 16, fontWeight: 600 },
            subtextStyle: { color: '#78716C', fontSize: 12 }
        },
        legend: {
            textStyle: { color: '#78716C', fontSize: 12 },
            pageTextStyle: { color: '#78716C' },
            itemWidth: 14, itemHeight: 8, itemGap: 16
        },
        tooltip: {
            backgroundColor: 'rgba(255,255,255,0.96)',
            borderColor: '#E7E5E4',
            borderWidth: 1,
            textStyle: { color: '#44403C', fontSize: 12 },
            extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 8px; padding: 12px 16px;'
        },
        categoryAxis: {
            axisLine: { lineStyle: { color: '#E7E5E4' } },
            axisTick: { show: false },
            axisLabel: { color: '#78716C', fontSize: 12 },
            splitLine: { show: false }
        },
        valueAxis: {
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: '#A8A29E', fontSize: 11 },
            splitLine: { lineStyle: { color: '#F5F5F4', type: 'dashed' } },
            nameTextStyle: { color: '#A8A29E', fontSize: 11 }
        },
        bar: {
            barMaxWidth: 40,
            itemStyle: { borderRadius: [4, 4, 0, 0] }
        },
        line: {
            smooth: true,
            symbol: 'circle',
            symbolSize: 6,
            lineStyle: { width: 2.5 }
        },
        pie: {
            itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 },
            label: { fontSize: 12, lineHeight: 16 }
        },
        animationDuration: 1200,
        animationEasing: 'cubicOut'
    });

    console.log('[ECharts Themes] Registered: corporate-blue, executive-dark, warm-earth');
})();
