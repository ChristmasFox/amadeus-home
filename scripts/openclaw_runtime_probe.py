#!/usr/bin/env python3
"""Emit sanitized facts about the migration-safe destination OpenClaw candidate."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


OPENCLAW_RE = re.compile(r"openclaw", re.IGNORECASE)
INGRESS_RE = re.compile(r"frpc|nginx-proxy-manager|nginxproxymanager|jc21/nginx-proxy-manager", re.IGNORECASE)


def _run_json(command: list[str]):
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def destination_snapshot() -> dict:
    rows = subprocess.run(
        ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"], check=True, capture_output=True, text=True
    ).stdout.splitlines()
    openclaw_rows = [row for row in rows if OPENCLAW_RE.search(row)]
    ingress_rows = [row for row in rows if INGRESS_RE.search(row)]
    radar_rows = [row for row in rows if re.search(r"product-radar", row, re.IGNORECASE)]

    safe = False
    if len(openclaw_rows) == 1:
        try:
            inspection = _run_json(["docker", "inspect", "openclaw"])[0]
            environment = dict(item.split("=", 1) for item in inspection["Config"].get("Env", []) if "=" in item)
            bindings = inspection.get("HostConfig", {}).get("PortBindings") or {}
            restart = inspection.get("HostConfig", {}).get("RestartPolicy", {}).get("Name")
            mounts = inspection.get("Mounts", [])
            config = json.loads(Path("/run/openclaw-migration-safe/openclaw.json").read_text(encoding="utf-8"))
            channels = config.get("channels", {})
            amadeus = config.get("plugins", {}).get("entries", {}).get("amadeus", {})
            safe_config = (
                config.get("gateway", {}).get("mode") == "local"
                and config.get("gateway", {}).get("bind") == "loopback"
                and config.get("gateway", {}).get("tailscale", {}).get("mode") == "off"
                and bool(channels)
                and all(isinstance(section, dict) and section.get("enabled") is False for section in channels.values())
                and amadeus.get("enabled") is True
                and amadeus.get("config", {}).get("ownerNotificationDeliveryEnabled") is False
            )
            config_mount = any(
                item.get("Destination") == "/run/openclaw-migration"
                and item.get("Source") == "/run/openclaw-migration-safe"
                and item.get("RW") is False
                for item in mounts
            )
            safe = (
                inspection.get("State", {}).get("Status") == "running"
                and str(inspection.get("Config", {}).get("Image", "")).startswith("local/openclaw-amadeus:")
                and environment.get("OPENCLAW_STATE_DIR") == "/home/node/.openclaw"
                and environment.get("OPENCLAW_CONFIG_PATH") == "/run/openclaw-migration/openclaw.json"
                and environment.get("OWNER_NOTIFICATION_DELIVERY_ENABLED", "").lower() == "false"
                and not bindings
                and restart in ("no", "")
                and config_mount
                and safe_config
                and not ingress_rows
                and not radar_rows
            )
        except (OSError, ValueError, KeyError, IndexError, subprocess.CalledProcessError, json.JSONDecodeError):
            safe = False
    return {
        "destinationCandidateCount": len(openclaw_rows),
        "destinationSafeMode": safe,
        "destinationIngressCount": len(ingress_rows),
        "destinationProductRadarCount": len(radar_rows),
    }


def main() -> int:
    result = destination_snapshot()
    print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError):
        print(json.dumps({
            "destinationCandidateCount": -1,
            "destinationSafeMode": False,
            "destinationIngressCount": -1,
            "destinationProductRadarCount": -1,
        }, separators=(",", ":"), sort_keys=True))
        raise SystemExit(1)
