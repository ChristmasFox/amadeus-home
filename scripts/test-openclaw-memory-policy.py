#!/usr/bin/env python3
"""Test the derived Telegram Dreaming allowlist and explicit Memory Core config."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import stat
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("openclaw_prepare", ROOT / "scripts/openclaw_prepare.py")
prepare = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = prepare
spec.loader.exec_module(prepare)
prepare.ensure_owner = lambda path, mode=0o600: os.chmod(path, mode)

content = prepare.telegram_peer_allowlist_content([123456789, "telegram:987654321", "123456789"])
assert content == b"telegram:123456789\ntelegram:987654321\n"
for values in ([], ["*"], [0], [-12], [True], ["123@telegram"], ["123456789012345678901"]):
    try:
        prepare.telegram_peer_allowlist_content(values)
    except SystemExit:
        pass
    else:
        raise AssertionError("invalid Telegram allowFrom must be rejected")

with tempfile.TemporaryDirectory(prefix="openclaw-memory-policy-test-") as temporary:
    base = Path(temporary)
    allowlist = base / "dreaming-telegram-peer"
    prepare.ensure_telegram_peer_allowlist(allowlist, content)
    assert allowlist.read_bytes() == content
    assert stat.S_IMODE(allowlist.stat().st_mode) == 0o600
    prepare.ensure_telegram_peer_allowlist(allowlist, content)
    try:
        prepare.ensure_telegram_peer_allowlist(allowlist, b"telegram:111222333\n")
    except SystemExit:
        pass
    else:
        raise AssertionError("mismatched runtime allowlist must fail closed")
    assert allowlist.read_bytes() == content

    symlink_target = base / "symlink-target"
    symlink_target.write_text("preserve\n")
    symlink = base / "symlink-allowlist"
    symlink.symlink_to(symlink_target)
    try:
        prepare.ensure_telegram_peer_allowlist(symlink, content)
    except SystemExit:
        pass
    else:
        raise AssertionError("symlink allowlist must fail closed")
    assert symlink_target.read_text() == "preserve\n"

    directory = base / "directory-allowlist"
    directory.mkdir()
    try:
        prepare.ensure_telegram_peer_allowlist(directory, content)
    except SystemExit:
        pass
    else:
        raise AssertionError("directory allowlist must fail closed")

    hardlink_source = base / "hardlink-source"
    hardlink_source.write_bytes(content)
    hardlink = base / "hardlink-allowlist"
    os.link(hardlink_source, hardlink)
    try:
        prepare.ensure_telegram_peer_allowlist(hardlink, content)
    except SystemExit:
        pass
    else:
        raise AssertionError("hard-linked allowlist must fail closed")
    assert hardlink_source.read_bytes() == content

config = json.loads((ROOT / "integrations/openclaw/openclaw.json.example").read_text())
template_memory = copy.deepcopy(config["memory"])
template_memory_slot = config["plugins"]["slots"]["memory"]
existing_config = {
    "commands": {"ownerAllowFrom": ["whatsapp:owner-fixture"]},
    "meta": {"operatorValue": "preserve-me"},
    "security": {"operatorPolicy": "preserve-me"},
    "channels": {
        "whatsapp": {
            "allowFrom": ["whatsapp:owner-fixture"],
            "accounts": {"primary": {"operatorValue": "preserve-me"}},
        }
    },
    "memory": {"search": {"enabled": False}},
    "plugins": {"slots": {"memory": "legacy-memory-provider"}},
}
prepare.merge_preserved(config, existing_config)
assert config["memory"] == template_memory, "managed Memory Core config must reach the final merged config"
assert config["plugins"]["slots"]["memory"] == template_memory_slot
assert config["commands"] == existing_config["commands"]
assert config["meta"] == existing_config["meta"]
assert config["security"] == existing_config["security"]
assert (
    config["channels"]["whatsapp"]["allowFrom"]
    == existing_config["channels"]["whatsapp"]["allowFrom"]
)
assert (
    config["channels"]["whatsapp"]["accounts"]
    == existing_config["channels"]["whatsapp"]["accounts"]
)
assert config["memory"]["search"]["enabled"] is True
assert config["memory"]["search"]["sources"] == ["memory"]
assert config["memory"]["search"]["rememberAcrossConversations"] is False
assert config["memory"]["search"]["store"]["fts"]["tokenizer"] == "trigram", "CJK keyword search needs the trigram FTS tokenizer"
assert config["memory"]["search"]["query"]["minScore"] == 0.25
assert config["hooks"]["internal"]["entries"]["session-memory"]["messages"] == 200
assert "memory-core" in config["plugins"]["allow"]
assert config["plugins"]["slots"]["memory"] == "memory-core"
memory_core = config["plugins"]["entries"]["memory-core"]
assert memory_core["enabled"] is True
assert memory_core["config"]["dreaming"] == {"enabled": True, "frequency": "0 3 * * *", "timezone": "Asia/Shanghai"}
assert memory_core["config"]["memoryPolicy"]["allowlistedDirectPeerFiles"]["telegram"] == "/home/node/.openclaw/dreaming-telegram-peer"

print("OPENCLAW_MEMORY_POLICY_TEST=passed telegram_allowlist=6 private_file=5 explicit_provider=6")
