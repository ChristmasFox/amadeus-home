#!/usr/bin/env python3
"""The pre-apply checkpoint never mutates a live host by default."""
from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
from subprocess import CompletedProcess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("checkpoint", Path(__file__).with_name("checkpoint-amadeus-model-capability.py"))
checkpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checkpoint)


class CheckpointTest(unittest.TestCase):
    def test_plan_is_offline(self):
        with patch.object(sys, "argv", ["checkpoint-amadeus-model-capability.py"]), \
             patch.object(checkpoint.subprocess, "run", side_effect=AssertionError("no OrbStack write")), \
             patch.object(checkpoint.subprocess, "check_output", side_effect=AssertionError("no Git read")), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            checkpoint.main()
        self.assertIn("MODE=dry-run", output.getvalue())

    def test_apply_requires_clean_source_and_safe_guest_evidence(self):
        commit = "a" * 40
        def git(command, **_):
            return commit + "\n" if "rev-parse" in command else ""
        def guest(command, **_):
            target = command[-2]
            evidence = f"PRECHECKPOINT={target}\nLIVE_OPENCLAW_IMAGE=local/openclaw-amadeus:git-example\nSOURCE_COMMIT={commit}\nCHECKPOINT_MODES=0700/0600\n"
            return CompletedProcess(command, 0, evidence, "")
        with patch.object(sys, "argv", ["checkpoint-amadeus-model-capability.py", "--apply"]), \
             patch.object(checkpoint.subprocess, "check_output", side_effect=git), \
             patch.object(checkpoint.subprocess, "run", side_effect=guest) as run, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            checkpoint.main()
        self.assertEqual(run.call_count, 1)
        self.assertIn("orb", run.call_args.args[0])
        self.assertIn("SOURCE_COMMIT=" + commit, output.getvalue())
        self.assertNotIn("secret", output.getvalue().lower())
        with patch.object(sys, "argv", ["checkpoint-amadeus-model-capability.py", "--apply"]), \
             patch.object(checkpoint.subprocess, "check_output", side_effect=[commit, " M source.py\n"]), \
             patch.object(checkpoint.subprocess, "run", side_effect=AssertionError("no guest write")), \
             self.assertRaisesRegex(SystemExit, "clean source"):
            checkpoint.main()


if __name__ == "__main__":
    unittest.main()
