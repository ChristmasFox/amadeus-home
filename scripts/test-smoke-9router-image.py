#!/usr/bin/env python3
"""No-send default and content-safe evidence for the image transport smoke."""
from __future__ import annotations

import contextlib
import importlib.util
import io
from pathlib import Path
from subprocess import CompletedProcess
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("image_smoke", Path(__file__).with_name("smoke-9router-image.py"))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class ImageSmokeTest(unittest.TestCase):
    def test_default_does_not_send(self):
        with patch.object(sys, "argv", ["smoke-9router-image.py"]), \
             patch.object(smoke.subprocess, "run", side_effect=AssertionError("no live request")), \
             contextlib.redirect_stdout(io.StringIO()) as out:
            smoke.main()
        self.assertIn("MODE=dry-run", out.getvalue())

    def test_apply_prints_only_bounded_metadata(self):
        fake_image = CompletedProcess([], 0, stdout='{"status":"passed","model":"amadeus-image","items":1,"format":"jpeg","bytes":12345}\n', stderr="")
        private_log = "provider-private-prompt\nTrying model 1/1: cx/gpt-image-2.5-sunburst\nModel cx/gpt-image-2.5-sunburst succeeded\n"
        fake_logs = CompletedProcess([], 0, stdout="", stderr=private_log)
        with patch.object(sys, "argv", ["smoke-9router-image.py", "--apply"]), \
             patch.object(smoke.subprocess, "run", side_effect=[fake_image, fake_logs]) as run, \
             contextlib.redirect_stdout(io.StringIO()) as out:
            smoke.main()
        self.assertEqual(run.call_count, 2)
        self.assertIn("docker", run.call_args_list[0].args[0])
        self.assertIn("openclaw", run.call_args_list[0].args[0])
        self.assertIn("IMAGE_SMOKE=passed", out.getvalue())
        self.assertIn("FIRST_BACKEND_ATTEMPT=observed", out.getvalue())
        self.assertIn("FIRST_BACKEND_SUCCESS=observed", out.getvalue())
        self.assertNotIn("provider-private-prompt", out.getvalue())
        self.assertNotIn("base64", out.getvalue())

    def test_error_is_bounded(self):
        failed = CompletedProcess([], 1, stdout="", stderr="IMAGE_SMOKE=HTTP_429\n")
        with patch.object(sys, "argv", ["smoke-9router-image.py", "--apply"]), \
             patch.object(smoke.subprocess, "run", return_value=failed), \
             self.assertRaisesRegex(SystemExit, "HTTP_429"):
            smoke.main()


if __name__ == "__main__":
    unittest.main()
