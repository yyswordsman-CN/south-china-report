# 常见踩坑

> 从 `SKILL.md` §10 下沉，原文照搬（V1→V2 别名一行已按 V2.7 评审口径更新）。遇渲染/字体/图表问题时加载本文件。

| 问题                                 | 解决方案                                                                |
| :----------------------------------- | :---------------------------------------------------------------------- |
| ECharts 在 `display:none` 中不渲染 | Flash-then-hide: 先全部 `display:block` → init → 恢复               |
| 打印时图表消失                       | `@media print` 中确保 `.chart-container` 有固定 height              |
| 中文字体 fallback                    | 总是在 font-family 末尾加 `'Noto Sans SC','PingFang SC'`              |
| KPI 数字未对齐                       | `font-variant-numeric: tabular-nums` + `--font-data`                |
| 窗口 resize 后图表不跟随             | 全局 resize debounce +`chart.resize()`                                |
| 图表/Badge 裸 hex 未对齐 Token       | ECharts/canvas 不吃 `var()`：用 `cssVar('--chart-1')` 动态读取，或保留 literal 但须落在已登记 Token 表内 (图表→`chart-patterns.md`，Badge→`design-tokens.md` §3.3) |
| 动效在低端设备卡顿                   | 检查 `prefers-reduced-motion`，降级为即时显示                         |
| V1 模板升级到 V2                     | V2 Token 提供部分 V1 别名 (`--color-growth/risk` 等, 见 `design-tokens.md` §3.3/§3.4); 别名表以 `design-tokens.md` 为准, 未列出的旧名 (如 `--color-success`) 已不存在, validator 会以「Token 引用完整性」P1 拦截 |
| 字体角色混用                         | 检查是否把 `--font-display` 用在了正文段落                            |
