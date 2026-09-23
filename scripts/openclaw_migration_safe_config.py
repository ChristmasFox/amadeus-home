#!/usr/bin/env python3
"""Create a temporary OpenClaw config overlay that keeps the canonical restore untouched."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path


class MigrationConfigError(RuntimeError):
    pass


def build_overlay(source: Path) -> tuple[dict, bytes]:
    path = Path(source)
    if path.is_symlink() or not path.is_file():
        raise MigrationConfigError("canonical OpenClaw config is missing or symlinked")
    try:
        original = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MigrationConfigError("canonical config is not strict JSON; refusing an unsafe rewrite") from exc
    if not isinstance(original, dict):
        raise MigrationConfigError("canonical OpenClaw config root must be an object")
    overlay = json.loads(json.dumps(original))

    gateway = overlay.get("gateway")
    if not isinstance(gateway, dict):
        raise MigrationConfigError("canonical config has no gateway object")
    gateway["mode"] = "local"
    gateway["bind"] = "loopback"
    gateway.pop("publicOrigin", None)
    gateway.pop("trustedProxies", None)
    tailscale = gateway.setdefault("tailscale", {})
    if not isinstance(tailscale, dict):
        raise MigrationConfigError("gateway.tailscale must be an object")
    tailscale["mode"] = "off"
    control_ui = gateway.setdefault("controlUi", {})
    if not isinstance(control_ui, dict):
        raise MigrationConfigError("gateway.controlUi must be an object")
    control_ui["allowedOrigins"] = ["http://127.0.0.1:18789", "http://localhost:18789"]

    channels = overlay.get("channels")
    if not isinstance(channels, dict) or not {"telegram", "whatsapp"}.issubset(channels):
        raise MigrationConfigError("canonical Telegram and WhatsApp channel sections are required")
    disabled_channels = 0
    for channel in channels.values():
        if not isinstance(channel, dict):
            raise MigrationConfigError("channel config section must be an object")
        channel["enabled"] = False
        disabled_channels += 1

    plugins = overlay.get("plugins")
    if not isinstance(plugins, dict):
        raise MigrationConfigError("canonical config has no plugins object")
    entries = plugins.get("entries")
    if not isinstance(entries, dict):
        raise MigrationConfigError("canonical plugin entries are unavailable")
    amadeus = entries.get("amadeus")
    if not isinstance(amadeus, dict) or amadeus.get("enabled") is not True:
        raise MigrationConfigError("Amadeus plugin must remain enabled for local validation")
    if not isinstance(amadeus.get("config"), dict):
        raise MigrationConfigError("Amadeus plugin config is unavailable")
    for plugin_name in ("telegram", "whatsapp", "kook"):
        plugin = entries.get(plugin_name)
        if isinstance(plugin, dict):
            plugin["enabled"] = False

    payload = (json.dumps(overlay, sort_keys=True, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    return {"disabledChannels": disabled_channels, "config": overlay}, payload


def write_overlay(source: Path, output: Path) -> tuple[str, int]:
    _summary, payload = build_overlay(source)
    destination = Path(output)
    if destination.is_symlink():
        raise MigrationConfigError("migration overlay destination is a symlink")
    source_real = Path(source).resolve()
    if destination.resolve() == source_real:
        raise MigrationConfigError("migration overlay must not replace canonical config")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(destination.parent, 0o700)
    if os.geteuid() == 0:
        os.chown(destination.parent, 1000, 1000)
    if destination.exists():
        if not destination.is_file() or destination.read_bytes() != payload:
            raise MigrationConfigError("migration overlay already exists with different content")
        if os.geteuid() == 0:
            os.chown(destination, 1000, 1000)
        os.chmod(destination, 0o600)
        return hashlib.sha256(payload).hexdigest(), len(_summary["config"]["channels"])
    temporary = destination.with_name(f".{destination.name}.{secrets.token_hex(8)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        if os.geteuid() == 0:
            os.chown(destination, 1000, 1000)
        os.chmod(destination, 0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
    return hashlib.sha256(payload).hexdigest(), len(_summary["config"]["channels"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--approve-avalon-move", default="")
    args = parser.parse_args()
    summary, payload = build_overlay(args.source)
    digest = hashlib.sha256(payload).hexdigest()
    if not args.apply:
        print(f"MIGRATION_SAFE_CONFIG=PLAN channelsDisabled={summary['disabledChannels']} ownerDelivery=disabled bind=loopback canonicalUnchanged=yes SHA256={digest}")
        return 0
    if args.approve_avalon_move != "APPROVE_AVALON_MOVE_1_4_8":
        raise MigrationConfigError("overlay apply requires exact APPROVE_AVALON_MOVE_1_4_8")
    actual_digest, count = write_overlay(args.source, args.output)
    print(f"MIGRATION_SAFE_CONFIG=written channelsDisabled={count} ownerDelivery=disabled bind=loopback SHA256={actual_digest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MigrationConfigError as exc:
        print(f"MIGRATION_SAFE_CONFIG_ERROR={exc}", file=sys.stderr)
        raise SystemExit(1)
