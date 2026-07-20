#!/usr/bin/env python3
"""stat-insights.py — 统计洞察层 (V2.10)

读 prep-source.py 产出的 metrics.json, 产出 insights.json + insights.md:
  1. 趋势显著性  — Mann-Kendall 检验 (跨年逐月 YoY 增速序列): 回答"下滑是趋势还是波动"
  2. 异常月检测  — 稳健 Z 分数 (median/MAD), |z|>=2.5 判异常月
  3. 连续下滑    — YoY 序列末端连续为负的月数
  4. 维度扫描    — 断崖(cliff)/引擎(engine)/结构位移(share shift, pp)/增速贡献分解(contribution)
  5. 集中度      — HHI/Top5/帕累托；无显式政策阈值时只作描述性输出
  6. 量价象限    — 依据 period.pvm 判量价组合 (沿用 price_mix 口径 caveat)
  7. 问题清单    — 按主指标影响度与方向排序，供报告"问题发现"章直接引用

纪律 (与 SKILL 数据至上对齐):
  - metrics.json 为 BLOCKED 时拒绝运行 (exit 2): 脏数据上不做统计
  - 样本 n<8 时 Mann-Kendall 只报方向不报显著性 (insufficient_sample), 禁止写"趋势确立"
  - 无目标数据不编造达成缺口; 本脚本不做预测外推
  - 报告中的洞察结论从 insights.json 引用, 显著性以 significant 字段为准

依赖: 仅 Python3 标准库 (json/math/statistics), 无 pandas/scipy。
用法:
  python3 scripts/stat-insights.py metrics.json [--out insights.json]
      [--cliff -15] [--engine 15] [--material 2] [--shift 1.5] [--zthr 2.5]
      [--hhi-medium .10 --hhi-high .18] [--top5-medium 30 --top5-high 45]

HHI/Top5 阈值没有显式成对配置时只输出描述性集中度，不自动解释成业务风险。
"""
import argparse, hashlib, json, math, os, sys
from statistics import median

