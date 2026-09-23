#!/usr/bin/env python3
"""Fixture tests for the migration-safe OpenClaw configuration overlay."""

from __future__ import annotations

import json
import stat
import subprocess
import tempfile
from pathlib import Path

from openclaw_migration_safe_config import MigrationConfigError, build_overlay, write_overlay


ingress_fixture = """openclaw local/openclaw-amadeus:test
frpc snowdreamtech/frpc:latest
nginx-proxy-manager jc21/nginx-proxy-manager:latest
npm example/unrelated:latest
changedetection dgtlmoon/changedetection.io:latest
"""
ingress_count = subprocess.run(
    ["awk", "-f", str(Path(__file__).with_name("openclaw-ingress-count.awk"))],
    input=ingress_fixture,
    check=True,
    capture_output=True,
    text=True,
).stdout.strip()
assert ingress_count == "3"


with tempfile.TemporaryDirectory(prefix="openclaw-migration-safe-test-") as temporary:
    root = Path(temporary)
    canonical = root / "openclaw.json"
    original = {
        "gateway": {
            "mode": "local",
            "bind": "lan",
            "publicOrigin": "https://private.example.invalid",
            "trustedProxies": ["172.0.0.1"],
            "tailscale": {"mode": "funnel"},
            "controlUi": {"enabled": True, "allowedOrigins": ["https://private.example.invalid"]},
        },
        "channels": {
            "telegram": {"enabled": True, "tokenFile": "/run/secrets/telegram"},
            "whatsapp": {"enabled": True, "accounts": {"secondary": {"enabled": True}}},
            "kook": {"enabled": True},
        },
        "plugins": {
            "allow": ["pubg", "amadeus", "telegram", "whatsapp"],
            "entries": {
                "pubg": {"enabled": True},
                "amadeus": {"enabled": True, "config": {"ownerTargetFile": "/run/secrets/owner"}},
                "telegram": {"enabled": True},
                "whatsapp": {"enabled": True},
            },
        },
        "agents": {"defaults": {"workspace": "/home/node/.openclaw/workspace"}},
    }
    canonical.write_text(json.dumps(original, indent=2) + "\n")
    before = canonical.read_bytes()
    summary, _payload = build_overlay(canonical)
    assert summary["disabledChannels"] == 3
    overlay_path = root / "run" / "migration-safe" / "openclaw.json"
    digest, count = write_overlay(canonical, overlay_path)
    assert len(digest) == 64 and count == 3
    assert canonical.read_bytes() == before
    assert stat.S_IMODE(overlay_path.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(overlay_path.stat().st_mode) == 0o600
    overlay = json.loads(overlay_path.read_text())
    assert overlay["gateway"]["mode"] == "local"
    assert overlay["gateway"]["bind"] == "loopback"
    assert "publicOrigin" not in overlay["gateway"]
    assert overlay["gateway"]["tailscale"]["mode"] == "off"
    assert set(overlay["gateway"]["controlUi"]["allowedOrigins"]) == {
        "http://127.0.0.1:18789", "http://localhost:18789",
    }
    assert all(item["enabled"] is False for item in overlay["channels"].values())
    assert overlay["plugins"]["entries"]["amadeus"]["enabled"] is True
    assert overlay["plugins"]["entries"]["amadeus"]["config"]["ownerNotificationDeliveryEnabled"] is False
    assert overlay["plugins"]["entries"]["telegram"]["enabled"] is False
    assert overlay["plugins"]["entries"]["whatsapp"]["enabled"] is False
    assert overlay["agents"]["defaults"]["workspace"] == original["agents"]["defaults"]["workspace"]
    assert write_overlay(canonical, overlay_path)[0] == digest

    overlay_path.write_text("different content")
    try:
        write_overlay(canonical, overlay_path)
    except MigrationConfigError:
        pass
    else:
        raise AssertionError("conflicting pre-existing overlay was silently overwritten")

    json5 = root / "openclaw-json5.json"
    json5.write_text("{ gateway: { mode: 'local' } }")
    try:
        build_overlay(json5)
    except MigrationConfigError:
        pass
    else:
        raise AssertionError("non-JSON config did not fail closed")

print("OPENCLAW_MIGRATION_SAFE_CONFIG_TEST=passed")
