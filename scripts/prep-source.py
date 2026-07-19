#!/usr/bin/env python3
"""
prep-source.py — 多源数据画像 + 清洗聚合 + 校验 (south-china-report)

借鉴 anthropic-skills:sales-report-html 的 prep_data 架构, 用 DuckDB 做统一加载器,
一个接口吃 Excel/CSV/Parquet/SQLite/DuckDB/任意 SQL —— 适应面比只读 Excel 广。

用法:
  # 1) 画像: 看字段角色 + 自动建议分析骨架 + 产出 map.json 草稿
  python3 prep-source.py profile <源> [--sheet S] [--sqlite db --table T] [--sql "SELECT..."]
      [--out-map map.draft.json] [--force] [--show-samples]
  # 2) 构建: 按 map.json 清洗+聚合+校验 → metrics.json (+ quality.md)
  python3 prep-source.py build --map map.json --out metrics.json

<源> 可以是: data.xlsx / data.csv / data.parquet / db.sqlite / db.duckdb
纪律: 报告里每个数字都从 metrics.json 抄, 不手敲 (防转录错误)。
      data_status=BLOCKED 时数据不可信, 只出修数建议, 不出结论。
      map.caliber.period 必须确认；支持月/旬/季/H1-H2/全年/自定义起止。
      目标重复时需配置 target_aggregation/target_grain/target_frequency，否则局部 BLOCKED。
      map.roles.id 可选, 指定单据/流水号列, 用于检测完全重复行与重复单号 (发现只告警, 不自动去重)。
"""
import sys, os, json, argparse, re, hashlib
import duckdb

# ── 统一加载器 (DuckDB 多源) ──────────────────────────────
def _sql_literal(value):
    """DuckDB ATTACH 不支持路径参数绑定，因此在这个边界做字面量转义。"""
    return "'" + str(value).replace("'", "''") + "'"

def _quote_ident(value):
    """安全引用用户指定表名，避免将表名当成 SQL 片段执行。"""
    if not value or "\x00" in str(value):
        raise SystemExit("表名不合法")
    return '"' + str(value).replace('"', '""') + '"'

def _load_extension(con, name):
    """只加载已安装扩展；运行时不隐式联网 INSTALL。"""
    try:
        con.execute(f"LOAD {name}")
        return True
    except Exception:
        return False

def load(args):
    if not getattr(args, 'sql', None) and not getattr(args, 'data', None) and not getattr(args, 'sqlite', None):
        raise SystemExit("需提供数据源路径或 --sql")
    con = duckdb.connect()
    try:
        con.execute("SET autoinstall_known_extensions=false")
        con.execute("SET autoload_known_extensions=false")
        if getattr(args, 'sql', None):
            return con.execute(args.sql).df()
        src = str(getattr(args, 'data', None) or getattr(args, 'sqlite', None))
        e = os.path.splitext(src)[1].lower()
        if getattr(args, 'sqlite', None) or e in ('.sqlite', '.db', '.sqlite3'):
            db = getattr(args, 'sqlite', None) or src
            if not _load_extension(con, 'sqlite'):
                import sqlite3
                import pandas as pd
                sq = sqlite3.connect(db)
                try:
                    tbl = getattr(args, 'table', None)
                    if not tbl:
                        tbls = [row[0] for row in sq.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                        raise SystemExit(f"SQLite 需指定 --table (可选: {tbls})")
                    return pd.read_sql_query(f"SELECT * FROM {_quote_ident(tbl)}", sq)
                finally:
                    sq.close()
            con.execute(f"ATTACH {_sql_literal(db)} AS s (TYPE sqlite)")
            tbl = getattr(args, 'table', None)
            if not tbl:
                tbls = con.execute("SELECT name FROM s.sqlite_master WHERE type='table'").df()['name'].tolist()
                raise SystemExit(f"SQLite 需指定 --table (可选: {tbls})")
            return con.execute(f"SELECT * FROM s.{_quote_ident(tbl)}").df()
        if e in ('.duckdb', '.ddb'):
            con.execute(f"ATTACH {_sql_literal(src)} AS d")
            tbl = getattr(args, 'table', None)
            if not tbl:
                tbls = con.execute("SELECT table_name FROM d.information_schema.tables").df()['table_name'].tolist()
                raise SystemExit(f"DuckDB 需指定 --table (可选: {tbls})")
            return con.execute(f"SELECT * FROM d.{_quote_ident(tbl)}").df()
        if e in ('.xlsx', '.xlsm', '.xls'):
            sh = getattr(args, 'sheet', None)
            if _load_extension(con, 'excel'):
                try:
                    if sh:
                        return con.execute("SELECT * FROM read_xlsx(?, sheet=?)", [src, sh]).df()
                    return con.execute("SELECT * FROM read_xlsx(?)", [src]).df()
                except Exception:
                    pass
            import pandas as pd
            return pd.read_excel(src, sheet_name=sh if sh else 0)
        if e in ('.csv', '.txt', '.tsv'):
            return con.execute("SELECT * FROM read_csv_auto(?)", [src]).df()
        if e in ('.parquet', '.pq'):
            return con.execute("SELECT * FROM read_parquet(?)", [src]).df()
        raise SystemExit(f"不支持的源类型: {e} (支持 xlsx/csv/parquet/sqlite/duckdb 或 --sql)")
    finally:
        con.close()

def _atomic_write(path, text):
    path = os.path.abspath(path)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)
    os.replace(tmp, path)

def _write_json(path, value):
    _atomic_write(path, json.dumps(value, ensure_ascii=False, indent=1, allow_nan=False))

