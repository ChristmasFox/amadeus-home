import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import endpoint_benchmark

class EndpointTest(unittest.TestCase):
    def test_uses_only_public_fixed_fixture(self):
        self.assertNotIn('reference.wav', endpoint_benchmark.FIXTURES['short'])
        self.assertLessEqual(len(endpoint_benchmark.FIXTURES['short']), 50)
        self.assertTrue(40 <= len(endpoint_benchmark.FIXTURES['normal']) <= 65)

    def test_busy_response_is_a_sanitized_category(self):
        self.assertEqual(endpoint_benchmark.response_error(503, b'{"error":{"type":"tts_busy","message":"ignored"}}'), 'tts_busy')
        self.assertEqual(endpoint_benchmark.response_error(503, b'{"error":{"type":"private-content"}}'), 'invalid_response')