def atomic_write(path, text):
    target = os.path.abspath(path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    temporary = f"{target}.tmp.{os.getpid()}"
    try:
        with open(temporary, 'x', encoding='utf-8') as handle:
            handle.write(text)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

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
    仅取相邻两年同月均有值、基期>0 且当期>=0 的月份。返回 [(label, yoy%), ...]"""
    yrs = sorted(int(y) for y in trend)
    seq = []
    for y in yrs:
        prev = str(y - 1)
        if prev not in trend:
            continue
        for m in range(12):
            c, p = trend[str(y)][m], trend[prev][m]
            if c is None or p is None or p <= 0 or c < 0:
                continue
            seq.append((f"{y}-{m+1:02d}", round((c / p - 1) * 100, 1)))
    return seq

def trailing_negative_run(seq):
    """只统计末端日历连续的负增长月；缺月立即中断，不把 1 月+3 月说成连续两月。"""
    run = 0
    previous_index = None
    for label, value in reversed(seq):
        try:
            year, month = (int(x) for x in label.split('-', 1))
            month_index = year * 12 + month - 1
        except (ValueError, AttributeError):
            break
        if value >= 0 or (previous_index is not None and month_index != previous_index - 1):
            break
        run += 1
        previous_index = month_index
    return run

def _method(status, reason_code, **extra):
    return {"status": status, "reason_code": reason_code, **extra}

def _primary_semantics(metrics):
    semantic = metrics.get('semantic_layer') or {}
    contracts = semantic.get('measures') or []
    primary_id = semantic.get('primary_measure') or (metrics.get('meta') or {}).get('primary_measure_id')
    contract = next((item for item in contracts if item.get('id') == primary_id), None)
    result = (metrics.get('measure_results') or {}).get(primary_id) if primary_id else None
    if contract and result:
        return primary_id, contract, result
    period = metrics.get('period') or {}
    if isinstance(period, dict):
        return 'amount', {"id": "amount", "label": "金额", "semantic_type": "amount",
                          "aggregation": "sum", "unit": "wan_currency",
                          "direction": "higher_is_better", "additivity": "additive"}, {
            "current": period.get('total_cur_wan'), "baseline": period.get('total_base_wan'),
            "change_pct": period.get('total_yoy'), "change_abs": (
                period.get('total_cur_wan') - period.get('total_base_wan')
                if period.get('total_cur_wan') is not None and period.get('total_base_wan') is not None else None)}
    return None, None, None

def _is_unfavorable(delta, direction):
    if delta is None or direction == 'neutral': return None
    return delta < 0 if direction == 'higher_is_better' else delta > 0

def _regular_month_series(points):
    """Return numeric values only when labels are strictly adjacent YYYY-MM months."""
    indexed = []
    for point in points or []:
        try:
            year, month = (int(value) for value in str(point['period']).split('-', 1))
            indexed.append((year * 12 + month - 1, float(point['value'])))
        except (KeyError, TypeError, ValueError):
            return None
    if any(indexed[index][0] != indexed[index - 1][0] + 1 for index in range(1, len(indexed))):
        return None
    return [value for _, value in indexed]

# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description="metrics.json → 通用统计洞察 insights.json")
    ap.add_argument('metrics'); ap.add_argument('--out', default='insights.json')
    ap.add_argument('--cliff', type=float, default=-15, help="不利变化阈值绝对值沿用 15%%")
    ap.add_argument('--engine', type=float, default=15, help="有利变化阈值 (默认 15%%)")
    ap.add_argument('--material', type=float, default=2, help="重要性门槛: 份额%%")
    ap.add_argument('--shift', type=float, default=1.5, help="结构位移阈值 pp")
    ap.add_argument('--zthr', type=float, default=2.5, help="异常期稳健Z阈值")
    ap.add_argument('--hhi-medium', type=float, default=None)
    ap.add_argument('--hhi-high', type=float, default=None)
    ap.add_argument('--top5-medium', type=float, default=None)
    ap.add_argument('--top5-high', type=float, default=None)
    a = ap.parse_args()
    hhi_policy = a.hhi_medium is not None or a.hhi_high is not None
    top5_policy = a.top5_medium is not None or a.top5_high is not None
    if hhi_policy and (a.hhi_medium is None or a.hhi_high is None or not 0 <= a.hhi_medium < a.hhi_high <= 1):
        ap.error("HHI 政策阈值必须成对配置且满足 0 <= medium < high <= 1")
    if top5_policy and (a.top5_medium is None or a.top5_high is None or not 0 <= a.top5_medium < a.top5_high <= 100):
        ap.error("Top5 政策阈值必须成对配置且满足 0 <= medium < high <= 100")
    try:
        with open(a.metrics, 'rb') as handle: metrics_payload = handle.read()
        M = json.loads(metrics_payload.decode('utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[REFUSED] 无法读取有效 metrics.json: {exc}"); sys.exit(2)
    status = (M.get('data_status') or {}).get('status')
    if status == 'BLOCKED':
        print("[REFUSED] metrics.json 为 BLOCKED — 先按 quality.md 修数"); sys.exit(2)
    if status not in {'OK', 'WARN'}:
        print(f"[REFUSED] data_status.status 缺失或未知: {status!r}"); sys.exit(2)
    primary_id, contract, primary = _primary_semantics(M)
    if M.get('schema_version') != '1.0' or not primary_id or not contract or not primary:
        print("[REFUSED] metrics schema 不完整：要求 schema_version=1.0 且存在通用主指标或旧 period 兼容对象"); sys.exit(2)

    out = {"schema_version": "1.0", "meta": {"source_metrics": os.path.basename(a.metrics),
           "metrics_sha256": hashlib.sha256(metrics_payload).hexdigest(), "generated_by": "stat-insights.py",
           "metrics_status": status, "primary_measure": primary_id,
           "thresholds": {"unfavorable_change_pct": abs(a.cliff), "favorable_change_pct": abs(a.engine),
                          "material_share": a.material, "share_shift_pp": a.shift,
                          "anomaly_robust_z": a.zthr, "hhi_medium": a.hhi_medium,
                          "hhi_high": a.hhi_high, "top5_medium": a.top5_medium, "top5_high": a.top5_high},
           "policy": {"hhi": hhi_policy, "top5": top5_policy}},
           "method_applicability": {}, "problem_list": [],
           "_discipline": "方法先判适用性；好坏读取指标 direction；无政策时集中度只描述不定性风险"}
    problems = []

    # 趋势与异常：优先沿用严格 YoY 序列；否则仅接受日历连续月序列。
    snapshot_mode = (M.get('analysis_scope') or {}).get('mode') == 'snapshot'
    seq = [] if snapshot_mode else (yoy_series(M.get('trend') or {}) if M.get('trend') else [])
    series_kind = 'monthly_yoy_pct'
    if not seq and not snapshot_mode:
        values = _regular_month_series(primary.get('time_series') or [])
        if values is not None:
            seq = [(point['period'], point['value']) for point in primary.get('time_series') or []]
            series_kind = 'regular_monthly_primary_measure'
    if len(seq) >= 4:
        vals = [value for _, value in seq]
        mk = mann_kendall(vals)
        business_favorable = None
        if mk['direction'] in {'increasing', 'decreasing'} and contract['direction'] != 'neutral':
            business_favorable = ((mk['direction'] == 'increasing') == (contract['direction'] == 'higher_is_better'))
        out['trend_test'] = {"series": series_kind, "points": seq, "mann_kendall": mk,
                             "business_favorable": business_favorable, "reading": _mk_reading(mk)}
        out['method_applicability']['mann_kendall'] = _method('APPLIED', 'regular_series_n_gte_4', n=len(seq))
        zs = robust_z(vals)
        anomalies = [{"period": seq[index][0], "value": seq[index][1], "robust_z": zs[index]}
                     for index in range(len(seq)) if abs(zs[index]) >= a.zthr]
        out['anomaly_periods'] = anomalies
        out['anomaly_months'] = [{"month": item['period'], "yoy": item['value'], "robust_z": item['robust_z']} for item in anomalies]
        out['method_applicability']['robust_z'] = _method('APPLIED', 'regular_series_n_gte_4', n=len(seq))
        if mk['significant'] and business_favorable is False:
            problems.append({"type": "主指标不利趋势", "object": contract.get('label') or primary_id,
                             "evidence": f"Mann-Kendall z={mk['z']}, p={mk['p']}，方向={mk['direction']}，指标方向={contract['direction']}",
                             "impact": None, "impact_wan": None})
        if series_kind == 'monthly_yoy_pct':
            run = trailing_negative_run(seq); out['trailing_negative_yoy_months'] = run
    else:
        reason = 'snapshot_has_no_time_series' if snapshot_mode else 'requires_regular_series_n_gte_4'
        out['trend_test'] = {"status": "SKIPPED", "reason_code": reason, "points_available": len(seq)}
        out['method_applicability']['mann_kendall'] = _method('SKIPPED', reason, n=len(seq))
        out['method_applicability']['robust_z'] = _method('SKIPPED', reason, n=len(seq))

    # 通用维度扫描：方向决定有利/不利；贡献与 HHI/Pareto 只适用于可加非负指标。
    dimensions = (M.get('measure_dimensions') or {}).get(primary_id) or M.get('dimensions') or {}
    dims_out = {}
    for dim, rows in dimensions.items():
        scan = {"unfavorable": [], "favorable": [], "share_shifts": [], "contributions": [],
                "topn": _method('APPLIED', 'dimension_with_multiple_groups', groups=len(rows)) if len(rows) >= 2
                        else _method('SKIPPED', 'requires_dimension_with_multiple_groups', groups=len(rows))}
        shares = [row['share'] for row in rows if row.get('share') is not None]
        if shares and contract['additivity'] == 'additive' and all(share >= 0 for share in shares):
            hhi = round(sum((share / 100) ** 2 for share in shares), 3)
            if hhi_policy:
                level = "高集中" if hhi >= a.hhi_high else ("中度集中" if hhi >= a.hhi_medium else "分散")
                scan['hhi'] = {"value": hhi, "level": level, "classification": "policy"}
            else:
                scan['hhi'] = {"value": hhi, "level": None, "classification": "descriptive",
                               "_note": "未配置业务政策阈值，不解释为风险"}
            scan['pareto'] = _method('APPLIED', 'nonnegative_additive_measure')
        else:
            scan['hhi'] = {"status": "SKIPPED", "reason_code": "requires_nonnegative_additive_shares"}
            scan['pareto'] = _method('SKIPPED', 'requires_nonnegative_additive_measure')
        for row in rows:
            change = row.get('change_pct', row.get('yoy')); share = row.get('share')
            current = row.get('current', row.get('amount_cur_wan')); baseline = row.get('baseline', row.get('amount_base_wan'))
            delta = row.get('delta')
            if delta is None and current is not None and baseline is not None: delta = current - baseline
            entry = {"name": row['name'], "change_pct": change, "share": share, "delta": delta,
                     "delta_wan": row.get('delta_wan'),
                     "favorable": None if delta is None else not _is_unfavorable(delta, contract['direction'])
                     if contract['direction'] != 'neutral' else None}
            contribution = row.get('contribution_pp')
            if contribution is not None and contract['additivity'] == 'additive':
                entry['contribution_pp'] = contribution
                scan['contributions'].append({"name": row['name'], "change_pct": change,
                                              "share": share, "delta": delta, "delta_wan": row.get('delta_wan'),
                                              "contribution_pp": contribution})
            material = (share >= a.material if share is not None else contract['additivity'] != 'additive')
            if change is not None and material and contract['direction'] != 'neutral':
                unfavorable = ((change < 0) if contract['direction'] == 'higher_is_better' else (change > 0))
                favorable = ((change > 0) if contract['direction'] == 'higher_is_better' else (change < 0))
                if unfavorable and abs(change) >= abs(a.cliff):
                    scan['unfavorable'].append(entry)
                    problems.append({"type": "维度主指标不利变化", "object": f"{dim}={row['name']}",
                                     "evidence": f"变化={change}%" + (f", 份额={share}%" if share is not None else "") +
                                                 f", direction={contract['direction']}",
                                     "impact": delta, "impact_wan": row.get('delta_wan')})
                elif favorable and abs(change) >= abs(a.engine):
                    scan['favorable'].append(entry)
        scan['cliffs'] = scan['unfavorable']; scan['engines'] = scan['favorable']
        scan['contributions'].sort(key=lambda item: item['contribution_pp'])
        dims_out[dim] = scan
    if dims_out: out['dimension_scan'] = dims_out
    out['method_applicability']['topn'] = _method('APPLIED' if any(scan['topn']['status'] == 'APPLIED' for scan in dims_out.values()) else 'SKIPPED',
                                                  'at_least_one_eligible_dimension' if dims_out else 'no_dimensions')
    out['method_applicability']['pareto'] = _method('APPLIED' if any(scan['pareto']['status'] == 'APPLIED' for scan in dims_out.values()) else 'SKIPPED',
                                                   'nonnegative_additive_dimension' if dims_out else 'no_dimensions')

    conc = M.get('concentration')
    if conc:
        if conc.get('status') in {'BLOCKED', 'SKIPPED'}:
            out['concentration_risk'] = {**conc, "level": None,
                                         "classification": "unavailable",
                                         "_note": conc.get('_caveat') or "集中度适用性或质量门禁未通过"}
        else:
            top5 = conc.get('top5_share')
            if top5_policy:
                level = "高" if (top5 or 0) >= a.top5_high else ("中" if (top5 or 0) >= a.top5_medium else "低")
                out['concentration_risk'] = {**conc, "level": level, "classification": "policy"}
                if level == '高':
                    problems.append({"type": "对象集中度政策触发", "object": "对象结构",
                                     "evidence": f"Top5={top5}% >= policy {a.top5_high}%",
                                     "impact": None, "impact_wan": None})
            else:
                out['concentration_risk'] = {**conc, "level": None, "classification": "descriptive",
                                             "_note": "未配置业务政策阈值，不解释为风险"}
    out['method_applicability']['hhi_risk_classification'] = _method('APPLIED' if hhi_policy else 'SKIPPED',
                                                                     'policy_configured' if hhi_policy else 'business_policy_not_configured')

    period = M.get('period') or {}; pvm = period.get('pvm')
    pvm_app = (M.get('method_applicability') or {}).get('pvm') or {}
    if not pvm or pvm_app.get('status') == 'SKIPPED':
        out['pvm_quadrant'] = {"status": "SKIPPED", "reason_code": pvm_app.get('reason_code') or 'requires_amount_quantity_and_time_baseline'}
        out['method_applicability']['pvm'] = _method('SKIPPED', out['pvm_quadrant']['reason_code'])
    elif pvm.get('status') == 'BLOCKED' or pvm.get('_caveat'):
        out['pvm_quadrant'] = {"status": "BLOCKED", "quadrant": None,
                               "_caveat": pvm.get('_caveat') or "PVM 质量门禁未通过"}
        out['method_applicability']['pvm'] = _method('BLOCKED', 'quality_gate_failed')
    elif period.get('qty_yoy') is not None and period.get('price_yoy') is not None:
        quantity_change, price_change = period['qty_yoy'], period['price_yoy']
        quadrant = ("量价齐升" if quantity_change >= 0 and price_change >= 0 else "量增价减" if quantity_change >= 0 else
                    "量减价升" if price_change >= 0 else "量价齐跌")
        out['pvm_quadrant'] = {"status": "OK", "qty_yoy": quantity_change, "price_yoy": price_change,
                               "quadrant": quadrant, "vol_wan": pvm.get('vol_wan'), "price_mix_wan": pvm.get('price_mix_wan'),
                               "_note": pvm.get('_note')}
        out['method_applicability']['pvm'] = _method('APPLIED', 'additive_amount_quantity_time_baseline')

    with_impact = sorted([item for item in problems if item.get('impact') is not None],
                         key=lambda item: abs(item['impact']), reverse=True)
    without_impact = [item for item in problems if item.get('impact') is None]
    for item in with_impact + without_impact:
        item['action_frame'] = "按 PAC 出对策: 对象+动作+期限+验证指标 (需结合业务补全)"
    out['problem_list'] = with_impact + without_impact
    atomic_write(a.out, json.dumps(out, ensure_ascii=False, indent=1, allow_nan=False))

    md = [f"# 统计洞察摘要 — {a.out}", "", f"- 主指标: {contract.get('label')} ({primary_id}, {contract.get('unit')}, {contract.get('direction')})"]
    trend_test = out.get('trend_test', {})
    md.append(f"- 趋势检验: {trend_test.get('reading') or '跳过 (' + trend_test.get('reason_code', '不适用') + ')'}")
    md.append(f"- 集中度解释: {'使用显式政策阈值' if hhi_policy or top5_policy else '仅描述，不自动定性风险'}")
    md.append(f"- 问题清单: {len(out['problem_list'])} 条")
    md.append(""); md.append("> 纪律: 方法适用性以 method_applicability 为准；方向读取 semantic_layer.measures[].direction。")
    atomic_write(a.out.replace('.json', '') + '.md', "\n".join(md))
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
