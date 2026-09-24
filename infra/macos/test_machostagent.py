import ast
import importlib.util
import pathlib
import unittest


SOURCE = pathlib.Path(__file__).with_name("machostagent.py")
POWER_SOURCE = pathlib.Path(__file__).with_name("machostagent_power.py")
SPEC = importlib.util.spec_from_file_location("machostagent_power", POWER_SOURCE)
assert SPEC and SPEC.loader
machostagent_power = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(machostagent_power)


class MacHostAgentContractTest(unittest.TestCase):
    def test_only_fixed_read_only_routes_exist(self):
        tree = ast.parse(SOURCE.read_text())
        routes = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value.startswith("/v1/")}
        self.assertTrue({"/v1/status", "/v1/processes"} <= routes)
        self.assertNotIn("/exec", routes)

    def test_no_shell_execution(self):
        text = SOURCE.read_text()
        self.assertNotIn("shell=True", text)
        self.assertNotIn("/usr/bin/sudo", text)
        self.assertIn("MACHOSTAGENT_HOST_NAME", text)

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
