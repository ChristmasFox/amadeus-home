import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import endpoint_benchmark

class EndpointTest(unittest.TestCase):
    def test_uses_only_public_fixed_fixture(self):
        self.assertNotIn('reference.wav', endpoint_benchmark.FIXTURES['short'])
        self.assertLessEqual(len(endpoint_benchmark.FIXTURES['short']), 50)