def _source_trace(args):
    """Return a report-safe locator and fingerprint without leaking absolute paths or SQL text."""
    if getattr(args, 'sql', None):
        raw = str(args.sql).encode('utf-8')
        return {"kind": "inline-sql", "path": "inline-sql", "sha256": hashlib.sha256(raw).hexdigest(),
                "fingerprint_scope": "query_text_only",
                "caveat": "该指纹仅证明查询文本，不是查询结果或上游数据快照"}
    source = getattr(args, 'data', None) or getattr(args, 'sqlite', None)
    if not source:
        return {"kind": "unknown", "path": "unknown", "sha256": None,
                "fingerprint_scope": "unavailable"}
    path = os.path.realpath(os.path.abspath(str(source)))
    digest = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b''):
            digest.update(chunk)
    extension = os.path.splitext(path)[1].lower().lstrip('.') or 'file'
    selector = getattr(args, 'sheet', None) or getattr(args, 'table', None)
    result = {"kind": extension, "path": os.path.basename(path), "sha256": digest.hexdigest(),
              "fingerprint_scope": "source_file_snapshot"}
    if selector:
        result["selector"] = str(selector)
    return result

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
    if getattr(args, 'sql', None):
        source_display = f"<SQL query sha256={hashlib.sha256(str(args.sql).encode('utf-8')).hexdigest()[:12]}…>"
    else:
        source_display = os.path.basename(str(args.data or getattr(args, 'sqlite', None) or 'unknown'))
    print(f"源: {source_display}")
    print(f"行数: {n:,}   列数: {df.shape[1]}\n")
    sample_header = "样例（已显式启用）" if getattr(args, 'show_samples', False) else ""
    print(f"{'列名':<22}{'类型':<10}{'空%':>6}{'基数':>9}  {'角色':<10}{sample_header}")
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
        sample = ', '.join(s.dropna().astype(str).head(2).tolist())[:30] if getattr(args, 'show_samples', False) else ''
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
    # 金额是本 Skill 的核心度量，不能在未命中金额语义时退化为“任意数值列”。
    # 否则销量会同时被当成 amount/qty，进而输出伪 total_wan 与 price=1 的 PVM。
    amt = next((m for m in meas if AMT_RE.search(m) and not QTY_RE.search(m)), None)
    qty = next((m for m in meas if QTY_RE.search(m)), None)
    # 年度覆盖面: build 仅在 ≥2 年时产出 period/trend/pvm; profile 骨架须对齐, 否则单期数据会被建议搭无数据支撑的 YoY/瀑布章节
    n_years = 0
    tcols = roles.get('time') or []
    if tcols:
        try: n_years = int(_parse_time_series(df[tcols[0]])[0].dt.year.dropna().nunique())
        except Exception: n_years = 0
    multi_year = n_years >= 2
    sk = []; generic = []
    if not amt:
        sk.append("[BLOCKED] 未识别到金额/营收字段；禁止把销量等任意数值列当金额。请补充金额列或改用数量型分析工具")
    elif amt and has_time and multi_year:
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
    source_path = os.path.abspath(args.data) if args.data else None
    sqlite_path = os.path.abspath(args.sqlite) if getattr(args, 'sqlite', None) else None
    draft = {"source": {"path": source_path, "sheet": getattr(args,'sheet',None), "sqlite": sqlite_path,
                        "table": getattr(args,'table',None), "sql": getattr(args,'sql',None)},
             "roles": {"time": (roles.get('time') or [None])[0], "amount": amt, "qty": qty,
                       "dimensions": [d for d in dims], "customer": (roles.get('customer') or [None])[0],
                       "product": (roles.get('product') or [None])[0], "target": (roles.get('target') or [None])[0],
                       "id": (roles.get('id') or [None])[0]},
             "caliber": {"period": "填写, 如 2026H1", "note": "净值/含税等口径"}}
    out_map = os.path.abspath(args.out_map)
    if os.path.exists(out_map) and not args.force:
        raise SystemExit(f"{out_map} 已存在；为避免覆盖人工映射，请改用 --out-map 或显式加 --force")
    _atomic_write(out_map, json.dumps(draft, ensure_ascii=False, indent=2))
    print(f"\n已写 {out_map} (改好后用于 build)。下一步: python3 prep-source.py build --map {out_map} --out metrics.json")

# ── 清洗工具 ──────────────────────────────────────────────
def coerce_num(s):
    import pandas as pd
    if pd.api.types.is_numeric_dtype(s): return pd.to_numeric(s, errors='coerce')
    x = s.astype(str).str.strip()
    x = x.str.replace(',', '', regex=False).str.replace('¥','',regex=False).str.replace('￥','',regex=False)
    x = x.str.replace(r'^\((.*)\)$', r'-\1', regex=True)  # 会计负数
    return pd.to_numeric(x, errors='coerce')

def _parse_time_series(series, business_timezone=None):
    """Parse mixed naive/offset timestamps to a tz-naive business-time series."""
    import pandas as pd
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
    raw = series.astype('string').str.strip()
    aware_mask = raw.str.contains(r'(?:Z|[+-]\d{2}:?\d{2})$', case=False, regex=True, na=False)
    parsed = pd.Series(pd.NaT, index=series.index, dtype='datetime64[ns]')
    if (~aware_mask).any():
        parsed.loc[~aware_mask] = pd.to_datetime(series.loc[~aware_mask], errors='coerce', format='mixed')
    timezone = None
    if business_timezone:
        try:
            timezone = ZoneInfo(str(business_timezone))
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"未知 caliber.timezone: {business_timezone}") from exc
    if aware_mask.any():
        aware = pd.to_datetime(series.loc[aware_mask], errors='coerce', format='mixed', utc=True)
        if timezone is not None:
            aware = aware.dt.tz_convert(timezone)
        parsed.loc[aware_mask] = aware.dt.tz_localize(None)
    return parsed, int(aware_mask.sum())

def _period_result(start, end, granularity, label, inferred=False):
    import pandas as pd
    start = pd.Timestamp(start).normalize(); end = pd.Timestamp(end).normalize()
    if start > end:
        raise ValueError(f"期间起始日 {start.date()} 晚于结束日 {end.date()}")
    base_start = start - pd.DateOffset(years=1)
    base_end = end - pd.DateOffset(years=1)
    return {"start": start, "end": end, "base_start": base_start, "base_end": base_end,
            "granularity": granularity, "label": label, "inferred": inferred}

