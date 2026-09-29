#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).with_name("kurisu-gpt-sovits-poc-proxy.py")
SPEC = importlib.util.spec_from_file_location("kurisu_poc_proxy", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ProxyValidationTests(unittest.TestCase):
    def test_text_is_trimmed_and_bounded(self) -> None:
        self.assertEqual(MODULE.validate_text("  日语  ", 10), "日语")
        with self.assertRaisesRegex(ValueError, "text_too_long"):
            MODULE.validate_text("超过", 1)

    def test_seed_defaults_and_rejects_invalid_values(self) -> None:
        self.assertEqual(MODULE.validate_seed(None, 4242), 4242)
        self.assertEqual(MODULE.validate_seed("12", 4242), 12)
        with self.assertRaisesRegex(ValueError, "seed_invalid"):
            MODULE.validate_seed("bad", 4242)


if __name__ == "__main__":
    unittest.main()
