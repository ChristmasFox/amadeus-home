#!/usr/bin/env python3
"""Source-managed group policy is additive only for native image generation."""
from __future__ import annotations

import copy
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("openclaw_prepare", Path(__file__).with_name("openclaw_prepare.py"))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class GroupImagePolicyTest(unittest.TestCase):
    def test_whatsapp_group_owner_and_nonowner_scope(self):
        keys = prepare.owner_tool_policy_keys("+15555550123")
        channel = {
            "dmPolicy": "open", "allowFrom": ["*"],
            "direct": {"fixture-dm": {"systemPrompt": "untouched"}},
            "groups": {"*": {"requireMention": False}, "fixture-group": {"requireMention": True}},
            "accounts": {"secondary": {"groups": {"account-group": {"requireMention": True}}}},
        }
        before_direct = copy.deepcopy(channel["direct"])
        prepare.ensure_group_image_policies(channel, keys)
        self.assertEqual(channel["direct"], before_direct)
        self.assertEqual(channel["dmPolicy"], "open")
        self.assertEqual(channel["allowFrom"], ["*"])
        for group in [*channel["groups"].values(), *channel["accounts"]["secondary"]["groups"].values()]:
            self.assertEqual(group["tools"], {"allow": ["web_search", "web_fetch", "image_generate"]})
            self.assertEqual(group["toolsBySender"], {key: {"allow": ["*"]} for key in keys})
        self.assertFalse(channel["groups"]["*"]["requireMention"])
        self.assertTrue(channel["groups"]["fixture-group"]["requireMention"])
        self.assertEqual(set(channel["groups"]), {"*", "fixture-group"}, "admission keys must not be added or removed")
        once = copy.deepcopy(channel)
        prepare.ensure_group_image_policies(channel, keys)
        self.assertEqual(channel, once, "prepare must be idempotent")

    def test_telegram_group_has_no_owner_wildcard_or_direct_change(self):
        channel = {"direct": {"*": {"tools": {"deny": ["exec"]}}},
                   "groups": {"*": {"requireMention": False}}}
        before = copy.deepcopy(channel["direct"])
        prepare.ensure_group_image_policies(channel)
        self.assertEqual(channel["direct"], before)
        self.assertEqual(channel["groups"]["*"]["tools"], {"allow": ["web_search", "web_fetch", "image_generate"]})
        self.assertNotIn("toolsBySender", channel["groups"]["*"])

    def test_prepared_group_owner_rules_validate_under_pinned_runtime(self):
        root = Path(__file__).resolve().parents[1]
        cli = root / "node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/openclaw.mjs"
        if not cli.is_file():
            self.skipTest("pinned OpenClaw npm dependency is not installed")
        config = json.loads((root / "integrations/openclaw/openclaw.json.example").read_text())
        keys = prepare.owner_tool_policy_keys("+15555550123")
        config["tools"]["toolsBySender"].update({key: {"allow": ["*"]} for key in keys})
        prepare.ensure_group_image_policies(config["channels"]["whatsapp"], keys)
        prepare.ensure_group_image_policies(config["channels"]["telegram"])
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "openclaw.json"
            target.write_text(json.dumps(config))
            env = {**os.environ, "OPENCLAW_CONFIG_PATH": str(target),
                   "OPENCLAW_9ROUTER_API_KEY": "fixture-only"}
            result = subprocess.run(["node", str(cli), "config", "validate", "--json"],
                                    cwd=root, env=env, capture_output=True, text=True, check=True)
            self.assertTrue(json.loads(result.stdout)["valid"])

    def test_unexpected_group_restrictions_fail_closed(self):
        for group in ({"tools": {"deny": ["exec"]}},
                      {"toolsBySender": {"id:another-person": {"allow": ["*"]}}}):
            with self.subTest(group=group):
                channel = {"groups": {"*": copy.deepcopy(group)}}
                with self.assertRaisesRegex(SystemExit, "unexpected group"):
                    prepare.ensure_group_image_policies(channel, prepare.owner_tool_policy_keys("+15555550123"))
        with self.assertRaisesRegex(SystemExit, "groups must be an object"):
            prepare.ensure_group_image_policies({"groups": []})


if __name__ == "__main__":
    unittest.main()
