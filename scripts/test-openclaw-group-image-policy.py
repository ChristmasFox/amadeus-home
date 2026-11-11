#!/usr/bin/env python3
"""Source-managed group policy is additive only for scoped native capabilities."""
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
from openclaw_test_runtime import patch_pinned_runtime_tree


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
            self.assertEqual(group["tools"], {"allow": list(prepare.GROUP_IMAGE_TOOL_ALLOWLIST)})
            self.assertIn("steam_friends_status", group["tools"]["allow"])
            self.assertNotIn("toolsBySender", group, "the group tool set is the same for every sender")
            allow = group["tools"]["allow"]
            self.assertNotIn("*", allow)
            self.assertEqual(len(allow), 37)
            self.assertEqual(len(allow), len(set(allow)), "no duplicates")
            self.assertTrue(set(prepare.GROUP_BASE_TOOL_ALLOWLIST) <= set(allow))
            self.assertTrue(set(prepare.GROUP_OWNER_EXTRA_TOOL_ALLOWLIST) <= set(allow))
            for forbidden in ("exec", "read", "write", "edit", "apply_patch", "gateway") + tuple(
                    name for name in allow if name.startswith("amadeus_vps_")):
                self.assertNotIn(forbidden, allow)
        self.assertFalse(channel["groups"]["*"]["requireMention"])
        self.assertTrue(channel["groups"]["fixture-group"]["requireMention"])
        self.assertEqual(set(channel["groups"]), {"*", "fixture-group"}, "admission keys must not be added or removed")
        once = copy.deepcopy(channel)
        prepare.ensure_group_image_policies(channel, keys)
        self.assertEqual(channel, once, "prepare must be idempotent")

    def test_legacy_owner_rules_are_removed_and_global_owner_stays_full(self):
        keys = prepare.owner_tool_policy_keys("+15555550123")
        for legacy in ({"allow": ["*"]}, {"allow": list(prepare.GROUP_OWNER_TOOL_ALLOWLIST)}):
            channel = {"groups": {"*": {"requireMention": False, "tools": {"allow": list(prepare.GROUP_BASE_TOOL_ALLOWLIST)},
                                        "toolsBySender": {key: dict(legacy) for key in keys}}}}
            prepare.ensure_group_image_policies(channel, keys)
            self.assertNotIn("toolsBySender", channel["groups"]["*"])
            self.assertEqual(channel["groups"]["*"]["tools"], {"allow": list(prepare.GROUP_IMAGE_TOOL_ALLOWLIST)})
        # Direct chats and the global owner rule are not touched by the group policy: they keep the wildcard.
        config = {"tools": {}, "channels": {"whatsapp": {}, "telegram": {}}}
        owner_rules = {key: {"allow": ["*"]} for key in keys}
        config["tools"]["toolsBySender"] = {"*": {"allow": prepare.NON_OWNER_TOOL_ALLOWLIST}, **owner_rules}
        prepare.ensure_group_image_policies(config["channels"]["whatsapp"], keys)
        for key in keys:
            self.assertEqual(config["tools"]["toolsBySender"][key], {"allow": ["*"]})

    def test_heartbeat_is_switched_off_without_touching_other_agent_defaults(self):
        config = {"agents": {"defaults": {"workspace": "/w", "heartbeat": {"every": "30m", "target": "none"}}}}
        prepare.ensure_heartbeat_disabled(config)
        self.assertEqual(config["agents"]["defaults"]["heartbeat"], {"every": "0m", "target": "none"})
        self.assertEqual(config["agents"]["defaults"]["workspace"], "/w")
        empty = {}
        prepare.ensure_heartbeat_disabled(empty)
        prepare.ensure_heartbeat_disabled(empty)
        self.assertEqual(empty, {"agents": {"defaults": {"heartbeat": {"every": "0m"}}}})
        template = json.loads((Path(__file__).resolve().parents[1] / "integrations/openclaw/openclaw.json.example").read_text())
        self.assertEqual(template["agents"]["defaults"]["heartbeat"]["every"], "0m")
        for channel in ("whatsapp", "telegram"):
            self.assertEqual(template["channels"][channel]["groups"]["*"]["tools"]["allow"], list(prepare.GROUP_IMAGE_TOOL_ALLOWLIST))
            self.assertNotIn("toolsBySender", template["channels"][channel]["groups"]["*"])

    def test_group_owner_gate_refuses_exactly_the_owner_extras(self):
        """The plugin must refuse, at run time, every tool that became visible to all senders."""
        import re
        source = (Path(__file__).resolve().parents[1] / "plugins/amadeus/src/group-owner-gate.ts").read_text()
        listed = re.search(r"GROUP_OWNER_ONLY_TOOLS: readonly string\[\] = \[(.*?)\];", source, re.S).group(1)
        self.assertEqual(re.findall(r"'([a-z_]+)'", listed), list(prepare.GROUP_OWNER_EXTRA_TOOL_ALLOWLIST))

    def test_telegram_group_has_no_owner_wildcard_or_direct_change(self):
        channel = {"direct": {"*": {"tools": {"deny": ["exec"]}}},
                   "groups": {"*": {"requireMention": False}}}
        before = copy.deepcopy(channel["direct"])
        prepare.ensure_group_image_policies(channel)
        self.assertEqual(channel["direct"], before)
        self.assertEqual(channel["groups"]["*"]["tools"], {"allow": list(prepare.GROUP_IMAGE_TOOL_ALLOWLIST)})
        self.assertIn("steam_friends_status", channel["groups"]["*"]["tools"]["allow"])
        self.assertNotIn("toolsBySender", channel["groups"]["*"])

    def test_legacy_group_image_policy_is_upgraded_to_include_pubg_tools(self):
        channel = {"groups": {"*": {"requireMention": False,
                                    "tools": {"allow": ["web_search", "web_fetch", "image_generate"]}}}}
        prepare.ensure_group_image_policies(channel)
        self.assertEqual(channel["groups"]["*"]["tools"]["allow"], prepare.GROUP_IMAGE_TOOL_ALLOWLIST)

    def test_previous_pubg_group_policy_is_upgraded_to_include_mac_host_tools(self):
        channel = {"groups": {"*": {"requireMention": False,
                                    "tools": {"allow": prepare.LEGACY_GROUP_PUBG_TOOL_ALLOWLIST}}}}
        prepare.ensure_group_image_policies(channel)
        self.assertEqual(channel["groups"]["*"]["tools"]["allow"], prepare.GROUP_IMAGE_TOOL_ALLOWLIST)

    def test_prepared_group_owner_rules_validate_under_pinned_runtime(self):
        root = Path(__file__).resolve().parents[1]
        cli = root / "node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/openclaw.mjs"
        if not cli.is_file():
            self.skipTest("pinned OpenClaw npm dependency is not installed")
        config = json.loads((root / "integrations/openclaw/openclaw.json.example").read_text())
        config["channels"]["telegram"]["allowFrom"] = ["123456789"]
        keys = prepare.owner_tool_policy_keys("+15555550123")
        config["tools"]["toolsBySender"].update({key: {"allow": ["*"]} for key in keys})
        prepare.ensure_group_image_policies(config["channels"]["whatsapp"], keys)
        prepare.ensure_group_image_policies(config["channels"]["telegram"])
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            patched_extensions = patch_pinned_runtime_tree(cli.parent / "dist", temporary / "dist", root)
            target = temporary / "openclaw.json"
            target.write_text(json.dumps(config))
            env = {**os.environ, "OPENCLAW_CONFIG_PATH": str(target),
                   "OPENCLAW_9ROUTER_API_KEY": "fixture-only",
                   "OPENCLAW_BUNDLED_PLUGINS_DIR": str(patched_extensions),
                   "OPENCLAW_TEST_TRUST_BUNDLED_PLUGINS_DIR": "1",
                   "VITEST": "1"}
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

    def test_previous_steam_lists_are_migrated(self):
        """Live configs from before each later Steam tool (achievements, friends, owned games) upgrade in place."""
        keys = prepare.owner_tool_policy_keys("+15555550123")
        for tools, owner in ((prepare.LEGACY_GROUP_NO_ACHIEVEMENTS_TOOL_ALLOWLIST, prepare.LEGACY_GROUP_OWNER_NO_ACHIEVEMENTS_TOOL_ALLOWLIST),
                             (prepare.LEGACY_GROUP_NO_FRIENDS_TOOL_ALLOWLIST, prepare.LEGACY_GROUP_OWNER_NO_FRIENDS_TOOL_ALLOWLIST),
                             (prepare.LEGACY_GROUP_NO_OWNED_TOOL_ALLOWLIST, prepare.LEGACY_GROUP_OWNER_NO_OWNED_TOOL_ALLOWLIST),
                             (prepare.LEGACY_GROUP_NO_BATCH_TOOL_ALLOWLIST, prepare.LEGACY_GROUP_OWNER_NO_BATCH_TOOL_ALLOWLIST)):
            channel = {"groups": {"*": {"tools": {"allow": list(tools)}, "toolsBySender": {key: {"allow": list(owner)} for key in keys}}}}
            prepare.ensure_group_image_policies(channel, keys)
            group = channel["groups"]["*"]
            for name in ("steam_get_achievements", "steam_friends_status", "steam_get_owned_games", "steam_get_account_info", "steam_game_info", "steam_get_game_stats", "steam_library_overlap"):
                self.assertIn(name, group["tools"]["allow"])
            self.assertNotIn("toolsBySender", group)
        self.assertEqual(len(prepare.LEGACY_GROUP_NO_BATCH_TOOL_ALLOWLIST) + 4, len(prepare.GROUP_BASE_TOOL_ALLOWLIST))

    def test_core_patch_passes_every_group_tool_except_the_core_web_pair(self):
        """The pinned core patch lets only the tools it lists through the global sender layer; a group
        allowlist tool missing there silently never reaches non-owners (Steam did exactly that)."""
        import re
        source = Path(__file__).with_name("patch-openclaw-group-image-policy.mjs").read_text()
        exported = re.search(r"GROUP_READONLY_CAPABILITY_TOOLS = \[(.*?)\];", source, re.S).group(1)
        inline = re.search(r"const groupCapabilityTools = \[(.*?)\];", source, re.S).group(1)
        names = lambda text: set(re.findall(r"'([a-z_]+)'", text))
        wanted = set(prepare.GROUP_IMAGE_TOOL_ALLOWLIST) - set(prepare.NON_OWNER_TOOL_ALLOWLIST)
        self.assertEqual(names(exported), wanted)
        self.assertEqual(names(inline), wanted)


if __name__ == "__main__":
    unittest.main()
