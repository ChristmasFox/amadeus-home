import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import quality_sheet

class QualitySheetTest(unittest.TestCase):
    def test_no_automatic_quality_rating(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root)
            sample = path / "A-icl-Auto-short-listen.wav"
            sample.write_bytes(b"RIFF")
            sample.chmod(0o600)
            entries = quality_sheet.rows(path)
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]["owner_accepted_yes_no"], "")
            self.assertEqual(entries[0]["similarity_1to5"], "")