def parse_period_spec(spec, available_dates=None, granularity_hint=None):
    """将 map.caliber.period 规范化为闭区间。

    支持: 2025-12 / 2025-12上旬 / 2025Q4 / 2025H1 / 2025 / 全年 /
    {"start":"2025-10-01","end":"2025-12-31"} / "2025-10-01..2025-12-31"。
    未填时可推断最新年 YTD，但 build 默认将其 BLOCKED；仅显式
    caliber.allow_inferred_period=true 时允许降为 WARN。
    """
    import pandas as pd
    hint = str(granularity_hint or 'month').lower()
    if isinstance(spec, dict):
        if not spec.get('start') or not spec.get('end'):
            raise ValueError("自定义 period 对象必须同时包含 start/end")
        start, end = pd.to_datetime(spec['start']), pd.to_datetime(spec['end'])
        return _period_result(start, end, str(spec.get('granularity') or hint),
                              str(spec.get('label') or f"{start.date()}..{end.date()}"))

    raw = str(spec or '').strip()
    placeholder = (not raw or raw.lower() in {'auto', 'latest', '最新', '自动'} or
                   re.search(r'填写|示例|待填|yyyy', raw, re.I))
    if placeholder:
        if available_dates is None:
            raise ValueError("未提供 period，也没有可用日期可供推断")
        valid = pd.to_datetime(available_dates, errors='coerce', format='mixed').dropna()
        if valid.empty:
            raise ValueError("时间列无可解析日期，无法推断 period")
        last = valid.max().normalize()
        start = pd.Timestamp(last.year, 1, 1)
        if hint == 'xun':
            if last.day <= 10: end = pd.Timestamp(last.year, last.month, 10)
            elif last.day <= 20: end = pd.Timestamp(last.year, last.month, 20)
            else: end = last + pd.offsets.MonthEnd(0)
        else:
            end = last + pd.offsets.MonthEnd(0)
        return _period_result(start, end, hint, f"{last.year}YTD", inferred=True)

    compact_raw = re.sub(r'\s+', '', raw).upper()
    cn_quarter = re.fullmatch(r'(\d{4})年?第?([1234一二三四])季度', compact_raw)
    if cn_quarter:
        y = int(cn_quarter.group(1)); quarter = {'一': 1, '二': 2, '三': 3, '四': 4}.get(cn_quarter.group(2), int(cn_quarter.group(2)) if cn_quarter.group(2).isdigit() else 0)
        month = (quarter - 1) * 3 + 1; start = pd.Timestamp(y, month, 1)
        return _period_result(start, start + pd.offsets.QuarterEnd(startingMonth=month + 2), 'quarter', f"{y}Q{quarter}")
    cn_half = re.fullmatch(r'(\d{4})年?([\u4e0a\u4e0b])半年', compact_raw)
    if cn_half:
        y = int(cn_half.group(1)); h = 1 if cn_half.group(2) == '上' else 2; month = 1 if h == 1 else 7
        start = pd.Timestamp(y, month, 1); end = pd.Timestamp(y, month + 5, 1) + pd.offsets.MonthEnd(0)
        return _period_result(start, end, 'half', f"{y}H{h}")

    compact = compact_raw
    compact = re.sub(r'(?<=\d)年', '-', compact).replace('月', '')
    custom = re.fullmatch(r'(\d{4}-\d{1,2}-\d{1,2})(?:\.\.|~|至)(\d{4}-\d{1,2}-\d{1,2})', compact)
    if custom:
        return _period_result(pd.to_datetime(custom.group(1)), pd.to_datetime(custom.group(2)),
                              'custom', raw)

    q = re.fullmatch(r'(\d{4})-?Q([1-4])', compact)
    if q:
        y, quarter = int(q.group(1)), int(q.group(2)); month = (quarter - 1) * 3 + 1
        start = pd.Timestamp(y, month, 1); end = start + pd.offsets.QuarterEnd(startingMonth=month + 2)
        return _period_result(start, end, 'quarter', f"{y}Q{quarter}")

    half = re.fullmatch(r'(\d{4})-?H([12])', compact)
    if half:
        y, h = int(half.group(1)), int(half.group(2)); month = 1 if h == 1 else 7
        start = pd.Timestamp(y, month, 1); end = pd.Timestamp(y, month + 5, 1) + pd.offsets.MonthEnd(0)
        return _period_result(start, end, 'half', f"{y}H{h}")

    xun = re.fullmatch(r'(\d{4})-(\d{1,2})(?:-?X([123])|-?([123])旬|([\u4e0a\u4e2d\u4e0b])旬)', compact)
    if xun:
        y, month = int(xun.group(1)), int(xun.group(2))
        part = int(xun.group(3) or xun.group(4)) if (xun.group(3) or xun.group(4)) else {'上': 1, '中': 2, '下': 3}[xun.group(5)]
        if not 1 <= month <= 12: raise ValueError(f"月份超出范围: {month}")
        first = 1 if part == 1 else (11 if part == 2 else 21)
        start = pd.Timestamp(y, month, first)
        end = pd.Timestamp(y, month, 10 if part == 1 else 20) if part < 3 else start + pd.offsets.MonthEnd(0)
        return _period_result(start, end, 'xun', f"{y}-{month:02d}-X{part}")

    month = re.fullmatch(r'(\d{4})-(\d{1,2})', compact)
    if month:
        y, mo = int(month.group(1)), int(month.group(2))
        if not 1 <= mo <= 12: raise ValueError(f"月份超出范围: {mo}")
        start = pd.Timestamp(y, mo, 1)
        return _period_result(start, start + pd.offsets.MonthEnd(0), 'month', f"{y}-{mo:02d}")

    year = re.fullmatch(r'(\d{4})(?:-全年|全年)?', compact)
    if year:
        y = int(year.group(1))
        return _period_result(pd.Timestamp(y, 1, 1), pd.Timestamp(y, 12, 31), 'year', str(y))
    raise ValueError(f"无法解析 map.caliber.period: {raw}")

