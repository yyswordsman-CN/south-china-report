import argparse
import importlib.util
import json
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


PREP = load_script("prep_source_generalized_p2", ROOT / "scripts" / "prep-source.py")


class GeneralizedP2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def run_build(self, mapping, name="metrics", expect_exit=None):
        map_path = self.work / f"{name}.map.json"
        out_path = self.work / f"{name}.json"
        map_path.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
        args = argparse.Namespace(data=None, sheet=None, sqlite=None, table=None, sql=None,
                                  map=str(map_path), out=str(out_path), baseline_metrics=None)
        if expect_exit is None:
            PREP.build(args)
        else:
            with self.assertRaises(SystemExit) as caught:
                PREP.build(args)
            self.assertEqual(caught.exception.code, expect_exit)
        return json.loads(out_path.read_text(encoding="utf-8")), out_path

    def test_calendar_period_equal_window_same_stage_and_iso_week_are_distinct(self):
        month = PREP.parse_period_spec("2025-04")
        calendar_type, calendar = PREP._comparison_period(month, {"type": "mom"})
        rolling_type, rolling = PREP._comparison_period(month, {"type": "previous_equal_window"})
        self.assertEqual(calendar_type, "previous_calendar_period")
        self.assertEqual((str(calendar["start"].date()), str(calendar["end"].date())),
                         ("2025-03-01", "2025-03-31"))
        self.assertEqual(rolling_type, "previous_equal_window")
        self.assertEqual((str(rolling["start"].date()), str(rolling["end"].date())),
                         ("2025-03-02", "2025-03-31"))

        week = PREP.parse_period_spec("2025-W14")
        week_type, previous_week = PREP._comparison_period(week, {"type": "wow"})
        self.assertEqual(week_type, "previous_calendar_period")
        self.assertEqual((str(previous_week["start"].date()), str(previous_week["end"].date())),
                         ("2025-03-24", "2025-03-30"))

        source = self.work / "same-stage.csv"
        source.write_text(
            "date,value\n2025-03-10,10\n2025-03-20,20\n2025-04-10,30\n2025-04-20,40\n",
            encoding="utf-8",
        )
        mapping = {
            "source": {"path": str(source)},
            "roles": {"time": "date", "measures": [{
                "id": "volume", "field": "value", "label": "Volume", "semantic_type": "quantity",
                "aggregation": "sum", "unit": "count", "direction": "higher_is_better",
                "additivity": "additive", "primary": True, "required": True,
            }], "dimensions": []},
            "analysis_scope": {"mode": "period", "period": "2025-04", "data_as_of": "2025-04-15",
                               "comparison_as_of": "2025-03-15",
                               "comparisons": [{"type": "same_stage_previous_period"}]},
            "schema": {"business_grain": "one row per date", "primary_key": ["date"], "fields": {
                "date": {"required": True, "type": "date"},
                "value": {"required": True, "type": "number", "unit": "count", "aggregation": "sum"},
            }},
        }
        metrics, _ = self.run_build(mapping, "same-stage")
        self.assertEqual(metrics["meta"]["period_lock"]["base_start"], "2025-03-01")
        self.assertEqual(metrics["meta"]["period_lock"]["base_end"], "2025-03-15")
        self.assertEqual(metrics["period"]["total_cur"], 30)
        self.assertEqual(metrics["period"]["total_base"], 10)

    def test_axis_additivity_ratio_scale_and_weight_coverage(self):
        inventory = self.work / "inventory.csv"
        inventory.write_text(
            "date,facility,on_hand\n2025-03-01,A,10\n2025-03-01,B,20\n2025-03-31,A,8\n2025-03-31,B,25\n",
            encoding="utf-8",
        )
        inventory_map = {
            "source": {"path": str(inventory)},
            "roles": {"time": "date", "measures": [{
                "id": "on_hand", "field": "on_hand", "label": "On hand", "semantic_type": "inventory",
                "aggregation": "sum", "dimension_aggregation": "sum", "time_aggregation": "ending",
                "unit": "unit", "direction": "neutral", "additivity": "semi_additive",
                "primary": True, "required": True,
            }], "dimensions": ["facility"]},
            "analysis_scope": {"mode": "period", "period": "2025-03", "data_as_of": "2025-03-31",
                               "comparisons": []},
            "schema": {"business_grain": "daily facility snapshot", "primary_key": ["date", "facility"], "fields": {
                "date": {"required": True, "type": "date"}, "facility": {"required": True, "type": "string"},
                "on_hand": {"required": True, "type": "number", "unit": "unit", "aggregation": "sum"},
            }},
        }
        metrics, _ = self.run_build(inventory_map, "inventory-ending")
        self.assertEqual(metrics["total"], 33)
        by_facility = {row["name"]: row["current"] for row in metrics["measure_dimensions"]["on_hand"]["facility"]}
        self.assertEqual(by_facility, {"A": 8, "B": 25})

        ratio_source = self.work / "quality.csv"
        ratio_source.write_text(
            "stage,defects,inspected,response_rate,score,weight\nA,2,100,0.50,80,10\nB,9,300,0.70,100,\n",
            encoding="utf-8",
        )
        ratio_map = {
            "source": {"path": str(ratio_source)},
            "roles": {"measures": [
                {"id": "defect_rate", "label": "Defect rate", "semantic_type": "defect_rate",
                 "aggregation": "ratio", "dimension_aggregation": "ratio",
                 "numerator_field": "defects", "denominator_field": "inspected", "storage_scale": "fraction",
                 "unit": "percent", "direction": "lower_is_better", "additivity": "non_additive",
                 "primary": True, "required": True},
                {"id": "response_rate", "field": "response_rate", "label": "Response rate",
                 "semantic_type": "percentage", "aggregation": "mean", "storage_scale": "fraction",
                 "unit": "percent", "direction": "higher_is_better", "additivity": "non_additive",
                 "primary": False, "required": True},
            ], "dimensions": ["stage"]},
            "analysis_scope": {"mode": "snapshot", "comparisons": []},
            "schema": {"business_grain": "one row per stage", "primary_key": ["stage"], "fields": {
                "stage": {"required": True, "type": "string"},
                "defects": {"required": True, "type": "number"},
                "inspected": {"required": True, "type": "number"},
                "response_rate": {"required": True, "type": "number", "unit": "percent", "aggregation": "mean"},
            }},
        }
        ratio_metrics, _ = self.run_build(ratio_map, "ratio")
        self.assertIs(ratio_metrics["semantic_layer"]["schema"]["declared"], True)
        self.assertAlmostEqual(ratio_metrics["measure_results"]["defect_rate"]["current"], 2.75)
        self.assertAlmostEqual(ratio_metrics["measure_results"]["response_rate"]["current"], 60.0)

        weighted_map = json.loads(json.dumps(ratio_map))
        weighted_map["roles"]["measures"] = [{
            "id": "weighted_score", "field": "score", "label": "Weighted score", "semantic_type": "score",
            "aggregation": "weighted_mean", "weight_field": "weight", "min_weight_coverage_pct": 95,
            "unit": "point", "direction": "higher_is_better", "additivity": "non_additive",
            "primary": True, "required": True,
        }]
        weighted_map["schema"]["fields"].update({
            "score": {"required": True, "type": "number", "unit": "point", "aggregation": "weighted_mean"},
            "weight": {"required": True, "type": "number"},
        })
        weighted_metrics, _ = self.run_build(weighted_map, "weighted", expect_exit=2)
        quality = weighted_metrics["meta"]["quality"]["measures"]["weighted_score"]
        self.assertEqual(quality["status"], "BLOCKED")
        self.assertEqual(quality["weight_coverage"]["coverage_pct"], 50.0)

    def test_references_unify_target_benchmark_range_group_and_legacy_projection(self):
        source = self.work / "service.csv"
        source.write_text("queue,duration,target\nA,30,40\nB,60,40\n", encoding="utf-8")
        mapping = {
            "source": {"path": str(source)},
            "roles": {"measures": [{
                "id": "duration", "field": "duration", "label": "Duration", "semantic_type": "duration",
                "aggregation": "mean", "unit": "minute", "direction": "lower_is_better",
                "additivity": "non_additive", "primary": True, "required": True,
            }], "dimensions": ["queue"]},
            "analysis_scope": {"mode": "snapshot", "comparisons": []},
            "references": [
                {"id": "target", "type": "target", "measure": "duration", "value": 40, "unit": "minute"},
                {"id": "healthy_band", "type": "benchmark", "measure": "duration", "lower": 35,
                 "upper": 50, "unit": "minute"},
                {"id": "queue_a", "type": "group", "measure": "duration", "dimension": "queue",
                 "reference_group": "A", "unit": "minute"},
            ],
            "schema": {"business_grain": "one row per queue", "primary_key": ["queue"], "fields": {
                "queue": {"required": True, "type": "string"},
                "duration": {"required": True, "type": "number", "unit": "minute", "aggregation": "mean"},
            }},
        }
        metrics, _ = self.run_build(mapping, "references")
        references = {item["id"]: item for item in metrics["references"]}
        self.assertEqual(references["target"]["attainment_rate"], 88.9)
        self.assertFalse(references["target"]["favorable"])
        self.assertTrue(references["healthy_band"]["favorable"])
        queue_b = next(row for row in references["queue_a"]["groups"] if row["name"] == "B")
        self.assertEqual(queue_b["delta"], 30)
        self.assertEqual(metrics["comparisons"], metrics["references"])

        legacy_source = self.work / "legacy.csv"
        legacy_source.write_text("amount,target\n45,40\n", encoding="utf-8")
        legacy = {
            "source": {"path": str(legacy_source)},
            "roles": {"amount": "amount", "target": "target", "dimensions": []},
            "analysis_scope": {"mode": "snapshot", "comparisons": []},
            "caliber": {"target_measure": "amount", "target_aggregation": "unique"},
            "schema": {"business_grain": "one row snapshot", "primary_key": [], "fields": {
                "amount": {"required": True, "type": "number", "unit": "currency", "aggregation": "sum"},
                "target": {"required": True, "type": "number", "unit": "currency"},
            }},
        }
        legacy_metrics, _ = self.run_build(legacy, "legacy-reference")
        self.assertEqual(legacy_metrics["target"]["plan"], 40)
        self.assertEqual(legacy_metrics["target"]["actual"], 45)
        self.assertEqual(legacy_metrics["target"]["achievement_rate"], 112.5)
        self.assertEqual(next(item for item in legacy_metrics["references"]
                              if item["source_contract"] == "legacy_target")["status"], "OK")

    def test_drift_lock_detects_result_row_schema_and_semantic_changes(self):
        source = self.work / "metric.csv"
        source.write_text("id,value\nA,10\nB,20\n", encoding="utf-8")

        def mapping():
            return {
                "source": {"path": str(source)},
                "roles": {"measures": [{
                    "id": "score", "field": "value", "label": "Score", "semantic_type": "score",
                    "aggregation": "mean", "unit": "point", "direction": "higher_is_better",
                    "additivity": "non_additive", "primary": True, "required": True,
                }], "dimensions": []},
                "analysis_scope": {"mode": "snapshot", "comparisons": []},
                "schema": {"business_grain": "one row per id", "primary_key": ["id"], "fields": {
                    "id": {"required": True, "type": "string"},
                    "value": {"required": True, "type": "number", "unit": "point", "aggregation": "mean"},
                }},
            }

        baseline_metrics, baseline_path = self.run_build(mapping(), "baseline")
        self.assertEqual(baseline_metrics["drift_report"]["status"], "NOT_CONFIGURED")

        unchanged = mapping()
        unchanged["drift_lock"] = {"baseline_metrics": str(baseline_path), "expected_result_change": False}
        unchanged_metrics, _ = self.run_build(unchanged, "unchanged")
        self.assertEqual(unchanged_metrics["drift_report"]["status"], "OK")

        source.write_text("id,value\nA,11\nB,20\n", encoding="utf-8")
        unexpected_metrics, _ = self.run_build(unchanged, "unexpected", expect_exit=2)
        self.assertEqual(unexpected_metrics["drift_report"]["checks"]["result_snapshot"]["status"], "CHANGED")

        expected = mapping()
        expected["drift_lock"] = {"baseline_metrics": str(baseline_path), "expected_result_change": True}
        expected_metrics, _ = self.run_build(expected, "expected")
        self.assertEqual(expected_metrics["drift_report"]["status"], "OK")

        source.write_text("id,value\nA,11\nB,20\nC,30\n", encoding="utf-8")
        row_metrics, _ = self.run_build(expected, "row-drift", expect_exit=2)
        self.assertEqual(row_metrics["drift_report"]["checks"]["row_count"]["status"], "BLOCKED")

        source.write_text("id,value,note\nA,10,x\nB,20,y\n", encoding="utf-8")
        schema_metrics, _ = self.run_build(expected, "schema-drift", expect_exit=2)
        self.assertEqual(schema_metrics["drift_report"]["checks"]["schema"]["status"], "CHANGED")

        source.write_text("id,value\nA,10\nB,20\n", encoding="utf-8")
        semantic = mapping()
        semantic["roles"]["measures"][0]["direction"] = "lower_is_better"
        semantic["drift_lock"] = {"baseline_metrics": str(baseline_path), "expected_result_change": False}
        semantic_metrics, _ = self.run_build(semantic, "semantic-drift", expect_exit=2)
        self.assertEqual(semantic_metrics["drift_report"]["checks"]["semantic_contract"]["status"], "CHANGED")


if __name__ == "__main__":
    unittest.main()
