import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import analyze_benchmark as report

class SummaryTest(unittest.TestCase):
    def test_percentile_interpolation_and_minimum_runs(self):
        rows = [dict(cold_or_warm="model_cold", success=True, total_ms=20, rss_bytes=10,
                     model_startup_ms=7, prompt_ms=2)]
        rows += [dict(cold_or_warm="warm", success=True, total_ms=n, engine_ms=n-1,
                      queue_wait_ms=0, encode_ms=1, audio_duration_ms=100,
                      rtf=n/100, rss_bytes=n) for n in (1,2,3,4,5)]
        result = report.summarize(rows)
        self.assertEqual(result["total_ms"]["p50"], 3)
        self.assertEqual(result["total_ms"]["p95"], 4.8)
        self.assertEqual(result["first_samples"][0]["phase"], "model_cold")
        with self.assertRaises(ValueError):
            report.summarize(rows[:5])
        rows[1]["first_for_fixture"] = True
        with self.assertRaises(ValueError):
            report.summarize(rows)
