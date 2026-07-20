#!/usr/bin/env python3
"""可审计地重建 demo-report 数据与双密度 HTML 产物。

输入真源是 demo_sales.csv + map.json + enrichment.json + report-spec.json：
1. prep-source.py 产出锁定期间的基础 metrics；
2. 按 enrichment 声明从同一 CSV 复算历史月度趋势，再跑 stat-insights.py；
3. 把可复算证据与显式行动假设分层写入 metrics；
4. Renderer 以 report-spec 为叙事结构真源生成标准/紧凑在线版；
5. make-offline 由两份 Renderer 在线真源生成离线版。

默认在临时目录完整成功后原子写回；--check 不联网重打包，而是逐字节比对
数据产物/Renderer 在线产物，并核验离线版记录的在线真源 SHA-256。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demo-report"
MAP_PATH = DEMO / "map.json"
ENRICHMENT_PATH = DEMO / "enrichment.json"
REPORT_SPEC_PATH = DEMO / "report-spec.json"
SOURCE_PATH = DEMO / "demo_sales.csv"
GENERATED_FILES = ("metrics.json", "metrics.quality.md", "insights.json", "insights.md")
ONLINE_HTML_FILES = ("report.html", "report-compact.html")
OFFLINE_HTML_BY_SOURCE = {
    "report.html": "report.offline.html",
    "report-compact.html": "report-compact.offline.html",
}
HTML_DENSITY_BY_FILE = {
    "report.html": "standard",
    "report-compact.html": "compact",
}
OFFLINE_SOURCE_RE = re.compile(
    r'<meta\s+name="south-china-report-offline-source-sha256"\s+content="([0-9a-f]{64})"\s*/?>',
    re.IGNORECASE,
)


class DemoBuildError(RuntimeError):
    pass


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DemoBuildError(f"无法读取有效 JSON: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DemoBuildError(f"JSON 顶层必须是对象: {path}")
    return value


def dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=1, allow_nan=False)


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def run(command: list[str]) -> None:
    completed = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if completed.returncode != 0:
        detail = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
        raise DemoBuildError(f"命令失败 ({completed.returncode}): {' '.join(command)}\n{detail}")


def parse_month(raw: str, label: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d{4})-(\d{2})", str(raw))
    if not match:
        raise DemoBuildError(f"{label} 必须是 YYYY-MM: {raw!r}")
    year, month = map(int, match.groups())
    if not 1 <= month <= 12:
        raise DemoBuildError(f"{label} 月份非法: {raw!r}")
    return year, month


def monthly_trend(map_config: dict[str, Any], enrichment: dict[str, Any]) -> dict[str, list[float | None]]:
    trend_config = enrichment.get("longitudinal_trend") or {}
    start = parse_month(trend_config.get("start"), "longitudinal_trend.start")
    end = parse_month(trend_config.get("end"), "longitudinal_trend.end")
    if start > end:
        raise DemoBuildError("longitudinal_trend.start 不能晚于 end")

    roles = map_config.get("roles") or {}
    time_field, amount_field = roles.get("time"), roles.get("amount")
    if not time_field or not amount_field:
        raise DemoBuildError("map.roles.time/amount 为演示趋势复算必填项")

    totals: dict[tuple[int, int], float] = defaultdict(float)
    try:
        with SOURCE_PATH.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            if time_field not in (reader.fieldnames or []) or amount_field not in (reader.fieldnames or []):
                raise DemoBuildError(f"源表缺少趋势字段: {time_field}/{amount_field}")
            for row_number, row in enumerate(reader, start=2):
                try:
                    stamp = date.fromisoformat(str(row[time_field])[:10])
                    amount = float(row[amount_field])
                except (TypeError, ValueError) as exc:
                    raise DemoBuildError(f"源表第 {row_number} 行无法复算趋势") from exc
                key = (stamp.year, stamp.month)
                if start <= key <= end:
                    totals[key] += amount
    except OSError as exc:
        raise DemoBuildError(f"读取演示 CSV 失败: {exc}") from exc

    expected = []
    cursor = start
    while cursor <= end:
        expected.append(cursor)
        cursor = (cursor[0] + 1, 1) if cursor[1] == 12 else (cursor[0], cursor[1] + 1)
    missing = [f"{year:04d}-{month:02d}" for year, month in expected if (year, month) not in totals]
    if missing:
        raise DemoBuildError(f"历史趋势窗口存在缺月: {', '.join(missing)}")

    output: dict[str, list[float | None]] = {}
    for year in range(start[0], end[0] + 1):
        output[str(year)] = [
            round(totals[(year, month)] / 10_000, 1) if start <= (year, month) <= end else None
            for month in range(1, 13)
        ]
    return output


def find_named(rows: list[dict[str, Any]], name: str, context: str) -> dict[str, Any]:
    matches = [row for row in rows if row.get("name") == name]
    if len(matches) != 1:
        raise DemoBuildError(f"{context} 期待唯一 {name!r}，实际 {len(matches)} 条")
    return matches[0]


def build_report_evidence(metrics: dict[str, Any], insights: dict[str, Any], enrichment: dict[str, Any]) -> dict[str, Any]:
    lock = metrics["meta"]["period_lock"]
    end = date.fromisoformat(lock["end"])
    trend_test = insights.get("trend_test") or {}
    mk = trend_test.get("mann_kendall") or {}
    anomalies = insights.get("anomaly_months") or []
    if not mk.get("significant") or len(anomalies) != 1:
        raise DemoBuildError("演示叙事合同要求趋势显著且恰有一个异常月")

    scans = insights.get("dimension_scan") or {}
    region_contributions = scans.get("战区", {}).get("contributions") or []
    category_contributions = scans.get("品类", {}).get("contributions") or []
    share_shifts: dict[str, float] = {}
    base_shares: dict[str, float] = {}
    total_base_wan = metrics["period"]["total_base_wan"]
    for rows in (metrics.get("dimensions") or {}).values():
        for item in rows:
            base_share = round(item["amount_base_wan"] / total_base_wan * 100, 1)
            base_shares[item["name"]] = base_share
            # insights 只列出越过阈值的位移；证据层从基础 metrics 复算全量位移。
            share_shifts[item["name"]] = round(item["share"] - base_share, 1)

    region_map = {item["name"]: item for item in region_contributions}
    if set(region_map) != {"北区", "西区", "东区", "南区", "中区"}:
        raise DemoBuildError("演示战区成员发生变化，需先人工审阅叙事")
    entry = find_named(category_contributions, "入门系列", "品类贡献")
    anomaly = anomalies[0]
    period = metrics["period"]
    contract = enrichment.get("evidence_contract") or {}

    keyed_dimensions = {
        dim: {row["name"]: row for row in rows}
        for dim, rows in (metrics.get("dimensions") or {}).items()
    }
    total_yoy = period["total_yoy"]
    return {
        "period": {
            "current_year": date.fromisoformat(lock["start"]).year,
            "base_year": date.fromisoformat(lock["base_start"]).year,
            "start_month": date.fromisoformat(lock["start"]).month,
            "end_month": end.month,
            "first_missing_month": end.month + 1 if end.month < 12 else None,
        },
        "trend": {
            "comparable_months": mk["n"],
            "mann_kendall_z": mk["z"],
            "p_threshold": contract["p_threshold"],
            "trailing_negative_months": insights["trailing_negative_yoy_months"],
            "anomaly_month": int(anomaly["month"].split("-")[1]),
            "anomaly_yoy": anomaly["yoy"],
            "anomaly_robust_z": anomaly["robust_z"],
        },
        "income_gap_wan": round(abs(period["total_cur_wan"] - period["total_base_wan"]), 1),
        "magnitude": {
            "total_yoy": abs(total_yoy),
            "qty_yoy": abs(period["qty_yoy"]),
            "south_contribution_pp": abs(region_map["南区"]["contribution_pp"]),
            "entry_contribution_pp": abs(entry["contribution_pp"]),
        },
        "contribution_pp": {
            **{name: region_map[name]["contribution_pp"] for name in ("北区", "西区", "东区", "南区", "中区")},
            "合计": total_yoy,
            "入门系列": entry["contribution_pp"],
        },
        "share_shift_pp": share_shifts,
        "base_share_pct": {
            name: base_shares[name]
            for name in ("主力系列", "旗舰系列", "入门系列")
        },
        "decline_wan": {"南区": abs(region_map["南区"]["delta_wan"])},
        "concentration_threshold": contract["concentration_threshold"],
        "share_total": contract["share_total"],
        "top_n": contract["top_n"],
        "dimensions": keyed_dimensions,
    }


def normalized_quality(path: Path) -> bytes:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"\A# 数据质量报告 — .*", "# 数据质量报告 — metrics.json", text, count=1)
    return text.encode("utf-8")


def normalized_insights_md(path: Path) -> bytes:
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"\A# 统计洞察摘要 — .*", "# 统计洞察摘要 — insights.json", text, count=1)
    return text.encode("utf-8")


def render_html(temp_dir: Path, metrics_path: Path, insights_path: Path) -> dict[str, bytes]:
    rendered: dict[str, bytes] = {}
    for filename, density in HTML_DENSITY_BY_FILE.items():
        output_path = temp_dir / filename
        run([
            "node",
            str(ROOT / "scripts/render-report.mjs"),
            "--metrics",
            str(metrics_path),
            "--insights",
            str(insights_path),
            "--spec",
            str(REPORT_SPEC_PATH),
            "--out",
            str(output_path),
            "--density",
            density,
        ])
        rendered[filename] = output_path.read_bytes()
    return rendered


def generate(temp_dir: Path, *, include_offline: bool) -> dict[str, bytes]:
    map_config = load_json(MAP_PATH)
    enrichment = load_json(ENRICHMENT_PATH)
    if enrichment.get("schema_version") != "1.0":
        raise DemoBuildError("enrichment.schema_version 必须为 1.0")
    source_contract = enrichment.get("source_contract") or {}
    if source_contract.get("path") != SOURCE_PATH.name:
        raise DemoBuildError("enrichment.source_contract.path 必须指向 demo_sales.csv")
    html_source_path = source_contract.get("html_path")
    if not html_source_path or (ROOT / html_source_path).resolve() != SOURCE_PATH.resolve():
        raise DemoBuildError("enrichment.source_contract.html_path 必须是从项目根开始的 demo_sales.csv 路径")
    source_sha = sha256_file(SOURCE_PATH)
    if source_sha != source_contract.get("sha256"):
        raise DemoBuildError(
            "演示源表指纹与 enrichment 合同不一致；"
            f"期望 {source_contract.get('sha256')}，实际 {source_sha}"
        )
    map_source = (map_config.get("source") or {}).get("path")
    if map_source != SOURCE_PATH.name:
        raise DemoBuildError("map.source.path 必须是相对 map 的 demo_sales.csv")

    metrics_path = temp_dir / "metrics.json"
    insights_path = temp_dir / "insights.json"
    run([sys.executable, "-B", str(ROOT / "scripts/prep-source.py"), "build", "--map", str(MAP_PATH), "--out", str(metrics_path)])
    metrics = load_json(metrics_path)
    if (metrics.get("data_status") or {}).get("status") == "BLOCKED":
        raise DemoBuildError("基础 metrics 为 BLOCKED，拒绝增强与生成报告")
    # Demo 交付以项目根为用户可见基准，避免 HTML 中出现模糊的相对路径。
    metrics["meta"]["source_path"] = html_source_path
    metrics["trend"] = monthly_trend(map_config, enrichment)
    metrics["meta"]["demo_build"] = {
        "builder": "scripts/build-demo.py",
        "map": MAP_PATH.name,
        "map_sha256": sha256_file(MAP_PATH),
        "enrichment": ENRICHMENT_PATH.name,
        "enrichment_sha256": sha256_file(ENRICHMENT_PATH),
        "report_spec": REPORT_SPEC_PATH.name,
        "report_spec_sha256": sha256_file(REPORT_SPEC_PATH),
        "source_contract_verified": True,
        "synthetic_source": bool(source_contract.get("synthetic")),
        "longitudinal_trend": enrichment["longitudinal_trend"],
    }
    metrics_path.write_text(dump_json(metrics), encoding="utf-8")
    demo_policy = ["--hhi-medium", ".10", "--hhi-high", ".18",
                   "--top5-medium", "30", "--top5-high", "45"]
    run([sys.executable, "-B", str(ROOT / "scripts/stat-insights.py"), str(metrics_path),
         "--out", str(insights_path), *demo_policy])
    insights = load_json(insights_path)
    metrics["report_evidence"] = build_report_evidence(metrics, insights, enrichment)
    metrics["report_actions"] = enrichment["report_actions"]
    metrics_payload = dump_json(metrics).encode("utf-8")
    metrics_path.write_bytes(metrics_payload)
    # 用最终 metrics 再跑一次，确保 insights 与仓内交付文件是直接输入/输出关系。
    run([sys.executable, "-B", str(ROOT / "scripts/stat-insights.py"), str(metrics_path),
         "--out", str(insights_path), *demo_policy])

    artifacts: dict[str, bytes] = {
        "metrics.json": metrics_payload,
        "metrics.quality.md": normalized_quality(temp_dir / "metrics.quality.md"),
        "insights.json": insights_path.read_bytes(),
        "insights.md": normalized_insights_md(temp_dir / "insights.md"),
    }
    artifacts.update(render_html(temp_dir, metrics_path, insights_path))
    if include_offline:
        for source_name, offline_name in OFFLINE_HTML_BY_SOURCE.items():
            source_path = temp_dir / source_name
            offline_path = temp_dir / offline_name
            source_path.write_bytes(artifacts[source_name])
            run([
                "node",
                str(ROOT / "scripts/make-offline.mjs"),
                str(source_path),
                "--out",
                str(offline_path),
            ])
            artifacts[offline_name] = offline_path.read_bytes()
    return artifacts


def verify_offline_provenance(artifacts: dict[str, bytes]) -> list[str]:
    mismatches: list[str] = []
    for source_name, offline_name in OFFLINE_HTML_BY_SOURCE.items():
        offline_path = DEMO / offline_name
        if not offline_path.exists():
            mismatches.append(f"{offline_name}(缺失)")
            continue
        text = offline_path.read_text(encoding="utf-8")
        matches = OFFLINE_SOURCE_RE.findall(text)
        expected = sha256_bytes(artifacts[source_name])
        if matches != [expected]:
            mismatches.append(f"{offline_name}(在线真源指纹不一致)")
    return mismatches


def main() -> int:
    parser = argparse.ArgumentParser(description="重建/检查 demo-report 可复现产物")
    parser.add_argument("--check", action="store_true", help="只重建到临时目录并比对，不修改仓库")
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix="south-china-report-demo-") as temp:
            artifacts = generate(Path(temp), include_offline=not args.check)
        if args.check:
            mismatches = []
            for filename, expected in artifacts.items():
                actual_path = DEMO / filename
                if not actual_path.exists() or actual_path.read_bytes() != expected:
                    mismatches.append(filename)
            mismatches.extend(verify_offline_provenance(artifacts))
            if mismatches:
                raise DemoBuildError("仓内演示产物已漂移: " + ", ".join(mismatches) + "；请运行 npm run build:demo")
            print(
                "[OK] demo 可复现性: 数据与 Renderer 在线产物逐字节一致，"
                "两份离线版均匹配当前 Renderer 真源指纹"
            )
            return 0
        for filename, payload in artifacts.items():
            atomic_write(DEMO / filename, payload)
        print(f"[OK] demo 已重建: {len(artifacts)} 份数据/HTML 产物")
        return 0
    except DemoBuildError as exc:
        print(f"[REFUSED] {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
