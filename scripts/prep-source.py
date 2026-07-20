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
  python3 prep-source.py build --map map.json --out metrics.json [--baseline-metrics prior.metrics.json]

<源> 可以是: data.xlsx / data.csv / data.parquet / db.sqlite / db.duckdb
纪律: 报告里每个数字都从 metrics.json 抄, 不手敲 (防转录错误)。
      data_status=BLOCKED 时数据不可信, 只出修数建议, 不出结论。
      新合同使用 roles.measures[] 声明聚合、单位、方向、可加性、权重与主指标；
      amount/qty 仅为兼容别名，没有金额字段不得阻断数量/人数/时长/得分/比率等报告。
      analysis_scope 区分同比、日历环比、等长窗口、上一完整期、同阶段、自定义基线与无时间快照。
      目标、Benchmark、区间与组间比较统一使用 references[]；旧 target_* 仅作兼容。
      drift_lock 可用已确认 metrics 基线锁定语义、schema、行数与结果快照变化。
      map.roles.id 可选, 指定单据/流水号列；完全重复行按行占比和金额影响度执行门禁，不自动去重。
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
                "caveat": "该字段仅证明查询文本；结果变化请核对 meta.result_snapshot_rows/result_schema_sha256/result_snapshot_sha256"}
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
AMT_RE   = re.compile(r'金额|销售额|营收|收入|amount|revenue|sales|gmv|cost|成本|费用', re.I)
QTY_RE   = re.compile(r'数量|台数|件数|销量|人数|人次|工单数|缺陷数|qty|quantity|units|count|headcount|tickets?', re.I)
PRICE_RE = re.compile(r'单价|均价|价格|price', re.I)
RATE_RE  = re.compile(r'率|占比|比例|百分比|rate|ratio|percent|pct|%|满意度', re.I)
DURATION_RE = re.compile(r'时长|耗时|处理时间|响应时间|分钟|小时|duration|latency|minutes?|hours?', re.I)
SCORE_RE = re.compile(r'得分|评分|分数|score|rating|nps|csat', re.I)
INVENTORY_RE = re.compile(r'库存|存量|余额|结存|inventory|stock|balance', re.I)
DEFECT_RE = re.compile(r'缺陷率|不良率|故障率|返修率|defect|failure|rework', re.I)
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

MEASURE_AGGREGATIONS = {'sum', 'mean', 'weighted_mean', 'median', 'min', 'max', 'count', 'distinct_count', 'ratio'}
TIME_AGGREGATIONS = {'sum', 'mean', 'median', 'min', 'max', 'ending', 'last_non_null'}
MEASURE_DIRECTIONS = {'higher_is_better', 'lower_is_better', 'neutral'}
MEASURE_ADDITIVITY = {'additive', 'semi_additive', 'non_additive'}
MEASURE_TYPES = {'amount', 'quantity', 'count', 'people', 'duration', 'score', 'rate',
                 'percentage', 'inventory', 'defect_rate', 'price', 'other'}
STORAGE_SCALES = {'raw', 'fraction', 'percent'}
TIME_COMPARISONS = {'year_over_year', 'period_over_period', 'previous_equal_window',
                    'previous_calendar_period', 'previous_complete_period',
                    'same_stage_previous_period', 'custom'}
COMPARISON_ALIASES = {
    'yoy': 'year_over_year', 'year_over_year': 'year_over_year',
    'mom': 'previous_calendar_period', 'qoq': 'previous_calendar_period', 'wow': 'previous_calendar_period',
    'period_over_period': 'period_over_period', 'previous_period': 'period_over_period',
    'previous_equal_window': 'previous_equal_window', 'rolling_previous_window': 'previous_equal_window',
    'previous_calendar_period': 'previous_calendar_period',
    'previous_complete_period': 'previous_complete_period', 'custom': 'custom',
    'same_stage_previous_period': 'same_stage_previous_period', 'same_stage': 'same_stage_previous_period',
    'target': 'target', 'benchmark': 'benchmark', 'group': 'group', 'none': 'none',
}

def _slug(value, fallback='measure'):
    value = re.sub(r'[^0-9A-Za-z_\-]+', '_', str(value or '')).strip('_').lower()
    return value or fallback

def _infer_measure_contract(field):
    """Conservative profile-time semantics. Ambiguous business direction stays neutral."""
    name = str(field)
    if DEFECT_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'defect_rate', 'mean', 'percent', 'lower_is_better', 'non_additive'
    elif DURATION_RE.search(name):
        unit = 'hour' if re.search(r'小时|hours?', name, re.I) else 'minute'
        semantic_type, aggregation, direction, additivity = 'duration', 'mean', 'lower_is_better', 'non_additive'
    elif RATE_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'rate', 'mean', 'percent', 'neutral', 'non_additive'
    elif SCORE_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'score', 'mean', 'point', 'higher_is_better', 'non_additive'
    elif INVENTORY_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'inventory', 'sum', 'unit', 'neutral', 'semi_additive'
    elif PRICE_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'price', 'mean', 'currency_per_unit', 'neutral', 'non_additive'
    elif AMT_RE.search(name) and not QTY_RE.search(name):
        semantic_type, aggregation, unit, direction, additivity = 'amount', 'sum', 'currency', 'neutral', 'additive'
    elif QTY_RE.search(name):
        semantic_type = 'people' if re.search(r'人数|人次|headcount', name, re.I) else 'quantity'
        aggregation, unit, direction, additivity = 'sum', ('person' if semantic_type == 'people' else 'count'), 'neutral', 'additive'
    else:
        semantic_type, aggregation, unit, direction, additivity = 'other', 'sum', 'unit', 'neutral', 'additive'
    storage_scale = ('confirm_fraction_or_percent'
                     if semantic_type in {'rate', 'percentage', 'defect_rate'} and unit == 'percent' else None)
    return {'id': _slug(name), 'field': name, 'label': name, 'semantic_type': semantic_type,
            'aggregation': aggregation, 'unit': unit, 'direction': direction,
            'additivity': additivity, 'dimension_aggregation': aggregation, 'time_aggregation': None,
            'storage_scale': storage_scale, 'weight_field': None, 'primary': False, 'required': True}

def _measure_profiles(measure_fields):
    measures = []
    for field in measure_fields:
        contract = _infer_measure_contract(field)
        if any(existing['id'] == contract['id'] for existing in measures):
            contract['id'] = f"{contract['id']}_{len(measures) + 1}"
        measures.append(contract)
    if measures:
        preferred = next((item for item in measures if item['semantic_type'] == 'amount'), measures[0])
        preferred['primary'] = True
    return measures

