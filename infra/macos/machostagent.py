#!/usr/bin/env python3
"""Bounded, read-only telemetry service for the real Amadeus-M204 host.

The HTTP surface is intentionally a fixed allow-list. There is no command
name, argv, shell, sudo, or file path supplied by callers.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import plistlib
import re
import shutil
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = os.environ.get("MACHOSTAGENT_BIND", "127.0.0.1")
PORT = int(os.environ.get("MACHOSTAGENT_PORT", "18791"))
TOKEN_FILE = os.environ.get("MACHOSTAGENT_TOKEN_FILE", "")
AVALON_PATH = os.environ.get("MACHOSTAGENT_AVALON_PATH", "/Volumes/Avalon")
HOST_NAME = os.environ.get("MACHOSTAGENT_HOST_NAME", "Amadeus-M204")
POWER_FILE = Path(os.environ.get("MACHOSTAGENT_POWER_FILE", "/var/run/amadeus-machostagent-power.json"))
POWER_MAX_AGE_SECONDS = 30.0


def run(argv: list[str], timeout: float = 2.0) -> str:
    try:
        result = subprocess.run(argv, check=False, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def number(value: str) -> float | None:
    try:
        value = value.strip()
        return float(value) if value else None
    except ValueError:
        return None


def sysctl(name: str) -> str | None:
    value = run(["/usr/sbin/sysctl", "-n", name])
    return value or None


def memory() -> dict[str, Any]:
    page_size = number(sysctl("hw.pagesize") or "4096") or 4096
    raw = run(["/usr/bin/vm_stat"])
    pages: dict[str, int] = {}
    for line in raw.splitlines():
        match = re.match(r"^(.+?):\s+(\d+)\.", line)
        if match:
            pages[match.group(1)] = int(match.group(2))
    total = number(sysctl("hw.memsize")) or 0
    used_pages = sum(pages.get(key, 0) for key in ("Pages active", "Pages wired down", "Pages occupied by compressor"))
    used = used_pages * page_size
    return {"totalBytes": int(total), "usedBytes": int(used), "usedPercent": round(used / total * 100, 1) if total else None, "pressure": "unknown"}


def disk(path: str) -> dict[str, Any]:
    try:
        usage = shutil.disk_usage(path)
        return {"path": path, "totalBytes": usage.total, "usedBytes": usage.used, "freeBytes": usage.free, "freePercent": round(usage.free / usage.total * 100, 1) if usage.total else None}
    except OSError as exc:
        return {"path": path, "status": "unavailable", "message": type(exc).__name__}


def power() -> dict[str, Any]:
    battery = run(["/usr/bin/pmset", "-g", "batt"])
    base = {"battery": battery[:500] if battery else "unknown"}
    try:
        snapshot = json.loads(POWER_FILE.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return {**base, "telemetry": "degraded", "source": "powermetrics", "powerWatts": None, "powerSummary": None, "message": "privileged power sampler is not installed"}
    updated = snapshot.get("updatedAt") if isinstance(snapshot, dict) else None
    try:
        timestamp = dt.datetime.fromisoformat(str(updated).replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc).timestamp() - timestamp.timestamp()
    except (TypeError, ValueError, OverflowError):
        age = float("inf")
    if not isinstance(snapshot, dict) or snapshot.get("status") != "ok" or age > POWER_MAX_AGE_SECONDS:
        return {**base, "telemetry": "degraded", "source": "powermetrics", "powerWatts": None, "powerSummary": None, "updatedAt": updated, "message": "privileged power sample is unavailable or stale"}
    return {**base, **snapshot, "ageSeconds": round(max(age, 0.0), 1), "powerSummary": "powermetrics SoC estimate"}


def process_rows() -> list[dict[str, Any]]:
    raw = run(["/bin/ps", "-A", "-o", "pid=,pcpu=,pmem=,comm="])
    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        parts = line.strip().split(None, 3)
        if len(parts) != 4:
            continue
        pid, cpu, mem, command = parts
        cpu_num, mem_num = number(cpu), number(mem)
        if cpu_num is None or mem_num is None:
            continue
        rows.append({"pid": int(pid) if pid.isdigit() else None, "cpuPercent": round(cpu_num, 1), "memoryPercent": round(mem_num, 1), "command": command[:160]})
    return rows


def status() -> dict[str, Any]:
    load = [number(part) for part in (sysctl("vm.loadavg") or "").strip("{} ").split()[:3]]
    load = [item for item in load if item is not None]
    uptime_raw = run(["/usr/bin/uptime"])
    root_disk = disk("/")
    avalon_disk = disk(AVALON_PATH)
    cores = int(number(sysctl("hw.logicalcpu") or "0") or 0)
    processes = process_rows()
    cpu_sum = sum(float(row["cpuPercent"]) for row in processes)
    return {
        "status": "ok",
        "host": HOST_NAME,
        "platform": "macos",
        "architecture": sysctl("hw.machine") or "unknown",
        "cpu": {"load": load, "logicalCores": cores, "utilizationPercent": round(cpu_sum / cores, 1) if cores else None},
        "memory": memory(),
        "uptime": uptime_raw[:300] if uptime_raw else "unknown",
        "disks": {"internal": root_disk, "avalon": avalon_disk},
        "network": {"hostname": socket.gethostname(), "interfaces": run(["/sbin/ifconfig"], 2.0)[:1500] or "unknown"},
        "power": power(),
        "services": {"ssh": bool(run(["/usr/bin/pgrep", "-x", "sshd"]))},
        "observedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def auth_token() -> str | None:
    if not TOKEN_FILE:
        return None
    try:
        return Path(TOKEN_FILE).read_text(encoding="utf8").strip() or None
    except OSError:
        return None


class Handler(BaseHTTPRequestHandler):
    server_version = "MacHostAgent/1"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def authorized(self) -> bool:
        expected = auth_token()
        return expected is not None and self.headers.get("Authorization", "") == f"Bearer {expected}"

    def send_json(self, status_code: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if not self.authorized():
            self.send_json(401, {"status": "unauthorized"})
            return
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "host": HOST_NAME, "mode": "read-only"})
        elif self.path == "/v1/status":
            self.send_json(200, status())
        elif self.path == "/v1/processes":
            rows = process_rows()
            self.send_json(200, {"status": "ok", "host": HOST_NAME, "topCpu": sorted(rows, key=lambda row: row["cpuPercent"], reverse=True)[:10], "topMemory": sorted(rows, key=lambda row: row["memoryPercent"], reverse=True)[:10]})
        else:
            self.send_json(404, {"status": "not_found"})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