def _resolve_build_source(args, mapping):
    """Layer explicit CLI locators over map.source without dropping sheet/table selectors."""
    source = mapping.get('source') or {}
    explicit = {key: getattr(args, key, None) for key in ('data', 'sheet', 'sqlite', 'table', 'sql')}
    map_values = {
        'data': source.get('path'), 'sheet': source.get('sheet'), 'sqlite': source.get('sqlite'),
        'table': source.get('table'), 'sql': source.get('sql'),
    }

    # map 中的相对文件路径始终按 map.json 所在目录解析；CLI 相对路径仍按 cwd。
    for target in ('data', 'sqlite'):
        value = map_values.get(target)
        if value and not os.path.isabs(str(value)):
            map_relative = os.path.abspath(os.path.join(os.path.dirname(args.map), str(value)))
            map_values[target] = map_relative

    if explicit['sql'] is not None:
        args.data = None; args.sqlite = None; args.sheet = None; args.table = explicit['table']
        args.sql = explicit['sql']; args._source_origin = 'cli'
    elif explicit['data'] is not None or explicit['sqlite'] is not None:
        args.data = explicit['data']
        args.sqlite = explicit['sqlite']
        args.sheet = explicit['sheet'] if explicit['sheet'] is not None else map_values['sheet']
        args.table = explicit['table'] if explicit['table'] is not None else map_values['table']
        args.sql = None
        args._source_origin = 'cli+map' if args.sheet is not None or args.table is not None else 'cli'
    else:
        for target, value in map_values.items():
            setattr(args, target, explicit[target] if explicit[target] is not None else value)
        args._source_origin = 'map+cli' if any(explicit[key] is not None for key in ('sheet', 'table')) else 'map'

    if not getattr(args, 'sql', None):
        for target in ('data', 'sqlite'):
            value = getattr(args, target, None)
            if value and not os.path.exists(str(value)):
                label = f"CLI {target}" if explicit[target] is not None else f"map.source.{('path' if target == 'data' else target)}（相对 map 目录解析）"
                raise SystemExit(f"{label} 不存在: {value}")
    if not getattr(args, 'sql', None) and not getattr(args, 'data', None) and not getattr(args, 'sqlite', None):
        raise SystemExit("build 未收到 CLI 数据源，map.source 也未配置 path/sql")

def _date_mask(df, start, end):
    return df['_d'].between(start, end, inclusive='both')

def _period_key(df, frequency):
    import pandas as pd
    if frequency == 'period':
        return pd.Series('locked-period', index=df.index)
    if '_d' not in df.columns:
        return pd.Series(None, index=df.index, dtype='object')
    if frequency == 'xun':
        part = df['_d'].dt.day.map(lambda d: 1 if d <= 10 else (2 if d <= 20 else 3))
        return df['_d'].dt.strftime('%Y-%m') + '-X' + part.astype('Int64').astype(str)
    if frequency == 'month':
        return df['_d'].dt.strftime('%Y-%m')
    if frequency == 'quarter':
        return df['_d'].dt.to_period('Q').astype(str)
    if frequency == 'half':
        return df['_d'].dt.year.astype('Int64').astype(str) + '-H' + df['_d'].dt.month.map(lambda month: 1 if month <= 6 else 2).astype('Int64').astype(str)
    if frequency == 'year':
        return df['_d'].dt.year.astype('Int64').astype(str)
    return pd.Series('locked-period', index=df.index)

class Rep:
    def __init__(s): s.e=[]; s.w=[]; s.ok=[]
    def err(s,m): s.e.append(m)
    def warn(s,m): s.w.append(m)
    def good(s,m): s.ok.append(m)
    def status(s): return 'BLOCKED' if s.e else ('WARN' if s.w else 'OK')

