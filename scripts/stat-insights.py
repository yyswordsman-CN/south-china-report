#!/usr/bin/env python3
"""stat-insights.py — 统计洞察层 (V2.10)

读 prep-source.py 产出的 metrics.json, 产出 insights.json + insights.md:
  1. 趋势显著性  — Mann-Kendall 检验 (跨年逐月 YoY 增速序列): 回答"下滑是趋势还是波动"
  2. 异常月检测  — 稳健 Z 分数 (median/MAD), |z|>=2.5 判异常月
  3. 连续下滑    — YoY 序列末端连续为负的月数
  4. 维度扫描    — 断崖(cliff)/引擎(engine)/结构位移(share shift, pp)/增速贡献分解(contribution)
  5. 集中度      — HHI (各维度) + 客户 Top5/帕累托复述与风险分级
  6. 量价象限    — 依据 period.pvm 判量价组合 (沿用 price_mix 口径 caveat)
  7. 问题清单    — 按影响金额(万)排序, 供报告"问题发现"章直接引用

纪律 (与 SKILL 数据至上对齐):
  - metrics.json 为 BLOCKED 时拒绝运行 (exit 2): 脏数据上不做统计
  - 样本 n<8 时 Mann-Kendall 只报方向不报显著性 (insufficient_sample), 禁止写"趋势确立"
  - 无目标数据不编造达成缺口; 本脚本不做预测外推
  - 报告中的洞察结论从 insights.json 引用, 显著性以 significant 字段为准

依赖: 仅 Python3 标准库 (json/math/statistics), 无 pandas/scipy。
用法:
  python3 scripts/stat-insights.py metrics.json [--out insights.json]
      [--cliff -15] [--engine 15] [--material 2] [--shift 1.5] [--zthr 2.5]
"""
import argparse, json, math, sys
from statistics import median

# ---------- 统计原语 ----------

def mann_kendall(xs):
    """Mann-Kendall 趋势检验 (双侧, 正态近似, 含并列修正)。
    返回 dict: n/S/z/p/direction/significant。n<8 时不给显著性 (小样本正态近似不可靠)。"""
    n = len(xs)
    out = {"n": n, "S": None, "z": None, "p": None,
           "direction": "insufficient_sample", "significant": False}
    if n < 4:
        return out
    S = 0
    for i in range(n - 1):
        for j in range(i + 1, n):
            S += (xs[j] > xs[i]) - (xs[j] < xs[i])
    # 并列修正
    ties = {}
    for v in xs:
        ties[v] = ties.get(v, 0) + 1
    tie_term = sum(t * (t - 1) * (2 * t + 5) for t in ties.values() if t > 1)
    var = (n * (n - 1) * (2 * n + 5) - tie_term) / 18
    if var <= 0:
        return out
    z = (S - 1) / math.sqrt(var) if S > 0 else ((S + 1) / math.sqrt(var) if S < 0 else 0.0)
    p = math.erfc(abs(z) / math.sqrt(2))  # 双侧
    out.update({"S": S, "z": round(z, 2), "p": round(p, 4)})
    if n < 8:
        # 方向可给, 显著性不给 (诚实降级)
        out["direction"] = "increasing" if S > 0 else ("decreasing" if S < 0 else "no_trend")
        out["note"] = "n<8, 正态近似不可靠: 只报方向, 不判显著; 报告措辞用'方向上/初步', 禁写'趋势确立'"
        return out
    out["direction"] = "increasing" if S > 0 else ("decreasing" if S < 0 else "no_trend")
    out["significant"] = p < 0.05
    return out

def robust_z(xs):
    """稳健 Z 分数 (median/MAD)。MAD=0 时退化用均值绝对偏差; 仍为 0 则全 0。"""
    med = median(xs)
    mad = median([abs(x - med) for x in xs])
    if mad == 0:
        mad = sum(abs(x - med) for x in xs) / len(xs) or None
        if mad is None:
            return [0.0] * len(xs)
        return [round((x - med) / (1.2533 * mad), 2) for x in xs]  # 均值绝对偏差换算
    return [round(0.6745 * (x - med) / mad, 2) for x in xs]

