#!/usr/bin/env python3
"""
prep-source.py — 多源数据画像 + 清洗聚合 + 校验 (south-china-report)

借鉴 anthropic-skills:sales-report-html 的 prep_data 架构, 用 DuckDB 做统一加载器,
一个接口吃 Excel/CSV/Parquet/SQLite/DuckDB/任意 SQL —— 适应面比只读 Excel 广。

用法:
  # 1) 画像: 看字段角色 + 自动建议分析骨架 + 产出 map.json 草稿
  python3 prep-source.py profile <源> [--sheet S] [--sqlite db --table T] [--sql "SELECT..."]
  # 2) 构建: 按 map.json 清洗+聚合+校验 → metrics.json (+ quality.md)
  python3 prep-source.py build <源> --map map.json --out metrics.json

<源> 可以是: data.xlsx / data.csv / data.parquet / db.sqlite / db.duckdb
纪律: 报告里每个数字都从 metrics.json 抄, 不手敲 (防转录错误)。
      data_status=BLOCKED 时数据不可信, 只出修数建议, 不出结论。
      map.caliber.granularity 可选 "month"(默认) | "xun"(旬, 按日 1-10/11-20/21-末 切分), 影响 YoY 期间锁定粒度。
      map.roles.id 可选, 指定单据/流水号列, 用于检测完全重复行与重复单号 (发现只告警, 不自动去重)。
"""
import sys, os, json, argparse, re
import duckdb

# ── 统一加载器 (DuckDB 多源) ──────────────────────────────
def load(args):
    if not getattr(args, 'sql', None) and not getattr(args, 'data', None):
        raise SystemExit("需提供数据源路径或 --sql")
    con = duckdb.connect()
    for ext in ('excel', 'sqlite'):
        try: con.execute(f"INSTALL {ext}; LOAD {ext};")
        except Exception: pass
    if getattr(args, 'sql', None):
        return con.execute(args.sql).df()
    src = args.data
    e = os.path.splitext(src)[1].lower()
    if getattr(args, 'sqlite', None) or e in ('.sqlite', '.db', '.sqlite3'):
        db = args.sqlite or src
        con.execute(f"ATTACH '{db}' AS s (TYPE sqlite);")
        tbl = getattr(args, 'table', None)
        if not tbl:
            tbls = con.execute("SELECT name FROM s.sqlite_master WHERE type='table'").df()['name'].tolist()
            raise SystemExit(f"SQLite 需指定 --table (可选: {tbls})")
        return con.execute(f"SELECT * FROM s.{tbl}").df()
    if e in ('.duckdb', '.ddb'):
        con.execute(f"ATTACH '{src}' AS d;")
        tbl = getattr(args, 'table', None)
        if not tbl:
            tbls = con.execute("SELECT table_name FROM d.information_schema.tables").df()['table_name'].tolist()
            raise SystemExit(f"DuckDB 需指定 --table (可选: {tbls})")
        return con.execute(f"SELECT * FROM d.{tbl}").df()
    if e in ('.xlsx', '.xlsm', '.xls'):
        sh = getattr(args, 'sheet', None)
        q = f"SELECT * FROM read_xlsx('{src}'" + (f", sheet='{sh}'" if sh else "") + ")"
        try: return con.execute(q).df()
        except Exception:
            import pandas as pd
            return pd.read_excel(src, sheet_name=sh if sh else 0)
    if e in ('.csv', '.txt', '.tsv'):
        return con.execute(f"SELECT * FROM read_csv_auto('{src}')").df()
    if e in ('.parquet', '.pq'):
        return con.execute(f"SELECT * FROM read_parquet('{src}')").df()
    raise SystemExit(f"不支持的源类型: {e} (支持 xlsx/csv/parquet/sqlite/duckdb 或 --sql)")

