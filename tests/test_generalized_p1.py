import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "evals" / "fixtures" / "generalized"


def load_script(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PREP = load_script("prep_source_generalized", ROOT / "scripts" / "prep-source.py")


class GeneralizedP1Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def build_fixture(self, name):
        metrics_path = self.work / f"{name}.metrics.json"
        args = argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                  map=str(FIXTURES / f"{name}.map.json"), out=str(metrics_path))
        PREP.build(args)
        insights_path = self.work / f"{name}.insights.json"
        result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts" / "stat-insights.py"),
                                 str(metrics_path), "--out", str(insights_path)],
                                cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        return (json.loads(metrics_path.read_text(encoding="utf-8")),
                json.loads(insights_path.read_text(encoding="utf-8")))

    def test_six_business_fixtures_cover_generic_measures_and_comparisons(self):
        outputs = {name: self.build_fixture(name) for name in
                   ("finance", "people", "inventory", "quality", "service", "survey")}
        for name, (metrics, insights) in outputs.items():
            with self.subTest(name=name):
                self.assertIn(metrics["data_status"]["status"], {"OK", "WARN"})
                self.assertTrue(metrics["semantic_layer"]["measures"])
                self.assertEqual(insights["meta"]["primary_measure"], metrics["semantic_layer"]["primary_measure"])
                source_text = (FIXTURES / f"{name}.csv").read_text(encoding="utf-8").lower()
                combined = json.dumps({"metrics": metrics, "insights": insights}, ensure_ascii=False).lower()
                for forbidden in ("战区", "渠道", "产品", "客户", "销售", "sales", "channel", "product", "customer", "zone"):
                    if forbidden not in source_text:
                        self.assertNotIn(forbidden, combined, f"{name} 注入了输入不存在的默认词 {forbidden}")

        finance, finance_insights = outputs["finance"]
        self.assertEqual(finance["analysis_scope"]["comparison_type"], "year_over_year")
        self.assertIsNone(finance_insights["dimension_scan"]["portfolio"]["hhi"]["level"])
        self.assertEqual(finance_insights["dimension_scan"]["portfolio"]["hhi"]["classification"], "descriptive")

        people, people_insights = outputs["people"]
        self.assertEqual(people["analysis_scope"]["mode"], "snapshot")
        self.assertNotIn("period_lock", people["meta"])
        self.assertEqual(people_insights["method_applicability"]["mann_kendall"]["status"], "SKIPPED")
        self.assertEqual(people["comparisons"][0]["type"], "group")

        inventory, inventory_insights = outputs["inventory"]
        self.assertEqual(len(inventory["measure_dimensions"]["on_hand"]["facility"]), 18)
        self.assertEqual(inventory_insights["method_applicability"]["pareto"]["status"], "SKIPPED")
        self.assertLess(inventory["measure_results"]["on_hand"]["distribution"]["min"], 0)

        quality, _ = outputs["quality"]
        self.assertEqual(quality["analysis_scope"]["comparison_type"], "previous_calendar_period")
        self.assertTrue(quality["measure_results"]["defect_rate"]["favorable"])
        self.assertEqual(quality["method_applicability"]["pvm"]["status"], "SKIPPED")

        service, _ = outputs["service"]
        self.assertEqual(service["analysis_scope"]["comparison_type"], "previous_complete_period")
        self.assertEqual(service["meta"]["period_lock"]["base_start"], "2025-03-01")
        self.assertEqual(service["measure_results"]["resolution_time"]["distribution"]["max"], 9999)
        self.assertEqual(next(item for item in service["comparisons"] if item["type"] == "target")["status"], "OK")

        survey, _ = outputs["survey"]
        self.assertEqual(survey["analysis_scope"]["comparison_type"], "custom")
        self.assertEqual(survey["measure_results"]["response_rate"]["unit"], "percent")
        self.assertLess(next(row for row in survey["measure_dimensions"]["nps"]["segment"]
                             if row["name"].lower() == "new participants")["baseline"], 0)

    def test_schema_required_optional_unit_and_primary_key_drift(self):
        source = self.work / "schema.csv"
        source.write_text("id,value,unit\nA,10,minute\nA,20,minute\n", encoding="utf-8")
        base = {
            "source": {"path": str(source)},
            "roles": {"measures": [{"id": "duration", "field": "value", "label": "Duration",
                "semantic_type": "duration", "aggregation": "mean", "unit": "minute",
                "direction": "lower_is_better", "additivity": "non_additive", "primary": True,
                "required": True, "unit_field": "unit"}], "dimensions": []},
            "analysis_scope": {"mode": "snapshot", "comparisons": []},
            "schema": {"business_grain": "one row per id", "primary_key": ["id"], "fields": {
                "id": {"required": True, "type": "string"}, "value": {"required": True, "type": "number", "unit": "minute"},
                "optional_note": {"required": False, "type": "string"}}},
        }
        measures, primary = PREP._normalize_measure_contracts(base, PREP.load(argparse.Namespace(
            data=str(source), sqlite=None, sql=None, table=None, sheet=None)), PREP.Rep())
        reporter = PREP.Rep()
        frame = PREP.load(argparse.Namespace(data=str(source), sqlite=None, sql=None, table=None, sheet=None))
        PREP._validate_schema_contract(base, frame, measures, reporter)
        self.assertTrue(any("可选字段缺失" in item for item in reporter.w))
        self.assertTrue(any("primary_key" in item for item in reporter.e))

        drift = json.loads(json.dumps(base)); drift["schema"]["fields"]["value"]["unit"] = "hour"
        reporter = PREP.Rep(); measures, _ = PREP._normalize_measure_contracts(drift, frame, reporter)
        PREP._validate_schema_contract(drift, frame, measures, reporter)
        self.assertTrue(any("单位漂移" in item for item in reporter.e))

        aggregation_drift = json.loads(json.dumps(base))
        aggregation_drift["schema"]["fields"]["value"]["aggregation"] = "sum"
        reporter = PREP.Rep(); measures, _ = PREP._normalize_measure_contracts(aggregation_drift, frame, reporter)
        PREP._validate_schema_contract(aggregation_drift, frame, measures, reporter)
        self.assertTrue(any("聚合规则漂移" in item for item in reporter.e))

        incomplete = json.loads(json.dumps(base)); incomplete["schema"].pop("business_grain")
        incomplete["schema"].pop("primary_key")
        reporter = PREP.Rep(); measures, _ = PREP._normalize_measure_contracts(incomplete, frame, reporter)
        PREP._validate_schema_contract(incomplete, frame, measures, reporter)
        self.assertTrue(any("business_grain" in item for item in reporter.e))
        self.assertTrue(any("primary_key" in item for item in reporter.e))

    def test_comparison_contract_and_generic_quantity_measure_are_validated(self):
        finance, _ = self.build_fixture("finance")
        self.assertEqual(finance["method_applicability"]["pvm"]["status"], "SKIPPED")

        source = self.work / "pvm.csv"
        source.write_text("date,revenue,units\n2025-01-01,100,10\n2026-01-01,132,12\n", encoding="utf-8")
        mapping = {
            "source": {"path": str(source)},
            "roles": {"time": "date", "measures": [
                {"id": "revenue", "field": "revenue", "label": "Revenue", "semantic_type": "amount",
                 "aggregation": "sum", "unit": "currency", "direction": "higher_is_better",
                 "additivity": "additive", "primary": True, "required": True},
                {"id": "units", "field": "units", "label": "Units", "semantic_type": "quantity",
                 "aggregation": "sum", "unit": "count", "direction": "higher_is_better",
                 "additivity": "additive", "primary": False, "required": True}], "dimensions": []},
            "analysis_scope": {"mode": "period", "period": "2026-01", "data_as_of": "2026-01-31",
                               "comparison_as_of": "2025-01-31",
                               "comparisons": [{"type": "year_over_year"}]},
            "schema": {"business_grain": "one row per date", "primary_key": ["date"], "fields": {
                "date": {"required": True, "type": "date"},
                "revenue": {"required": True, "type": "number", "unit": "currency"},
                "units": {"required": True, "type": "number", "unit": "count"}}}}
        map_path = self.work / "pvm.map.json"; map_path.write_text(json.dumps(mapping), encoding="utf-8")
        out = self.work / "pvm.metrics.json"
        PREP.build(argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                      map=str(map_path), out=str(out)))
        metrics = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(metrics["method_applicability"]["pvm"]["status"], "OK")

        mapping["analysis_scope"]["comparisons"].append({"type": "period_over_period"})
        map_path.write_text(json.dumps(mapping), encoding="utf-8")
        with self.assertRaises(SystemExit) as blocked:
            PREP.build(argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                          map=str(map_path), out=str(out)))
        self.assertEqual(blocked.exception.code, 2)
        metrics = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(metrics["data_status"]["status"], "BLOCKED")
        self.assertTrue(any("只能声明一个主时间基线" in item for item in metrics["data_status"]["errors"]))

    def test_explicit_snapshot_with_time_field_still_skips_trend(self):
        mapping = json.loads((FIXTURES / "service.map.json").read_text(encoding="utf-8"))
        mapping["analysis_scope"] = {"mode": "snapshot", "comparisons": []}
        mapping["source"]["path"] = str(FIXTURES / "service.csv")
        map_path = self.work / "service-snapshot.map.json"
        map_path.write_text(json.dumps(mapping), encoding="utf-8")
        out = self.work / "service-snapshot.metrics.json"
        PREP.build(argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                      map=str(map_path), out=str(out)))
        metrics = json.loads(out.read_text(encoding="utf-8"))
        self.assertNotIn("time_series", metrics["measure_results"]["resolution_time"])
        insights_path = self.work / "service-snapshot.insights.json"
        result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts" / "stat-insights.py"),
                                 str(out), "--out", str(insights_path)], cwd=ROOT, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        insights = json.loads(insights_path.read_text(encoding="utf-8"))
        self.assertEqual(insights["method_applicability"]["mann_kendall"]["status"], "SKIPPED")

    def test_same_sql_text_gets_result_snapshot_row_and_schema_hashes(self):
        source = self.work / "sql-source.csv"
        source.write_text("metric\n10\n", encoding="utf-8")
        query = f"SELECT * FROM read_csv_auto('{str(source).replace(chr(39), chr(39) * 2)}')"
        mapping = {"roles": {"measures": [{"id": "metric", "field": "metric", "label": "Metric",
            "semantic_type": "score", "aggregation": "mean", "unit": "point", "direction": "higher_is_better",
            "additivity": "non_additive", "primary": True, "required": True}], "dimensions": []},
            "analysis_scope": {"mode": "snapshot", "comparisons": []},
            "schema": {"business_grain": "result row", "primary_key": [], "fields": {"metric": {"required": True, "type": "number", "unit": "point"}}}}
        map_path = self.work / "sql.map.json"; map_path.write_text(json.dumps(mapping), encoding="utf-8")

        def run(label):
            out = self.work / f"{label}.json"
            PREP.build(argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=query,
                                          map=str(map_path), out=str(out)))
            return json.loads(out.read_text(encoding="utf-8"))

        first = run("first")
        source.write_text("metric\n10\n20\n", encoding="utf-8")
        second = run("second")
        self.assertEqual(first["meta"]["source_sha256"], second["meta"]["source_sha256"])
        self.assertNotEqual(first["meta"]["result_snapshot_sha256"], second["meta"]["result_snapshot_sha256"])
        self.assertEqual((first["meta"]["result_snapshot_rows"], second["meta"]["result_snapshot_rows"]), (1, 2))
        self.assertEqual(first["meta"]["result_schema_sha256"], second["meta"]["result_schema_sha256"])


if __name__ == "__main__":
    unittest.main()
