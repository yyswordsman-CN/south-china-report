import argparse
import hashlib
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]


def load_script(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PREP = load_script("prep_source", ROOT / "scripts" / "prep-source.py")
STATS = load_script("stat_insights", ROOT / "scripts" / "stat-insights.py")


class DataPipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_csv(self, rows):
        path = self.work / "sales.csv"
        header = "date,zone,channel,product,customer,amount,qty,target\n"
        path.write_text(header + "\n".join(",".join(map(str, row)) for row in rows) + "\n", encoding="utf-8")
        return path

    def mapping(self, source, period="2025Q4", **caliber):
        try:
            lock = PREP.parse_period_spec(period)
            data_as_of = str(lock["end"].date())
            comparison_as_of = str(lock["base_end"].date())
        except (TypeError, ValueError):
            data_as_of = "2025-12-31"
            comparison_as_of = "2024-12-31"
        config = {"period": period, "data_as_of": data_as_of,
                  "comparison_as_of": comparison_as_of,
                  "target_measure": "amount", **caliber}
        return {
            "source": {"path": str(source)},
            "roles": {"time": "date", "amount": "amount", "qty": "qty",
                      "dimensions": ["zone", "channel"], "customer": "customer",
                      "product": "product", "target": "target", "id": None},
            "caliber": config,
        }

    def run_build(self, mapping, expect_exit=None):
        map_path = self.work / "map.json"; out = self.work / "metrics.json"
        map_path.write_text(json.dumps(mapping), encoding="utf-8")
        args = argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                  map=str(map_path), out=str(out))
        if expect_exit is None:
            PREP.build(args)
        else:
            with self.assertRaises(SystemExit) as caught:
                PREP.build(args)
            self.assertEqual(caught.exception.code, expect_exit)
        return json.loads(out.read_text(encoding="utf-8"))

    def test_period_parser_covers_month_xun_quarter_half_year_and_custom(self):
        cases = {
            "2025-12": ("2025-12-01", "2025-12-31", "month"),
            "2025年12月": ("2025-12-01", "2025-12-31", "month"),
            "2025-12上旬": ("2025-12-01", "2025-12-10", "xun"),
            "2025-12-X2": ("2025-12-11", "2025-12-20", "xun"),
            "2025Q4": ("2025-10-01", "2025-12-31", "quarter"),
            "2025年第四季度": ("2025-10-01", "2025-12-31", "quarter"),
            "2025H1": ("2025-01-01", "2025-06-30", "half"),
            "2025H2": ("2025-07-01", "2025-12-31", "half"),
            "2025下半年": ("2025-07-01", "2025-12-31", "half"),
            "2025全年": ("2025-01-01", "2025-12-31", "year"),
            "2025-10-01..2025-12-31": ("2025-10-01", "2025-12-31", "custom"),
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                result = PREP.parse_period_spec(value)
                self.assertEqual((str(result["start"].date()), str(result["end"].date()), result["granularity"]), expected)
        custom = PREP.parse_period_spec({"start": "2025-02-03", "end": "2025-03-07"})
        self.assertEqual((str(custom["start"].date()), str(custom["end"].date())),
                         ("2025-02-03", "2025-03-07"))

    def test_locked_quarter_drives_totals_dimensions_target_and_products(self):
        source = self.write_csv([
            ("2024-01-05", "outside", "old", "OLD", "c0", 99999, 1, 1),
            ("2024-01-06", "outside-2", "old-2", "OLD2", "c0", 99999, 1, 1),
            ("2024-01-07", "outside-3", "old-3", "OLD3", "c0", 99999, 1, 1),
            ("2024-10-05", "north", "online", "A", "c1", 80, 1, 250),
            ("2024-11-05", "north", "online", "B", "c2", 120, 1, 250),
            ("2024-12-05", "south", "retail", "A", "c3", 100, 1, 250),
            ("2025-01-05", "outside-new", "new", "NEW", "c0", 88888, 1, 1),
            ("2025-01-06", "outside-new-2", "new-2", "NEW2", "c0", 88888, 1, 1),
            ("2025-01-07", "outside-new-3", "new-3", "NEW3", "c0", 88888, 1, 1),
            ("2025-10-05", "north", "online", "A", "c1", 100, 1, 300),
            ("2025-11-05", "north", "online", "B", "c2", 150, 1, 300),
            ("2025-12-05", "south", "retail", "A", "c3", 200, 2, 300),
        ])
        metrics = self.run_build(self.mapping(source, target_aggregation="first_per_group"))
        self.assertEqual(metrics["meta"]["period_lock"]["start"], "2025-10-01")
        self.assertEqual(metrics["total"], 450)
        self.assertEqual(metrics["period"]["total_base_wan"], 0.0)
        self.assertEqual(metrics["period"]["total_yoy"], 50.0)
        self.assertEqual(metrics["target"]["status"], "OK")
        self.assertEqual(metrics["target"]["plan"], 300)
        self.assertEqual(metrics["target"]["achievement_rate"], 150.0)
        self.assertEqual(metrics["target"]["gap"], 150)
        self.assertEqual(metrics["dimensions"]["zone"][0]["amount_cur_wan"], 0.0)
        self.assertEqual(metrics["products"]["ranking"][0]["name"], "A")
        self.assertEqual(metrics["products"]["growth"][0]["delta_wan"], 0.0)
        self.assertNotIn("OLD", [row["name"] for row in metrics["products"]["ranking"]])
        self.assertFalse(any("取值重合" in text for text in metrics["data_status"]["errors"]))

    def test_month_period_excludes_other_months(self):
        source = self.write_csv([
            ("2024-11-05", "n", "o", "A", "c1", 900, 1, ""),
            ("2024-12-05", "n", "o", "A", "c1", 100, 1, ""),
            ("2025-11-05", "n", "o", "A", "c1", 800, 1, ""),
            ("2025-12-05", "n", "o", "A", "c1", 200, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12")
        mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["total"], 200)
        self.assertEqual(metrics["period"]["total_yoy"], 100.0)
        self.assertEqual(metrics["meta"]["current_rows"], 1)
        self.assertEqual(metrics["meta"]["source_path"], source.name)
        self.assertEqual(metrics["meta"]["source_fingerprint_scope"], "source_file_snapshot")
        self.assertEqual(metrics["meta"]["source_sha256"], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertNotIn(str(source.parent), json.dumps(metrics["meta"], ensure_ascii=False))

    def test_xun_period_filters_exact_ten_day_window(self):
        source = self.write_csv([
            ("2024-12-05", "n", "o", "A", "c1", 100, 1, ""),
            ("2024-12-15", "n", "o", "A", "c1", 200, 1, ""),
            ("2024-12-25", "n", "o", "A", "c1", 300, 1, ""),
            ("2025-12-05", "n", "o", "A", "c1", 1000, 1, ""),
            ("2025-12-15", "n", "o", "A", "c1", 400, 1, ""),
            ("2025-12-25", "n", "o", "A", "c1", 3000, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12中旬"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["total"], 400)
        self.assertEqual(metrics["period"]["total_base"], 200)
        self.assertEqual(metrics["period"]["total_yoy"], 100.0)
        self.assertEqual(metrics["meta"]["period_lock"]["granularity"], "xun")

    def test_repeated_target_auto_mode_is_locally_blocked(self):
        source = self.write_csv([
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, 500),
            ("2025-12-02", "s", "r", "B", "c2", 200, 1, 500),
        ])
        metrics = self.run_build(self.mapping(source, period="2025-12"))
        self.assertEqual(metrics["target"]["status"], "BLOCKED")
        self.assertIsNone(metrics["target"]["achievement_rate"])
        self.assertIn("auto 无法判断", metrics["target"]["_caveat"])

    def test_distinct_multirow_targets_also_require_explicit_aggregation(self):
        source = self.write_csv([
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, 100),
            ("2025-12-02", "s", "r", "B", "c2", 120, 1, 120),
        ])
        metrics = self.run_build(self.mapping(source, period="2025-12"))
        self.assertEqual(metrics["target"]["status"], "BLOCKED")
        self.assertIsNone(metrics["target"]["plan"])
        self.assertIn("多行", metrics["target"]["_caveat"])

    def test_target_parse_error_below_threshold_is_disclosed(self):
        rows = [
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, "bad"),
            ("2025-12-02", "s", "r", "B", "c2", 100, 1, 100),
        ] + [(f"2025-12-{day:02d}", "s", "r", f"P{day}", f"c{day}", 10, 1, day)
             for day in range(3, 23)]
        source = self.write_csv(rows)
        mapping = self.mapping(source, period="2025-12", target_aggregation="sum")
        mapping["thresholds"] = {"target_parse_block_pct": 5}
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["target"]["status"], "OK")
        self.assertIn("无法解析", metrics["target"]["_caveat"])
        self.assertTrue(any("目标列在锁定当期" in item for item in metrics["data_status"]["warnings"]))

    def test_target_measure_is_required_and_qty_target_uses_qty_actual(self):
        source = self.write_csv([("2025-12-01", "n", "o", "A", "c1", 100000, 10, 20)])
        missing = self.mapping(source, period="2025-12", target_aggregation="sum")
        missing["caliber"].pop("target_measure")
        blocked = self.run_build(missing)
        self.assertEqual(blocked["target"]["status"], "BLOCKED")
        self.assertIn("target_measure", blocked["target"]["_caveat"])

        quantity = self.mapping(source, period="2025-12", target_aggregation="sum", target_measure="qty")
        metrics = self.run_build(quantity)
        self.assertEqual(metrics["target"]["measure"], "qty")
        self.assertEqual(metrics["target"]["actual"], 10)
        self.assertEqual(metrics["target"]["plan"], 20)
        self.assertEqual(metrics["target"]["achievement_rate"], 50.0)
        self.assertIsNone(metrics["target"]["actual_wan"])

    def test_quarter_target_frequency_deduplicates_each_grain_once(self):
        source = self.write_csv([
            ("2025-10-01", "n", "o", "A", "c1", 100, 1, 300),
            ("2025-11-01", "n", "o", "A", "c1", 100, 1, 300),
            ("2025-10-02", "s", "r", "B", "c2", 200, 1, 300),
            ("2025-12-02", "s", "r", "B", "c2", 200, 1, 300),
        ])
        mapping = self.mapping(source, period="2025Q4", target_aggregation="first_per_group",
                               target_grain=["zone"], target_frequency="quarter")
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["target"]["status"], "OK")
        self.assertEqual(metrics["target"]["plan"], 600)
        self.assertEqual(metrics["target"]["achievement_rate"], 100.0)

    def test_material_exact_duplicate_blocks_without_id_role(self):
        row = ("2025-12-01", "n", "o", "A", "c1", 100, 1, "")
        source = self.write_csv([row, row])
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertTrue(any("完全重复行在锁定可比范围" in text for text in metrics["data_status"]["errors"]))
        self.assertEqual(metrics["meta"]["quality"]["duplicates"]["row_pct"], 50.0)

    def test_low_materiality_exact_duplicate_only_warns(self):
        rows = [(f"2025-12-{day:02d}", "n", "o", f"P{day}", f"c{day}", 1000, 1, "")
                for day in range(1, 22)]
        tiny = ("2025-12-22", "n", "o", "tiny", "tiny", 1, 1, "")
        source = self.write_csv(rows + [tiny, tiny])
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["data_status"]["status"], "WARN")
        self.assertLess(metrics["meta"]["quality"]["duplicates"]["row_pct"], 5)
        self.assertLess(metrics["meta"]["quality"]["duplicates"]["amount_pct"], 5)

    def test_amount_blank_materiality_blocks(self):
        rows = [(f"2025-12-{day:02d}", "n", "o", "A", f"c{day}", "", 1, "")
                for day in range(1, 10)]
        rows.append(("2025-12-10", "n", "o", "A", "c10", 100, 1, ""))
        source = self.write_csv(rows)
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertEqual(metrics["meta"]["quality"]["amount"]["blank_pct"], 90.0)
        self.assertTrue(any("主指标[amount]在分析范围" in text for text in metrics["data_status"]["errors"]))

    def test_period_specific_amount_blanks_cannot_be_diluted_by_other_period(self):
        rows = [("2025-12-01", "n", "o", "A", f"current-{index}", "" if index < 9 else 100, 1, "")
                for index in range(10)]
        rows.extend(("2024-12-01", "n", "o", "A", f"base-{index}", 100, 1, "")
                    for index in range(200))
        source = self.write_csv(rows)
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        amount_quality = metrics["meta"]["quality"]["amount"]
        self.assertLess(amount_quality["blank_pct"], 5)
        self.assertEqual(amount_quality["periods"]["current"]["blank_pct"], 90.0)
        self.assertTrue(any("单期越线" in text for text in metrics["data_status"]["errors"]))

    def test_period_specific_duplicates_cannot_be_diluted_by_other_period(self):
        duplicate = ("2025-12-01", "n", "o", "A", "current", 100, 1, "")
        rows = [duplicate, duplicate]
        rows.extend(("2024-12-01", "n", "o", "A", f"base-{index}", 100, 1, "")
                    for index in range(200))
        source = self.write_csv(rows)
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        duplicate_quality = metrics["meta"]["quality"]["duplicates"]
        self.assertLess(duplicate_quality["row_pct"], 5)
        self.assertEqual(duplicate_quality["periods"]["current"]["row_pct"], 50.0)
        self.assertTrue(any("单期越线" in text for text in metrics["data_status"]["errors"]))

    def test_partial_period_uses_same_cutoff_instead_of_full_base(self):
        source = self.write_csv([
            ("2024-12-01", "n", "o", "A", "c1", 1000, 1, ""),
            ("2024-12-31", "n", "o", "A", "c2", 1000, 1, ""),
            ("2025-12-01", "n", "o", "A", "c1", 1000, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12", data_as_of="2025-12-15",
                               comparison_as_of="2024-12-15")
        mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["period"]["total_base"], 1000)
        self.assertEqual(metrics["period"]["total_yoy"], 0.0)
        self.assertEqual(metrics["meta"]["period_lock"]["end"], "2025-12-15")
        self.assertEqual(metrics["meta"]["period_lock"]["base_end"], "2024-12-15")
        self.assertEqual(metrics["meta"]["period_lock"]["completeness"], "partial_same_cutoff")

    def test_missing_or_short_comparison_cutoff_blocks(self):
        source = self.write_csv([
            ("2024-12-01", "n", "o", "A", "c1", 100, 1, ""),
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, ""),
        ])
        missing = self.mapping(source, period="2025-12")
        missing["roles"]["target"] = None
        missing["caliber"].pop("data_as_of")
        blocked = self.run_build(missing, expect_exit=2)
        self.assertTrue(any("data_as_of" in text for text in blocked["data_status"]["errors"]))

        short = self.mapping(source, period="2025-12", data_as_of="2025-12-15",
                             comparison_as_of="2024-12-01")
        short["roles"]["target"] = None
        blocked = self.run_build(short, expect_exit=2)
        self.assertTrue(any("未覆盖基线截止日" in text for text in blocked["data_status"]["errors"]))

        malformed = self.mapping(source, period="2025-12", data_as_of="2025/12/15",
                                 comparison_as_of="2024-12-15")
        malformed["roles"]["target"] = None
        blocked = self.run_build(malformed, expect_exit=2)
        self.assertTrue(any("严格使用 YYYY-MM-DD" in text for text in blocked["data_status"]["errors"]))

    def test_expected_observation_completeness_blocks(self):
        source = self.write_csv([
            ("2024-12-01", "n", "o", "A", "c1", 100, 1, ""),
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12",
                               expected_observations={"mode": "distinct_dates", "current": 10, "base": 10})
        mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertEqual(metrics["meta"]["quality"]["observations"]["current"]["completeness_pct"], 10.0)

    def test_bad_time_over_threshold_blocks(self):
        source = self.write_csv([
            ("bad-date", "n", "o", "A", "c1", 100, 1, ""),
            ("2025-12-01", "n", "o", "A", "c1", 100, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertEqual(metrics["data_status"]["status"], "BLOCKED")
        self.assertTrue(any("时间列" in text for text in metrics["data_status"]["errors"]))

    def test_unconfirmed_inferred_period_blocks_by_default(self):
        source = self.write_csv([("2025-12-01", "n", "o", "A", "c1", 100, 1, "")])
        mapping = self.mapping(source, period="填写, 如 2026H1"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertTrue(metrics["meta"]["period_lock"]["inferred"])
        self.assertTrue(any("未明确填写" in text for text in metrics["data_status"]["errors"]))

    def test_missing_time_defaults_to_snapshot_and_skips_trend(self):
        source = self.write_csv([("2025-12-01", "n", "o", "A", "c1", 100, 1, "")])
        mapping = self.mapping(source, period=None)
        mapping["roles"]["time"] = None
        mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertNotIn("period_lock", metrics["meta"])
        self.assertEqual(metrics["total"], 100)
        self.assertEqual(metrics["analysis_scope"]["mode"], "snapshot")
        self.assertEqual(metrics["method_applicability"]["mk_trend"]["status"], "SKIPPED")

    def test_timezone_dates_block_without_business_timezone_and_pass_when_configured(self):
        source = self.write_csv([
            ("2025-01-01T00:00:00+08:00", "n", "o", "A", "c1", 100, 1, ""),
            ("2025-01-02T00:00:00Z", "s", "r", "B", "c2", 200, 1, ""),
        ])
        missing = self.mapping(source, period="2025-01"); missing["roles"]["target"] = None
        blocked = self.run_build(missing, expect_exit=2)
        self.assertIsNone(blocked["total"])
        self.assertTrue(any("caliber.timezone" in item for item in blocked["data_status"]["errors"]))

        configured = self.mapping(source, period="2025-01", timezone="Asia/Shanghai")
        configured["roles"]["target"] = None
        metrics = self.run_build(configured)
        self.assertEqual(metrics["total"], 300)
        self.assertEqual(metrics["meta"]["current_rows"], 2)

    def test_negative_dimension_part_suppresses_share(self):
        source = self.write_csv([
            ("2025-12-01", "n", "o", "A", "c1", 200, 1, ""),
            ("2025-12-02", "s", "r", "B", "c2", -50, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertTrue(all(row["share"] is None for row in metrics["dimensions"]["zone"]))
        self.assertTrue(any("负数主指标分项" in text for text in metrics["data_status"]["warnings"]))

    def test_profile_refuses_overwrite_without_force(self):
        source = self.write_csv([("2025-12-01", "n", "o", "A", "c1", 100, 1, "")])
        out_map = self.work / "draft.json"
        cmd = [sys.executable, str(ROOT / "scripts" / "prep-source.py"), "profile", str(source),
               "--out-map", str(out_map)]
        first = subprocess.run(cmd, text=True, capture_output=True)
        second = subprocess.run(cmd, text=True, capture_output=True)
        forced = subprocess.run(cmd + ["--force"], text=True, capture_output=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertNotEqual(second.returncode, 0)
        self.assertIn("已存在", second.stderr + second.stdout)
        self.assertEqual(forced.returncode, 0, forced.stderr)

    def test_profile_promotes_volume_to_primary_measure_without_amount(self):
        source = self.work / "volume-only.csv"
        source.write_text("日期,区域,销量\n2025-12-01,南区,10\n", encoding="utf-8")
        out_map = self.work / "volume-map.json"
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "prep-source.py"),
                                 "profile", str(source), "--out-map", str(out_map)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        draft = json.loads(out_map.read_text(encoding="utf-8"))
        self.assertIsNone(draft["roles"]["amount"])
        self.assertEqual(draft["roles"]["qty"], "销量")
        self.assertEqual(draft["roles"]["measures"][0]["field"], "销量")
        self.assertTrue(draft["roles"]["measures"][0]["primary"])
        self.assertNotIn("[BLOCKED] 未识别到金额", result.stdout)

    def test_profile_hides_samples_and_sql_text_by_default(self):
        source = self.work / "sensitive.csv"
        source.write_text("日期,客户,销售额\n2025-12-01,SECRET-CUSTOMER,100\n", encoding="utf-8")
        hidden_map = self.work / "hidden.json"
        hidden = subprocess.run([sys.executable, str(ROOT / "scripts" / "prep-source.py"), "profile",
                                 str(source), "--out-map", str(hidden_map)], text=True, capture_output=True)
        shown = subprocess.run([sys.executable, str(ROOT / "scripts" / "prep-source.py"), "profile",
                                str(source), "--out-map", str(self.work / "shown.json"), "--show-samples"],
                               text=True, capture_output=True)
        self.assertEqual(hidden.returncode, 0, hidden.stderr)
        self.assertNotIn("SECRET-CUSTOMER", hidden.stdout)
        self.assertIn("SECRET-CUSTOMER", shown.stdout)

        sql_text = "SELECT 1 AS amount /* SECRET-SQL */"
        sql_run = subprocess.run([sys.executable, str(ROOT / "scripts" / "prep-source.py"), "profile",
                                  "--sql", sql_text, "--out-map", str(self.work / "sql.json")],
                                 text=True, capture_output=True)
        self.assertEqual(sql_run.returncode, 0, sql_run.stderr)
        self.assertNotIn("SECRET-SQL", sql_run.stdout)
        self.assertIn("SQL query sha256=", sql_run.stdout)

    def test_build_blocks_when_amount_and_qty_are_same_column(self):
        source = self.write_csv([("2025-12-01", "n", "o", "A", "c1", 100, 1, "")])
        mapping = self.mapping(source, period="2025-12")
        mapping["roles"]["qty"] = "amount"
        mapping["roles"]["target"] = None
        metrics = self.run_build(mapping, expect_exit=2)
        self.assertTrue(any("amount 与 qty" in item for item in metrics["data_status"]["errors"]))

    def test_cli_data_keeps_map_sheet_selector(self):
        source = self.work / "two-sheets.xlsx"
        first = pd.DataFrame([{"date": "2025-12-01", "amount": 100, "qty": 1}])
        second = pd.DataFrame([{"date": "2025-12-01", "amount": 200, "qty": 2}])
        with pd.ExcelWriter(source, engine="openpyxl") as writer:
            first.to_excel(writer, sheet_name="Sheet1", index=False)
            second.to_excel(writer, sheet_name="Sheet2", index=False)
        mapping = {
            "source": {"path": str(source), "sheet": "Sheet2"},
            "roles": {"time": "date", "amount": "amount", "qty": "qty", "dimensions": [],
                      "customer": None, "product": None, "target": None, "id": None},
            "caliber": {"period": "2025-12"},
        }
        mapping["caliber"].update({"data_as_of": "2025-12-31", "comparison_as_of": "2024-12-31"})
        map_path = self.work / "sheet-map.json"; out = self.work / "sheet-metrics.json"
        map_path.write_text(json.dumps(mapping), encoding="utf-8")
        args = argparse.Namespace(data=str(source), sheet=None, sqlite=None, table=None, sql=None,
                                  map=str(map_path), out=str(out))
        PREP.build(args)
        metrics = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(metrics["total"], 200)
        self.assertEqual(metrics["meta"]["source_selector"], "Sheet2")
        self.assertEqual(metrics["meta"]["source_origin"], "cli+map")

    def test_missing_map_relative_source_never_falls_back_to_cwd(self):
        map_dir = self.work / "mapdir"; cwd_dir = self.work / "cwddir"
        map_dir.mkdir(); cwd_dir.mkdir()
        (cwd_dir / "sales.csv").write_text("date,amount\n2025-12-01,999999\n", encoding="utf-8")
        map_path = map_dir / "map.json"
        mapping = {"source": {"path": "sales.csv"}, "roles": {"amount": "amount"},
                   "caliber": {"period": "2025-12"}}
        map_path.write_text(json.dumps(mapping), encoding="utf-8")
        args = argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                  map=str(map_path), out=str(self.work / "never.json"))
        previous = Path.cwd()
        try:
            os.chdir(cwd_dir)
            with self.assertRaises(SystemExit) as caught:
                PREP._resolve_build_source(args, mapping)
        finally:
            os.chdir(previous)
        self.assertIn("相对 map 目录解析", str(caught.exception))

    def test_duckdb_path_and_table_identifiers_are_safely_quoted(self):
        db_path = self.work / "sales'quoted.duckdb"
        con = PREP.duckdb.connect(str(db_path))
        con.execute('CREATE TABLE "order-lines" (amount INTEGER)')
        con.execute('INSERT INTO "order-lines" VALUES (7)')
        con.close()
        args = argparse.Namespace(data=str(db_path), sql=None, sqlite=None, table="order-lines", sheet=None)
        loaded = PREP.load(args)
        self.assertEqual(loaded["amount"].tolist(), [7])

    def test_sqlite_loader_handles_quoted_path_and_table_without_install(self):
        db_path = self.work / "sales'quoted.sqlite"
        con = sqlite3.connect(db_path)
        con.execute('CREATE TABLE "order-lines" (amount INTEGER)')
        con.execute('INSERT INTO "order-lines" VALUES (9)')
        con.commit(); con.close()
        args = argparse.Namespace(data=str(db_path), sql=None, sqlite=None, table="order-lines", sheet=None)
        loaded = PREP.load(args)
        self.assertEqual(loaded["amount"].tolist(), [9])

    def test_inline_sql_trace_hashes_query_without_embedding_text(self):
        trace = PREP._source_trace(argparse.Namespace(sql="SELECT secret_column FROM private_table",
                                                      data=None, sqlite=None, sheet=None, table=None))
        self.assertEqual(trace["kind"], "inline-sql")
        self.assertEqual(trace["fingerprint_scope"], "query_text_only")
        self.assertEqual(len(trace["sha256"]), 64)
        self.assertNotIn("private_table", json.dumps(trace))

    def test_trailing_negative_run_requires_calendar_adjacency(self):
        self.assertEqual(STATS.trailing_negative_run([("2025-01", -1), ("2025-03", -2)]), 1)
        self.assertEqual(STATS.trailing_negative_run([("2024-12", -1), ("2025-01", -2), ("2025-02", -3)]), 3)

    def test_yoy_series_skips_nonpositive_base_and_negative_current(self):
        trend = {"2024": [-1, 10, 10] + [None] * 9, "2025": [1, -1, 20] + [None] * 9}
        self.assertEqual(STATS.yoy_series(trend), [("2025-03", 100.0)])

    def test_low_customer_coverage_blocks_concentration_risk(self):
        source = self.write_csv([
            ("2025-12-01", "n", "o", "A", "known", 10, 1, ""),
            ("2025-12-02", "n", "o", "A", "", 90, 1, ""),
        ])
        mapping = self.mapping(source, period="2025-12"); mapping["roles"]["target"] = None
        metrics = self.run_build(mapping)
        self.assertEqual(metrics["concentration"]["status"], "BLOCKED")
        self.assertEqual(metrics["concentration"]["customer_coverage"], 10.0)
        self.assertEqual(metrics["concentration"]["top5_share"], 10.0)
        self.assertIn("覆盖不足", metrics["concentration"]["_caveat"])

    def test_pvm_caveat_blocks_strong_quadrant_problem(self):
        metrics_path = self.work / "metrics.json"; out = self.work / "insights.json"
        metrics_path.write_text(json.dumps({
            "schema_version": "1.0", "meta": {"period_lock": {"label": "2025"}},
            "data_status": {"status": "WARN"},
            "period": {"total_cur_wan": 80, "total_base_wan": 100, "qty_yoy": -10,
                       "price_yoy": -10, "pvm": {"status": "BLOCKED", "vol_wan": -10,
                       "price_mix_wan": -10, "_caveat": "数量坏值率过高"}},
            "dimensions": {}
        }), encoding="utf-8")
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "stat-insights.py"),
                                 str(metrics_path), "--out", str(out)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        insights = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(insights["schema_version"], "1.0")
        self.assertEqual(insights["meta"]["metrics_sha256"], hashlib.sha256(metrics_path.read_bytes()).hexdigest())
        self.assertEqual(insights["pvm_quadrant"]["status"], "BLOCKED")
        self.assertFalse(any(item["type"] == "量价双杀" for item in insights["problem_list"]))

    def test_hhi_and_top5_thresholds_are_configurable(self):
        metrics_path = self.work / "metrics.json"; out = self.work / "insights.json"
        metrics_path.write_text(json.dumps({
            "schema_version": "1.0", "meta": {"period_lock": {"label": "2025"}},
            "data_status": {"status": "OK"},
            "period": {"total_cur_wan": 100, "total_base_wan": 100},
            "dimensions": {"zone": [{"name": "a", "share": 60}, {"name": "b", "share": 40}]},
            "concentration": {"top5_share": 50, "pareto_n80": 8}
        }), encoding="utf-8")
        result = subprocess.run([
            sys.executable, str(ROOT / "scripts" / "stat-insights.py"), str(metrics_path), "--out", str(out),
            "--hhi-medium", "0.5", "--hhi-high", "0.9", "--top5-medium", "40", "--top5-high", "90"
        ], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        insights = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(insights["dimension_scan"]["zone"]["hhi"]["level"], "中度集中")
        self.assertEqual(insights["concentration_risk"]["level"], "中")

    def test_stat_insights_rejects_missing_or_unknown_metrics_schema(self):
        metrics_path = self.work / "wrong.json"; out = self.work / "never.json"
        metrics_path.write_text("{}", encoding="utf-8")
        result = subprocess.run([sys.executable, str(ROOT / "scripts" / "stat-insights.py"),
                                 str(metrics_path), "--out", str(out)], text=True, capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("status", result.stdout)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
