#!/usr/bin/env python3
"""Offline 9Router image Combo provisioning/rollback contract fixtures."""
from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("image_combo", Path(__file__).with_name("provision-9router-image-combo.py"))
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)


class FakeDashboard:
    def __init__(self, *, combos=None, strategies=None, aliases=None):
        self.combos = copy.deepcopy(combos if combos is not None else [
            {"id": "arthur-unchanged", "name": "arthur-combo", "kind": None, "models": ["ag/chat", "cx/chat"]},
            {"id": "dev-unchanged", "name": "dev-combo", "kind": None, "models": ["cx/dev"]},
        ])
        self.aliases = copy.deepcopy(aliases if aliases is not None else {"amadeus-asr": "selfhosted-stt/asr", "amadeus-tts": "selfhosted-tts/tts"})
        self.settings = {"comboStrategy": "round-robin", "providerConnectionsMarker": "unchanged", "comboStrategies": copy.deepcopy(strategies or {"dev-combo": {"fallbackStrategy": "round-robin"}})}
        self.writes = []

    def request(self, method, path, body=None):
        if method == "GET":
            if path == "/api/combos":
                return {"combos": copy.deepcopy(self.combos)}
            if path == "/api/models/alias":
                return {"aliases": copy.deepcopy(self.aliases)}
            if path == "/api/settings":
                return copy.deepcopy(self.settings)
            if path == "/api/health":
                return {"ok": True}
        self.writes.append((method, path, copy.deepcopy(body)))
        if method == "POST" and path == "/api/combos":
            self.combos.append({"id": "created-image", **copy.deepcopy(body)})
            return copy.deepcopy(self.combos[-1])
        if method == "PUT" and path.startswith("/api/combos/"):
            for combo in self.combos:
                if combo["id"] == path.removeprefix("/api/combos/"):
                    combo.update(copy.deepcopy(body))
                    return copy.deepcopy(combo)
        if method == "DELETE" and path.startswith("/api/combos/"):
            self.combos = [c for c in self.combos if c["id"] != path.removeprefix("/api/combos/")]
            return {"success": True}
        if method == "PATCH" and path == "/api/settings":
            self.settings.update(copy.deepcopy(body))
            return copy.deepcopy(self.settings)
        raise AssertionError(f"unexpected API call: {method} {path}")


class ImageComboTest(unittest.TestCase):
    def setUp(self):
        self.desired = image.desired_image()

    def test_exact_git_desired_state(self):
        self.assertEqual(self.desired, {
            "name": "amadeus-image", "kind": "image", "strategy": "fallback",
            "models": ["cx/gpt-image-2.5-sunburst"],
        })

    def test_creation_idempotence_preserves_unrelated_state(self):
        api = FakeDashboard()
        before = image.snapshot(api)
        self.assertIsNone(before["combo"])
        self.assertEqual(image.ensure_image(api, self.desired, before), ("created", "reconciled"))
        self.assertEqual(api.combos[-1]["kind"], "image")
        self.assertEqual(api.combos[-1]["models"], self.desired["models"])
        self.assertEqual(api.settings["comboStrategies"]["amadeus-image"], {"fallbackStrategy": "fallback"})
        self.assertEqual(api.settings["comboStrategies"]["dev-combo"], {"fallbackStrategy": "round-robin"})
        self.assertEqual(api.settings["comboStrategy"], "round-robin")
        self.assertEqual(api.aliases, {"amadeus-asr": "selfhosted-stt/asr", "amadeus-tts": "selfhosted-tts/tts"})
        self.assertEqual([c["name"] for c in api.combos[:2]], ["arthur-combo", "dev-combo"])
        writes = len(api.writes)
        image.verify_live(api, self.desired)
        self.assertEqual(image.ensure_image(api, self.desired, image.snapshot(api)), ("existing", "existing"))
        self.assertEqual(len(api.writes), writes)
        self.assertEqual(image.restore_image(api, before), ("removed", "reconciled"))
        self.assertIsNone(image.snapshot(api)["combo"])
        self.assertNotIn("amadeus-image", api.settings["comboStrategies"])
        self.assertEqual(image.restore_image(api, before), ("already_absent", "existing"))

    def test_reconcile_order_and_strategy_then_restore_exact_original(self):
        old_models = ["cx/gpt-image-1"]
        api = FakeDashboard(
            combos=[{"id": "existing-image", "name": "amadeus-image", "kind": "image", "models": old_models},
                    {"id": "other", "name": "other-image", "kind": "image", "models": ["other/model"]}],
            strategies={"amadeus-image": {"fallbackStrategy": "round-robin", "judgeModel": "unchanged"},
                        "other-image": {"fallbackStrategy": "round-robin"}},
        )
        before = image.snapshot(api)
        self.assertEqual(image.ensure_image(api, self.desired, before), ("reconciled", "reconciled"))
        self.assertEqual(image.snapshot(api)["combo"]["models"], self.desired["models"])
        self.assertEqual(api.settings["comboStrategies"]["amadeus-image"]["judgeModel"], "unchanged")
        self.assertEqual(api.combos[1]["models"], ["other/model"])
        self.assertEqual(image.restore_image(api, before), ("restored", "reconciled"))
        self.assertEqual(image.snapshot(api), before)
        self.assertEqual(api.settings["comboStrategies"]["other-image"], {"fallbackStrategy": "round-robin"})

    def test_wrong_kind_and_alias_conflict_fail_before_write(self):
        api = FakeDashboard(combos=[{"id": "wrong", "name": "amadeus-image", "kind": None, "models": []}])
        with self.assertRaisesRegex(RuntimeError, "wrong_kind"):
            image.snapshot(api)
        self.assertFalse(api.writes)
        with self.assertRaisesRegex(RuntimeError, "not_canonical"):
            image.verify_live(FakeDashboard(), self.desired)
        api = FakeDashboard(aliases={"amadeus-image": "other/model"})
        with self.assertRaisesRegex(RuntimeError, "alias_conflict"):
            image.snapshot(api)
        self.assertFalse(api.writes)

    def test_minimal_private_external_checkpoint_and_rollback(self):
        api = FakeDashboard()
        before = image.snapshot(api)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "private"
            path = image.write_checkpoint(directory, before)
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            saved = image.read_checkpoint(path)
            self.assertEqual(saved, before)
            serialized = path.read_text()
            self.assertNotIn("providerConnectionsMarker", serialized)
            self.assertNotIn("amadeus-asr", serialized)
            self.assertNotIn("amadeus-tts", serialized)
            image.ensure_image(api, self.desired, saved)
            image.restore_image(api, saved)
            self.assertEqual(image.snapshot(api), before)
            os.chmod(path, 0o644)
            with self.assertRaisesRegex(ValueError, "checkpoint_not_private"):
                image.read_checkpoint(path)

    def test_default_cli_is_non_authenticating_plan(self):
        with patch.object(sys, "argv", ["provision-9router-image-combo.py"]), \
             patch.object(image, "local_cli_token", side_effect=AssertionError("must not authenticate")), \
             contextlib.redirect_stdout(io.StringIO()) as stdout:
            image.main()
        self.assertIn("MODE=dry-run", stdout.getvalue())
        self.assertIn("amadeus-image", stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
