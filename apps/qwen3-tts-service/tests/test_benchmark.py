import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import benchmark

class BenchmarkFixtureTest(unittest.TestCase):
    def test_fixture_lengths_are_fixed_and_public(self):
        lengths = [len(benchmark.FIXTURES[b]) for b in ("short", "normal", "long")]
        self.assertLessEqual(lengths[0], 30)
        self.assertTrue(40 <= lengths[1] <= 65)
        self.assertTrue(85 <= lengths[2] <= 120)

    def test_outputs_must_be_external_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "profiles"
            root.mkdir(mode=0o700)
            repo = Path(benchmark.__file__).resolve().parents[2]
            with self.assertRaises(ValueError):
                benchmark.prepare_paths(root, repo / "samples", repo)
            out = Path(tmp) / "results"
            benchmark.prepare_paths(root, out, repo)
            self.assertEqual(out.stat().st_mode & 0o777, 0o700)
            public = Path(tmp) / "public"
            public.mkdir(mode=0o755)
            with self.assertRaises(ValueError):
                benchmark.prepare_paths(public, out, repo)