# ── 角色推断 ──────────────────────────────────────────────
TIME_RE  = re.compile(r'日期|时间|date|time|年月|ym|month|年份|year', re.I)
AMT_RE   = re.compile(r'金额|额|销售|营收|收入|amount|revenue|sales|value|gmv', re.I)
QTY_RE   = re.compile(r'数量|台数|件数|销量|qty|quantity|units|count', re.I)
PRICE_RE = re.compile(r'单价|均价|价格|price', re.I)
TGT_RE   = re.compile(r'目标|预算|计划|指标|target|budget|plan|quota', re.I)
ID_RE    = re.compile(r'单号|订单号|发票号|流水号|编码|编号|id$|_id|no$|number', re.I)
NOISE_RE = re.compile(r'名称|地址|街道|省份|城市|项目名|业务员|仓库名|发票|订单号', re.I)  # 高基数/无决策价值维度
CUST_RE  = re.compile(r'客户|经销商|门店|store|customer|dealer|account', re.I)
PROD_RE  = re.compile(r'型号|产品|sku|商品|product|model|item', re.I)
DIM_RE   = re.compile(r'战区|大区|区域|渠道|品类|类别|分类|地区|省|市|region|channel|category|zone|area|类', re.I)

def infer_role(col, dtype, nun, n, num_ok):
    s = str(col)
    if TGT_RE.search(s): return 'target'
    if TIME_RE.search(s): return 'time'
    if num_ok and (AMT_RE.search(s) or QTY_RE.search(s) or PRICE_RE.search(s)): return 'measure'
    if ID_RE.search(s): return 'id'
    if CUST_RE.search(s): return 'customer'
    if PROD_RE.search(s): return 'product'
    if DIM_RE.search(s): return 'dimension'
    if num_ok and nun > 0.3*n: return 'measure'      # 高基数数值 → 度量
    if nun <= max(50, 0.1*n): return 'dimension'     # 低基数 → 维度
    return 'other'

def profile(args):
    import pandas as pd
    df = load(args)
    n = len(df)
    print(f"源: {args.data or args.sql}")
    print(f"行数: {n:,}   列数: {df.shape[1]}\n")
    print(f"{'列名':<22}{'类型':<10}{'空%':>6}{'基数':>9}  {'角色':<10}样例")
    print("-"*90)
    roles = {}; card = {}
    for c in df.columns:
        s = df[c]; nn = s.isna().mean(); nun = s.nunique(dropna=True); card[str(c)] = nun
        num_ok = pd.api.types.is_numeric_dtype(s)
        if not num_ok:
            try: num_ok = pd.to_numeric(s.dropna().astype(str).str.replace(',','').head(50), errors='coerce').notna().mean() > 0.8
            except Exception: num_ok = False
        role = infer_role(c, s.dtype, nun, n, num_ok)
        roles.setdefault(role, []).append(str(c))
        sample = ', '.join(s.dropna().astype(str).head(2).tolist())[:30]
        print(f"{str(c)[:21]:<22}{str(s.dtype)[:9]:<10}{nn*100:>5.0f}%{nun:>9,}  {role:<10}{sample}")

    # ── 骨架建议 (字段角色 → 覆盖面 → 章节) ──
    print("\n" + "="*90 + "\n建议分析骨架 (依据 audience-visual-contract §2 覆盖面清单):")
    # 维度筛选: 只保留有决策价值的低基数维度 (2-40 值, 非 ID/名称/地址等噪声)
    dims_all = roles.get('dimension', [])
    dims = [d for d in dims_all if 2 <= card.get(d,0) <= 40 and not NOISE_RE.search(d)]
    dropped = [d for d in dims_all if d not in dims]
    meas = roles.get('measure', [])
    has_time = bool(roles.get('time')); has_tgt = bool(roles.get('target'))
    has_cust = bool(roles.get('customer')); has_prod = bool(roles.get('product'))
    amt = next((m for m in meas if AMT_RE.search(m)), meas[0] if meas else None)
    qty = next((m for m in meas if QTY_RE.search(m)), None)
    # 年度覆盖面: build 仅在 ≥2 年时产出 period/trend/pvm; profile 骨架须对齐, 否则单期数据会被建议搭无数据支撑的 YoY/瀑布章节
    n_years = 0
    tcols = roles.get('time') or []
    if tcols:
        try: n_years = int(pd.to_datetime(df[tcols[0]], errors='coerce').dt.year.dropna().nunique())
        except Exception: n_years = 0
    multi_year = n_years >= 2
    sk = []; generic = []
    if amt and has_time and multi_year:
        sk.append(f"C1 总量趋势 — YoY 同期对比折线 (度量={amt})" + (f" + 量价瀑布 (量={qty}/价=均价)" if qty else ""))
    elif amt and has_time:
        sk.append(f"[!] 时间跨度仅 {n_years} 个年度(<2年) → build 不会产出 YoY/量价瀑布/趋势同比; 降级建议: 结构占比 + 排名(增长下滑双榜) + 集中度, 勿搭 YoY/瀑布章节 (补齐上一年同期数据后再做同比)")
    for d in dims:
        low = str(d)
        if re.search(r'渠道|channel', low, re.I): sk.append(f"C· 渠道结构 — 100%堆叠 (维度={d})")
        elif re.search(r'战区|大区|区域|region|zone', low, re.I): sk.append(f"C· 区域/战区 — 降序条形+YoY色 + {d}×月热力 (维度={d})")
        elif re.search(r'结构|高端|变频|渗透', low, re.I): sk.append(f"C· 结构升级 — 渗透率趋势 (维度={d})")
        else: generic.append(d)
    if has_prod: sk.append(f"C· 产品/型号 — 增长下滑双榜 (§1.8, 按绝对增减额)")
    if has_cust: sk.append(f"C· 客户集中度 — Top5/10 占比趋势 + Pareto (风险维度)")
    if has_tgt: sk.append(f"C· 达成分析 — 子弹图 (目标 vs 实际)")
    else: sk.append("[!] 无目标/预算字段 → 达成率/子弹图强制降级为 YoY/结构 (chart-selection-guide §0.1b), 禁止编造目标")
    for line in sk: print("  " + line)
    if generic:
        print("  其它候选维度 (按需, 挑有决策价值的): " + " / ".join(generic[:6]) + (" …" if len(generic)>6 else ""))
    if dropped: print(f"  已略过 {len(dropped)} 个高基数/ID/名称类维度 (发票号/地址/名称等, 不宜成章)")
    print("  [!] 紧凑档 4-6 章; 从上面挑最有决策含义的 4-5 个, 别为多而多 (少胜于多)")

    # ── 产出 map.json 草稿 ──
    draft = {"source": {"path": args.data, "sheet": getattr(args,'sheet',None), "sqlite": getattr(args,'sqlite',None),
                        "table": getattr(args,'table',None), "sql": getattr(args,'sql',None)},
             "roles": {"time": (roles.get('time') or [None])[0], "amount": amt, "qty": qty,
                       "dimensions": [d for d in dims], "customer": (roles.get('customer') or [None])[0],
                       "product": (roles.get('product') or [None])[0], "target": (roles.get('target') or [None])[0],
                       "id": (roles.get('id') or [None])[0]},
             "caliber": {"period": "填写, 如 2026H1", "note": "净值/含税等口径"}}
    open('map.draft.json','w',encoding='utf-8').write(json.dumps(draft, ensure_ascii=False, indent=2))
    print("\n已写 map.draft.json (改好后用于 build)。下一步: python3 prep-source.py build <源> --map map.draft.json --out metrics.json")

