import json
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import duckdb
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT / "scripts" / "prep-source.py"


class MultiSourceGoldenE2ETests(unittest.TestCase):
    """同一业务数据跨 Excel/SQLite/DuckDB 必须得到同一 metrics 语义。"""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.work = Path(self.temp.name)
        self.frame = pd.DataFrame([
            ("2024-01-05", "北区", "电商", "A", "客户1", 100_000, 10, None),
            ("2024-02-05", "南区", "传统", "B", "客户2", 200_000, 20, None),
            ("2024-03-05", "北区", "传统", "C", "客户3", 150_000, 15, None),
            ("2024-04-05", "南区", "电商", "A", "客户4", 50_000, 5, None),
            ("2025-01-05", "北区", "电商", "A", "客户1", 120_000, 12, 150_000),
            ("2025-02-05", "南区", "传统", "B", "客户2", 180_000, 18, 200_000),
            ("2025-03-05", "北区", "传统", "C", "客户3", 210_000, 21, 250_000),
            ("2025-04-05", "南区", "电商", "A", "客户4", 90_000, 9, 100_000),
        ], columns=["date", "zone", "channel", "product", "customer", "amount", "qty", "target"])

    def tearDown(self):
        self.temp.cleanup()

    def create_sources(self):
        excel = self.work / "golden.xlsx"
        self.frame.to_excel(excel, sheet_name="Sales", index=False, engine="openpyxl")

        sqlite = self.work / "golden.sqlite"
        with sqlite3.connect(sqlite) as connection:
            self.frame.to_sql("sales_records", connection, index=False)

        database = self.work / "golden.duckdb"
        connection = duckdb.connect(str(database))
        try:
            connection.register("golden_frame", self.frame)
            connection.execute("CREATE TABLE sales_records AS SELECT * FROM golden_frame")
        finally:
            connection.close()

        return {
            "excel": (excel, ["--sheet", "Sales"]),
            "sqlite": (sqlite, ["--table", "sales_records"]),
            "duckdb": (database, ["--table", "sales_records"]),
        }

    def profile_and_build(self, label, source, locator):
        map_path = self.work / f"{label}.map.json"
        metrics_path = self.work / f"{label}.metrics.json"
        profile = subprocess.run(
            [sys.executable, "-B", str(PREP), "profile", str(source), *locator,
             "--out-map", str(map_path)],
            cwd=ROOT, text=True, capture_output=True,
        )
        self.assertEqual(profile.returncode, 0, profile.stderr or profile.stdout)
        mapping = json.loads(map_path.read_text(encoding="utf-8"))
        self.assertEqual(mapping["roles"]["time"], "date")
        self.assertEqual(mapping["roles"]["amount"], "amount")
        self.assertEqual(mapping["roles"]["qty"], "qty")
        self.assertEqual(mapping["roles"]["target"], "target")
        self.assertEqual(mapping["roles"]["customer"], "customer")
        self.assertEqual(mapping["roles"]["product"], "product")
        self.assertEqual(mapping["roles"]["dimensions"], ["zone", "channel"])
        mapping["caliber"] = {
            "period": "2025H1",
            "target_measure": "amount",
            "target_aggregation": "sum",
        }
        mapping["thresholds"] = {"customer_top5_high": 101}
        map_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")

        build = subprocess.run(
            [sys.executable, "-B", str(PREP), "build", "--map", str(map_path),
             "--out", str(metrics_path)],
            cwd=ROOT, text=True, capture_output=True,
        )
        self.assertEqual(build.returncode, 0, build.stderr or build.stdout)
        return json.loads(metrics_path.read_text(encoding="utf-8"))

    @staticmethod
    def business_projection(metrics):
        """去掉格式特有的路径/指纹，只比较报告真正消费的业务语义。"""
        return {
            "total": metrics["total"],
            "period": metrics["period"],
            "dimensions": metrics["dimensions"],
            "products": metrics["products"],
            "target": metrics["target"],
            "concentration": metrics["concentration"],
            "data_status": metrics["data_status"],
            "period_lock": metrics["meta"]["period_lock"],
            "current_rows": metrics["meta"]["current_rows"],
            "base_rows": metrics["meta"]["base_rows"],
        }

    def test_excel_sqlite_duckdb_profile_to_metrics_are_semantically_identical(self):
        outputs = {
            label: self.profile_and_build(label, source, locator)
            for label, (source, locator) in self.create_sources().items()
        }
        golden = self.business_projection(outputs["excel"])
        self.assertEqual(golden["data_status"]["status"], "OK")
        self.assertEqual(golden["period"]["total_cur"], 600_000)
        self.assertEqual(golden["period"]["total_base"], 500_000)
        self.assertEqual(golden["period"]["total_yoy"], 20.0)
        self.assertEqual(golden["target"]["plan"], 700_000)
        self.assertEqual(golden["target"]["achievement_rate"], 85.7)
        self.assertEqual(golden["period_lock"]["label"], "2025H1")
        for label in ("sqlite", "duckdb"):
            self.assertEqual(self.business_projection(outputs[label]), golden, label)

        self.assertEqual(outputs["excel"]["meta"]["source_kind"], "xlsx")
        self.assertEqual(outputs["sqlite"]["meta"]["source_kind"], "sqlite")
        self.assertEqual(outputs["duckdb"]["meta"]["source_kind"], "duckdb")
        self.assertEqual(outputs["excel"]["meta"]["source_selector"], "Sales")
        self.assertEqual(outputs["sqlite"]["meta"]["source_selector"], "sales_records")
        self.assertEqual(outputs["duckdb"]["meta"]["source_selector"], "sales_records")


if __name__ == "__main__":
    unittest.main()