def _schema_fingerprint(df):
    payload = [{'name': str(column), 'dtype': str(df[column].dtype)} for column in df.columns]
    encoded = json.dumps(payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')
    return payload, hashlib.sha256(encoded).hexdigest()

def _result_snapshot_fingerprint(df):
    """Hash the loaded result without serializing source values into report-safe metadata."""
    import pandas as pd
    schema, schema_hash = _schema_fingerprint(df)
    digest = hashlib.sha256()
    digest.update(schema_hash.encode('ascii'))
    digest.update(str(len(df)).encode('ascii'))
    if len(df):
        normalized = df.copy()
        normalized.columns = [str(column) for column in normalized.columns]
        for column in normalized.columns:
            if pd.api.types.is_datetime64_any_dtype(normalized[column]):
                normalized[column] = normalized[column].astype('string')
        digest.update(pd.util.hash_pandas_object(normalized, index=False, categorize=False).values.tobytes())
    return {'rows': int(len(df)), 'columns': int(len(df.columns)), 'schema': schema,
            'schema_sha256': schema_hash, 'result_sha256': digest.hexdigest()}

def _semantic_signature(measures, schema_contract):
    """Stable hash of the contracts that can change the meaning of a reported number."""
    measure_keys = (
        'id', 'field', 'semantic_type', 'aggregation', 'unit', 'direction', 'additivity',
        'dimension_aggregation', 'time_aggregation', 'storage_scale', 'numerator_field',
        'denominator_field', 'weight_field', 'min_weight_coverage_pct', 'primary', 'required'
    )
    normalized_measures = [
        {key: measure.get(key) for key in measure_keys}
        for measure in sorted(measures, key=lambda item: str(item.get('id') or ''))
    ]
    fields = (schema_contract or {}).get('fields') or {}
    normalized_fields = {
        str(field): {key: spec.get(key) for key in ('required', 'type', 'unit', 'aggregation', 'min_valid_ratio')}
        for field, spec in sorted(fields.items(), key=lambda item: str(item[0]))
        if isinstance(spec, dict)
    }
    contract = {
        'measures': normalized_measures,
        'schema': {
            'business_grain': (schema_contract or {}).get('business_grain'),
            'primary_key': list((schema_contract or {}).get('primary_key') or []),
            'fields': normalized_fields,
        },
    }
    encoded = json.dumps(contract, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return {'sha256': hashlib.sha256(encoded).hexdigest(), 'contract': contract}

def _evaluate_drift_lock(args, mapping, result_snapshot, semantic_signature, reporter):
    """Compare this run with a prior metrics snapshot under an explicit drift policy."""
    raw_config = mapping.get('drift_lock', mapping.get('drift'))
    baseline_cli = getattr(args, 'baseline_metrics', None)
    if raw_config is None and not baseline_cli:
        return {'status': 'NOT_CONFIGURED', 'reason_code': 'baseline_metrics_not_configured'}
    if raw_config is None:
        config = {}
    elif not isinstance(raw_config, dict):
        reporter.err('map.drift_lock 必须是对象')
        return {'status': 'BLOCKED', 'reason_code': 'drift_contract_invalid'}
    else:
        config = dict(raw_config)

    baseline_value = baseline_cli or config.get('baseline_metrics')
    if not baseline_value:
        reporter.err('drift_lock 已启用但未声明 baseline_metrics')
        return {'status': 'BLOCKED', 'reason_code': 'baseline_metrics_missing'}
    baseline_path = str(baseline_value)
    if not os.path.isabs(baseline_path):
        baseline_path = os.path.join(os.path.dirname(os.path.abspath(args.map)), baseline_path)
    baseline_path = os.path.realpath(baseline_path)
    result = {
        'status': 'OK', 'baseline': os.path.basename(baseline_path),
        'policy': {}, 'checks': {}, 'warnings': [], 'errors': [],
    }

    try:
        row_warn = float(config.get('row_count_warn_pct', 10))
        row_block = float(config.get('row_count_block_pct', 30))
        if row_warn < 0 or row_block < row_warn:
            raise ValueError
    except (TypeError, ValueError):
        reporter.err('drift_lock 行数阈值无效：需满足 0 <= row_count_warn_pct <= row_count_block_pct')
        result.update({'status': 'BLOCKED', 'reason_code': 'drift_threshold_invalid'})
        return result
    expected_change = config.get('expected_result_change')
    if expected_change not in {None, True, False}:
        reporter.err('drift_lock.expected_result_change 仅支持 true|false|null')
        result.update({'status': 'BLOCKED', 'reason_code': 'expected_result_change_invalid'})
        return result
    allow_schema = config.get('allow_schema_change') is True
    allow_semantic = config.get('allow_semantic_change') is True
    result['policy'] = {
        'row_count_warn_pct': row_warn, 'row_count_block_pct': row_block,
        'expected_result_change': expected_change,
        'allow_schema_change': allow_schema, 'allow_semantic_change': allow_semantic,
    }

    try:
        with open(baseline_path, encoding='utf-8') as fh:
            baseline = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        message = f"漂移基线不可读取: {os.path.basename(baseline_path)} ({type(exc).__name__})"
        reporter.err(message); result['errors'].append(message)
        result.update({'status': 'BLOCKED', 'reason_code': 'baseline_metrics_unreadable'})
        return result

    baseline_meta = baseline.get('meta') or {}
    baseline_result_hash = baseline_meta.get('result_snapshot_sha256')
    baseline_schema_hash = baseline_meta.get('result_schema_sha256')
    baseline_rows = baseline_meta.get('result_snapshot_rows', baseline_meta.get('rows'))
    baseline_semantic_hash = baseline_meta.get('semantic_contract_sha256')
    if not baseline_semantic_hash:
        baseline_layer = baseline.get('semantic_layer') or {}
        baseline_semantic_hash = _semantic_signature(
            baseline_layer.get('measures') or [], baseline_layer.get('schema') or {}
        )['sha256']

    def add_error(message):
        result['errors'].append(message); reporter.err(message)

    def add_warning(message):
        result['warnings'].append(message); reporter.warn(message)

    schema_changed = not baseline_schema_hash or baseline_schema_hash != result_snapshot['schema_sha256']
    result['checks']['schema'] = {
        'status': 'CHANGED' if schema_changed else 'UNCHANGED',
        'baseline_sha256': baseline_schema_hash, 'current_sha256': result_snapshot['schema_sha256']}
    if schema_changed:
        message = '结果 schema hash 与漂移基线不一致'
        (add_warning if allow_schema else add_error)(message + ('；已由策略允许' if allow_schema else ''))

    semantic_changed = baseline_semantic_hash != semantic_signature['sha256']
    result['checks']['semantic_contract'] = {
        'status': 'CHANGED' if semantic_changed else 'UNCHANGED',
        'baseline_sha256': baseline_semantic_hash, 'current_sha256': semantic_signature['sha256']}
    if semantic_changed:
        message = '度量/schema 语义合同与漂移基线不一致'
        (add_warning if allow_semantic else add_error)(message + ('；已由策略允许' if allow_semantic else ''))

    try:
        baseline_rows = int(baseline_rows)
        current_rows = int(result_snapshot['rows'])
        if baseline_rows == 0:
            row_change_pct = 0.0 if current_rows == 0 else None
            row_status = 'UNCHANGED' if current_rows == 0 else 'BLOCKED'
        else:
            row_change_pct = (current_rows / baseline_rows - 1) * 100
            magnitude = abs(row_change_pct)
            row_status = 'BLOCKED' if magnitude > row_block else ('WARN' if magnitude > row_warn else 'OK')
        result['checks']['row_count'] = {
            'status': row_status, 'baseline': baseline_rows, 'current': current_rows,
            'change_pct': round(row_change_pct, 2) if row_change_pct is not None else None}
        if row_status == 'BLOCKED':
            add_error(f"结果行数相对漂移基线变化超过 {row_block:g}%")
        elif row_status == 'WARN':
            add_warning(f"结果行数相对漂移基线变化超过 {row_warn:g}%")
    except (TypeError, ValueError):
        result['checks']['row_count'] = {'status': 'BLOCKED', 'reason_code': 'baseline_row_count_missing'}
        add_error('漂移基线缺少有效 result_snapshot_rows/meta.rows')

    result_changed = not baseline_result_hash or baseline_result_hash != result_snapshot['result_sha256']
    result['checks']['result_snapshot'] = {
        'status': 'CHANGED' if result_changed else 'UNCHANGED',
        'baseline_sha256': baseline_result_hash, 'current_sha256': result_snapshot['result_sha256']}
    if result_changed and expected_change is False:
        add_error('结果快照发生变化，但 drift_lock.expected_result_change=false')
    elif result_changed and expected_change is None:
        add_warning('结果快照发生变化，且未声明 expected_result_change；需人工确认后更新基线')
    elif not result_changed and expected_change is True:
        add_warning('预期结果变化，但结果快照与基线一致')

    result['status'] = 'BLOCKED' if result['errors'] else ('WARN' if result['warnings'] else 'OK')
    return result

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
    amt = next((m for m in meas if AMT_RE.search(m) and not QTY_RE.search(m)), None)
    qty = next((m for m in meas if QTY_RE.search(m)), None)
    measure_contracts = _measure_profiles(meas)
    # 年度覆盖面: build 仅在 ≥2 年时产出 period/trend/pvm; profile 骨架须对齐, 否则单期数据会被建议搭无数据支撑的 YoY/瀑布章节
    n_years = 0
    tcols = roles.get('time') or []
    if tcols:
        try: n_years = int(_parse_time_series(df[tcols[0]])[0].dt.year.dropna().nunique())
        except Exception: n_years = 0
    multi_year = n_years >= 2
    sk = []; generic = []
    if not measure_contracts:
        sk.append("[BLOCKED] 未识别到数值度量；请至少声明一个 roles.measures[] 主指标")
    elif has_time and multi_year:
        sk.append(f"C1 时间比较 — 先在 analysis_scope 选择同比/环比/上一完整期/自定义基线 (主指标={next(x['field'] for x in measure_contracts if x['primary'])})")
    elif has_time:
        sk.append(f"[!] 时间跨度仅 {n_years} 个年度；仍可做环比/上一完整期/自定义基线，未满足条件的方法机器跳过")
    else:
        sk.append("C1 无时间快照 — 结构、分布、排名、异常与组间差异；趋势模块自动跳过")
    for d in dims:
        low = str(d)
        if re.search(r'渠道|channel', low, re.I): sk.append(f"C· 渠道结构 — 100%堆叠 (维度={d})")
        elif re.search(r'战区|大区|区域|region|zone', low, re.I): sk.append(f"C· 区域/战区 — 降序条形+YoY色 + {d}×月热力 (维度={d})")
        elif re.search(r'结构|高端|变频|渗透', low, re.I): sk.append(f"C· 结构升级 — 渗透率趋势 (维度={d})")
        else: generic.append(d)
    if has_prod: sk.append(f"C· {roles.get('product', ['分类'])[0]} — 排名/差异双榜 (仅满足适用条件时给贡献)")
    if has_cust: sk.append(f"C· {roles.get('customer', ['对象'])[0]} — TopN/Pareto (无政策时只描述集中度，不自动定性风险)")
    if has_tgt: sk.append(f"C· 达成分析 — 子弹图 (目标 vs 实际)")
    else: sk.append("[!] 无目标/预算字段 → 目标比较与子弹图跳过；保留已显式选择的结构/趋势/组间分析，禁止自动改成同比")
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
             "roles": {"time": (roles.get('time') or [None])[0], "measures": measure_contracts,
                       "amount": amt, "qty": qty,
                       "dimensions": [d for d in dims], "customer": (roles.get('customer') or [None])[0],
                       "product": (roles.get('product') or [None])[0], "target": (roles.get('target') or [None])[0],
                       "id": (roles.get('id') or [None])[0]},
             "analysis_scope": ({"mode": "period", "period": "填写, 如 2026H1",
                                  "data_as_of": "填写, 数据源完整覆盖至 YYYY-MM-DD",
                                  "comparisons": [{"id": "baseline", "type": "none",
                                                   "note": "确认后改为 year_over_year|mom/qoq/wow|previous_equal_window|previous_calendar_period|same_stage_previous_period|custom；none 表示只做当期"}]}
                                if has_time else
                                {"mode": "snapshot", "comparisons": [{"id": "snapshot", "type": "none"}]}),
             "references": [],
             "schema": {"business_grain": "填写业务粒度", "primary_key": [],
                        "fields": {item['field']: {"required": item['required'], "type": "number",
                                                   "unit": item['unit'], "aggregation": item['aggregation']}
                                   for item in measure_contracts}},
             "caliber": {"period": "填写, 如 2026H1" if has_time else None,
                         "data_as_of": "填写, 数据源完整覆盖至 YYYY-MM-DD" if has_time else None,
                         "comparison_as_of": None,
                         "note": "口径说明；旧 amount/qty/caliber 字段仅作兼容"}}
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

    支持: 2025-12 / 2025-W14 / 2025-12上旬 / 2025Q4 / 2025H1 / 2025 / 全年 /
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

    week = re.fullmatch(r'(\d{4})-?W(\d{1,2})', compact)
    if week:
        y, week_number = int(week.group(1)), int(week.group(2))
        try:
            start = pd.Timestamp.fromisocalendar(y, week_number, 1)
        except ValueError as exc:
            raise ValueError(f"ISO 周期非法: {raw}") from exc
        return _period_result(start, start + pd.Timedelta(days=6), 'week', f"{y}-W{week_number:02d}")

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

def _parse_cutoff(value, label):
    """Parse an explicitly declared source-completeness cutoff."""
    import pandas as pd
    raw = str(value or '').strip()
    if (not raw or re.search(r'填写|示例|待填|yyyy', raw, re.I)):
        raise ValueError(f"caliber.{label} 必须显式填写 YYYY-MM-DD，不能从最后一笔交易日期猜测数据完整性")
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', raw):
        raise ValueError(f"caliber.{label} 必须严格使用 YYYY-MM-DD: {raw}")
    try:
        parsed = pd.to_datetime(raw, errors='raise')
    except Exception as exc:
        raise ValueError(f"caliber.{label} 无法解析为日期: {raw}") from exc
    if getattr(parsed, 'tzinfo', None) is not None:
        parsed = parsed.tz_localize(None)
    return pd.Timestamp(parsed).normalize()

def _expected_observations(value):
    """Normalize optional source-cadence expectations.

    Accepted forms:
      30
      {"mode":"rows|distinct_dates", "current":30, "base":30}
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if int(value) != value or value <= 0:
            raise ValueError("caliber.expected_observations 数值必须是正整数")
        return {"mode": "rows", "current": int(value), "base": int(value)}
    if not isinstance(value, dict):
        raise ValueError("caliber.expected_observations 必须是正整数或 {mode,current,base} 对象")
    mode = str(value.get('mode') or 'rows').lower()
    if mode not in {'rows', 'distinct_dates'}:
        raise ValueError("caliber.expected_observations.mode 仅支持 rows|distinct_dates")
    result = {"mode": mode}
    for key in ('current', 'base'):
        raw = value.get(key)
        if not isinstance(raw, (int, float)) or isinstance(raw, bool) or int(raw) != raw or raw <= 0:
            raise ValueError(f"caliber.expected_observations.{key} 必须是正整数")
        result[key] = int(raw)
    return result

def _normalize_measure_contracts(mapping, df, reporter):
    """Return validated generic measures, converting legacy amount/qty roles additively."""
    roles = mapping.get('roles') or {}
    explicit = roles.get('measures')
    explicit_contract = explicit is not None
    if explicit_contract and not isinstance(explicit, list):
        reporter.err("map.roles.measures 必须是数组")
        explicit = []
    raw_measures = [dict(item) for item in (explicit or []) if isinstance(item, dict)]
    if explicit_contract and len(raw_measures) != len(explicit or []):
        reporter.err("map.roles.measures[] 每项必须是对象")

    existing_fields = {str(item.get('field')) for item in raw_measures if item.get('field')}
    amount_field = roles.get('amount')
    qty_field = roles.get('qty')
    if not explicit_contract:
        if amount_field:
            contract = _infer_measure_contract(amount_field)
            contract.update({'id': 'amount', 'semantic_type': 'amount', 'aggregation': 'sum',
                             'unit': str((mapping.get('caliber') or {}).get('amount_unit') or 'currency'),
                             'direction': str((mapping.get('caliber') or {}).get('amount_direction') or 'higher_is_better'),
                             'additivity': 'additive', 'primary': True, 'legacy_role': 'amount'})
            raw_measures.append(contract); existing_fields.add(str(amount_field))
        if qty_field and str(qty_field) not in existing_fields:
            contract = _infer_measure_contract(qty_field)
            contract.update({'id': 'qty', 'semantic_type': 'quantity', 'aggregation': 'sum',
                             'unit': str((mapping.get('caliber') or {}).get('qty_unit') or 'count'),
                             'direction': str((mapping.get('caliber') or {}).get('qty_direction') or 'higher_is_better'),
                             'additivity': 'additive', 'primary': not raw_measures, 'legacy_role': 'qty'})
            raw_measures.append(contract)

    normalized, ids = [], set()
    for index, raw in enumerate(raw_measures):
        field = str(raw.get('field') or '').strip()
        measure_id = _slug(raw.get('id') or field, f'measure_{index + 1}')
        required = raw.get('required', True) is not False
        errors = []
        if measure_id in ids:
            errors.append(f'id 重复: {measure_id}')
        aggregation = str(raw.get('aggregation') or '').lower()
        unit = str(raw.get('unit') or '').strip()
        direction = str(raw.get('direction') or '').lower()
        additivity = str(raw.get('additivity') or '').lower()
        semantic_type = str(raw.get('semantic_type') or 'other').lower()
        if aggregation not in MEASURE_AGGREGATIONS:
            errors.append(f'aggregation={aggregation!r} 无效')
        if not field and aggregation != 'ratio':
            errors.append('field 缺失')
        if not unit:
            errors.append('unit 缺失')
        if direction not in MEASURE_DIRECTIONS:
            errors.append(f'direction={direction!r} 无效')
        if additivity not in MEASURE_ADDITIVITY:
            errors.append(f'additivity={additivity!r} 无效')
        if semantic_type not in MEASURE_TYPES:
            errors.append(f'semantic_type={semantic_type!r} 无效')
        if field and field not in df.columns:
            errors.append(f'field 列不存在: {field}')
        numerator_field = raw.get('numerator_field')
        denominator_field = raw.get('denominator_field')
        if aggregation == 'ratio':
            if not numerator_field or numerator_field not in df.columns:
                errors.append('ratio 必须声明存在的 numerator_field')
            if not denominator_field or denominator_field not in df.columns:
                errors.append('ratio 必须声明存在的 denominator_field')
        elif numerator_field or denominator_field:
            errors.append('numerator_field/denominator_field 仅用于 aggregation=ratio')
        weight_field = raw.get('weight_field') or raw.get('weight')
        if aggregation == 'weighted_mean' and (not weight_field or weight_field not in df.columns):
            errors.append('weighted_mean 必须声明存在的 weight_field')
        try:
            min_weight_coverage_pct = float(raw.get('min_weight_coverage_pct', 95))
            if not 0 <= min_weight_coverage_pct <= 100:
                errors.append('min_weight_coverage_pct 必须在 0..100')
        except (TypeError, ValueError):
            min_weight_coverage_pct = 95.0
            errors.append('min_weight_coverage_pct 必须是数值')
        unit_field = raw.get('unit_field')
        if unit_field and unit_field not in df.columns:
            errors.append(f'unit_field 列不存在: {unit_field}')
        dimension_aggregation = str(raw.get('dimension_aggregation') or aggregation).lower()
        if dimension_aggregation not in MEASURE_AGGREGATIONS:
            errors.append(f'dimension_aggregation={dimension_aggregation!r} 无效')
        time_aggregation_raw = raw.get('time_aggregation')
        time_aggregation = str(time_aggregation_raw).lower() if time_aggregation_raw is not None else None
        if time_aggregation is not None and time_aggregation not in TIME_AGGREGATIONS:
            errors.append(f'time_aggregation={time_aggregation!r} 无效')
        if additivity == 'semi_additive' and roles.get('time') and time_aggregation is None:
            errors.append('semi_additive 度量存在时间列时必须声明 time_aggregation')
        storage_scale = str(raw.get('storage_scale') or 'raw').lower()
        if (semantic_type in {'rate', 'percentage', 'defect_rate'} and unit == 'percent' and
                storage_scale not in {'fraction', 'percent'}):
            errors.append('百分比/比率度量必须声明 storage_scale=fraction|percent')
        elif storage_scale not in STORAGE_SCALES:
            errors.append(f'storage_scale={storage_scale!r} 无效')
        if errors:
            message = f"度量[{measure_id}]合同无效: " + '; '.join(errors)
            (reporter.err if required or raw.get('primary') is True else reporter.warn)(message)
            continue
        ids.add(measure_id)
        normalized.append({
            'id': measure_id, 'field': field, 'label': str(raw.get('label') or field or measure_id),
            'semantic_type': semantic_type, 'aggregation': aggregation, 'unit': unit,
            'direction': direction, 'additivity': additivity,
            'dimension_aggregation': dimension_aggregation, 'time_aggregation': time_aggregation,
            'storage_scale': storage_scale,
            'numerator_field': str(numerator_field) if numerator_field else None,
            'denominator_field': str(denominator_field) if denominator_field else None,
            'weight_field': str(weight_field) if weight_field else None,
            'min_weight_coverage_pct': min_weight_coverage_pct,
            'unit_field': str(unit_field) if unit_field else None,
            'primary': raw.get('primary') is True, 'required': required,
            **({'legacy_role': raw['legacy_role']} if raw.get('legacy_role') else {}),
            **({'target_field': str(raw['target_field'])} if raw.get('target_field') else {}),
            **({'benchmark': raw['benchmark']} if raw.get('benchmark') is not None else {}),
        })
    if not normalized:
        reporter.err("没有可用度量；请声明至少一个 roles.measures[]，或使用旧 roles.amount/qty 兼容字段")
        return [], None
    primary = [item for item in normalized if item['primary']]
    if explicit_contract and len(primary) != 1:
        reporter.err(f"roles.measures[] 必须且只能声明一个 primary=true，当前 {len(primary)} 个")
    if not primary:
        normalized[0]['primary'] = True
        primary = [normalized[0]]
    elif len(primary) > 1:
        primary = [primary[0]]
    return normalized, primary[0]

def _validate_schema_contract(mapping, df, measures, reporter):
    """Validate declared required/optional fields, types, units, grain and primary key."""
    import pandas as pd
    schema_declared = 'schema' in mapping
    raw_contract = mapping.get('schema')
    if schema_declared and not isinstance(raw_contract, dict):
        reporter.err("map.schema 必须是对象")
    contract = raw_contract if isinstance(raw_contract, dict) else {}
    if schema_declared:
        business_grain = str(contract.get('business_grain') or '').strip()
        if not business_grain or business_grain in {'填写业务粒度', '待填写', 'TODO'}:
            reporter.err("map.schema.business_grain 必须明确声明，不能使用占位值")
        if 'primary_key' not in contract:
            reporter.err("map.schema.primary_key 必须显式声明；无天然主键时请写空数组 []")
    fields = contract.get('fields') or {}
    if fields and not isinstance(fields, dict):
        reporter.err("map.schema.fields 必须是 {字段名: 合同} 对象")
        fields = {}
    for field, raw_spec in fields.items():
        spec = raw_spec if isinstance(raw_spec, dict) else {}
        required = spec.get('required', False) is True
        if field not in df.columns:
            (reporter.err if required else reporter.warn)(
                f"schema {'必需' if required else '可选'}字段缺失: {field}" +
                ("" if required else "；仅关闭依赖模块"))
            continue
        expected_type = str(spec.get('type') or '').lower()
        valid_ratio = 1.0
        non_null = df[field].notna()
        if expected_type in {'number', 'numeric', 'float', 'integer', 'int'} and non_null.any():
            valid_ratio = coerce_num(df.loc[non_null, field]).notna().mean()
        elif expected_type in {'date', 'datetime', 'time'} and non_null.any():
            valid_ratio = pd.to_datetime(df.loc[non_null, field], errors='coerce', format='mixed').notna().mean()
        if expected_type and valid_ratio < float(spec.get('min_valid_ratio', 0.95)):
            (reporter.err if required else reporter.warn)(
                f"schema 字段[{field}]类型漂移: 期望 {expected_type}，有效率 {valid_ratio*100:.1f}%")
    by_field = {item['field']: item for item in measures if item.get('field')}
    for field, measure in by_field.items():
        declared_spec = fields.get(field) if isinstance(fields.get(field), dict) else {}
        declared_unit = str(declared_spec.get('unit') or '').strip()
        if declared_unit and declared_unit != measure['unit']:
            reporter.err(f"度量[{measure['id']}]单位漂移: schema={declared_unit}, measures[]={measure['unit']}")
        declared_aggregation = str(declared_spec.get('aggregation') or '').strip().lower()
        if declared_aggregation and declared_aggregation != measure['aggregation']:
            reporter.err(f"度量[{measure['id']}]聚合规则漂移: schema={declared_aggregation}, measures[]={measure['aggregation']}")
        if measure.get('unit_field'):
            observed = sorted({str(value).strip() for value in df[measure['unit_field']].dropna().unique() if str(value).strip()})
            if observed != [measure['unit']]:
                reporter.err(f"度量[{measure['id']}]单位漂移: 期望 {measure['unit']}，源数据出现 {observed[:5]}")
    for measure in measures:
        if measure['aggregation'] != 'ratio':
            continue
        for role in ('numerator_field', 'denominator_field'):
            field = measure[role]
            declared_spec = fields.get(field) if isinstance(fields.get(field), dict) else {}
            if schema_declared and not declared_spec:
                reporter.err(f"ratio 度量[{measure['id']}]的 {role}={field} 未写入 schema.fields")
            elif declared_spec and str(declared_spec.get('type') or '').lower() not in {'number', 'numeric', 'float', 'integer', 'int'}:
                reporter.err(f"ratio 度量[{measure['id']}]的 {role}={field} 必须声明 numeric 类型")
    primary_key = contract.get('primary_key') or []
    if isinstance(primary_key, str):
        primary_key = [primary_key]
    missing_key = [field for field in primary_key if field not in df.columns]
    if missing_key:
        reporter.err(f"schema.primary_key 列缺失: {missing_key}")
    elif primary_key and not contract.get('allow_duplicate_primary_key'):
        duplicate_keys = int(df.duplicated(subset=primary_key, keep=False).sum())
        if duplicate_keys:
            reporter.err(f"schema.primary_key={primary_key} 出现 {duplicate_keys} 行重复；业务粒度发生漂移")
    return {'business_grain': contract.get('business_grain'), 'primary_key': primary_key,
            'fields': fields, 'declared': schema_declared}

def _comparison_period(period_info, comparison):
    """Resolve one time baseline without assuming a fixed previous year."""
    import pandas as pd
    raw_type = str((comparison or {}).get('type') or 'none').lower()
    comparison_type = COMPARISON_ALIASES.get(raw_type)
    if comparison_type is None:
        raise ValueError(f"analysis_scope.comparison.type 无效: {raw_type}")
    alias_granularity = {'mom': 'month', 'qoq': 'quarter', 'wow': 'week'}.get(raw_type)
    if alias_granularity and period_info['granularity'] != alias_granularity:
        raise ValueError(f"comparison.type={raw_type} 仅适用于 {alias_granularity} 期间，当前为 {period_info['granularity']}")
    if comparison_type == 'none' or comparison_type not in TIME_COMPARISONS:
        return comparison_type, None
    start, end = period_info['start'], period_info['end']
    if comparison_type == 'year_over_year':
        base_start, base_end = start - pd.DateOffset(years=1), end - pd.DateOffset(years=1)
    elif comparison_type in {'period_over_period', 'previous_equal_window'}:
        days = int((end - start).days + 1)
        base_end = start - pd.Timedelta(days=1); base_start = base_end - pd.Timedelta(days=days - 1)
    elif comparison_type in {'previous_complete_period', 'previous_calendar_period', 'same_stage_previous_period'}:
        granularity = period_info['granularity']
        if granularity == 'month':
            base_end = start - pd.Timedelta(days=1); base_start = base_end.replace(day=1)
        elif granularity == 'week':
            base_end = start - pd.Timedelta(days=1); base_start = base_end - pd.Timedelta(days=6)
        elif granularity == 'quarter':
            base_end = start - pd.Timedelta(days=1); base_start = (base_end - pd.offsets.QuarterBegin(startingMonth=1)).normalize()
        elif granularity == 'half':
            base_end = start - pd.Timedelta(days=1); base_start = pd.Timestamp(base_end.year, 1 if base_end.month <= 6 else 7, 1)
        elif granularity == 'year':
            base_start = pd.Timestamp(start.year - 1, 1, 1); base_end = pd.Timestamp(start.year - 1, 12, 31)
        else:
            days = int((end - start).days + 1)
            base_end = start - pd.Timedelta(days=1); base_start = base_end - pd.Timedelta(days=days - 1)
    else:
        custom = (comparison or {}).get('period') or (comparison or {}).get('baseline_period')
        parsed = parse_period_spec(custom, granularity_hint=period_info['granularity'])
        base_start, base_end = parsed['start'], parsed['end']
    return comparison_type, {'start': base_start.normalize(), 'end': base_end.normalize(),
                             'label': str((comparison or {}).get('label') or f"{base_start.date()}..{base_end.date()}")}

def _measure_row_series(df, measure):
    """Return row-level values in the declared output scale for quality/distribution checks."""
    import pandas as pd
    if measure['aggregation'] == 'ratio':
        numerator = coerce_num(df[measure['numerator_field']])
        denominator = coerce_num(df[measure['denominator_field']])
        values = numerator / denominator.where(denominator > 0)
        if measure.get('unit') == 'percent':
            values = values * 100
    else:
        values = coerce_num(df[measure['field']])
    if (measure['aggregation'] != 'ratio' and measure.get('storage_scale') == 'fraction'
            and measure.get('unit') == 'percent'):
        values = values * 100
    return pd.Series(values, index=df.index, dtype='float64')

def _measure_source_present(df, measure):
    if measure['aggregation'] == 'ratio':
        return df[measure['numerator_field']].notna() | df[measure['denominator_field']].notna()
    return df[measure['field']].notna()

def _aggregate_base(df, mask, measure, aggregation):
    """Aggregate rows on one axis; time-axis composition is handled by _aggregate_measure."""
    if aggregation == 'ratio':
        numerator = coerce_num(df.loc[mask, measure['numerator_field']])
        denominator = coerce_num(df.loc[mask, measure['denominator_field']])
        usable = numerator.notna() & denominator.notna() & (denominator > 0)
        if not bool(usable.any()):
            return None
        value = float(numerator.loc[usable].sum() / denominator.loc[usable].sum())
        return value * 100 if measure.get('unit') == 'percent' else value
    series = _measure_row_series(df, measure).loc[mask]
    if aggregation == 'count':
        return float(series.notna().sum())
    if aggregation == 'distinct_count':
        return float(series.dropna().nunique())
    valid = series.dropna()
    if valid.empty:
        return None
    if aggregation == 'sum': return float(valid.sum())
    if aggregation == 'mean': return float(valid.mean())
    if aggregation == 'median': return float(valid.median())
    if aggregation == 'min': return float(valid.min())
    if aggregation == 'max': return float(valid.max())
    if aggregation == 'weighted_mean':
        weights = coerce_num(df.loc[mask, measure['weight_field']])
        usable = series.notna() & weights.notna() & (weights > 0)
        if not bool(usable.any()): return None
        return float((series.loc[usable] * weights.loc[usable]).sum() / weights.loc[usable].sum())
    raise ValueError(f"不支持的聚合: {aggregation}")

def _aggregate_measure(df, mask, measure):
    """Aggregate a measure with separate dimension-axis and time-axis semantics."""
    import pandas as pd
    time_aggregation = measure.get('time_aggregation')
    if not time_aggregation or '_d' not in df.columns or not bool(df.loc[mask, '_d'].notna().any()):
        return _aggregate_base(df, mask, measure, measure['aggregation'])
    daily_values = []
    valid_dates = sorted(df.loc[mask & df['_d'].notna(), '_d'].dt.normalize().unique())
    for date_value in valid_dates:
        date_mask = mask & df['_d'].dt.normalize().eq(pd.Timestamp(date_value))
        value = _aggregate_base(df, date_mask, measure, measure['dimension_aggregation'])
        if value is not None:
            daily_values.append((pd.Timestamp(date_value), float(value)))
    if not daily_values:
        return None
    values = [value for _, value in daily_values]
    if time_aggregation in {'ending', 'last_non_null'}: return values[-1]
    if time_aggregation == 'sum': return float(sum(values))
    if time_aggregation == 'mean': return float(sum(values) / len(values))
    if time_aggregation == 'median': return float(pd.Series(values).median())
    if time_aggregation == 'min': return min(values)
    if time_aggregation == 'max': return max(values)
    raise ValueError(f"不支持的 time_aggregation: {time_aggregation}")

def _group_measure(df, mask, dimension, measure):
    """Aggregate one measure by a dimension with the exact declared rule."""
    import pandas as pd
    groups = {}
    for name, indexes in df.loc[mask].groupby(dimension, dropna=False).groups.items():
        group_mask = df.index.isin(indexes)
        key = '(空值)' if pd.isna(name) else str(name)
        groups[key] = _aggregate_measure(df, group_mask, measure)
    return groups

def _axis_measure_quality(df, mask, measure):
    """Quality signals required by weighted and ratio aggregation contracts."""
    scoped_rows = int(mask.sum())
    result = {'status': 'OK', 'scope_rows': scoped_rows}
    issues = []
    if measure['aggregation'] == 'weighted_mean':
        values = _measure_row_series(df, measure)
        weights = coerce_num(df[measure['weight_field']])
        candidates = mask & values.notna()
        usable = candidates & weights.notna() & (weights > 0)
        candidate_rows = int(candidates.sum()); usable_rows = int(usable.sum())
        coverage = usable_rows / candidate_rows * 100 if candidate_rows else 0.0
        result['weight_coverage'] = {
            'field': measure['weight_field'], 'candidate_rows': candidate_rows,
            'usable_rows': usable_rows, 'coverage_pct': round(coverage, 1),
            'threshold_pct': measure['min_weight_coverage_pct']}
        if coverage < measure['min_weight_coverage_pct']:
            issues.append('weight_coverage_below_threshold')
    if measure['aggregation'] == 'ratio':
        numerator = coerce_num(df[measure['numerator_field']])
        denominator = coerce_num(df[measure['denominator_field']])
        candidates = mask & (df[measure['numerator_field']].notna() | df[measure['denominator_field']].notna())
        invalid_denominator = int((candidates & (denominator.isna() | (denominator <= 0))).sum())
        invalid_numerator = int((candidates & numerator.isna()).sum())
        result['ratio_inputs'] = {
            'numerator_field': measure['numerator_field'], 'denominator_field': measure['denominator_field'],
            'candidate_rows': int(candidates.sum()), 'invalid_numerator_rows': invalid_numerator,
            'nonpositive_or_invalid_denominator_rows': invalid_denominator}
        if invalid_denominator or invalid_numerator:
            issues.append('ratio_inputs_invalid')
    if issues:
        result.update({'status': 'BLOCKED' if measure['primary'] else 'SKIPPED',
                       'reason_codes': issues})
    return result

def _favorable(delta, direction):
    if delta is None or direction == 'neutral': return None
    if delta == 0: return True
    return delta > 0 if direction == 'higher_is_better' else delta < 0

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
    if frequency == 'week':
        iso = df['_d'].dt.isocalendar()
        return iso.year.astype('Int64').astype(str) + '-W' + iso.week.astype('Int64').astype(str).str.zfill(2)
    if frequency == 'quarter':
        return df['_d'].dt.to_period('Q').astype(str)
    if frequency == 'half':
        return df['_d'].dt.year.astype('Int64').astype(str) + '-H' + df['_d'].dt.month.map(lambda month: 1 if month <= 6 else 2).astype('Int64').astype(str)
    if frequency == 'year':
        return df['_d'].dt.year.astype('Int64').astype(str)
    return pd.Series('locked-period', index=df.index)

def _normalize_reference_specs(mapping, comparison_specs, measures, reporter):
    """Build one canonical reference list from V3.2 references and legacy comparison/target inputs."""
    explicit = mapping.get('references')
    if explicit is None:
        explicit = []
    elif not isinstance(explicit, list):
        reporter.err("map.references 必须是数组")
        explicit = []
    specs = []
    for source, items in (('analysis_scope', comparison_specs), ('references', explicit)):
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                if source == 'references': reporter.err(f"map.references[{index}] 必须是对象")
                continue
            kind = COMPARISON_ALIASES.get(str(item.get('type') or 'none').lower())
            if kind in {'target', 'benchmark', 'group'}:
                spec = dict(item); spec['_source'] = source; spec['_strict_unit'] = source == 'references'
                specs.append(spec)
    for measure in measures:
        if measure.get('target_field'):
            specs.append({'id': f"target_{measure['id']}", 'type': 'target', 'measure': measure['id'],
                          'field': measure['target_field'], 'unit': measure['unit'],
                          'aggregation': 'unique', '_source': 'measure', '_strict_unit': True})
        if measure.get('benchmark') is not None:
            specs.append({'id': f"benchmark_{measure['id']}", 'type': 'benchmark', 'measure': measure['id'],
                          'value': measure['benchmark'], 'unit': measure['unit'],
                          '_source': 'measure', '_strict_unit': True})

    roles = mapping.get('roles') or {}; caliber = mapping.get('caliber') or {}; thresholds = mapping.get('thresholds') or {}
    target_field = roles.get('target')
    already_bound = any(spec.get('field') == target_field and
                        COMPARISON_ALIASES.get(str(spec.get('type') or '').lower()) == 'target'
                        for spec in specs)
    if target_field and not already_bound:
        legacy_name = str(caliber.get('target_measure') or '').lower()
        legacy_measure = next((measure for measure in measures
                               if measure.get('legacy_role') == legacy_name or measure['id'] == legacy_name), None)
        unit_conflict = None
        if legacy_name == 'amount' and re.search(r'目标销量|销量目标|目标数量|数量目标|目标台数|台数目标|目标件数|件数目标|\b(?:qty|quantity|units?)\b', str(target_field), re.I):
            unit_conflict = f"目标列名 [{target_field}] 表示数量，但 target_measure=amount，单位冲突"
        elif legacy_name == 'qty' and re.search(r'目标金额|金额目标|销售额目标|营收目标|预算金额|\b(?:amount|revenue|gmv)\b', str(target_field), re.I):
            unit_conflict = f"目标列名 [{target_field}] 表示金额，但 target_measure=qty，单位冲突"
        specs.append({'id': 'legacy_target', 'type': 'target',
                      'measure': legacy_measure['id'] if legacy_measure else legacy_name or None,
                      'field': target_field, 'unit': legacy_measure['unit'] if legacy_measure else None,
                      'aggregation': str(caliber.get('target_aggregation') or 'auto').lower(),
                      'grain': list(caliber.get('target_grain') or []),
                      'frequency': str(caliber.get('target_frequency') or 'period').lower(),
                      'required': True, '_source': 'legacy_target', '_strict_unit': False,
                      '_legacy_measure_missing': legacy_measure is None,
                      '_legacy_unit_conflict': unit_conflict,
                      '_parse_block_pct': float(thresholds.get('target_parse_block_pct', 5))})

    seen = set(); normalized = []
    for index, raw in enumerate(specs):
        spec = dict(raw)
        spec['id'] = _slug(spec.get('id') or f"reference_{index + 1}", f"reference_{index + 1}")
        if spec['id'] in seen:
            reporter.err(f"reference id 重复: {spec['id']}")
            continue
        seen.add(spec['id']); normalized.append(spec)
    return normalized

def _reference_field_value(df, mask, spec):
    """Resolve a scalar reference field with explicit aggregation/grain/frequency."""
    field = spec.get('field'); aggregation = str(spec.get('aggregation') or 'unique').lower()
    if not field or field not in df.columns:
        return None, ['reference field missing'], 'optional_reference_field_missing', None
    raw = df.loc[mask, field]; numeric = coerce_num(raw)
    parse_bad = int((raw.notna() & numeric.isna()).sum()); source_rows = int(raw.notna().sum())
    parse_bad_pct = parse_bad / source_rows * 100 if source_rows else 0.0
    caveats = [f"参考列 {parse_bad} 行({parse_bad_pct:.1f}%)无法解析，已排除"] if parse_bad else []
    valid = numeric.dropna()
    if valid.empty:
        return None, caveats + ['当前范围无参考值'], 'reference_missing', {'parse_error_rows': parse_bad, 'parse_error_pct': round(parse_bad_pct, 1)}
    if aggregation in {'unique', 'auto'}:
        unique_values = valid.unique()
        accepted = len(valid) == 1 if aggregation == 'auto' else len(unique_values) == 1
        if not accepted:
            phrase = '多行，auto 无法判断分摊/重复/修订口径' if aggregation == 'auto' else '需要唯一值或显式聚合'
            return None, caveats + [f"参考列在锁定期间存在{phrase}"], 'reference_field_requires_single_value_or_explicit_aggregation', None
        value = float(unique_values[0])
    elif aggregation in {'sum', 'mean', 'median', 'min', 'max'}:
        value = float(getattr(valid, aggregation)())
        caveats.append(f"参考列按显式配置 {aggregation} 汇总")
    elif aggregation in {'first_per_group', 'unique_per_period'}:
        grain = [] if aggregation == 'unique_per_period' else list(spec.get('grain') or [])
        missing = [column for column in grain if column not in df.columns]
        frequency = str(spec.get('frequency') or 'period').lower()
        if missing:
            return None, caveats + [f"reference grain 列不存在: {missing}"], 'reference_grain_missing', None
        if frequency not in {'period', 'week', 'month', 'xun', 'quarter', 'half', 'year'}:
            return None, caveats + [f"reference frequency 无效: {frequency}"], 'reference_frequency_invalid', None
        if frequency != 'period' and '_d' not in df.columns:
            return None, caveats + [f"reference frequency={frequency} 需要有效 time 列"], 'reference_frequency_requires_time', None
        work = df.loc[mask, [field] + grain].copy(); work['_reference'] = coerce_num(work[field])
        work['_reference_period'] = _period_key(df.loc[mask], frequency).values
        keys = ['_reference_period'] + grain
        conflicts = work.dropna(subset=['_reference']).groupby(keys, dropna=False)['_reference'].nunique()
        all_groups = len(work.groupby(keys, dropna=False)); covered_groups = len(conflicts)
        if covered_groups < all_groups:
            return None, caveats + [f"{all_groups-covered_groups} 个参考粒度组完全缺值"], 'reference_grain_incomplete', None
        if (conflicts > 1).any():
            return None, caveats + [f"{int((conflicts > 1).sum())} 个参考粒度组内存在多个不同值"], 'reference_grain_conflict', None
        value = float(work.dropna(subset=['_reference']).groupby(keys, dropna=False)['_reference'].first().sum())
        caveats.append(f"参考按 {frequency}+{grain or ['全局']} 每组取首值去重")
    else:
        return None, caveats + [f"reference aggregation 无效: {aggregation}"], 'reference_aggregation_invalid', None
    return value, caveats, None, {'parse_error_rows': parse_bad, 'parse_error_pct': round(parse_bad_pct, 1)}

def _reference_record(df, current_mask, spec, measures, measure_results, measure_dimensions):
    kind = COMPARISON_ALIASES.get(str(spec.get('type') or 'none').lower())
    measure_id = str(spec.get('measure') or '')
    measure = next((item for item in measures if item['id'] == measure_id), None)
    record = {'id': spec['id'], 'type': kind, 'measure': measure_id or None,
              'status': 'BLOCKED' if spec.get('required') else 'SKIPPED', 'reason_code': None,
              'source_contract': spec.get('_source')}
    caveats = []
    if spec.get('_legacy_measure_missing'):
        record['reason_code'] = 'legacy_target_measure_missing'; caveats.append('必须显式配置 caliber.target_measure=amount|qty')
    elif spec.get('_legacy_unit_conflict'):
        record['reason_code'] = 'legacy_target_unit_conflict'; caveats.append(spec['_legacy_unit_conflict'])
    elif not measure:
        record['reason_code'] = 'unknown_measure'
    elif spec.get('_strict_unit') and not spec.get('unit'):
        record['reason_code'] = 'reference_unit_missing'; caveats.append('references[] 必须显式声明 unit')
    elif spec.get('unit') and str(spec['unit']) != measure['unit']:
        record['reason_code'] = 'reference_unit_mismatch'; caveats.append(f"参考单位={spec['unit']} 与度量单位={measure['unit']} 不一致")
    elif kind == 'group':
        dimension = spec.get('dimension')
        if not dimension or dimension not in (measure_dimensions.get(measure_id) or {}):
            record['reason_code'] = 'optional_group_dimension_missing'
        else:
            groups = measure_dimensions[measure_id][dimension]
            reference_name = spec.get('reference_group')
            overall = (measure_results.get(measure_id) or {}).get('current')
            matched = next((row for row in groups if row['name'] == str(reference_name)), None)
            if reference_name is not None and matched is None:
                record['reason_code'] = 'reference_group_missing'
                if caveats: record['_caveat'] = '; '.join(caveats)
                return record
            reference = matched['current'] if matched is not None else overall
            rows = []
            for row in groups:
                difference = row['current'] - reference if row.get('current') is not None and reference is not None else None
                rows.append({'name': row['name'], 'current': row.get('current'), 'reference': reference,
                             'delta': round(difference, 4) if difference is not None else None,
                             'favorable': _favorable(difference, measure['direction'])})
            record.update({'status': 'OK' if rows else record['status'], 'dimension': dimension,
                           'reference_group': reference_name or 'overall', 'groups': rows,
                           'reason_code': None if rows else 'no_groups'})
    else:
        reference = spec.get('value')
        quality = None
        if reference is None and (spec.get('lower') is None or spec.get('upper') is None):
            reference, field_caveats, reason, quality = _reference_field_value(df, current_mask, spec)
            caveats.extend(field_caveats)
            if reason: record['reason_code'] = reason
        current = (measure_results.get(measure_id) or {}).get('current')
        lower, upper = spec.get('lower'), spec.get('upper')
        direction_rule = str(spec.get('direction_rule') or measure['direction']).lower()
        tolerance = float(spec.get('tolerance') or 0)
        try:
            if current is None:
                record['reason_code'] = 'measure_current_unavailable'
            elif quality and quality.get('parse_error_pct', 0) > float(spec.get('_parse_block_pct', 100)):
                record['reason_code'] = 'reference_parse_error_above_threshold'
                caveats.append(f"参考列坏值率{quality['parse_error_pct']:.1f}%超阈值")
            elif lower is not None or upper is not None:
                if lower is None or upper is None or float(lower) > float(upper):
                    raise ValueError('range invalid')
                lower, upper = float(lower), float(upper)
                favorable = current is not None and lower - tolerance <= current <= upper + tolerance
                record.update({'status': 'OK', 'current': current, 'reference_range': {'lower': lower, 'upper': upper},
                               'direction_rule': 'inside_range_is_better', 'favorable': favorable,
                               'delta': 0.0 if favorable else round(min(abs(current-lower), abs(current-upper)), 4) if current is not None else None,
                               'reason_code': None})
            elif reference is not None:
                reference = float(reference); delta = current - reference if current is not None else None
                if spec.get('_source') == 'legacy_target' and reference <= 0:
                    raise ValueError('legacy target must be positive')
                if direction_rule == 'closer_to_target':
                    favorable = abs(delta) <= tolerance if delta is not None else None
                elif direction_rule in MEASURE_DIRECTIONS:
                    favorable = _favorable(delta, direction_rule)
                else:
                    raise ValueError('direction rule invalid')
                attainment = None
                if current is not None and current > 0 and reference > 0:
                    attainment = current / reference * 100 if direction_rule != 'lower_is_better' else reference / current * 100
                record.update({'status': 'OK', 'reference': round(reference, 4), 'current': current,
                               'delta': round(delta, 4) if delta is not None else None,
                               'gap': round(delta, 4) if delta is not None else None,
                               'attainment_rate': round(attainment, 1) if attainment is not None else None,
                               'direction_rule': direction_rule, 'tolerance': tolerance,
                               'favorable': favorable, 'reason_code': None})
        except (TypeError, ValueError):
            record['reason_code'] = 'reference_contract_invalid'
        if quality: record['quality'] = quality
    if caveats: record['_caveat'] = '; '.join(caveats)
    return record

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
    scope = m.get('analysis_scope') or {}
    df = load(args); R = Rep()
    if df.empty:
        R.err("数据源为 0 行，无法生成经营结论")

    # 完全重复行与 ID 无关，必须在派生列加入前记录；影响度在期间锁定后计算。
    duplicate_mask = df.duplicated(keep='first')
    dup_rows = int(df.duplicated().sum())
    for k in ('time', 'target', 'customer', 'product', 'id'):
        v = r.get(k)
        if v and v not in df.columns:
            R.warn(f"map.roles.{k} 列不存在: {v} (相关分析跳过)")
    idcol = r.get('id')
    if idcol and idcol in df.columns:
        dup_ids = int(df[idcol].duplicated().sum())
        if dup_ids > dup_rows:
            R.warn(f"重复 {idcol} 共 {dup_ids} 个 (可能一单多行, 核对口径)")

    measures, primary_measure = _normalize_measure_contracts(m, df, R)
    schema_contract = _validate_schema_contract(m, df, measures, R)
    if primary_measure:
        primary_field = primary_measure['field']; df['_amt'] = _measure_row_series(df, primary_measure)
    else:
        primary_field = None; df['_amt'] = pd.Series(float('nan'), index=df.index)
        primary_measure = {'id': 'invalid', 'field': None, 'label': 'invalid', 'semantic_type': 'other',
                           'aggregation': 'sum', 'unit': 'unknown', 'direction': 'neutral',
                           'additivity': 'non_additive', 'primary': True, 'required': True}
    amt = r.get('amount') if r.get('amount') in df.columns else None
    if amt and r.get('qty') == amt:
        R.err(f"map.roles.amount 与 qty 不能指向同一列 [{amt}]；禁止把数量当金额并生成伪量价结论")
    negative_policy = str(caliber.get('negative_amount_policy') or 'allow_net').lower()
    if negative_policy not in {'allow_net', 'block'}:
        R.err(f"caliber.negative_amount_policy 无效: {negative_policy} (仅支持 allow_net|block)")

    tcol = r.get('time'); period_info = None
    analysis_mode = str(scope.get('mode') or ('period' if tcol and tcol in df.columns else 'snapshot')).lower()
    if analysis_mode not in {'period', 'snapshot'}:
        R.err(f"analysis_scope.mode 无效: {analysis_mode} (仅支持 period|snapshot)")
        analysis_mode = 'snapshot'
    comparison_specs = scope.get('comparisons')
    if comparison_specs is None:
        one = scope.get('comparison')
        comparison_specs = [one] if isinstance(one, dict) else []
    if not isinstance(comparison_specs, list):
        R.err("analysis_scope.comparisons 必须是数组"); comparison_specs = []
    # 旧 map 没有 analysis_scope 时保持同比兼容；新合同必须显式选择 comparison type。
    if not scope and analysis_mode == 'period':
        comparison_specs = [{'id': 'baseline', 'type': 'year_over_year', 'legacy': True}]
    normalized_comparisons = []
    for index, item in enumerate(comparison_specs):
        if not isinstance(item, dict):
            R.err(f"analysis_scope.comparisons[{index}] 必须是对象")
            continue
        raw_type = str(item.get('type') or 'none').lower()
        normalized_type = COMPARISON_ALIASES.get(raw_type)
        if normalized_type is None:
            R.err(f"analysis_scope.comparisons[{index}].type 无效: {raw_type}")
            continue
        normalized_comparisons.append((item, normalized_type))
    time_comparisons = [item for item, normalized_type in normalized_comparisons
                        if normalized_type in TIME_COMPARISONS]
    if len(time_comparisons) > 1:
        R.err("analysis_scope.comparisons 只能声明一个主时间基线；目标、Benchmark 与组间比较可并列")
    time_comparison = time_comparisons[0] if time_comparisons else None
    comparison_type = 'none'; baseline_period = None
    current_mask = pd.Series(False, index=df.index); base_mask = pd.Series(False, index=df.index)
    data_as_of = None; comparison_as_of = None
    current_end = None; base_end = None
    if analysis_mode == 'snapshot':
        current_mask = pd.Series(True, index=df.index)
        if tcol and tcol in df.columns:
            try:
                df['_d'], timezone_rows = _parse_time_series(df[tcol], caliber.get('timezone'))
                df['_y'] = df['_d'].dt.year; df['_m'] = df['_d'].dt.month
            except ValueError as exc:
                R.warn(f"快照模式时间列不可用，趋势模块跳过: {exc}")
        R.good("analysis_scope.mode=snapshot：全表作为单一快照，趋势模块关闭")
    elif tcol and tcol in df.columns:
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
            period_info = parse_period_spec(scope.get('period', caliber.get('period')), df['_d'], caliber.get('granularity'))
        except (ValueError, TypeError) as exc:
            R.err(str(exc))
        if period_info:
            try:
                comparison_type, baseline_period = _comparison_period(period_info, time_comparison or {'type': 'none'})
            except (ValueError, TypeError) as exc:
                R.err(str(exc)); comparison_type, baseline_period = 'none', None
            try:
                data_as_of = _parse_cutoff(scope.get('data_as_of', caliber.get('data_as_of')), 'data_as_of')
                if baseline_period:
                    comparison_value = ((time_comparison or {}).get('as_of') or scope.get('comparison_as_of') or
                                        caliber.get('comparison_as_of'))
                    comparison_as_of = _parse_cutoff(comparison_value, 'comparison_as_of')
            except ValueError as exc:
                R.err(str(exc))
            requested_end = period_info['end']
            if data_as_of is not None and data_as_of < period_info['start']:
                R.err(f"caliber.data_as_of={data_as_of.date()} 早于请求期间起点 {period_info['start'].date()}")
            if data_as_of is not None:
                current_end = min(requested_end, data_as_of)
                current_mask = _date_mask(df, period_info['start'], current_end)
                if baseline_period:
                    base_start = baseline_period['start']; base_end = baseline_period['end']
                    if comparison_type == 'year_over_year' and current_end < requested_end:
                        base_end = min(base_end, current_end - pd.DateOffset(years=1))
                    elif comparison_type == 'same_stage_previous_period':
                        elapsed_days = int((current_end - period_info['start']).days)
                        base_end = min(base_end, base_start + pd.Timedelta(days=elapsed_days))
                        baseline_period['end'] = base_end
                        baseline_period['label'] = f"{base_start.date()}..{base_end.date()}"
                    if comparison_as_of is not None and comparison_as_of < base_end:
                        R.err(f"caliber.comparison_as_of={comparison_as_of.date()} 未覆盖基线截止日 {base_end.date()}；禁止不完整基线比较")
                    base_mask = _date_mask(df, base_start, base_end)
                if current_end < requested_end and comparison_type == 'year_over_year':
                    R.warn(
                        f"请求期间 {period_info['label']} 尚未完结；已锁定截至 {current_end.date()}，"
                        f"并只比较同日历截止基线截至 {base_end.date()}，禁止整期同比措辞"
                    )
                elif current_end < requested_end:
                    if comparison_type == 'same_stage_previous_period':
                        R.warn(f"请求期间 {period_info['label']} 尚未完结；已按上一日历期同阶段比较至 {base_end.date()}")
                    elif comparison_type in {'previous_calendar_period', 'previous_complete_period'}:
                        R.warn(f"请求期间 {period_info['label']} 尚未完结，但基线为完整上一日历期；该比较非同阶段，报告必须显式披露")
                    else:
                        R.warn(f"请求期间 {period_info['label']} 尚未完结；当前值仅截至 {current_end.date()}，比较口径={comparison_type}")
            if period_info['inferred']:
                msg = f"map.caliber.period 未明确填写，已推断为 {period_info['label']}; 禁止在未确认期间下出报告"
                (R.warn if caliber.get('allow_inferred_period') is True else R.err)(msg)
    else:
        if scope.get('period') or caliber.get('period'):
            R.err("配置了 map.caliber.period 但无有效 time 列，无法锁定统计期间")
        else:
            R.err("analysis_scope.mode=period 但无有效 time 列；若为无时间数据请显式改为 snapshot")

    current_rows = int(current_mask.sum()); base_rows = int(base_mask.sum())
    quality_scope = current_mask | base_mask
    if not bool(quality_scope.any()):
        quality_scope = pd.Series(True, index=df.index)
    quality_rows = int(quality_scope.sum())

    # 主指标完整性与重复影响度按实际分析范围评估；不再把任意指标改名为金额。
    primary_present = _measure_source_present(df, primary_measure) if primary_measure['id'] != 'invalid' else pd.Series(False, index=df.index)
    measure_empty = int((quality_scope & ~primary_present).sum())
    measure_missing_pct = measure_empty / quality_rows * 100 if quality_rows else 100.0
    bad_mask = df['_amt'].isna() & primary_present
    bad = int((quality_scope & bad_mask).sum())
    measure_src = int((quality_scope & primary_present).sum())
    badpct = bad / measure_src * 100 if measure_src else 0.0
    missing_block_pct = float(thresholds.get('primary_measure_missing_block_pct',
                                             thresholds.get('amount_missing_block_pct', 5)))
    parse_block_pct = float(thresholds.get('primary_measure_parse_block_pct',
                                           thresholds.get('amount_parse_block_pct', 5)))
    measure_period_quality = {}
    for period_name, mask in (("current", current_mask), ("base", base_mask)):
        rows = int(mask.sum())
        blanks = int((mask & ~primary_present).sum())
        non_null = int((mask & primary_present).sum())
        parse_errors = int((mask & bad_mask).sum())
        measure_period_quality[period_name] = {
            "scope_rows": rows,
            "blank_rows": blanks,
            "blank_pct": round(blanks / rows * 100, 1) if rows else None,
            "parse_error_rows": parse_errors,
            "parse_error_pct": round(parse_errors / non_null * 100, 1) if non_null else None,
        }
    period_blank_breaches = [
        f"{name}={entry['blank_pct']:.1f}%"
        for name, entry in measure_period_quality.items()
        if entry['blank_pct'] is not None and entry['blank_pct'] > missing_block_pct
    ]
    if measure_empty:
        msg = f"主指标[{primary_measure['id']}]在分析范围有 {measure_empty} 行空值({measure_missing_pct:.1f}%)，已剔除"
        if period_blank_breaches:
            msg += "；单期越线 " + "、".join(period_blank_breaches)
        (R.err if measure_missing_pct > missing_block_pct or period_blank_breaches else R.warn)(msg)
    if bad:
        msg = f"主指标[{primary_measure['id']}]在分析范围有 {bad} 行({badpct:.1f}%非空)无法解析为数字，已剔除"
        (R.err if badpct > parse_block_pct else R.warn)(msg)

    scoped_duplicate = quality_scope & duplicate_mask
    duplicate_rows = int(scoped_duplicate.sum())
    duplicate_row_pct = duplicate_rows / quality_rows * 100 if quality_rows else 0.0
    scoped_abs_value = float(df.loc[quality_scope, '_amt'].abs().sum())
    duplicate_abs_value = float(df.loc[scoped_duplicate, '_amt'].abs().sum())
    duplicate_value_pct = duplicate_abs_value / scoped_abs_value * 100 if scoped_abs_value > 0 else 0.0
    duplicate_period_quality = {}
    for period_name, mask in (("current", current_mask), ("base", base_mask)):
        rows = int(mask.sum())
        duplicate_rows_in_period = int((mask & duplicate_mask).sum())
        absolute_amount = float(df.loc[mask, '_amt'].abs().sum())
        duplicate_amount = float(df.loc[mask & duplicate_mask, '_amt'].abs().sum())
        duplicate_period_quality[period_name] = {
            "scope_rows": rows,
            "rows": duplicate_rows_in_period,
            "row_pct": round(duplicate_rows_in_period / rows * 100, 1) if rows else None,
            "absolute_value": round(duplicate_amount, 2),
            "value_pct": round(duplicate_amount / absolute_amount * 100, 1) if absolute_amount > 0 else None,
            # amount aliases remain only for existing consumers.
            "absolute_amount": round(duplicate_amount, 2),
            "amount_pct": round(duplicate_amount / absolute_amount * 100, 1) if absolute_amount > 0 else None,
        }
    if duplicate_rows:
        row_threshold = float(thresholds.get('duplicate_row_block_pct', 5))
        amount_threshold = float(thresholds.get('duplicate_amount_block_pct', 5))
        period_duplicate_breaches = [
            name for name, entry in duplicate_period_quality.items()
            if ((entry['row_pct'] is not None and entry['row_pct'] > row_threshold) or
                (entry['amount_pct'] is not None and entry['amount_pct'] > amount_threshold))
        ]
        duplicate_blocked = (
            duplicate_row_pct > row_threshold or duplicate_value_pct > amount_threshold or
            bool(period_duplicate_breaches)
        )
        msg = (
            f"完全重复行在锁定可比范围占 {duplicate_rows}/{quality_rows} 行({duplicate_row_pct:.1f}%)，"
            f"涉及主指标绝对值占比 {duplicate_value_pct:.1f}%；当前未自动去重"
        )
        if period_duplicate_breaches:
            msg += "；单期越线 " + "、".join(period_duplicate_breaches)
        (R.err if duplicate_blocked else R.warn)(msg)

    negative_count = int((quality_scope & (df['_amt'] < 0)).sum())
    if negative_count:
        msg = f"主指标[{primary_measure['id']}]在分析范围含 {negative_count} 行负数; 排名保留，份额/集中度按适用性停算"
        (R.err if negative_policy == 'block' and primary_measure['semantic_type'] == 'amount' else R.warn)(msg)

    observation_quality = None
    try:
        expected_observations = _expected_observations(caliber.get('expected_observations'))
    except ValueError as exc:
        R.err(str(exc)); expected_observations = None
    if expected_observations and period_info:
        mode = expected_observations['mode']
        actual_current = current_rows if mode == 'rows' else int(df.loc[current_mask, '_d'].nunique())
        actual_base = base_rows if mode == 'rows' else int(df.loc[base_mask, '_d'].nunique())
        min_pct = float(thresholds.get('period_completeness_block_pct', 90))
        observation_quality = {"mode": mode, "threshold_pct": min_pct}
        for key, actual in (("current", actual_current), ("base", actual_base)):
            expected = expected_observations[key]
            ratio = actual / expected * 100 if expected else 0.0
            observation_quality[key] = {"actual": actual, "expected": expected, "completeness_pct": round(ratio, 1)}
            if ratio < min_pct:
                R.err(f"{key} 观测完整率 {ratio:.1f}%<{min_pct:.1f}%（{actual}/{expected} {mode}）")

    measure_quality = {}
    for measure in measures:
        quality = _axis_measure_quality(df, quality_scope, measure)
        measure_quality[measure['id']] = quality
        if quality['status'] != 'OK':
            message = f"度量[{measure['id']}]轴聚合质量不足: {','.join(quality.get('reason_codes') or [])}"
            (R.err if measure['primary'] else R.warn)(message)

    tc = _aggregate_measure(df, current_mask, primary_measure) if current_rows else None
    tp = _aggregate_measure(df, base_mask, primary_measure) if base_rows else None
    if period_info and current_rows == 0:
        R.err(f"指定当期 {period_info['label']} 无数据")
    base_available = bool(baseline_period and base_rows > 0)
    if period_info and not base_available:
        if baseline_period:
            R.warn(f"基线 {baseline_period['start'].date()}..{baseline_period['end'].date()} 无数据, 时间比较/贡献降级")
    elif base_available and tp == 0:
        R.warn("基线主指标=0，百分比变化停算；仍保留绝对差异")
    analysis_ready = bool(current_rows > 0 and tc is not None and not R.e)
    comparison_ready = bool(analysis_ready and base_available and tp is not None)

    source_trace = _source_trace(args)
    result_snapshot = _result_snapshot_fingerprint(df[[column for column in df.columns if not str(column).startswith('_')]])
    semantic_signature = _semantic_signature(measures, schema_contract)
    drift_report = _evaluate_drift_lock(args, m, result_snapshot, semantic_signature, R)
    out = {"schema_version": "1.0",
           "meta": {"source": source_trace["path"], "source_origin": args._source_origin,
                    "source_kind": source_trace["kind"], "source_path": source_trace["path"],
                    "source_sha256": source_trace["sha256"],
                    "source_fingerprint_scope": source_trace["fingerprint_scope"],
                    **({"source_selector": source_trace["selector"]} if source_trace.get("selector") else {}),
                    **({"source_caveat": source_trace["caveat"]} if source_trace.get("caveat") else {}),
                    "result_snapshot_sha256": result_snapshot['result_sha256'],
                    "result_snapshot_rows": result_snapshot['rows'],
                    "result_schema_sha256": result_snapshot['schema_sha256'],
                    "result_schema": result_snapshot['schema'],
                    "semantic_contract_sha256": semantic_signature['sha256'],
                    "rows": len(df), "current_rows": current_rows, "base_rows": base_rows,
                    "primary_measure_id": primary_measure['id'], "primary_measure_field": primary_field,
                    "amount_field": amt, "period": scope.get('period', caliber.get('period')),
                    "analysis_mode": analysis_mode, "generated_by": "prep-source.py",
                    "thresholds": {"time_parse_block_pct": float(thresholds.get('time_parse_block_pct', 5)),
                                   "primary_measure_parse_block_pct": parse_block_pct,
                                   "primary_measure_missing_block_pct": missing_block_pct,
                                   "amount_parse_block_pct": parse_block_pct,
                                   "amount_missing_block_pct": missing_block_pct,
                                   "duplicate_row_block_pct": float(thresholds.get('duplicate_row_block_pct', 5)),
                                   "duplicate_amount_block_pct": float(thresholds.get('duplicate_amount_block_pct', 5)),
                                   "period_completeness_block_pct": float(thresholds.get('period_completeness_block_pct', 90)),
                                   "object_top5_high": (float(thresholds['customer_top5_high'])
                                                        if thresholds.get('customer_top5_high') is not None else None)}},
           "semantic_layer": {"version": "1.1", "primary_measure": primary_measure['id'],
                              "measures": measures, "schema": schema_contract},
           "analysis_scope": {"mode": analysis_mode, "comparison_type": comparison_type,
                              "comparisons": comparison_specs},
           "total": round(tc, 2) if analysis_ready else None, "dimensions": {},
           "measure_results": {}, "measure_dimensions": {}, "method_applicability": {},
           "drift_report": drift_report,
           "_discipline": "报告数字一律从本文件引用；比较、方向、单位和聚合均以 semantic_layer/analysis_scope 为准"}
    primary_quality = {"measure_id": primary_measure['id'], "field": primary_field,
                   "scope_rows": quality_rows, "blank_rows": measure_empty,
                   "blank_pct": round(measure_missing_pct, 1), "parse_error_rows": bad,
                   "parse_error_pct": round(badpct, 1),
                   "non_null_pct": round(100 - measure_missing_pct, 1),
                   "periods": measure_period_quality}
    out['meta']['quality'] = {
        "primary_measure": primary_quality,
        "measures": measure_quality,
        "duplicates": {"rows": duplicate_rows, "row_pct": round(duplicate_row_pct, 1),
                       "absolute_value": round(duplicate_abs_value, 2),
                       "value_pct": round(duplicate_value_pct, 1),
                       "absolute_amount": round(duplicate_abs_value, 2),
                       "amount_pct": round(duplicate_value_pct, 1),
                       "periods": duplicate_period_quality},
    }
    if primary_measure['semantic_type'] == 'amount':
        out['meta']['quality']['amount'] = dict(primary_quality)
    if observation_quality:
        out['meta']['quality']['observations'] = observation_quality
    if period_info:
        requested_end = period_info['end']
        effective_end = current_end or requested_end
        effective_base_start = baseline_period['start'] if baseline_period else None
        effective_base_end = base_end if baseline_period else None
        requested_days = int((requested_end - period_info['start']).days + 1)
        covered_days = int((effective_end - period_info['start']).days + 1)
        out['meta']['period_lock'] = {
            "label": period_info['label'], "start": str(period_info['start'].date()),
            "end": str(effective_end.date()), "requested_end": str(requested_end.date()),
            "base_start": str(effective_base_start.date()) if effective_base_start is not None else None,
            "base_end": str(effective_base_end.date()) if effective_base_end is not None else None,
            "requested_base_end": str(baseline_period['end'].date()) if baseline_period else None,
            "data_as_of": str(data_as_of.date()) if data_as_of is not None else None,
            "comparison_as_of": str(comparison_as_of.date()) if comparison_as_of is not None else None,
            "completeness": "complete" if effective_end >= requested_end else "partial_same_cutoff",
            "calendar_coverage_pct": round(covered_days / requested_days * 100, 1),
            "comparison_type": comparison_type,
            "like_for_like": bool(not baseline_period or (data_as_of is not None and comparison_as_of is not None and
                                  comparison_as_of >= effective_base_end)),
            "granularity": period_info['granularity'], "inferred": period_info['inferred']}
    if period_info and analysis_ready:
        months = sorted(df.loc[current_mask, '_m'].dropna().astype(int).unique().tolist())
        out['meta']['comparison'] = {"type": comparison_type, "months": months,
                                    "granularity": period_info['granularity'], "available": comparison_ready}
        if comparison_type == 'year_over_year' and primary_measure.get('legacy_role') == 'amount':
            out['meta']['yoy'] = {"current_year": int(period_info['start'].year),
                                  "base_year": int(baseline_period['start'].year) if baseline_period else None,
                                  "months": months, "granularity": period_info['granularity'],
                                  "adjacent": True, "available": comparison_ready and tp not in {None, 0}}
        out['period'] = {"primary_measure": primary_measure['id'],
                         "total_cur": round(tc, 2),
                         "total_base": round(tp, 2) if comparison_ready else None,
                         "change_pct": round((tc / tp - 1) * 100, 1) if comparison_ready and tp not in {None, 0} else None}
        if primary_measure['semantic_type'] == 'amount':
            out['period'].update({"total_cur_wan": round(tc / 1e4, 1),
                                  "total_base_wan": round(tp / 1e4, 1) if comparison_ready else None,
                                  "total_yoy": round((tc / tp - 1) * 100, 1) if comparison_type == 'year_over_year' and comparison_ready and tp not in {None, 0} else None})

        # PVM 只适用于可加金额 + 可加数量 + 有效时间基线；其它业务机器可读跳过。
        quantity_measure = next((measure for measure in measures
                                 if measure['semantic_type'] == 'quantity'
                                 and measure['aggregation'] == 'sum'
                                 and measure['additivity'] == 'additive'
                                 and measure['field'] != primary_measure['field']), None)
        qcol = quantity_measure['field'] if quantity_measure else None
        if (primary_measure['semantic_type'] == 'amount' and primary_measure['aggregation'] == 'sum' and
                comparison_ready and qcol and qcol in df.columns):
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
            out['method_applicability']['pvm'] = {"status": pvm_status,
                                                  "reason_code": None if pvm_status == 'OK' else 'quality_gate_failed'}
        else:
            reasons = []
            if primary_measure['semantic_type'] != 'amount' or primary_measure['aggregation'] != 'sum':
                reasons.append('requires_additive_amount')
            if not comparison_ready: reasons.append('requires_time_baseline')
            if not qcol or qcol not in df.columns: reasons.append('requires_quantity_measure')
            out['method_applicability']['pvm'] = {"status": "SKIPPED", "reason_code": reasons[0],
                                                  "reasons": reasons}

        # 旧 trend 合同仅在同比可用时保留；其它比较不伪装成跨年逐月 YoY。
        if comparison_type == 'year_over_year':
            trend_df = df.loc[current_mask | base_mask].dropna(subset=['_m', '_y'])
            piv = trend_df.groupby(['_y', '_m'])['_amt'].sum()
            cell = {(int(y), int(month)): float(v) for (y, month), v in piv.items()}
            years = sorted({int(y) for y, _ in cell})
            divisor = 1e4 if primary_measure['semantic_type'] == 'amount' else 1
            if years:
                out['trend'] = {y: [round(cell[(y, month)] / divisor, 1) if (y, month) in cell else None
                                    for month in range(1, 13)] for y in years}
                out['method_applicability']['mk_trend'] = {"status": "ELIGIBLE",
                                                           "reason_code": "year_over_year_series_available"}
        if 'mk_trend' not in out['method_applicability']:
            out['method_applicability']['mk_trend'] = {"status": "SKIPPED",
                                                       "reason_code": "requires_regular_time_series_and_yoy_baseline"}

    if 'mk_trend' not in out['method_applicability']:
        out['method_applicability']['mk_trend'] = {"status": "SKIPPED",
                                                   "reason_code": "snapshot_has_no_time_series" if analysis_mode == 'snapshot' else "requires_regular_time_series"}
    if 'pvm' not in out['method_applicability']:
        out['method_applicability']['pvm'] = {"status": "SKIPPED",
                                             "reason_code": "snapshot_has_no_time_baseline" if analysis_mode == 'snapshot' else "requires_additive_amount_quantity"}

    cur_df = df.loc[current_mask if analysis_ready else pd.Series(False, index=df.index)]
    base_df = df.loc[base_mask if analysis_ready else pd.Series(False, index=df.index)]
    safe_total = bool(analysis_ready and primary_measure['additivity'] == 'additive' and tc not in {None, 0})
    out['meta']['share_caliber'] = '分析范围内主指标；仅 additive 且无负分项时可计算'

    def comparison_rows(field, measure=primary_measure):
        gc = _group_measure(df, current_mask, field, measure) if analysis_ready else {}
        gb = _group_measure(df, base_mask, field, measure) if comparison_ready else {}
        ordered = sorted(gc, key=lambda key: (gc[key] is not None, gc[key] if gc[key] is not None else float('-inf')), reverse=True)
        ordered.extend(key for key in sorted(gb, key=lambda item: gb[item] if gb[item] is not None else float('-inf'), reverse=True) if key not in gc)
        numeric_parts = [value for value in list(gc.values()) + list(gb.values()) if value is not None]
        unsafe_parts = bool(any(value < 0 for value in numeric_parts))
        total_current = _aggregate_measure(df, current_mask, measure) if analysis_ready else None
        total_base = _aggregate_measure(df, base_mask, measure) if comparison_ready else None
        share_allowed = (measure['additivity'] == 'additive' and total_current not in {None, 0} and not unsafe_parts)
        rows = []
        for name in ordered:
            ac = gc.get(name); ab = gb.get(name)
            row = {"name": str(name), "measure_id": measure['id'],
                   "value": round(ac, 4) if ac is not None else None,
                   "current": round(ac, 4) if ac is not None else None}
            row['share'] = round(ac / total_current * 100, 1) if share_allowed and ac is not None else None
            if comparison_ready:
                row['baseline'] = round(ab, 4) if ab is not None else None
                row['change_pct'] = round((ac / ab - 1) * 100, 1) if ac is not None and ab not in {None, 0} else None
                row['delta'] = round(ac - ab, 4) if ac is not None and ab is not None else None
                row['favorable'] = _favorable(row['delta'], measure['direction'])
                row['contribution_pp'] = (round((ac - ab) / total_base * 100, 1)
                                          if measure['additivity'] == 'additive' and ac is not None and
                                          ab is not None and total_base not in {None, 0} else None)
            if measure['semantic_type'] == 'amount':
                row.update({"amount": round(ac, 2) if ac is not None else None,
                            "amount_wan": round(ac / 1e4, 1) if ac is not None else None,
                            "amount_cur": round(ac, 2) if ac is not None else None,
                            "amount_cur_wan": round(ac / 1e4, 1) if ac is not None else None})
                if comparison_ready:
                    row.update({"amount_base": round(ab, 2) if ab is not None else None,
                                "amount_base_wan": round(ab / 1e4, 1) if ab is not None else None,
                                "yoy": row['change_pct'],
                                "delta_wan": round(row['delta'] / 1e4, 1) if row.get('delta') is not None else None})
            rows.append(row)
        return rows, unsafe_parts

    # 各维度：主指标、份额、变化、排名全部来自同一范围与方向合同。
    for dim in ((r.get('dimensions') or []) if analysis_ready else []):
        if dim not in df.columns:
            R.warn(f"维度列不存在: {dim}"); continue
        rows, unsafe_parts = comparison_rows(dim)
        out['dimensions'][dim] = rows
        if unsafe_parts:
            R.warn(f"维度[{dim}]存在负数主指标分项，已停算份额/集中度，仅保留数值排名")
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

    # 通用语义层结果：每个度量独立按其聚合/单位/方向/可加性计算。
    dimensions = [dim for dim in (r.get('dimensions') or []) if dim in df.columns]
    for measure in measures:
        current_value = _aggregate_measure(df, current_mask, measure) if analysis_ready else None
        baseline_value = _aggregate_measure(df, base_mask, measure) if comparison_ready else None
        delta = (current_value - baseline_value
                 if current_value is not None and baseline_value is not None else None)
        raw_current = _measure_row_series(df, measure).loc[current_mask].dropna() if analysis_ready else pd.Series(dtype='float64')
        distribution = None
        if not raw_current.empty:
            distribution = {
                'count': int(raw_current.size), 'min': round(float(raw_current.min()), 4),
                'p25': round(float(raw_current.quantile(.25)), 4),
                'median': round(float(raw_current.median()), 4),
                'p75': round(float(raw_current.quantile(.75)), 4),
                'max': round(float(raw_current.max()), 4), 'mean': round(float(raw_current.mean()), 4),
            }
        result = {
            'id': measure['id'], 'label': measure['label'], 'unit': measure['unit'],
            'aggregation': measure['aggregation'], 'direction': measure['direction'],
            'additivity': measure['additivity'], 'dimension_aggregation': measure['dimension_aggregation'],
            'time_aggregation': measure.get('time_aggregation'), 'storage_scale': measure.get('storage_scale'),
            'current': round(current_value, 4) if current_value is not None else None,
            'baseline': round(baseline_value, 4) if baseline_value is not None else None,
            'change_abs': round(delta, 4) if delta is not None else None,
            'change_pct': round((current_value / baseline_value - 1) * 100, 1)
                          if current_value is not None and baseline_value not in {None, 0} else None,
            'favorable': _favorable(delta, measure['direction']), 'distribution': distribution,
        }
        if analysis_mode == 'period' and '_d' in df.columns and df['_d'].notna().any():
            series = []
            month_keys = sorted(df.loc[df['_d'].notna(), '_d'].dt.to_period('M').unique())
            for month_key in month_keys:
                month_mask = df['_d'].dt.to_period('M') == month_key
                value = _aggregate_measure(df, month_mask, measure)
                if value is not None:
                    series.append({'period': str(month_key), 'value': round(value, 4)})
            result['time_series'] = series
            result['time_series_scope'] = 'all_source_valid_dates_monthly'
            if measure['primary']:
                month_ordinals = [pd.Period(point['period'], freq='M').ordinal for point in series]
                regular = (len(month_ordinals) >= 4 and
                           all(month_ordinals[index] == month_ordinals[index - 1] + 1
                               for index in range(1, len(month_ordinals))))
                out['method_applicability']['mk_trend'] = {
                    'status': 'ELIGIBLE' if regular else 'SKIPPED',
                    'reason_code': 'regular_month_series_n_gte_4' if regular else 'requires_regular_time_series_n_gte_4'}
        out['measure_results'][measure['id']] = result
        out['measure_dimensions'][measure['id']] = {}
        for dim in dimensions:
            rows, _ = comparison_rows(dim, measure)
            out['measure_dimensions'][measure['id']][dim] = rows

        topn_eligible = any(len(rows) >= 2 for rows in out['measure_dimensions'][measure['id']].values())
        pareto_eligible = (measure['additivity'] == 'additive' and topn_eligible and
                           all((row.get('current') or 0) >= 0
                               for rows in out['measure_dimensions'][measure['id']].values() for row in rows))
        out['method_applicability'][f"topn:{measure['id']}"] = {
            'status': 'ELIGIBLE' if topn_eligible else 'SKIPPED',
            'reason_code': 'dimension_with_multiple_groups' if topn_eligible else 'requires_dimension_with_multiple_groups'}
        out['method_applicability'][f"pareto:{measure['id']}"] = {
            'status': 'ELIGIBLE' if pareto_eligible else 'SKIPPED',
            'reason_code': 'nonnegative_additive_measure' if pareto_eligible else 'requires_nonnegative_additive_measure'}
        out['method_applicability'][f"hhi:{measure['id']}"] = {
            'status': 'ELIGIBLE' if pareto_eligible else 'SKIPPED',
            'reason_code': 'descriptive_only_without_policy' if pareto_eligible else 'requires_nonnegative_additive_measure'}

    # V3.2 统一参考合同：目标、Benchmark、区间与组间比较只走 references[]，旧入口仅作适配。
    reference_specs = _normalize_reference_specs(m, comparison_specs, measures, R)
    reference_records = [
        _reference_record(df, current_mask, spec, measures,
                          out['measure_results'], out['measure_dimensions'])
        for spec in reference_specs
    ]
    out['references'] = reference_records
    out['comparisons'] = reference_records  # 兼容已有消费者；references[] 是唯一真源。
    for record in reference_records:
        quality = record.get('quality') or {}
        if quality.get('parse_error_rows'):
            if record.get('source_contract') == 'legacy_target':
                R.warn(f"目标列在锁定当期有 {quality['parse_error_rows']} 行({quality.get('parse_error_pct', 0):.1f}%)无法解析，已排除")
            else:
                R.warn(f"参考[{record['id']}]有 {quality['parse_error_rows']} 行无法解析，已按合同降级")
        if record['status'] == 'BLOCKED':
            R.warn(f"参考[{record['id']}]已局部 BLOCKED: {record.get('_caveat') or record.get('reason_code')}")

    # 旧 target 输出仅是 legacy_target 的投影，禁止再维护第二套计算逻辑。
    legacy_reference = next((record for record in reference_records
                             if record.get('source_contract') == 'legacy_target'), None)
    if legacy_reference:
        target_measure = next((item for item in measures if item['id'] == legacy_reference.get('measure')), None)
        actual = legacy_reference.get('current'); plan = legacy_reference.get('reference')
        target = {
            'field': r.get('target'), 'measure': legacy_reference.get('measure'),
            'status': legacy_reference['status'], 'actual': actual, 'plan': plan,
            'achievement_rate': legacy_reference.get('attainment_rate'),
            'gap': legacy_reference.get('gap'),
            'actual_wan': None, 'plan_wan': None, 'gap_wan': None,
        }
        if target_measure and target_measure['semantic_type'] == 'amount' and actual is not None and plan is not None:
            target.update({'actual_wan': round(actual / 1e4, 1), 'plan_wan': round(plan / 1e4, 1),
                           'gap_wan': round((actual - plan) / 1e4, 1)})
        if legacy_reference.get('_caveat'):
            target['_caveat'] = legacy_reference['_caveat']
        elif legacy_reference.get('reason_code'):
            target['_caveat'] = legacy_reference['reason_code']
        if target['status'] == 'BLOCKED':
            R.warn(f"目标分析已局部 BLOCKED: {target.get('_caveat', '口径不明')}; 禁止出达成率/子弹图")
        out['target'] = target

    # 兼容 product 角色；输出基于主指标，不在非销售业务注入“产品”默认词。
    product = r.get('product')
    if analysis_ready and product and product in df.columns:
        product_rows, unsafe_product = comparison_rows(product)
        if unsafe_product:
            R.warn(f"分类维度[{product}]含负数主指标分项，份额已停算")
        out['products'] = {"field": product,
                           "ranking": sorted(product_rows, key=lambda x: x['current'] if x['current'] is not None else float('-inf'), reverse=True),
                           "growth": sorted([x for x in product_rows if x.get('delta') is not None and x['delta'] > 0],
                                            key=lambda x: x['delta'], reverse=True),
                           "decline": sorted([x for x in product_rows if x.get('delta') is not None and x['delta'] < 0],
                                             key=lambda x: x['delta']),
                           "contribution": sorted([x for x in product_rows if x.get('contribution_pp') is not None],
                                                  key=lambda x: abs(x['contribution_pp']), reverse=True)}

    # 兼容 customer 角色：无显式业务政策时只给描述性集中度，不自动贴“风险”标签。
    cust = r.get('customer')
    if analysis_ready and cust and cust in df.columns:
        out.setdefault('concentration_scope', {})['period'] = '当前分析范围'
        customer_present = cur_df[cust].notna() & cur_df[cust].astype(str).str.strip().ne('')
        if primary_measure['additivity'] != 'additive':
            out['concentration'] = {"status": "SKIPPED", "level": None,
                                    "_caveat": "集中度/Pareto 需要 nonnegative additive 度量"}
            cg = None
        else:
            present_mask = current_mask & df[cust].notna() & df[cust].astype(str).str.strip().ne('')
            cg_dict = _group_measure(df, present_mask, cust, primary_measure)
            cg = pd.Series(cg_dict, dtype='float64').sort_values(ascending=False)
        if cg is None:
            pass
        else:
            identified_amount = float(cg.sum()); coverage = identified_amount / tc * 100 if tc not in {None, 0} else None
            min_coverage = float(thresholds.get('customer_coverage_min_pct', 80))
            base_concentration = {"status": "OK", "customers": int(cg.size),
                                  "customer_coverage": round(coverage, 1) if coverage is not None else None,
                                  "coverage_threshold": min_coverage, "level": None,
                                  "classification": "descriptive"}
            if (cg < 0).any():
                R.warn(f"对象维度[{cust}]含负数分项，集中度已停算")
                out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                        "_caveat": "已识别对象存在负数分项"}
            elif identified_amount <= 0:
                R.warn(f"对象维度[{cust}]当前合计非正，集中度已停算")
                out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                        "_caveat": "已识别对象合计非正"}
            elif coverage is not None and coverage > 100.1:
                R.warn(f"对象字段主指标覆盖率={coverage:.1f}%>100%，集中度已停算")
                out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                        "_caveat": "对象覆盖率超过100%，分母受未归类负数影响"}
            elif coverage is None or coverage < min_coverage:
                R.warn(f"对象字段主指标覆盖率仅{(coverage or 0):.1f}%<{min_coverage:.1f}%，集中度外推已停算")
                out['concentration'] = {**base_concentration, "status": "BLOCKED",
                                        "top5_share": round(float(cg.head(5).sum() / tc * 100), 1) if tc not in {None, 0} else None,
                                        "top5_share_identified": round(float(cg.head(5).sum() / identified_amount * 100), 1),
                                        "_caveat": "对象字段覆盖不足，禁止把已识别子样本集中度外推到总体"}
            else:
                cum = cg.cumsum() / identified_amount
                out['concentration'] = {**base_concentration,
                    "top5_share": round(float(cg.head(5).sum() / tc * 100), 1),
                    "top10_share": round(float(cg.head(10).sum() / tc * 100), 1),
                    "top5_share_identified": round(float(cg.head(5).sum() / identified_amount * 100), 1),
                    "pareto_n50": int((cum < 0.5).sum() + 1), "pareto_n80": int((cum < 0.8).sum() + 1),
                    "top5_value": [round(float(v), 4) for v in cg.head(5).tolist()]}
                if primary_measure['semantic_type'] == 'amount':
                    out['concentration']['top5_wan'] = [round(float(v) / 1e4, 1) for v in cg.head(5).tolist()]
                top5_high = thresholds.get('customer_top5_high')
                if top5_high is not None:
                    top5_high = float(top5_high)
                    level = 'high' if out['concentration']['top5_share'] >= top5_high else 'below_high_threshold'
                    out['concentration'].update({'classification': 'policy', 'level': level,
                                                 'policy': {'top5_high': top5_high}})

    out['data_status'] = {"status": R.status(), "errors": R.e, "warnings": R.w, "passed": R.ok}
    _write_json(args.out, out)
    quality_path = args.out.replace('.json', '') + '.quality.md'
    q = [f"# 数据质量报告 — {args.out}", f"\n状态: **{R.status()}**  (源行数 {len(df):,}; 当期 {current_rows:,})\n"]
    if R.e: q.append("## 阻断 (BLOCKED, 修好前不出结论)\n" + "\n".join(f"- {x}" for x in R.e))
    if R.w: q.append("## 警告\n" + "\n".join(f"- {x}" for x in R.w))
    q.append(f"## 通过\n- 主指标 {primary_measure['id']} 按 {primary_measure['aggregation']} 聚合完成"
             "\n- 维度排名使用同一分析范围与方向合同" +
             (f"\n- 时间比较可用 ({comparison_type})" if comparison_ready else "\n- 时间比较未配置或不可用；结构/分布仍可用"))
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
        if name == 'build':
            p.add_argument('--map', required=True); p.add_argument('--out', default='metrics.json')
            p.add_argument('--baseline-metrics', help='覆盖 map.drift_lock.baseline_metrics 的跨运行基线')
    a = ap.parse_args(); a.fn(a)

if __name__ == '__main__': main()