def build(args):
    import pandas as pd
    with open(args.map, encoding='utf-8') as fh:
        m = json.load(fh)
    _resolve_build_source(args, m)
    r = m.get('roles') or {}; caliber = m.get('caliber') or {}; thresholds = m.get('thresholds') or {}
    df = load(args); R = Rep()
    if df.empty:
        R.err("数据源为 0 行，无法生成经营结论")

    # 完全重复行与 ID 无关，必须在派生列加入前检查。
    dup_rows = int(df.duplicated().sum())
    if dup_rows:
        R.warn(f"完全重复行 {dup_rows} 行 — 确认是否应去重 (当前未去重, 金额可能双计)")
    for k in ('time', 'target', 'customer', 'product', 'id'):
        v = r.get(k)
        if v and v not in df.columns:
            R.warn(f"map.roles.{k} 列不存在: {v} (相关分析跳过)")
    idcol = r.get('id')
    if idcol and idcol in df.columns:
        dup_ids = int(df[idcol].duplicated().sum())
        if dup_ids > dup_rows:
            R.warn(f"重复 {idcol} 共 {dup_ids} 个 (可能一单多行, 核对口径)")

    amt = r.get('amount')
    if not amt or amt not in df.columns:
        raise SystemExit(f"map.roles.amount 无效: {amt}")
    df['_amt'] = coerce_num(df[amt])
    if r.get('qty') == amt:
        R.err(f"map.roles.amount 与 qty 不能指向同一列 [{amt}]；禁止把数量当金额并生成伪量价结论")
    amt_empty = int(df[amt].isna().sum())
    bad = max(0, int(df['_amt'].isna().sum()) - amt_empty)
    amt_src = int(df[amt].notna().sum()); badpct = (bad / amt_src * 100) if amt_src else 0
    if amt_empty:
        R.warn(f"金额列 {amt_empty} 行为空单元格, 已按剔除处理(不计坏值率)")
    if bad:
        msg = f"金额列 {bad} 行({badpct:.1f}%非空)无法解析为数字, 已剔除"
        (R.err if badpct > float(thresholds.get('amount_parse_block_pct', 5)) else R.warn)(msg)
    negative_count = int((df['_amt'] < 0).sum())
    negative_policy = str(caliber.get('negative_amount_policy') or 'allow_net').lower()
    if negative_policy not in {'allow_net', 'block'}:
        R.err(f"caliber.negative_amount_policy 无效: {negative_policy} (仅支持 allow_net|block)")
    if negative_count:
        msg = f"金额列含 {negative_count} 行负数/冲销; 总额按净额聚合, 份额/集中度遇负分项将停算"
        (R.err if negative_policy == 'block' else R.warn)(msg)

    tcol = r.get('time'); period_info = None
    current_mask = pd.Series(False, index=df.index); base_mask = pd.Series(False, index=df.index)
    if tcol and tcol in df.columns:
        try:
            df['_d'], timezone_rows = _parse_time_series(df[tcol], caliber.get('timezone'))
        except ValueError as exc:
            R.err(str(exc)); df['_d'], timezone_rows = _parse_time_series(df[tcol])
        if timezone_rows and not caliber.get('timezone'):
            R.err(f"时间列含 {timezone_rows} 行时区偏移；必须显式配置 caliber.timezone（如 Asia/Shanghai）后再锁定业务日期")
        df['_y'] = df['_d'].dt.year; df['_m'] = df['_d'].dt.month
        invalid_time = int(df['_d'].isna().sum()); invalid_pct = invalid_time / len(df) * 100 if len(df) else 0
        if invalid_time:
            msg = f"时间列 {invalid_time} 行({invalid_pct:.1f}%)解析失败, 已排除在期间聚合外"
            (R.err if invalid_pct > float(thresholds.get('time_parse_block_pct', 5)) else R.warn)(msg)
        try:
            period_info = parse_period_spec(caliber.get('period'), df['_d'], caliber.get('granularity'))
        except (ValueError, TypeError) as exc:
            R.err(str(exc))
        if period_info:
            current_mask = _date_mask(df, period_info['start'], period_info['end'])
            base_mask = _date_mask(df, period_info['base_start'], period_info['base_end'])
            if period_info['inferred']:
                msg = f"map.caliber.period 未明确填写，已推断为 {period_info['label']}; 禁止在未确认期间下出报告"
                (R.warn if caliber.get('allow_inferred_period') is True else R.err)(msg)
    else:
        if caliber.get('period'):
            R.err("配置了 map.caliber.period 但无有效 time 列，无法锁定统计期间")
        else:
            R.err("map.caliber.period 未填写且无有效 time 列，无法确认统计期间；禁止聚合全表出报告")

    current_rows = int(current_mask.sum()); base_rows = int(base_mask.sum())
    tc = float(df.loc[current_mask, '_amt'].sum()); tp = float(df.loc[base_mask, '_amt'].sum())
    if period_info and current_rows == 0:
        R.err(f"指定当期 {period_info['label']} 无数据")
    if current_rows and tc <= 0:
        R.err(f"当期净额={tc:.2f}非正, 无法安全计算增速/份额/集中度")
    base_available = bool(period_info and base_rows > 0)
    if period_info and not base_available:
        R.warn(f"上年同期 {period_info['base_start'].date()}..{period_info['base_end'].date()} 无数据, YoY/PVM/增减贡献降级")
    elif base_available and tp <= 0:
        R.warn(f"上年同期净额={tp:.2f}非正, YoY/贡献率停算")
    analysis_ready = bool(period_info and current_rows > 0 and tc > 0 and not R.e)
    comparison_ready = bool(analysis_ready and base_available and tp > 0)

    source_trace = _source_trace(args)
    out = {"schema_version": "1.0",
           "meta": {"source": source_trace["path"], "source_origin": args._source_origin,
                    "source_kind": source_trace["kind"], "source_path": source_trace["path"],
                    "source_sha256": source_trace["sha256"],
                    "source_fingerprint_scope": source_trace["fingerprint_scope"],
                    **({"source_selector": source_trace["selector"]} if source_trace.get("selector") else {}),
                    **({"source_caveat": source_trace["caveat"]} if source_trace.get("caveat") else {}),
                    "rows": len(df), "current_rows": current_rows, "base_rows": base_rows,
                    "amount_field": amt, "period": caliber.get('period'), "generated_by": "prep-source.py",
                    "thresholds": {"time_parse_block_pct": float(thresholds.get('time_parse_block_pct', 5)),
                                   "amount_parse_block_pct": float(thresholds.get('amount_parse_block_pct', 5)),
                                   "customer_top5_high": float(thresholds.get('customer_top5_high', 45))}},
           "total": round(tc, 2) if analysis_ready else None, "dimensions": {},
           "_discipline": "报告数字一律从本文件抄，勿手敲; 所有份额/排名/同比共用 meta.period_lock"}
    if period_info:
        out['meta']['period_lock'] = {
            "label": period_info['label'], "start": str(period_info['start'].date()),
            "end": str(period_info['end'].date()), "base_start": str(period_info['base_start'].date()),
            "base_end": str(period_info['base_end'].date()), "granularity": period_info['granularity'],
            "inferred": period_info['inferred']}
    if period_info and analysis_ready:
        months = sorted(df.loc[current_mask, '_m'].dropna().astype(int).unique().tolist())
        out['meta']['yoy'] = {"current_year": int(period_info['start'].year),
                              "base_year": int(period_info['base_start'].year), "months": months,
                              "granularity": period_info['granularity'], "adjacent": True,
                              "available": comparison_ready and tp > 0}
        out['period'] = {"total_cur_wan": round(tc / 1e4, 1),
                         "total_cur": round(tc, 2),
                         "total_base_wan": round(tp / 1e4, 1) if comparison_ready else None,
                         "total_base": round(tp, 2) if comparison_ready else None,
                         "total_yoy": round((tc / tp - 1) * 100, 1) if comparison_ready and tp > 0 else None}

        # 量价仅在同一锁定期间与上年同期间计算。
        qcol = r.get('qty') if r.get('qty') != amt else None
        if comparison_ready and qcol and qcol in df.columns:
            df['_q'] = coerce_num(df[qcol]); relevant = current_mask | base_mask
            qbad = max(0, int((df.loc[relevant, '_q'].isna() & df.loc[relevant, qcol].notna()).sum()))
            qsrc = int(df.loc[relevant, qcol].notna().sum()); qpct = qbad / qsrc * 100 if qsrc else 0
            if qbad:
                R.warn(f"数量列在可比期间有 {qbad} 行({qpct:.1f}%)无法解析")
            valid_amt = df['_amt'].notna()
            qc = float(df.loc[current_mask & valid_amt, '_q'].sum())
            qp = float(df.loc[base_mask & valid_amt, '_q'].sum())
            pvm_status = 'OK'
            caveats = []
            if qpct > float(thresholds.get('qty_parse_block_pct', 5)):
                pvm_status = 'BLOCKED'; caveats.append(f"数量列坏值率{qpct:.1f}%超阈值")
            if qc <= 0 or qp <= 0:
                pvm_status = 'BLOCKED'; caveats.append("当期或基期数量非正")
            if tc <= 0 or tp <= 0:
                pvm_status = 'BLOCKED'; caveats.append("当期或基期净额非正")
            pc = tc / qc if qc > 0 else None; pp = tp / qp if qp > 0 else None
            out['period'].update({"qty_cur": round(qc),
                                  "qty_yoy": round((qc / qp - 1) * 100, 1) if qp > 0 else None,
                                  "price_cur": round(pc) if pc is not None else None,
                                  "price_yoy": round((pc / pp - 1) * 100, 1) if pc is not None and pp and pp > 0 else None})
            pvm = {"status": pvm_status, "base_wan": round(tp / 1e4, 1), "cur_wan": round(tc / 1e4, 1),
                   "vol_wan": round((qc - qp) * pp / 1e4, 1) if pp is not None else None,
                   "price_mix_wan": round((tc - tp - (qc - qp) * pp) / 1e4, 1) if pp is not None else None,
                   "_note": "price_mix_wan = 总额差 − 量效应 = 价格效应 + 产品结构/mix"}
            if caveats:
                pvm['_caveat'] = '; '.join(caveats) + ", 禁止输出强量价结论"
            out['period']['pvm'] = pvm

        # 趋势也只使用锁定当期+上年同期行，未覆盖月份写 null。
        trend_df = df.loc[current_mask | base_mask].dropna(subset=['_m', '_y'])
        piv = trend_df.groupby(['_y', '_m'])['_amt'].sum()
        cell = {(int(y), int(month)): float(v) for (y, month), v in piv.items()}
        years = sorted({int(y) for y, _ in cell})
        if years:
            out['trend'] = {y: [round(cell[(y, month)] / 1e4, 1) if (y, month) in cell else None
                                for month in range(1, 13)] for y in years}

    cur_df = df.loc[current_mask if analysis_ready else pd.Series(False, index=df.index)]
    base_df = df.loc[base_mask if analysis_ready else pd.Series(False, index=df.index)]
    safe_total = analysis_ready and tc > 0
    out['meta']['share_caliber'] = '锁定当期'

    def comparison_rows(field):
        gc = cur_df.groupby(field, dropna=False)['_amt'].sum(); gb = base_df.groupby(field, dropna=False)['_amt'].sum()
        ordered = list(gc.sort_values(ascending=False).index)
        ordered.extend(x for x in gb.sort_values(ascending=False).index if x not in gc.index)
        unsafe_parts = bool((gc < 0).any() or (gb < 0).any())
        rows = []
        for name in ordered:
            ac = float(gc.get(name, 0)); ab = float(gb.get(name, 0))
            row = {"name": str(name), "amount": round(ac, 2), "amount_wan": round(ac / 1e4, 1),
                   "amount_cur": round(ac, 2), "amount_cur_wan": round(ac / 1e4, 1)}
            row['share'] = round(ac / tc * 100, 1) if safe_total and not unsafe_parts else None
            if comparison_ready:
                row['amount_base'] = round(ab, 2); row['amount_base_wan'] = round(ab / 1e4, 1)
                row['yoy'] = round((ac / ab - 1) * 100, 1) if ab > 0 else None
                row['delta'] = round(ac - ab, 2)
                row['delta_wan'] = round((ac - ab) / 1e4, 1)
                row['contribution_pp'] = round((ac - ab) / tp * 100, 1) if tp > 0 else None
            rows.append(row)
        return rows, unsafe_parts

    # 各维度：金额、份额、同比、排名全部来自同一期间锁。
    for dim in ((r.get('dimensions') or []) if analysis_ready else []):
        if dim not in df.columns:
            R.warn(f"维度列不存在: {dim}"); continue
        rows, unsafe_parts = comparison_rows(dim)
        out['dimensions'][dim] = rows
        if unsafe_parts:
            R.warn(f"维度[{dim}]在锁定当期/基期存在负数净额分项，已停算份额/集中度，仅保留净额排名")
        else:
            shares = [x['share'] for x in rows if x['share'] is not None]
            if shares and abs(sum(shares) - 100) > 1:
                R.warn(f"维度[{dim}]占比和={sum(shares):.1f}% (偏离100, 查空值)")
            weak = [x for x in rows if x.get('share') is not None and x['share'] < 2]
            if len(rows) >= 2 and len(rows) - len(weak) <= 1 and rows[0].get('share', 0) > 90:
                R.warn(f"维度[{dim}]信号弱(单一值占>90%), 不宜单独成章")
        if comparison_ready:
            set_c = set(cur_df[dim].dropna().astype(str)); set_p = set(base_df[dim].dropna().astype(str))
            if set_c and set_p:
                jac = len(set_c & set_p) / len(set_c | set_p)
                if jac < float(thresholds.get('dimension_jaccard_block', 0.5)):
                    R.err(f"维度[{dim}]在锁定可比期间的取值重合仅{jac*100:.0f}% — 疑似编码/口径变更")

    # 产品双榜+贡献：不再只识别字段而不输出。
    product = r.get('product')
    if analysis_ready and product and product in df.columns:
        product_rows, unsafe_product = comparison_rows(product)
        if unsafe_product:
            R.warn(f"产品维度[{product}]在锁定当期/基期含负数净额分项，份额已停算")
        out['products'] = {"field": product,
                           "ranking": sorted(product_rows, key=lambda x: x['amount_cur'], reverse=True),
                           "growth": sorted([x for x in product_rows if x.get('delta', 0) > 0],
                                            key=lambda x: x['delta'], reverse=True),
                           "decline": sorted([x for x in product_rows if x.get('delta', 0) < 0],
                                             key=lambda x: x['delta']),
                           "contribution": sorted([x for x in product_rows if x.get('contribution_pp') is not None],
                                                  key=lambda x: abs(x['contribution_pp']), reverse=True)}

    # 目标明细重复时不猜汇总口径。需显式声明 sum 或 first_per_group。
    target_col = r.get('target')
    if analysis_ready and target_col and target_col in df.columns:
        target_measure = str(caliber.get('target_measure') or '').lower()
        target = {"field": target_col, "measure": target_measure or None, "status": "BLOCKED",
                  "actual": None, "plan": None, "achievement_rate": None, "gap": None,
                  "actual_wan": None, "plan_wan": None, "gap_wan": None}
        work = cur_df[[target_col]].copy(); work['_target'] = coerce_num(work[target_col])
        target_bad = int((work['_target'].isna() & work[target_col].notna()).sum())
        target_src = int(work[target_col].notna().sum()); target_bad_pct = target_bad / target_src * 100 if target_src else 0
        mode = str(caliber.get('target_aggregation') or 'auto').lower()
        plan = None; caveats = []; aggregation_ok = False; measure_ready = False; actual = None
        qty_target_name = re.search(r'目标销量|销量目标|目标数量|数量目标|目标台数|台数目标|目标件数|件数目标|\b(?:qty|quantity|units?)\b', target_col, re.I)
        amount_target_name = re.search(r'目标金额|金额目标|销售额目标|营收目标|预算金额|\b(?:amount|revenue|gmv)\b', target_col, re.I)
        if target_measure not in {'amount', 'qty'}:
            caveats.append("必须显式配置 caliber.target_measure=amount|qty，禁止猜测目标单位")
        elif target_measure == 'amount' and qty_target_name:
            caveats.append(f"目标列名 [{target_col}] 表示数量，但 target_measure=amount，单位冲突")
        elif target_measure == 'qty' and amount_target_name:
            caveats.append(f"目标列名 [{target_col}] 表示金额，但 target_measure=qty，单位冲突")
        elif target_measure == 'amount':
            actual = tc; measure_ready = tc > 0
            if not measure_ready:
                caveats.append(f"实际金额合计={tc:.2f}非正，金额达成率停算")
        else:
            qty_col = r.get('qty')
            if not qty_col or qty_col not in cur_df.columns or qty_col == amt:
                caveats.append("target_measure=qty 但 map.roles.qty 缺失、无效或与 amount 同列")
            else:
                qty_values = coerce_num(cur_df[qty_col])
                qty_bad = int((qty_values.isna() & cur_df[qty_col].notna()).sum())
                qty_src = int(cur_df[qty_col].notna().sum()); qty_bad_pct = qty_bad / qty_src * 100 if qty_src else 0
                if qty_bad:
                    caveats.append(f"实际数量列 {qty_bad} 行({qty_bad_pct:.1f}%)无法解析，已排除")
                    R.warn(f"实际数量列在目标期间有 {qty_bad} 行({qty_bad_pct:.1f}%)无法解析")
                if qty_bad_pct > float(thresholds.get('qty_parse_block_pct', 5)):
                    caveats.append("实际数量坏值率超阈值，数量达成率停算")
                else:
                    actual = float(qty_values.sum())
                    measure_ready = actual > 0
                    if not measure_ready:
                        caveats.append(f"实际数量合计={actual:.2f}非正，数量达成率停算")
        if target_bad:
            caveats.append(f"目标列 {target_bad} 行({target_bad_pct:.1f}%)无法解析，已排除")
            R.warn(f"目标列在锁定当期有 {target_bad} 行({target_bad_pct:.1f}%)无法解析")
        if not target_src:
            caveats.append("当期无目标值")
        elif target_bad_pct > float(thresholds.get('target_parse_block_pct', 5)):
            caveats.append(f"目标列坏值率{target_bad_pct:.1f}%超阈值")
        elif mode == 'sum':
            plan = float(work['_target'].sum()); aggregation_ok = True
            caveats.append("目标按显式配置 sum 汇总")
        elif mode in {'first_per_group', 'unique_per_period'}:
            grain = [] if mode == 'unique_per_period' else list(caliber.get('target_grain') or [])
            missing = [c for c in grain if c not in cur_df.columns]
            if missing:
                caveats.append(f"target_grain 列不存在: {missing}")
            else:
                frequency = str(caliber.get('target_frequency') or 'period').lower()
                if frequency not in {'period', 'month', 'xun', 'quarter', 'half', 'year'}:
                    caveats.append(f"target_frequency 无效: {frequency}")
                elif frequency != 'period' and '_d' not in cur_df.columns:
                    caveats.append(f"target_frequency={frequency} 需要有效 time 列")
                else:
                    work = cur_df[[target_col] + grain].copy(); work['_target'] = coerce_num(work[target_col])
                    work['_target_period'] = _period_key(cur_df, frequency).values
                    keys = ['_target_period'] + grain
                    conflicts = work.dropna(subset=['_target']).groupby(keys, dropna=False)['_target'].nunique()
                    all_groups = len(work.groupby(keys, dropna=False)); covered_groups = len(conflicts)
                    if covered_groups < all_groups:
                        caveats.append(f"{all_groups-covered_groups} 个目标粒度组完全缺目标值")
                    elif (conflicts > 1).any():
                        caveats.append(f"{int((conflicts > 1).sum())} 个目标粒度组内存在多个不同目标值")
                    else:
                        plan = float(work.dropna(subset=['_target']).groupby(keys, dropna=False)['_target'].first().sum())
                        aggregation_ok = True
                        caveats.append(f"目标按 {frequency}+{grain or ['全局']} 每组取首值去重")
        elif mode == 'auto':
            values = work['_target'].dropna()
            if len(values) > 1:
                caveats.append("目标列在锁定期间存在多行，auto 无法判断分摊/重复/修订口径; 请显式配置 target_aggregation")
            else:
                plan = float(values.sum()); aggregation_ok = True
                caveats.append("auto 仅检测到单个目标值，直接采用")
        else:
            caveats.append(f"target_aggregation 无效: {mode}")
        if plan is not None and plan <= 0:
            aggregation_ok = False; caveats.append(f"目标合计={plan:.2f}非正，达成率停算"); plan = None
        if plan is not None and aggregation_ok and measure_ready and actual is not None:
            target.update({"status": "OK", "actual": round(actual, 2), "plan": round(plan, 2),
                           "achievement_rate": round(actual / plan * 100, 1), "gap": round(actual - plan, 2)})
            if target_measure == 'amount':
                target.update({"actual_wan": round(actual / 1e4, 1), "plan_wan": round(plan / 1e4, 1),
                               "gap_wan": round((actual - plan) / 1e4, 1)})
        if caveats:
            target['_caveat'] = '; '.join(caveats)
        if target['status'] == 'BLOCKED':
            R.warn(f"目标分析已局部 BLOCKED: {target.get('_caveat', '口径不明')}; 禁止出达成率/子弹图")
        out['target'] = target

    # 客户集中度仅使用锁定当期；负分项或非正分母不做风险分级。
    cust = r.get('customer')
    if analysis_ready and cust and cust in df.columns:
        out.setdefault('concentration_scope', {})['period'] = '锁定当期'
        customer_present = cur_df[cust].notna() & cur_df[cust].astype(str).str.strip().ne('')
        cg = cur_df.loc[customer_present].groupby(cust)['_amt'].sum().sort_values(ascending=False)
        identified_amount = float(cg.sum()); coverage = identified_amount / tc * 100 if tc > 0 else None
        min_coverage = float(thresholds.get('customer_coverage_min_pct', 80))
        base_concentration = {"status": "OK", "customers": int(cg.size),
                              "customer_coverage": round(coverage, 1) if coverage is not None else None,
                              "coverage_threshold": min_coverage}
        if (cg < 0).any():
            R.warn(f"客户维度[{cust}]含负数净额分项，集中度已停算")
            out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                    "_caveat": "已识别客户存在负数净额分项"}
        elif identified_amount <= 0:
            R.warn(f"客户维度[{cust}]当期净额非正，集中度已停算")
            out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                    "_caveat": "已识别客户净额非正"}
        elif coverage is not None and coverage > 100.1:
            R.warn(f"客户字段金额覆盖率={coverage:.1f}%>100%，存在未归类负净额，集中度已停算")
            out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                    "_caveat": "客户覆盖率超过100%，净额分母受未归类负数影响"}
        elif coverage is None or coverage < min_coverage:
            R.warn(f"客户字段金额覆盖率仅{(coverage or 0):.1f}%<{min_coverage:.1f}%，集中度风险分级已停算")
            out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                    "top5_share": round(float(cg.head(5).sum() / tc * 100), 1) if tc > 0 else None,
                                    "top5_share_identified": round(float(cg.head(5).sum() / identified_amount * 100), 1),
                                    "_caveat": "客户字段覆盖不足，禁止把已识别子样本的集中度外推到总体"}
        else:
            cum = cg.cumsum() / identified_amount
            out['concentration'] = {**base_concentration,
                "top5_share": round(float(cg.head(5).sum() / tc * 100), 1),
                "top10_share": round(float(cg.head(10).sum() / tc * 100), 1),
                "top5_share_identified": round(float(cg.head(5).sum() / identified_amount * 100), 1),
                "pareto_n50": int((cum < 0.5).sum() + 1), "pareto_n80": int((cum < 0.8).sum() + 1),
                "top5_wan": [round(float(v) / 1e4, 1) for v in cg.head(5).tolist()]}
            top5_high = float(thresholds.get('customer_top5_high', 45))
            if out['concentration']['top5_share'] > top5_high:
                R.warn(f"客户集中度高(Top5={out['concentration']['top5_share']}%>{top5_high}%), 建议成风险章")

    out['data_status'] = {"status": R.status(), "errors": R.e, "warnings": R.w, "passed": R.ok}
    _write_json(args.out, out)
    quality_path = args.out.replace('.json', '') + '.quality.md'
    q = [f"# 数据质量报告 — {args.out}", f"\n状态: **{R.status()}**  (源行数 {len(df):,}; 当期 {current_rows:,})\n"]
    if R.e: q.append("## 阻断 (BLOCKED, 修好前不出结论)\n" + "\n".join(f"- {x}" for x in R.e))
    if R.w: q.append("## 警告\n" + "\n".join(f"- {x}" for x in R.w))
    q.append("## 通过\n- 金额按锁定期间聚合完成\n- 维度份额/排名使用同一期间口径" +
             ("\n- 上年同期可比" if comparison_ready and tp > 0 else "\n- 同比已降级(无有效基期)"))
    _atomic_write(quality_path, "\n".join(q))
    print(f"[{R.status()}] metrics → {args.out}  |  quality → {quality_path}")
    if R.e:
        print("  阻断项:"); [print("   -", x) for x in R.e]
    elif R.w:
        print("  警告:"); [print("   -", x) for x in R.w]
    if R.status() == 'BLOCKED':
        sys.exit(2)

def main():
    ap = argparse.ArgumentParser(description="多源数据画像+清洗校验 (DuckDB 统一加载)")
    sub = ap.add_subparsers(dest='cmd', required=True)
    for name, fn in [('profile', profile), ('build', build)]:
        p = sub.add_parser(name); p.add_argument('data', nargs='?'); p.add_argument('--sheet'); p.add_argument('--sqlite')
        p.add_argument('--table'); p.add_argument('--sql'); p.set_defaults(fn=fn)
        if name == 'profile':
            p.add_argument('--out-map', default='map.draft.json'); p.add_argument('--force', action='store_true')
            p.add_argument('--show-samples', action='store_true', help="显式打印每列前2个原始样例；默认关闭以免泄露客户/订单明细")
        if name=='build': p.add_argument('--map', required=True); p.add_argument('--out', default='metrics.json')
    a = ap.parse_args(); a.fn(a)

if __name__ == '__main__': main()