# ---------- 序列构造 ----------

def yoy_series(trend):
    """由 trend {year(str): [12 月值(万)|None]} 构造跨年逐月 YoY 序列 (时间升序)。
    仅取相邻两年同月均有值且基期>0 的月份。返回 [(label, yoy%), ...]"""
    yrs = sorted(int(y) for y in trend)
    seq = []
    for y in yrs:
        prev = str(y - 1)
        if prev not in trend:
            continue
        for m in range(12):
            c, p = trend[str(y)][m], trend[prev][m]
            if c is None or p is None or p == 0:
                continue
            seq.append((f"{y}-{m+1:02d}", round((c / p - 1) * 100, 1)))
    return seq

def trailing_negative_run(seq):
    run = 0
    for _, v in reversed(seq):
        if v < 0:
            run += 1
        else:
            break
    return run

# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description="metrics.json → 统计洞察 insights.json")
    ap.add_argument('metrics'); ap.add_argument('--out', default='insights.json')
    ap.add_argument('--cliff', type=float, default=-15, help="断崖阈值: YoY%% 低于此且份额达标 (默认 -15)")
    ap.add_argument('--engine', type=float, default=15, help="引擎阈值: YoY%% 高于此且份额达标 (默认 +15)")
    ap.add_argument('--material', type=float, default=2, help="重要性门槛: 当期份额%% (默认 2, 弱信号不进清单)")
    ap.add_argument('--shift', type=float, default=1.5, help="结构位移阈值: 份额变动 pp (默认 1.5)")
    ap.add_argument('--zthr', type=float, default=2.5, help="异常月稳健Z阈值 (默认 2.5)")
    a = ap.parse_args()

    M = json.load(open(a.metrics, encoding='utf-8'))
    status = (M.get('data_status') or {}).get('status')
    if status == 'BLOCKED':
        print("[REFUSED] metrics.json 为 BLOCKED — 脏数据上不做统计, 先按 quality.md 修数")
        sys.exit(2)

    out = {"meta": {"source_metrics": a.metrics, "generated_by": "stat-insights.py",
                    "thresholds": {"cliff_yoy": a.cliff, "engine_yoy": a.engine,
                                   "material_share": a.material, "share_shift_pp": a.shift,
                                   "anomaly_robust_z": a.zthr},
                    "metrics_status": status},
           "_discipline": "洞察从本文件引用; 显著性以 significant 为准, 非显著禁写'趋势确立'; 无目标数据不谈达成缺口"}
    problems = []

    # 1/2/3 趋势·异常·连续下滑 (需 trend, 即 >=2 年数据)
    trend = M.get('trend')
    if trend:
        seq = yoy_series(trend)
        if seq:
            vals = [v for _, v in seq]
            mk = mann_kendall(vals)
            out['trend_test'] = {"series": "跨年逐月YoY增速(%)", "points": seq, "mann_kendall": mk,
                                 "reading": _mk_reading(mk)}
            zs = robust_z(vals)
            anomalies = [{"month": seq[i][0], "yoy": seq[i][1], "robust_z": zs[i]}
                         for i in range(len(seq)) if abs(zs[i]) >= a.zthr]
            out['anomaly_months'] = anomalies
            run = trailing_negative_run(seq)
            out['trailing_negative_yoy_months'] = run
            if mk['direction'] == 'decreasing' and mk['significant']:
                problems.append({"type": "增速趋势性下滑", "object": "总体",
                                 "evidence": f"Mann-Kendall z={mk['z']}, p={mk['p']} (<0.05, 显著), 近{mk['n']}个可比月增速单调走低",
                                 "impact_wan": None})
            if run >= 3:
                problems.append({"type": "连续负增长", "object": "总体",
                                 "evidence": f"截至最近月, YoY 已连续 {run} 个月为负",
                                 "impact_wan": None})
            for x in anomalies:
                problems.append({"type": "异常月", "object": x['month'],
                                 "evidence": f"YoY={x['yoy']}%, 稳健Z={x['robust_z']} (|z|>={a.zthr})",
                                 "impact_wan": None})
    else:
        out['trend_test'] = {"skipped": "无 trend (数据<2年), 不做趋势/异常/连续下滑检验 — 与 prep-source 单年降级一致"}

    # 4 维度扫描 (需 period, 即 yoy_ready)
    period = M.get('period') or {}
    tc, tp = period.get('total_cur_wan'), period.get('total_base_wan')
    dims_out = {}
    for dim, rows in (M.get('dimensions') or {}).items():
        scan = {"cliffs": [], "engines": [], "share_shifts": [], "contributions": []}
        shares = [r['share'] for r in rows if r.get('share') is not None]
        if shares:
            hhi = round(sum((s / 100) ** 2 for s in shares), 3)
            scan['hhi'] = {"value": hhi,
                           "level": "高集中" if hhi > 0.18 else ("中度集中" if hhi >= 0.10 else "分散"),
                           "_note": "阈值沿用 0.10/0.18 (HHI 通用分级)"}
        for r in rows:
            yoy, share = r.get('yoy'), r.get('share')
            ac, ab = r.get('amount_cur_wan'), r.get('amount_base_wan')
            entry = {"name": r['name'], "yoy": yoy, "share": share}
            if ac is not None and ab is not None and tp:
                entry["delta_wan"] = round(ac - ab, 1)
                entry["contribution_pp"] = round((ac - ab) / tp * 100, 1)  # 对总增速的拉动/拖累(百分点)
                base_share = round(ab / tp * 100, 1)
                entry["share_shift_pp"] = round((share - base_share), 1) if share is not None else None
                scan['contributions'].append({k: entry[k] for k in
                                              ("name", "yoy", "share", "delta_wan", "contribution_pp")})
                if entry.get("share_shift_pp") is not None and abs(entry["share_shift_pp"]) >= a.shift:
                    scan['share_shifts'].append({"name": r['name'], "from": base_share,
                                                 "to": share, "shift_pp": entry["share_shift_pp"]})
            if yoy is not None and share is not None and share >= a.material:
                if yoy <= a.cliff:
                    scan['cliffs'].append(entry)
                    problems.append({"type": "维度断崖", "object": f"{dim}={r['name']}",
                                     "evidence": f"YoY={yoy}%, 份额{share}%" +
                                                 (f", 拖累总增速{entry['contribution_pp']}pp" if 'contribution_pp' in entry else ""),
                                     "impact_wan": entry.get('delta_wan')})
                elif yoy >= a.engine:
                    scan['engines'].append(entry)
        scan['contributions'].sort(key=lambda x: x['contribution_pp'])
        dims_out[dim] = scan
    if dims_out:
        out['dimension_scan'] = dims_out

    # 5 集中度风险 (复述 metrics 口径 + 分级)
    conc = M.get('concentration')
    if conc:
        top5 = conc.get('top5_share')
        level = "高" if (top5 or 0) > 45 else ("中" if (top5 or 0) > 30 else "低")
        out['concentration_risk'] = {**conc, "level": level,
                                     "_note": "Top5>45% 判高 (沿用 prep-source 阈值); 高集中建议成风险章"}
        if level == "高":
            problems.append({"type": "客户集中度风险", "object": "客户结构",
                             "evidence": f"Top5 占比 {top5}% (>45%), 前 {conc.get('pareto_n80')} 户贡献 80%",
                             "impact_wan": None})

    # 6 量价象限
    pvm = period.get('pvm')
    if pvm is not None and period.get('qty_yoy') is not None and period.get('price_yoy') is not None:
        q, p = period['qty_yoy'], period['price_yoy']
        quad = ("量价齐升" if q >= 0 and p >= 0 else
                "量增价减" if q >= 0 else
                "量减价升" if p >= 0 else "量价齐跌")
        out['pvm_quadrant'] = {"qty_yoy": q, "price_yoy": p, "quadrant": quad,
                               "vol_wan": pvm.get('vol_wan'), "price_mix_wan": pvm.get('price_mix_wan'),
                               "_note": pvm.get('_note'), **({"_caveat": pvm['_caveat']} if '_caveat' in pvm else {})}
        if quad == "量价齐跌":
            problems.append({"type": "量价双杀", "object": "总体",
                             "evidence": f"量 YoY={q}%, 价 YoY={p}% 同时为负",
                             "impact_wan": None if tc is None or tp is None else round(tc - tp, 1)})

    # 7 问题清单: 有影响金额的按 |金额| 降序在前, 其余按类型稳定排序在后
    with_amt = sorted([p for p in problems if p['impact_wan'] is not None], key=lambda x: abs(x['impact_wan']), reverse=True)
    without = [p for p in problems if p['impact_wan'] is None]
    for p in with_amt + without:
        p['action_frame'] = "按 PAC 出对策: 对象+动作+期限+验证指标 (由报告作者结合业务补全, 脚本不代拟具体动作)"
    out['problem_list'] = with_amt + without

    json.dump(out, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, allow_nan=False)

    # 人读摘要 insights.md
    md = [f"# 统计洞察摘要 — {a.out}", ""]
    tt = out.get('trend_test', {})
    if 'mann_kendall' in tt:
        md.append(f"- 趋势检验: {tt['reading']}")
        md.append(f"- 异常月: {len(out.get('anomaly_months', []))} 个"
                  + (" — " + ", ".join(x['month'] for x in out['anomaly_months']) if out.get('anomaly_months') else ""))
        md.append(f"- 连续负增长: 末端 {out.get('trailing_negative_yoy_months', 0)} 个月")
    else:
        md.append(f"- 趋势检验: 跳过 ({tt.get('skipped', '无序列')})")
    if 'pvm_quadrant' in out:
        md.append(f"- 量价象限: {out['pvm_quadrant']['quadrant']} (量 {out['pvm_quadrant']['qty_yoy']}% / 价 {out['pvm_quadrant']['price_yoy']}%)")
    for dim, scan in (out.get('dimension_scan') or {}).items():
        frag = []
        if scan.get('cliffs'):
            frag.append("断崖: " + ", ".join(f"{x['name']}({x['yoy']}%)" for x in scan['cliffs']))
        if scan.get('engines'):
            frag.append("引擎: " + ", ".join(f"{x['name']}(+{x['yoy']}%)" for x in scan['engines']))
        if scan.get('share_shifts'):
            frag.append("位移: " + ", ".join(f"{x['name']}{x['shift_pp']:+}pp" for x in scan['share_shifts']))
        md.append(f"- 维度[{dim}] HHI={scan.get('hhi', {}).get('value', 'NA')}" + ("; " + "; ".join(frag) if frag else ""))
    if 'concentration_risk' in out:
        md.append(f"- 客户集中度: {out['concentration_risk']['level']} (Top5={out['concentration_risk'].get('top5_share')}%)")
    md.append(f"- 问题清单: {len(out['problem_list'])} 条 (含影响金额的已按 |万| 降序)")
    md.append("")
    md.append("> 纪律: 显著性以 mann_kendall.significant 为准; n<8 只报方向; 无目标数据不谈达成缺口。")
    open(a.out.replace('.json', '') + '.md', 'w', encoding='utf-8').write("\n".join(md))
    print(f"[OK] insights → {a.out}  |  摘要 → {a.out.replace('.json', '')}.md  |  问题 {len(out['problem_list'])} 条")

def _mk_reading(mk):
    d = {"increasing": "增速上行", "decreasing": "增速下行", "no_trend": "无方向",
         "insufficient_sample": "样本不足"}[mk['direction']]
    if mk['direction'] == 'insufficient_sample':
        return "样本不足 (n<4), 不做趋势判断"
    if not mk.get('p') and mk.get('p') != 0:
        return d
    if 'note' in mk:
        return f"{d} (n={mk['n']}<8, 仅方向参考, 不判显著)"
    return f"{d}, {'显著 (p=' + str(mk['p']) + '<0.05) — 是趋势不是波动' if mk['significant'] else '不显著 (p=' + str(mk['p']) + ') — 措辞按波动处理, 禁写趋势确立'}"

if __name__ == '__main__':
    main()
