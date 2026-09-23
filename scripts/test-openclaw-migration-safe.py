#!/usr/bin/env python3
"""Fixture tests for the migration-safe OpenClaw configuration overlay."""

from __future__ import annotations

import json
import stat
import subprocess
import tempfile
from pathlib import Path

from openclaw_migration_safe_config import MigrationConfigError, build_overlay, write_overlay
from openclaw_migration_safe_preflight import (
    MigrationPreflightError,
    install_canonical_compose,
    render_canonical_compose,
    validate_compose_project,
)


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
    assert "ownerNotificationDeliveryEnabled" not in overlay["plugins"]["entries"]["amadeus"]["config"]
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


def rendered_compose(image: str = "local/openclaw-amadeus:git-123456789abc-20260923123456", ports=None):
    return {
        "services": {
            "openclaw": {
                "image": image,
                "ports": [] if ports is None else ports,
                "environment": {
                    "OPENCLAW_CONFIG_PATH": "/run/openclaw-migration/openclaw.json",
                    "OWNER_NOTIFICATION_DELIVERY_ENABLED": "false",
                },
                "restart": "no",
                "volumes": [{
                    "target": "/run/openclaw-migration",
                    "read_only": True,
                }],
            },
        },
    }


with tempfile.TemporaryDirectory(prefix="openclaw-compose-preflight-test-") as temporary:
    root = Path(temporary)
    app = root / "openclaw"
    app.mkdir()
    compose = app / "docker-compose.yml"
    overlay = root / "migration-safe.yml"
    compose.write_text("services: {}\n")
    overlay.write_text("services: {}\n")

    missing_app = root / "missing"
    try:
        validate_compose_project(missing_app, overlay, run=lambda *_args, **_kwargs: None)
    except MigrationPreflightError as error:
        assert "canonical Compose" in str(error)
    else:
        raise AssertionError("missing canonical Compose did not fail closed")

    calls = []

    def successful_runner(command, **_kwargs):
        calls.append(command)
        if command[:2] == ["docker", "compose"]:
            return subprocess.CompletedProcess(command, 0, json.dumps(rendered_compose()), "")
        if command[:3] == ["docker", "image", "inspect"]:
            return subprocess.CompletedProcess(command, 0, "[]", "")
        raise AssertionError(f"unexpected command: {command}")

    image = validate_compose_project(app, overlay, run=successful_runner)
    assert image == "local/openclaw-amadeus:git-123456789abc-20260923123456"
    assert len(calls) == 2 and calls[1] == ["docker", "image", "inspect", image]

    def expect_preflight_failure(document, inspect_status=0, expected=""):
        def runner(command, **_kwargs):
            if command[:2] == ["docker", "compose"]:
                return subprocess.CompletedProcess(command, 0, json.dumps(document), "")
            return subprocess.CompletedProcess(command, inspect_status, "", "")

        try:
            validate_compose_project(app, overlay, run=runner)
        except MigrationPreflightError as error:
            assert expected in str(error)
        else:
            raise AssertionError(f"preflight should fail: {expected}")

    expect_preflight_failure(
        rendered_compose(image="local/openclaw-amadeus:unbuilt"),
        expected="immutable local Git-and-timestamp tag",
    )
    expect_preflight_failure(
        rendered_compose(ports=[{"target": 18789}]),
        expected="still publishes ports",
    )
    expect_preflight_failure(
        rendered_compose(), inspect_status=1, expected="not loaded locally",
    )

    template = "services:\n  openclaw:\n    image: ${OPENCLAW_IMAGE:-local/openclaw-amadeus:unbuilt}\n"
    tag = "local/openclaw-amadeus:git-123456789abc-20260923123456"
    rendered = render_canonical_compose(template, tag)
    assert rendered == f"services:\n  openclaw:\n    image: {tag}\n".encode()
    installed_dir = root / "new-app"
    installed_file = installed_dir / "docker-compose.yml"
    assert install_canonical_compose(template, installed_file, tag) == "installed"
    assert installed_file.read_bytes() == rendered
    assert install_canonical_compose(template, installed_file, tag) == "already-identical"

    installed_file.write_text("operator-owned definition\n")
    try:
        install_canonical_compose(template, installed_file, tag)
    except MigrationPreflightError as error:
        assert "refusing to overwrite" in str(error)
    else:
        raise AssertionError("conflicting Compose was overwritten")

    occupied_dir = root / "occupied-app"
    occupied_dir.mkdir()
    (occupied_dir / "operator-data").write_text("preserve\n")
    try:
        install_canonical_compose(template, occupied_dir / "docker-compose.yml", tag)
    except MigrationPreflightError as error:
        assert "not empty" in str(error)
    else:
        raise AssertionError("non-empty app directory was modified")

    try:
        render_canonical_compose(template, "local/openclaw-amadeus:unbuilt")
    except MigrationPreflightError as error:
        assert "immutable" in str(error)
    else:
        raise AssertionError("mutable image tag was accepted")

print("OPENCLAW_MIGRATION_SAFE_CONFIG_TEST=passed")
