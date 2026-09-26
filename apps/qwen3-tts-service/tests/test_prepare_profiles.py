import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepare_profiles

class CropValidationTest(unittest.TestCase):
    def test_matching_ranges_and_durations_required(self):
        cuts = {
            "B": dict(start_seconds=0, end_seconds=15, line_start=1, line_end=3),
            "C": dict(start_seconds=2, end_seconds=10, line_start=2, line_end=3),
            "D": dict(start_seconds=2, end_seconds=6.5, line_start=2, line_end=2),
            "E": dict(start_seconds=2, end_seconds=6.5, line_start=2, line_end=2),
        }
        lines = ["one", "two", "three"]
        prepare_profiles.validate_cuts(cuts, 46, lines)
        with self.assertRaises(ValueError):
            prepare_profiles.validate_cuts(cuts | {"extra": cuts["B"]}, 46, lines)
        with self.assertRaises(ValueError):
            prepare_profiles.validate_cuts(cuts | {"C": cuts["C"] | {"line_end": 9}}, 46, lines)
