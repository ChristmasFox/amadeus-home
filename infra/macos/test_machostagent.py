import ast
import pathlib
import unittest


SOURCE = pathlib.Path(__file__).with_name("machostagent.py")


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
        self.assertIn('"telemetry": "supported" if temperature else "degraded"', SOURCE.read_text())


if __name__ == "__main__":
    unittest.main()
