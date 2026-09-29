#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("qwen_tts_smoke", ROOT / "scripts/smoke-qwen-audio-tts.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeEvidenceTest(unittest.TestCase):
    def test_evidence_is_atomic_and_protected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "evidence.json"
            smoke.write_evidence(path, [{"status": 200}])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(path.read_text())["cases"][0]["status"], 200)

    def test_evidence_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "target"
            target.write_text("keep")
            path = root / "evidence.json"
            path.symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "evidence_file_unprotected"):
                smoke.write_evidence(path, [])
            self.assertEqual(target.read_text(), "keep")

    def test_unprotected_parent_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "evidence"
            parent.mkdir(mode=0o755)
            with self.assertRaisesRegex(RuntimeError, "evidence_parent_unprotected"):
                smoke.write_evidence(parent / "result.json", [])


if __name__ == "__main__":
    unittest.main()
