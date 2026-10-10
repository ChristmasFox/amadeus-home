#!/usr/bin/env python3
"""Restricted tc command planner for the daily traffic fuse.

The executable accepts only ``status``, ``apply`` and ``release``.  It never
accepts an interface, qdisc handle, rate, or arbitrary command from OpenClaw.
The configured interface and SSH port come from a root-owned config file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Sequence


OWNED_HANDLE = "1a:"
BUSINESS_CLASS = "1a:20"
CONTROL_CLASS = "1a:10"
RATE = "2mbit"
CONTROL_RATE = "256kbit"
IFACE_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,15}$")


@dataclass(frozen=True)
class FuseConfig:
    interface: str
    ssh_port: int = 22

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "FuseConfig":
        interface = value.get("interface")
        port = value.get("sshPort", 22)
        if not isinstance(interface, str) or not IFACE_RE.fullmatch(interface):
            raise ValueError("invalid fixed WAN interface")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError("invalid fixed SSH port")
        return cls(interface=interface, ssh_port=port)


def root_qdisc(qdisc_json: Any) -> dict[str, Any] | None:
    if not isinstance(qdisc_json, list):
        raise ValueError("tc qdisc JSON must be an array")
    roots = [item for item in qdisc_json if isinstance(item, dict) and item.get("parent") in (None, "root")]
    if len(roots) > 1:
        raise ValueError("multiple root qdiscs")
    return roots[0] if roots else None


def owned_root(qdisc: dict[str, Any] | None) -> bool:
    if not qdisc:
        return False
    handle = str(qdisc.get("handle", ""))
    return handle in {OWNED_HANDLE, OWNED_HANDLE.rstrip(":")}


def plan_apply(config: FuseConfig, qdisc_json: Any) -> list[list[str]]:
    root = root_qdisc(qdisc_json)
    if root and not owned_root(root):
        kind = root.get("kind", "unknown")
        raise RuntimeError(f"foreign root qdisc {kind} present; no safe business-only composition is available, refusing destructive replacement")
    base = ["tc", "qdisc", "replace", "dev", config.interface, "root", "handle", OWNED_HANDLE, "htb", "default", "20"]
    commands = [
        base,
        ["tc", "class", "replace", "dev", config.interface, "parent", OWNED_HANDLE, "classid", "1a:1", "htb", "rate", RATE],
        ["tc", "class", "replace", "dev", config.interface, "parent", "1a:1", "classid", CONTROL_CLASS, "htb", "rate", CONTROL_RATE, "ceil", RATE],
        ["tc", "class", "replace", "dev", config.interface, "parent", "1a:1", "classid", BUSINESS_CLASS, "htb", "rate", RATE, "ceil", RATE],
    ]
    for priority, protocol, port_key in (
        (10, "ip", "dst_port"),
        (11, "ip", "src_port"),
        (12, "ipv6", "dst_port"),
        (13, "ipv6", "src_port"),
    ):
        commands.append([
            "tc", "filter", "replace", "dev", config.interface, "protocol", protocol,
            "parent", OWNED_HANDLE, "prio", str(priority), "flower", "ip_proto", "tcp",
            port_key, str(config.ssh_port), "flowid", CONTROL_CLASS,
        ])
    return commands


def plan_release(config: FuseConfig, qdisc_json: Any) -> list[list[str]]:
    root = root_qdisc(qdisc_json)
    if root is None:
        return []
    if not owned_root(root):
        raise RuntimeError("foreign root qdisc present; refusing release")
    return [["tc", "qdisc", "del", "dev", config.interface, "root"]]


def verify_apply(qdisc_json: Any) -> bool:
    return owned_root(root_qdisc(qdisc_json))


def verify_release(qdisc_json: Any) -> bool:
    return root_qdisc(qdisc_json) is None or not owned_root(root_qdisc(qdisc_json))


def tc_json(*args: str) -> Any:
    result = subprocess.run(["tc", "-j", *args], check=True, capture_output=True, text=True, timeout=10)
    return json.loads(result.stdout or "[]")


def run(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="fixed Amadeus traffic-fuse tc helper")
    parser.add_argument("--config", default="/etc/amadeus/traffic-fuse.json")
    parser.add_argument("operation", choices=("status", "apply", "release"))
    args = parser.parse_args(argv)
    stat = os.stat(args.config)
    if stat.st_uid != 0 or stat.st_mode & 0o022:
        raise PermissionError("traffic-fuse config must be root-owned and not group/world writable")
    with open(args.config, encoding="utf-8") as handle:
        config = FuseConfig.from_mapping(json.load(handle))
    qdisc_json = tc_json("qdisc", "show", "dev", config.interface)
    root = root_qdisc(qdisc_json)
    if args.operation == "status":
        print(json.dumps({
            "interface": config.interface,
            "owned": owned_root(root),
            "root": root,
            "classes": tc_json("class", "show", "dev", config.interface),
            "filters": tc_json("filter", "show", "dev", config.interface),
        }, separators=(",", ":")))
        return 0
    commands = plan_apply(config, qdisc_json) if args.operation == "apply" else plan_release(config, qdisc_json)
    for command in commands:
        subprocess.run(command, check=True)
    after = tc_json("qdisc", "show", "dev", config.interface)
    verified = verify_apply(after) if args.operation == "apply" else verify_release(after)
    if not verified:
        raise RuntimeError(f"tc {args.operation} read-back did not match the fuse-owned state")
    print(json.dumps({"interface": config.interface, "operation": args.operation, "verified": True}, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