# ── 清洗工具 ──────────────────────────────────────────────
def coerce_num(s):
    import pandas as pd
    if pd.api.types.is_numeric_dtype(s): return pd.to_numeric(s, errors='coerce')
    x = s.astype(str).str.strip()
    x = x.str.replace(',', '', regex=False).str.replace('¥','',regex=False).str.replace('￥','',regex=False)
    x = x.str.replace(r'^\((.*)\)$', r'-\1', regex=True)  # 会计负数
    return pd.to_numeric(x, errors='coerce')

class Rep:
    def __init__(s): s.e=[]; s.w=[]; s.ok=[]
    def err(s,m): s.e.append(m)
    def warn(s,m): s.w.append(m)
    def good(s,m): s.ok.append(m)
    def status(s): return 'BLOCKED' if s.e else ('WARN' if s.w else 'OK')

def build(args):
    import pandas as pd
    m = json.load(open(args.map, encoding='utf-8'))
    r = m['roles']; df = load(args)
    R = Rep()
    for k in ('time','target','customer','product','id'):
        v = r.get(k)
        if v and v not in df.columns: R.warn(f"map.roles.{k} 列不存在: {v} (相关分析跳过)")
    amt = r.get('amount')
    if not amt or amt not in df.columns: raise SystemExit(f"map.roles.amount 无效: {amt}")
    df['_amt'] = coerce_num(df[amt])
    # 与数量列同口径: 原生空单元格(空行)是稀疏但合法的数据(如仅已结单填金额), 不算坏值;
    # 只有"非空原始值但无法转数"才计入坏值率参与 5% 阈值 (原逻辑把空/坏混为一谈且分母用全量, 误伤稀疏合法数据)
    amt_empty = int(df[amt].isna().sum())                 # 原生空单元格 → 空行
    bad = int(df['_amt'].isna().sum()) - amt_empty        # 非空但无法转数 → 真坏值
    amt_src = int(df[amt].notna().sum())                  # 坏值率分母只用非空原始值
    badpct = (bad/amt_src*100) if amt_src else 0
    if amt_empty:
        R.warn(f"金额列 {amt_empty} 行为空单元格(空行), 已按剔除处理(未计入合计, 不计坏值率)")
    if bad:
        msg = f"金额列 {bad} 行({badpct:.1f}%非空)无法解析为数字, 已按剔除处理(未计入合计)"
        # 非空坏值率>5% 视为数据不可信 → BLOCKED; 否则仅告警 (空单元格不参与此阈值)
        (R.err if badpct > 5 else R.warn)(msg)
    idcol = r.get('id')
    if idcol and idcol in df.columns:
        dup_rows = int(df.duplicated().sum())
        dup_ids = int(df[idcol].duplicated().sum())
        if dup_rows: R.warn(f"完全重复行 {dup_rows} 行 — 确认是否应去重 (当前未去重, 金额可能双计)")
        if dup_ids > dup_rows: R.warn(f"重复 {idcol} 共 {dup_ids} 个 (可能一单多行, 核对口径)")
    tcol = r.get('time')
    if tcol and tcol in df.columns:
        df['_d'] = pd.to_datetime(df[tcol], errors='coerce')
        df['_y'] = df['_d'].dt.year; df['_m'] = df['_d'].dt.month
        if df['_d'].isna().mean() > 0.05: R.warn(f"时间列 {df['_d'].isna().sum()} 行解析失败")
        gran = str((m.get('caliber') or {}).get('granularity') or 'month').lower()
        if gran == 'xun':
            df['_xun'] = df['_d'].dt.day.map(lambda d: 1 if d <= 10 else (2 if d <= 20 else 3))
            df['_mk'] = df['_m'] * 10 + df['_xun']
        else:
            df['_mk'] = df['_m']

    out = {"meta": {"source": args.data or 'sql', "rows": len(df), "amount_field": amt,
                    "period": m.get('caliber',{}).get('period'), "generated_by":"prep-source.py"},
           "total": round(float(df['_amt'].sum()), 2), "dimensions": {}, "_discipline": "报告数字一律从本文件抄，勿手敲"}

    # YoY 期间: 取最新年出现的月份/旬, 对上一年同期 (粒度按 map.caliber.granularity, 默认 month; 旬粒度下 _mk = 月*10+旬号)
    yoy_ready = False
    if tcol and tcol in df.columns and df['_y'].notna().any():
        yrs = sorted(df['_y'].dropna().unique().tolist())
        if len(yrs) >= 2:
            cur, prev = yrs[-1], yrs[-2]
            # 基年相邻性检查 (V2.10.1, 外部审计缺陷): 2024+2026 这类缺中间年的数据,
            # yrs[-1]/yrs[-2] 会把跨 2 年对比静默标成"同比"且状态 OK — 必须显式降级口径
            gap = int(cur - prev)
            adjacent = (gap == 1)
            if not adjacent:
                R.warn(f"基年不相邻: {int(cur)} vs {int(prev)} (间隔 {gap} 年) — 口径为跨期对比而非同比, "
                       f"报告措辞禁用'同比/YoY', 应写'对比{int(prev)}年'; pvm/yoy 字段均按此口径理解")
            cur_ks = sorted(df[df._y==cur]['_mk'].dropna().unique().tolist())
            out['meta']['yoy'] = {"current_year": int(cur), "base_year": int(prev),
                                  "months": sorted({int(k // 10 if gran=='xun' else k) for k in cur_ks}),
                                  "granularity": gran, "adjacent": adjacent}
            if not adjacent:
                out['meta']['yoy']['caliber_note'] = f"基年不相邻(间隔{gap}年): 跨期对比, 非同比"
            yoy_ready = True
            def period_sum(sub, y): return float(sub[(sub._y==y)&(sub._mk.isin(cur_ks))]['_amt'].sum())
            # 期间总额 + 总 YoY (报告头条) + 量价 (若有 qty)
            tc = period_sum(df, cur); tp = period_sum(df, prev)
            out['period'] = {"total_cur_wan": round(tc/1e4,1), "total_base_wan": round(tp/1e4,1),
                             "total_yoy": None if tp==0 else round((tc/tp-1)*100,1)}
            qcol = r.get('qty')
            if qcol and qcol in df.columns:
                df['_q'] = coerce_num(df[qcol])
                qbad = int(df['_q'].isna().sum() - df[qcol].isna().sum())  # 原生空值不算解析失败
                qsrc = int(df[qcol].notna().sum())
                qpct = (qbad / qsrc * 100) if qsrc else 0
                if qbad:
                    R.warn(f"数量列 {qbad} 行({qpct:.1f}%)无法解析, 量价/PVM 按剔除口径")
                # 价量对齐: qc/qp 只在金额有效行上求和, 与 tc/tp 同口径 (否则均价 pc=tc/qc 分子分母行集错配, 系统性低估均价并污染 PVM)
                vm = df['_amt'].notna()
                qc = float(df[(df._y==cur)&(df._mk.isin(cur_ks))&vm]['_q'].sum()); qp = float(df[(df._y==prev)&(df._mk.isin(cur_ks))&vm]['_q'].sum())
                pc = tc/qc if qc else 0; pp = tp/qp if qp else 0
                out['period'].update({"qty_cur": round(qc), "qty_yoy": None if qp==0 else round((qc/qp-1)*100,1),
                    "price_cur": round(pc), "price_yoy": None if pp==0 else round((pc/pp-1)*100,1),
                    "pvm": {"base_wan": round(tp/1e4,1), "vol_wan": round((qc-qp)*pp/1e4,1), "price_mix_wan": round((tc-tp-(qc-qp)*pp)/1e4,1), "cur_wan": round(tc/1e4,1),
                            "_note": "price_mix_wan = 总额差 − 量效应 = 价格效应 + 产品结构/mix (混合均价法, 多SKU时非纯价; 瀑布图标签应写'价+结构')"}})
                if qpct > 5:
                    out['period']['pvm']['_caveat'] = f"数量列坏值率{qpct:.1f}%>5%, 量价拆解仅供参考"
            # 趋势 (年×月, 与旬粒度无关, 始终按自然月展示)
            # 缺月区分: 某(年,月)有数据 → 用其合计(可能真为0); 尚无数据(如当年只到3月) → null 前端断线,
            # 不与真实0混同, 与 YoY 锁同期口径一致。allow_nan=False 下 null 用 Python None。
            piv = df.dropna(subset=['_m','_y']).groupby(['_y','_m'])['_amt'].sum()
            cell = {(int(yk), int(mk)): float(vk) for (yk, mk), vk in piv.items()}
            out['trend'] = {int(y): [(round(cell[(int(y),mm)]/1e4,1) if (int(y),mm) in cell else None)
                                     for mm in range(1,13)] for y in yrs[-3:]}

    # 各维度聚合 + YoY + 占比 + 编码一致性/弱信号校验
    tot = df['_amt'].sum()
    # share 口径: 有 YoY 期间时 share 走当期(与 yoy 同口径, 避免"占比累计 vs 同比当期"打架); 否则全量累计
    out['meta']['share_caliber'] = '当期(与YoY同口径)' if yoy_ready else '全量累计'
    for d in (r.get('dimensions') or []):
        if d not in df.columns: R.warn(f"维度列不存在: {d}"); continue
        g = df.groupby(d)['_amt'].sum().sort_values(ascending=False)
        rows = []
        for name, v in g.items():
            row = {"name": str(name), "amount_wan": round(float(v)/1e4,1)}
            if yoy_ready:
                sub = df[df[d]==name]; a_c=period_sum(sub,cur); a_p=period_sum(sub,prev)
                row["share"] = (round(a_c/tc*100,1) if tc else None)   # 当期占比
                row["yoy"] = None if a_p==0 else round((a_c/a_p-1)*100,1)
                row["amount_cur_wan"]=round(a_c/1e4,1); row["amount_base_wan"]=round(a_p/1e4,1)
            else:
                row["share"] = (round(float(v)/tot*100,1) if tot else None)   # 全量占比
            rows.append(row)
        out['dimensions'][d] = rows
        # 校验: 占比和 (share 可能为 None: 总额=0 时)
        shares = [x['share'] for x in rows if x['share'] is not None]
        if not shares:
            R.err(f"维度[{d}]全部金额为0/不可解析, 无法计算占比")
        else:
            ssum = sum(shares)
            if abs(ssum-100) > 1: R.warn(f"维度[{d}]占比和={ssum:.1f}% (偏离100, 查空值/重复)")
        # 弱信号: 单值占比<2% 且该维度只有1-2个主值
        weak = [x['name'] for x in rows if x['share'] is not None and x['share']<2]
        if len(rows)>=2 and (len(rows)-len(weak))<=1 and rows[0]['share'] is not None and rows[0]['share']>90:
            R.warn(f"维度[{d}]信号弱(单一值占>90%), 不宜单独成章")
        # 编码一致性 (跨年): 维度取值集合是否在两年间大变 (产品定位那种坑)
        if yoy_ready:
            set_c=set(df[df._y==cur][d].dropna().astype(str)); set_p=set(df[df._y==prev][d].dropna().astype(str))
            if set_c and set_p:
                jac = len(set_c&set_p)/len(set_c|set_p)
                if jac < 0.5: R.err(f"维度[{d}]取值集合跨年重合仅{jac*100:.0f}% — 疑似编码/口径变更, 拿来做同比会误导, 需先核对")

    # 客户集中度 (期间口径: 有 YoY 期间时只算当期, 与报告一致)
    cust = r.get('customer')
    if cust and cust in df.columns:
        cdf = df[(df._y==cur)&(df._mk.isin(cur_ks))] if yoy_ready else df
        out.setdefault('concentration_scope', {})['period'] = ('当期' if yoy_ready else '全量')
        cg = cdf.groupby(cust)['_amt'].sum().sort_values(ascending=False)
        cs = float(cg.sum())
        if cs <= 0:
            R.err(f"客户维度[{cust}]当期金额合计为0/不可解析, 无法算集中度")
        else:
            cum = cg.cumsum()/cs
            out['concentration'] = {"customers": int(cg.size),
                "top5_share": round(float(cg.head(5).sum()/cs*100),1),
                "top10_share": round(float(cg.head(10).sum()/cs*100),1),
                "pareto_n50": int((cum<0.5).sum()+1), "pareto_n80": int((cum<0.8).sum()+1),
                "top5_wan": [round(float(v)/1e4,1) for v in cg.head(5).tolist()]}
            if out['concentration']['top5_share']>45: R.warn(f"客户集中度高(Top5={out['concentration']['top5_share']}%), 建议成风险章")

    out['data_status'] = {"status": R.status(), "errors": R.e, "warnings": R.w, "passed": R.ok}
    # allow_nan=False: 宁可显式报错也不写出非法 JSON (NaN/Infinity 会让前端 JSON.parse 崩溃)
    json.dump(out, open(args.out,'w',encoding='utf-8'), ensure_ascii=False, indent=1, allow_nan=False)
    # quality.md
    q = [f"# 数据质量报告 — {args.out}", f"\n状态: **{R.status()}**  (行数 {len(df):,})\n"]
    if R.e: q.append("## 阻断 (BLOCKED, 修好前不出结论)\n"+"\n".join(f"- {x}" for x in R.e))
    if R.w: q.append("## 警告\n"+"\n".join(f"- {x}" for x in R.w))
    q.append("## 通过\n- 金额聚合完成\n- 各维度占比/同比已算" + ("\n- YoY 期间已锁定" if yoy_ready else ""))
    open(args.out.replace('.json','')+'.quality.md','w',encoding='utf-8').write("\n".join(q))
    print(f"[{R.status()}] metrics → {args.out}  |  quality → {args.out.replace('.json','')}.quality.md")
    if R.e:
        print("  阻断项:"); [print("   -",x) for x in R.e]
    elif R.w:
        print("  警告:"); [print("   -",x) for x in R.w]
    if R.status()=='BLOCKED': sys.exit(2)

def main():
    ap = argparse.ArgumentParser(description="多源数据画像+清洗校验 (DuckDB 统一加载)")
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name, fn in [('profile', profile), ('build', build)]:
        p = sub.add_parser(name); p.add_argument('data', nargs='?'); p.add_argument('--sheet'); p.add_argument('--sqlite')
        p.add_argument('--table'); p.add_argument('--sql'); p.set_defaults(fn=fn)
        if name=='build': p.add_argument('--map', required=True); p.add_argument('--out', default='metrics.json')
    a = ap.parse_args(); a.fn(a)

if __name__ == '__main__': main()
