#!/usr/bin/env python3
"""演示数据生成器 (模拟数据, 非任何真实业务)。
植入模式: ①增速 18 个可比月持续放缓(趋势性下滑) ②2026-02 崩塌月
③南区 2026 断崖 / 东区引擎 ④旗舰系列 2026 占比跃升(结构护价)
⑤电商渠道份额上移、传统收缩 ⑥客户头部集中(区内 Top1 权重 48%)"""
import csv, math

REGION_W = {"北区": .25, "西区": .20, "中区": .15, "东区": .15, "南区": .25}
REGION_W_2026 = {"北区": .25, "西区": .20, "中区": .17, "东区": .20, "南区": .18}
CAT_W = {2024: {"旗舰系列": .22, "主力系列": .48, "入门系列": .30},
         2025: {"旗舰系列": .22, "主力系列": .48, "入门系列": .30},
         2026: {"旗舰系列": .30, "主力系列": .48, "入门系列": .22}}
CH_W = {2024: {"KA": .40, "电商": .28, "传统": .32},
        2025: {"KA": .40, "电商": .32, "传统": .28},
        2026: {"KA": .39, "电商": .38, "传统": .23}}
PRICE = {"旗舰系列": {2024: 5100, 2025: 5200, 2026: 5230},
         "主力系列": {2024: 3150, 2025: 3200, 2026: 3180},
         "入门系列": {2024: 1880, 2025: 1900, 2026: 1860}}
CUST_W = [.48, .16, .10, .08, .06, .05, .04, .03]

def base_amt_wan(m):                       # 2024 季节基线(万)
    return 950 + 220 * math.sin((m - 3) / 12 * 2 * math.pi)

def growth(i, n=18):                       # 可比月目标 YoY: +30% 线性滑至 -12%
    return 0.30 - 0.42 * i / (n - 1)

totals = {2024: {m: base_amt_wan(m) for m in range(1, 13)}, 2025: {}, 2026: {}}
i = 0
for y, months in ((2025, range(1, 13)), (2026, range(1, 7))):
    for m in months:
        g = -0.45 if (y, m) == (2026, 2) else growth(i)
        i += 1
        totals[y][m] = totals[y - 1][m] * (1 + g)

rows = 0
with open('demo_sales.csv', 'w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(["日期", "战区", "渠道", "品类", "客户", "签收额", "台数"])
    for y in sorted(totals):
        rw_map = REGION_W_2026 if y == 2026 else REGION_W
        for m in sorted(totals[y]):
            tot_yuan = totals[y][m] * 1e4
            for r, rw in rw_map.items():
                for cat, cw in CAT_W[y].items():
                    for ch, chw in CH_W[y].items():
                        for ci, cust_w in enumerate(CUST_W):
                            amt = tot_yuan * rw * cw * chw * cust_w
                            qty = amt / PRICE[cat][y]
                            w.writerow([f"{y}-{m:02d}-15", r, ch, cat,
                                        f"{r}经销商{ci+1:02d}", round(amt, 2), round(qty)])
                            rows += 1
print(f"demo_sales.csv: {rows} 行 (30 个月 x 5 战区 x 3 品类 x 3 渠道 x 8 客户)")
