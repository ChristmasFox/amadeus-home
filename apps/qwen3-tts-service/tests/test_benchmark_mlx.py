import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import benchmark_mlx
from benchmark import FIXTURES

class MlxContractTest(unittest.TestCase):
    def test_poc_uses_same_public_fixture_and_no_import_time_model(self):
        self.assertIs(benchmark_mlx.FIXTURES, FIXTURES)
        self.assertLessEqual(len(FIXTURES["short"]), 50)
