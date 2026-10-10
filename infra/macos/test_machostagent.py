import ast
import datetime as dt
import importlib.util
import pathlib
import tempfile
import time
import unittest

SOURCE = pathlib.Path(__file__).with_name("machostagent.py")
POWER_SOURCE = pathlib.Path(__file__).with_name("machostagent_power.py")
SPEC = importlib.util.spec_from_file_location("machostagent_power", POWER_SOURCE)
assert SPEC and SPEC.loader
machostagent_power = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(machostagent_power)
SPEC2 = importlib.util.spec_from_file_location("machostagent", SOURCE)
assert SPEC2 and SPEC2.loader
machostagent = importlib.util.module_from_spec(SPEC2)
SPEC2.loader.exec_module(machostagent)


class MacHostAgentContractTest(unittest.TestCase):
    def test_only_fixed_read_only_routes_exist(self):
        tree = ast.parse(SOURCE.read_text())
        routes = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("/v1/")}
        self.assertTrue({"/v1/status", "/v1/processes", "/v1/history", "/v1/anomalies"} <= routes)
        self.assertNotIn("/exec", routes)

    def test_no_shell_or_llm_execution(self):
        text = SOURCE.read_text()
        self.assertNotIn("shell=True", text)
        self.assertNotIn("/usr/bin/sudo", text)
        self.assertNotIn("openai", text.lower())
        self.assertNotIn("anthropic", text.lower())
        self.assertIn("MACHOSTAGENT_HOST_NAME", text)

    def test_sqlite_schema_and_summary_have_current_and_percentiles(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite3") as handle:
            connection = machostagent.db_connect(handle.name)
            machostagent.init_db(connection)
            now = time.time()
            for index, cpu in enumerate((10.0, 20.0, 30.0)):
                observed = dt.datetime.fromtimestamp(now + index * 5, dt.timezone.utc)
                snapshot = {
                    "observedAt": machostagent.timestamp(observed),
                    "cpu": {"utilizationPercent": cpu, "load": [1.0, 2.0, 3.0]},
                    "memory": {"totalBytes": 24_000_000_000, "usedBytes": 12_000_000_000, "pressure": "normal", "swap": {"totalBytes": 1_000, "usedBytes": index}},
                    "power": {"powerWatts": 2.0}, "network": {},
                    "disks": {"avalon": {"path": "/var/lib/amadeus-storage", "mounted": True, "status": "ok", "totalBytes": 8_000, "usedBytes": 4_000, "freeBytes": 4_000, "freePercent": 50.0}},
                    "services": {"ssh": {"ok": True}},
                }
                machostagent.insert_snapshot(connection, snapshot, now + index * 5)
            result = machostagent.summary(connection, now - 1, now + 20)
            self.assertEqual(result["metrics"]["cpu"]["current"], 30.0)
            self.assertEqual(result["metrics"]["cpu"]["avg"], 20.0)
            self.assertEqual(result["metrics"]["cpu"]["p95"], 29.0)
            self.assertEqual(result["metrics"]["cpu"]["max"], 30.0)
            self.assertIsNotNone(result["metrics"]["cpu"]["maxAt"])
            self.assertEqual(result["metrics"]["memoryUsedPercent"]["avg"], 50.0)
            public = machostagent.public_snapshot(snapshot)
            self.assertEqual(public["memory"]["total"], machostagent.human_bytes(24_000_000_000))
            self.assertNotIn("totalBytes", public["memory"])
            self.assertNotIn("freeBytes", public["disks"]["avalon"])
            self.assertEqual(public["power"]["socPower"], "2000 mW (SoC estimate)")
            self.assertEqual(public["power"]["wallPower"], "未知（需要外部墙上电表）")
            self.assertEqual(machostagent.public_anomalies([{"event_key": "storage_warning:avalon", "observed_at": "2026-09-28T00:00:00Z", "kind": "storage_warning:avalon", "severity": "warning", "status": "active", "summary": "low", "metric": 13.2, "threshold": 15.0, "duration_seconds": 0.0, "resolved_at": None}])[0]["eventKey"], "storage_warning:avalon")
            self.assertEqual({"host_samples", "storage_samples", "service_samples", "anomaly_events", "minute_rollups", "hourly_rollups", "daily_rollups"}, {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")})

    def test_anomaly_detection_is_deterministic_and_deduplicated(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite3") as handle:
            connection = machostagent.db_connect(handle.name)
            machostagent.init_db(connection)
            now = time.time()
            snapshot = {
                "observedAt": machostagent.timestamp(dt.datetime.fromtimestamp(now, dt.timezone.utc)),
                "cpu": {"utilizationPercent": 95.0, "load": [1.0]},
                "memory": {"totalBytes": 24, "usedBytes": 23, "pressure": "critical", "swap": {}},
                "power": {}, "network": {},
                "disks": {"avalon": {"path": "/var/lib/amadeus-storage", "mounted": False, "status": "unavailable"}},
                "services": {},
            }
            first = machostagent.evaluate_anomalies(connection, snapshot, now)
            second = machostagent.evaluate_anomalies(connection, snapshot, now + 1)
            self.assertEqual({item["kind"] for item in first}, {"memory_pressure", "avalon_unmounted"})
            self.assertEqual(second, [])
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM anomaly_events").fetchone()[0], 2)

    def test_memory_pressure_and_swap_parsers_preserve_unknown(self):
        self.assertEqual(machostagent.parse_swap("total = 8.00G used = 512.00M free = 7.50G"), {"totalBytes": 8 * 1024**3, "usedBytes": 512 * 1024**2, "freeBytes": int(7.50 * 1024**3)})
        self.assertEqual(machostagent.human_bytes(None), "未知")
        self.assertEqual(machostagent.human_bytes(8 * 1024**4), "8.00 TB")

    def test_power_degrades_independently(self):
        self.assertIn("privileged power sampler is not installed", SOURCE.read_text())

    def test_power_parser_reports_watts_and_scope(self):
        raw = b'''<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
        <key>elapsed_ns</key><integer>1000000000</integer><key>processor</key><dict>
        <key>cpu_power</key><real>993.156</real><key>gpu_power</key><real>476.674</real>
        <key>ane_power</key><real>0.0</real><key>combined_power</key><real>1469.83</real>
        </dict></dict></plist>'''
        parsed = machostagent_power.power_snapshot(raw, "2026-09-24T13:00:00Z")
        self.assertEqual(parsed["status"], "ok")
        self.assertEqual(parsed["scope"], "soc")
        self.assertEqual(parsed["powerWatts"], 1.47)
        self.assertEqual(parsed["sampleWindowMs"], 1000.0)

    def test_power_parser_preserves_unavailable_subsystems(self):
        raw = b'<?xml version="1.0"?><plist version="1.0"><dict><key>processor</key><dict><key>combined_power</key><real>33.3</real><key>gpu_power</key><real>33.3</real><key>ane_power</key><real>0</real></dict></dict></plist>'
        parsed = machostagent_power.power_snapshot(raw)
        self.assertEqual(parsed["socPowerMw"], 33.3)
        self.assertIsNone(parsed["cpuPowerMw"])
        self.assertEqual(parsed["anePowerMw"], 0.0)

    def test_power_parser_rejects_negative_combined_power(self):
        raw = b'<?xml version="1.0"?><plist version="1.0"><dict><key>processor</key><dict><key>combined_power</key><real>-2</real></dict></dict></plist>'
        self.assertEqual(machostagent_power.power_snapshot(raw)["error"], "powermetrics_combined_power_unavailable")

    def test_power_parser_rejects_missing_combined_power(self):
        raw = b'<plist version="1.0"><dict><key>processor</key><dict/></dict></plist>'
        parsed = machostagent_power.power_snapshot(raw)
        self.assertEqual(parsed["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
