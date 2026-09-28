#!/usr/bin/env python3
"""MacHostAgent: bounded macOS host telemetry, history and anomalies.

The process is deliberately local and deterministic. It never imports an LLM
client and never accepts a command, path, shell fragment, or database query
from callers. Sampling is split by cost: 5s native counters, 15s power,
30s bounded service checks, and 60s filesystem probes.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("MACHOSTAGENT_BIND", "127.0.0.1")
PORT = int(os.environ.get("MACHOSTAGENT_PORT", "18791"))
TOKEN_FILE = os.environ.get("MACHOSTAGENT_TOKEN_FILE", "")
AVALON_PATH = os.environ.get("MACHOSTAGENT_AVALON_PATH", "/Volumes/Avalon")
HOST_NAME = os.environ.get("MACHOSTAGENT_HOST_NAME", "Amadeus-M204")
DB_PATH = os.environ.get(
    "MACHOSTAGENT_DB_PATH",
    str(Path.home() / "Library/Application Support/Amadeus/machostagent.sqlite3"),
)
POWER_FILE = Path(os.environ.get("MACHOSTAGENT_POWER_FILE", "/var/run/amadeus-machostagent-power.json"))
POWER_MAX_AGE_SECONDS = 30.0
SAMPLE_SECONDS = 5.0
RETENTION_RAW_DAYS = int(os.environ.get("MACHOSTAGENT_RAW_RETENTION_DAYS", "7"))
RETENTION_MINUTE_DAYS = int(os.environ.get("MACHOSTAGENT_MINUTE_RETENTION_DAYS", "90"))
CPU_HIGH_PERCENT = float(os.environ.get("MACHOSTAGENT_CPU_HIGH_PERCENT", "90"))
CPU_HIGH_SECONDS = float(os.environ.get("MACHOSTAGENT_CPU_HIGH_SECONDS", "180"))
SWAP_GROWTH_BYTES = int(os.environ.get("MACHOSTAGENT_SWAP_GROWTH_BYTES", str(512 * 1024 * 1024)))
STORAGE_WARN_FREE_PERCENT = float(os.environ.get("MACHOSTAGENT_STORAGE_WARN_FREE_PERCENT", "15"))
STORAGE_CRITICAL_FREE_PERCENT = float(os.environ.get("MACHOSTAGENT_STORAGE_CRITICAL_FREE_PERCENT", "10"))
ANOMALY_COOLDOWN_SECONDS = float(os.environ.get("MACHOSTAGENT_ANOMALY_COOLDOWN_SECONDS", "1800"))
try:
    SERVICE_URLS = json.loads(os.environ.get("MACHOSTAGENT_SERVICE_URLS", "{}"))
except json.JSONDecodeError:
    SERVICE_URLS = {}


def run(argv: list[str], timeout: float = 2.0) -> str:
    try:
        result = subprocess.run(argv, check=False, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def number(value: str | int | float | None) -> float | None:
    try:
        if value is None:
            return None
        value = str(value).strip()
        return float(value) if value else None
    except (TypeError, ValueError):
        return None


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def timestamp(value: dt.datetime | None = None) -> str:
    return (value or now_utc()).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_timestamp(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def sysctl(name: str) -> str | None:
    value = run(["/usr/sbin/sysctl", "-n", name])
    return value or None


def human_bytes(value: int | float | None) -> str:
    if value is None:
        return "未知"
    amount = float(value)
    units = ("B", "KB", "MB", "GB", "TB", "PB")
    index = 0
    while abs(amount) >= 1024 and index < len(units) - 1:
        amount /= 1024
        index += 1
    if index == 0:
        return f"{amount:.0f} {units[index]}"
    return f"{amount:.2f} {units[index]}"


def parse_load(value: str | None) -> list[float]:
    if not value:
        return []
    return [float(match) for match in re.findall(r"\d+(?:\.\d+)?", value)[:3]]


def parse_bytes(value: str, multiplier: int = 1) -> int | None:
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?)(?:i?B)?", value, re.IGNORECASE)
    if not match:
        return None
    scale = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}.get(match.group(2).upper(), 1)
    return int(float(match.group(1)) * scale * multiplier)


def parse_swap(raw: str) -> dict[str, int | None]:
    values: dict[str, int | None] = {"totalBytes": None, "usedBytes": None, "freeBytes": None}
    for key, pattern in (("totalBytes", r"total\s*=\s*([^,]+)"), ("usedBytes", r"used\s*=\s*([^,]+)"), ("freeBytes", r"free\s*=\s*([^,]+)")):
        match = re.search(pattern, raw, re.IGNORECASE)
        values[key] = parse_bytes(match.group(1)) if match else None
    if values["freeBytes"] is None and values["totalBytes"] is not None and values["usedBytes"] is not None:
        values["freeBytes"] = max(0, int(values["totalBytes"]) - int(values["usedBytes"]))
    return values


def memory() -> dict[str, Any]:
    page_size = int(number(sysctl("hw.pagesize") or "4096") or 4096)
    raw = run(["/usr/bin/vm_stat"])
    pages: dict[str, int] = {}
    for line in raw.splitlines():
        match = re.match(r"^(.+?):\s+(\d+)\.", line)
        if match:
            pages[match.group(1)] = int(match.group(2))
    total = int(number(sysctl("hw.memsize")) or 0)
    compressed = pages.get("Pages occupied by compressor", 0) * page_size
    wired = pages.get("Pages wired down", 0) * page_size
    active = pages.get("Pages active", 0) * page_size
    inactive = pages.get("Pages inactive", 0) * page_size
    used = active + wired + compressed
    pressure_raw = run(["/usr/bin/memory_pressure", "-Q"], timeout=1.5)
    pressure_text = pressure_raw.lower()
    pressure = "unknown"
    if any(word in pressure_text for word in ("critical", "critically")):
        pressure = "critical"
    elif any(word in pressure_text for word in ("warning", "warn")):
        pressure = "warning"
    else:
        free_match = re.search(r"free percentage:\s*([0-9.]+)%", pressure_text)
        if free_match:
            free_percent = float(free_match.group(1))
            pressure = "critical" if free_percent < 10 else "warning" if free_percent < 20 else "normal"
    swap = parse_swap(sysctl("vm.swapusage") or "")
    return {
        "totalBytes": total,
        "usedBytes": used,
        "usedPercent": round(used / total * 100, 1) if total else None,
        "pressure": pressure,
        "pressureRaw": pressure_raw[:500] if pressure_raw else None,
        "compressedBytes": compressed,
        "wiredBytes": wired,
        "inactiveBytes": inactive,
        "swap": swap,
    }


def volume_uuid(path: str) -> str | None:
    raw = run(["/usr/sbin/diskutil", "info", path], timeout=2.0)
    for line in raw.splitlines():
        if "Volume UUID" in line:
            return line.split(":", 1)[-1].strip() or None
    return None


def disk(path: str) -> dict[str, Any]:
    mounted = os.path.ismount(path) if path != "/" else True
    if not mounted:
        return {"path": path, "status": "unavailable", "mounted": False, "message": "not_mounted"}
    try:
        usage = shutil.disk_usage(path)
        free_percent = round(usage.free / usage.total * 100, 1) if usage.total else None
        return {
            "path": path,
            "status": "ok",
            "mounted": True,
            "volumeUuid": volume_uuid(path),
            "totalBytes": usage.total,
            "usedBytes": usage.used,
            "freeBytes": usage.free,
            "freePercent": free_percent,
            "total": human_bytes(usage.total),
            "used": human_bytes(usage.used),
            "free": human_bytes(usage.free),
            "usedPercent": round(usage.used / usage.total * 100, 1) if usage.total else None,
        }
    except OSError as exc:
        return {"path": path, "status": "unavailable", "mounted": mounted, "message": type(exc).__name__}


def power() -> dict[str, Any]:
    battery = run(["/usr/bin/pmset", "-g", "batt"])
    base = {"battery": battery[:500] if battery else "unknown"}
    try:
        snapshot = json.loads(POWER_FILE.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return {**base, "telemetry": "degraded", "source": "powermetrics", "scope": "soc", "accuracy": "estimated_soc_not_wall_input", "powerWatts": None, "wallPowerWatts": None, "powerSummary": None, "message": "privileged power sampler is not installed"}
    updated = snapshot.get("updatedAt") if isinstance(snapshot, dict) else None
    try:
        observed = parse_timestamp(str(updated))
        age = (now_utc() - observed).total_seconds()
    except (TypeError, ValueError, OverflowError):
        age = float("inf")
    if not isinstance(snapshot, dict) or snapshot.get("status") != "ok" or age > POWER_MAX_AGE_SECONDS:
        return {**base, "telemetry": "degraded", "source": "powermetrics", "scope": "soc", "accuracy": "estimated_soc_not_wall_input", "powerWatts": None, "wallPowerWatts": None, "powerSummary": None, "updatedAt": updated, "message": "privileged power sample is unavailable or stale"}
    return {**base, **snapshot, "scope": "soc", "accuracy": "estimated_soc_not_wall_input", "wallPowerWatts": None, "ageSeconds": round(max(age, 0.0), 1), "powerSummary": "powermetrics SoC estimate"}


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


def services() -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {
        "ssh": {"ok": bool(run(["/usr/bin/pgrep", "-x", "sshd"], timeout=1.0))},
        "macHostAgent": {"ok": True},
    }
    if isinstance(SERVICE_URLS, dict):
        for name, url in SERVICE_URLS.items():
            if not isinstance(name, str) or not isinstance(url, str) or not name or not url.startswith(("http://", "https://")):
                continue
            try:
                request = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(request, timeout=2.0) as response:
                    result[name] = {"ok": 200 <= response.status < 400, "statusCode": response.status, "url": url}
            except (OSError, urllib.error.URLError, TimeoutError):
                result[name] = {"ok": False, "url": url}
    return result


def network_counters() -> dict[str, int | None]:
    # netstat is bounded and only sampled with the 5s native counter cadence.
    raw = run(["/usr/sbin/netstat", "-ib"], timeout=1.5)
    rx = tx = 0
    for line in raw.splitlines():
        fields = line.split()
        if len(fields) >= 10 and fields[0] not in ("Name", "lo0"):
            try:
                rx += int(fields[6])
                tx += int(fields[9])
            except (ValueError, IndexError):
                continue
    return {"rxBytes": rx or None, "txBytes": tx or None}


def current_status(*, include_power: bool = True, include_disks: bool = True, include_services: bool = True) -> dict[str, Any]:
    load = parse_load(sysctl("vm.loadavg"))
    cores = int(number(sysctl("hw.logicalcpu") or "0") or 0)
    return {
        "status": "ok",
        "host": HOST_NAME,
        "platform": "macos",
        "architecture": sysctl("hw.machine") or "unknown",
        "cpu": {"load": load, "logicalCores": cores, "utilizationPercent": round(min(100.0, load[0] / cores * 100), 1) if load and cores else None},
        "memory": memory(),
        "uptime": run(["/usr/bin/uptime"])[:300] or "unknown",
        "disks": ({"internal": disk("/"), "avalon": disk(AVALON_PATH)} if include_disks else {}),
        "network": {"hostname": socket.gethostname(), "interfaces": run(["/sbin/ifconfig"], 2.0)[:1500] or "unknown", **network_counters()},
        "power": power() if include_power else {},
        "services": services() if include_services else {},
        "observedAt": timestamp(),
    }


def db_connect(path: str = DB_PATH) -> sqlite3.Connection:
    connection = sqlite3.connect(path, timeout=10, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS host_samples (
          id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, observed_epoch REAL NOT NULL,
          cpu_utilization REAL, load1 REAL, load5 REAL, load15 REAL,
          memory_total_bytes INTEGER, memory_used_bytes INTEGER, memory_pressure TEXT,
          swap_total_bytes INTEGER, swap_used_bytes INTEGER, swap_in_bytes INTEGER, swap_out_bytes INTEGER,
          compressed_bytes INTEGER, wired_bytes INTEGER, power_watts REAL,
          network_rx_bytes INTEGER, network_tx_bytes INTEGER
        );
        CREATE INDEX IF NOT EXISTS host_samples_observed ON host_samples(observed_epoch);
        CREATE TABLE IF NOT EXISTS storage_samples (
          id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, observed_epoch REAL NOT NULL,
          name TEXT NOT NULL, path TEXT NOT NULL, volume_uuid TEXT, mounted INTEGER NOT NULL,
          total_bytes INTEGER, used_bytes INTEGER, free_bytes INTEGER, free_percent REAL, status TEXT
        );
        CREATE INDEX IF NOT EXISTS storage_samples_observed ON storage_samples(observed_epoch, name);
        CREATE TABLE IF NOT EXISTS service_samples (
          id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, observed_epoch REAL NOT NULL,
          name TEXT NOT NULL, ok INTEGER NOT NULL, detail TEXT
        );
        CREATE INDEX IF NOT EXISTS service_samples_observed ON service_samples(observed_epoch, name);
        CREATE TABLE IF NOT EXISTS anomaly_events (
          id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, observed_at TEXT NOT NULL,
          kind TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL,
          summary TEXT NOT NULL, metric REAL, threshold REAL, duration_seconds REAL,
          last_seen_at TEXT NOT NULL, resolved_at TEXT, cooldown_until REAL
        );
        CREATE INDEX IF NOT EXISTS anomaly_events_active ON anomaly_events(status, observed_at);
        CREATE TABLE IF NOT EXISTS minute_rollups (
          bucket_start TEXT NOT NULL, metric TEXT NOT NULL, sample_count INTEGER NOT NULL,
          avg REAL, p95 REAL, max REAL, max_at TEXT, PRIMARY KEY(bucket_start, metric)
        );
        CREATE TABLE IF NOT EXISTS hourly_rollups (
          bucket_start TEXT NOT NULL, metric TEXT NOT NULL, sample_count INTEGER NOT NULL,
          avg REAL, p95 REAL, max REAL, max_at TEXT, PRIMARY KEY(bucket_start, metric)
        );
        CREATE TABLE IF NOT EXISTS daily_rollups (
          bucket_start TEXT NOT NULL, metric TEXT NOT NULL, sample_count INTEGER NOT NULL,
          avg REAL, p95 REAL, max REAL, max_at TEXT, PRIMARY KEY(bucket_start, metric)
        );
        """
    )
    connection.commit()


def percentile(values: list[float], rank: float = 0.95) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * rank
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return round(ordered[lower], 3)
    return round(ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower), 3)


def metric_summary(connection: sqlite3.Connection, start_epoch: float, end_epoch: float, metric: str, threshold: float | None = None) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT observed_at, observed_epoch, " + metric + " AS value FROM host_samples WHERE observed_epoch BETWEEN ? AND ? AND " + metric + " IS NOT NULL ORDER BY observed_epoch",
        (start_epoch, end_epoch),
    ).fetchall()
    values = [float(row["value"]) for row in rows]
    maximum = max(values) if values else None
    max_at = next((row["observed_at"] for row in rows if float(row["value"]) == maximum), None) if maximum is not None else None
    duration = 0.0
    if threshold is not None and rows:
        run_start: float | None = None
        last_epoch: float | None = None
        for row in rows:
            epoch = float(row["observed_epoch"])
            above = float(row["value"]) >= threshold
            if above and run_start is None:
                run_start = epoch
            if above:
                last_epoch = epoch
            elif run_start is not None and last_epoch is not None:
                duration += min(end_epoch, last_epoch + SAMPLE_SECONDS) - run_start
                run_start = last_epoch = None
        if run_start is not None and last_epoch is not None:
            duration += min(end_epoch, last_epoch + SAMPLE_SECONDS) - run_start
        duration = max(0.0, min(duration, end_epoch - start_epoch))
    return {"count": len(values), "avg": round(sum(values) / len(values), 3) if values else None, "p95": percentile(values), "max": round(maximum, 3) if maximum is not None else None, "maxAt": max_at, "durationAboveThreshold": round(duration, 1) if threshold is not None else None}


def memory_percent_summary(connection: sqlite3.Connection, start_epoch: float, end_epoch: float) -> dict[str, Any]:
    rows = connection.execute("SELECT observed_at, observed_epoch, memory_used_bytes, memory_total_bytes FROM host_samples WHERE observed_epoch BETWEEN ? AND ? AND memory_used_bytes IS NOT NULL AND memory_total_bytes > 0 ORDER BY observed_epoch", (start_epoch, end_epoch)).fetchall()
    values = [float(row["memory_used_bytes"]) / float(row["memory_total_bytes"]) * 100 for row in rows]
    maximum = max(values) if values else None
    max_index = values.index(maximum) if maximum is not None else -1
    return {"count": len(values), "avg": round(sum(values) / len(values), 3) if values else None, "p95": percentile(values), "max": round(maximum, 3) if maximum is not None else None, "maxAt": rows[max_index]["observed_at"] if max_index >= 0 else None, "durationAboveThreshold": None}


def anomalies(connection: sqlite3.Connection, start_epoch: float, end_epoch: float) -> list[dict[str, Any]]:
    rows = connection.execute("SELECT event_key, observed_at, kind, severity, status, summary, metric, threshold, duration_seconds, resolved_at FROM anomaly_events WHERE observed_at >= ? AND observed_at <= ? ORDER BY id DESC", (dt.datetime.fromtimestamp(start_epoch, dt.timezone.utc).isoformat().replace("+00:00", "Z"), dt.datetime.fromtimestamp(end_epoch, dt.timezone.utc).isoformat().replace("+00:00", "Z"))).fetchall()
    return [dict(row) for row in rows]


def public_anomalies(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "eventKey": item.get("event_key"),
            "observedAt": item.get("observed_at"),
            "kind": item.get("kind"),
            "severity": item.get("severity"),
            "status": item.get("status"),
            "summary": item.get("summary"),
            "metric": item.get("metric"),
            "threshold": item.get("threshold"),
            "durationSeconds": item.get("duration_seconds"),
            "resolvedAt": item.get("resolved_at"),
        }
        for item in items
    ]


def day_window() -> tuple[float, float]:
    local_now = dt.datetime.now().astimezone()
    start = local_now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(dt.timezone.utc)
    return start.timestamp(), local_now.astimezone(dt.timezone.utc).timestamp()


def summary(connection: sqlite3.Connection, start_epoch: float | None = None, end_epoch: float | None = None) -> dict[str, Any]:
    if start_epoch is None or end_epoch is None:
        start_epoch, end_epoch = day_window()
    latest = connection.execute("SELECT * FROM host_samples ORDER BY observed_epoch DESC LIMIT 1").fetchone()
    current = dict(latest) if latest else None
    cpu = metric_summary(connection, start_epoch, end_epoch, "cpu_utilization", CPU_HIGH_PERCENT)
    memory_used = metric_summary(connection, start_epoch, end_epoch, "memory_used_bytes")
    power_watts = metric_summary(connection, start_epoch, end_epoch, "power_watts")
    swap_rows = connection.execute("SELECT observed_epoch, swap_used_bytes FROM host_samples WHERE observed_epoch BETWEEN ? AND ? AND swap_used_bytes IS NOT NULL ORDER BY observed_epoch", (start_epoch, end_epoch)).fetchall()
    swap_delta = (int(swap_rows[-1]["swap_used_bytes"]) - int(swap_rows[0]["swap_used_bytes"])) if len(swap_rows) >= 2 else None
    swap_summary = {"currentBytes": int(current["swap_used_bytes"]) if current and current.get("swap_used_bytes") is not None else None, "deltaBytes": swap_delta, "trend": "increasing" if swap_delta is not None and swap_delta > 0 else "decreasing" if swap_delta is not None and swap_delta < 0 else "stable" if swap_delta is not None else "unknown"}
    if current:
        total = current.get("memory_total_bytes") or 0
        memory_used_percent = {**memory_percent_summary(connection, start_epoch, end_epoch), "current": round(current["memory_used_bytes"] / total * 100, 1) if total and current.get("memory_used_bytes") is not None else None}
    else:
        memory_used_percent = {**memory_percent_summary(connection, start_epoch, end_epoch), "current": None}
    return {
        "windowStart": timestamp(dt.datetime.fromtimestamp(start_epoch, dt.timezone.utc)),
        "windowEnd": timestamp(dt.datetime.fromtimestamp(end_epoch, dt.timezone.utc)),
        "current": current,
        "metrics": {"cpu": {"current": current.get("cpu_utilization") if current else None, **cpu}, "memoryUsedBytes": memory_used, "memoryUsedPercent": memory_used_percent, "swap": swap_summary, "powerWatts": {"current": current.get("power_watts") if current else None, **power_watts}},
        "anomalies": anomalies(connection, start_epoch, end_epoch),
    }


def insert_snapshot(connection: sqlite3.Connection, snapshot: dict[str, Any], observed_epoch: float | None = None) -> None:
    observed_at = str(snapshot.get("observedAt") or timestamp())
    epoch = observed_epoch if observed_epoch is not None else parse_timestamp(observed_at).timestamp()
    cpu = snapshot.get("cpu") if isinstance(snapshot.get("cpu"), dict) else {}
    mem = snapshot.get("memory") if isinstance(snapshot.get("memory"), dict) else {}
    swap = mem.get("swap") if isinstance(mem.get("swap"), dict) else {}
    power_value = snapshot.get("power") if isinstance(snapshot.get("power"), dict) else {}
    network = snapshot.get("network") if isinstance(snapshot.get("network"), dict) else {}
    connection.execute(
        "INSERT INTO host_samples(observed_at, observed_epoch, cpu_utilization, load1, load5, load15, memory_total_bytes, memory_used_bytes, memory_pressure, swap_total_bytes, swap_used_bytes, compressed_bytes, wired_bytes, power_watts, network_rx_bytes, network_tx_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (observed_at, epoch, cpu.get("utilizationPercent"), *(list(cpu.get("load", [])) + [None, None, None])[:3], mem.get("totalBytes"), mem.get("usedBytes"), mem.get("pressure"), swap.get("totalBytes"), swap.get("usedBytes"), mem.get("compressedBytes"), mem.get("wiredBytes"), power_value.get("powerWatts"), network.get("rxBytes"), network.get("txBytes")),
    )
    disks = snapshot.get("disks") if isinstance(snapshot.get("disks"), dict) else {}
    for name, item in disks.items():
        if not isinstance(item, dict):
            continue
        connection.execute("INSERT INTO storage_samples(observed_at, observed_epoch, name, path, volume_uuid, mounted, total_bytes, used_bytes, free_bytes, free_percent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (observed_at, epoch, name, item.get("path", ""), item.get("volumeUuid"), 1 if item.get("mounted") else 0, item.get("totalBytes"), item.get("usedBytes"), item.get("freeBytes"), item.get("freePercent"), item.get("status", "unknown")))
    service_items = snapshot.get("services") if isinstance(snapshot.get("services"), dict) else {}
    for name, item in service_items.items():
        if isinstance(item, dict):
            connection.execute("INSERT INTO service_samples(observed_at, observed_epoch, name, ok, detail) VALUES (?, ?, ?, ?, ?)", (observed_at, epoch, name, 1 if item.get("ok") else 0, json.dumps(item, ensure_ascii=False)))


def rollup(connection: sqlite3.Connection, table: str, start_epoch: float, end_epoch: float, bucket_seconds: int) -> None:
    metrics = ("cpu_utilization", "memory_used_bytes", "power_watts")
    for metric in metrics:
        rows = connection.execute(f"SELECT observed_at, observed_epoch, {metric} AS value FROM host_samples WHERE observed_epoch BETWEEN ? AND ? AND {metric} IS NOT NULL ORDER BY observed_epoch", (start_epoch, end_epoch)).fetchall()
        buckets: dict[int, list[sqlite3.Row]] = {}
        for row in rows:
            buckets.setdefault(int(float(row["observed_epoch"]) // bucket_seconds) * bucket_seconds, []).append(row)
        for bucket, values in buckets.items():
            numbers = [float(row["value"]) for row in values]
            maximum = max(numbers)
            max_row = next(row for row in values if float(row["value"]) == maximum)
            bucket_text = timestamp(dt.datetime.fromtimestamp(bucket, dt.timezone.utc))
            connection.execute(f"INSERT OR REPLACE INTO {table}(bucket_start, metric, sample_count, avg, p95, max, max_at) VALUES (?, ?, ?, ?, ?, ?, ?)", (bucket_text, metric, len(numbers), sum(numbers) / len(numbers), percentile(numbers), maximum, max_row["observed_at"]))
    connection.commit()


def evaluate_anomalies(connection: sqlite3.Connection, snapshot: dict[str, Any], observed_epoch: float | None = None) -> list[dict[str, Any]]:
    epoch = observed_epoch if observed_epoch is not None else parse_timestamp(str(snapshot.get("observedAt") or timestamp())).timestamp()
    observed_at = timestamp(dt.datetime.fromtimestamp(epoch, dt.timezone.utc))
    emitted: list[dict[str, Any]] = []
    mem = snapshot.get("memory") if isinstance(snapshot.get("memory"), dict) else {}
    disks = snapshot.get("disks") if isinstance(snapshot.get("disks"), dict) else {}
    cpu = snapshot.get("cpu") if isinstance(snapshot.get("cpu"), dict) else {}
    checks: list[tuple[str, str, str, float | None, float | None, float]] = []
    cpu_value = number(cpu.get("utilizationPercent"))
    if cpu_value is not None and cpu_value >= CPU_HIGH_PERCENT:
        checks.append(("cpu_high", "warning", f"CPU 持续高于 {CPU_HIGH_PERCENT:.0f}%", cpu_value, CPU_HIGH_PERCENT, CPU_HIGH_SECONDS))
    pressure = str(mem.get("pressure", "unknown"))
    if pressure in ("warning", "critical"):
        checks.append(("memory_pressure", "critical" if pressure == "critical" else "warning", f"Memory Pressure={pressure}", None, None, 30.0))
    swap = mem.get("swap") if isinstance(mem.get("swap"), dict) else {}
    swap_used = number(swap.get("usedBytes"))
    if swap_used is not None:
        prior = connection.execute("SELECT swap_used_bytes FROM host_samples WHERE observed_epoch < ? AND swap_used_bytes IS NOT NULL ORDER BY observed_epoch DESC LIMIT 1", (epoch - 300,)).fetchone()
        if prior and swap_used - float(prior["swap_used_bytes"]) >= SWAP_GROWTH_BYTES:
            checks.append(("swap_growth", "warning", "Swap 在 5 分钟内持续增长", swap_used - float(prior["swap_used_bytes"]), float(SWAP_GROWTH_BYTES), 60.0))
    service_values = snapshot.get("services") if isinstance(snapshot.get("services"), dict) else {}
    for name, item in service_values.items():
        if not isinstance(item, dict) or item.get("ok") is not False:
            continue
        failures = connection.execute("SELECT ok FROM service_samples WHERE name = ? AND observed_epoch >= ? ORDER BY observed_epoch DESC LIMIT 3", (name, epoch - 180)).fetchall()
        if len(failures) >= 3 and all(int(row["ok"]) == 0 for row in failures):
            checks.append((f"service_unhealthy:{name}", "critical", f"关键服务 {name} 连续检查失败", 0.0, 1.0, 0.0))
    for name, item in disks.items():
        if not isinstance(item, dict):
            continue
        if name.lower() == "avalon" and not item.get("mounted", False):
            checks.append(("avalon_unmounted", "critical", "Avalon 未挂载", None, None, 0.0))
        free = number(item.get("freePercent"))
        if free is not None and free < STORAGE_CRITICAL_FREE_PERCENT:
            checks.append((f"storage_critical:{name}", "critical", f"{name} 剩余空间低于 {STORAGE_CRITICAL_FREE_PERCENT:.0f}%", free, STORAGE_CRITICAL_FREE_PERCENT, 0.0))
        elif free is not None and free < STORAGE_WARN_FREE_PERCENT:
            checks.append((f"storage_warning:{name}", "warning", f"{name} 剩余空间低于 {STORAGE_WARN_FREE_PERCENT:.0f}%", free, STORAGE_WARN_FREE_PERCENT, 0.0))
    for kind, severity, text, value, threshold, required_seconds in checks:
        active = connection.execute("SELECT * FROM anomaly_events WHERE event_key = ? AND status = 'active' ORDER BY id DESC LIMIT 1", (kind,)).fetchone()
        if active:
            connection.execute("UPDATE anomaly_events SET last_seen_at = ?, metric = ?, duration_seconds = ? WHERE id = ?", (observed_at, value, max(float(active["duration_seconds"] or 0), required_seconds), active["id"]))
            continue
        if required_seconds > 0 and kind == "cpu_high":
            recent = connection.execute("SELECT MIN(observed_epoch) AS first_epoch FROM host_samples WHERE observed_epoch >= ? AND cpu_utilization >= ?", (epoch - required_seconds, CPU_HIGH_PERCENT)).fetchone()
            if not recent or recent["first_epoch"] is None or epoch - float(recent["first_epoch"]) < required_seconds:
                continue
        event_key = kind
        last = connection.execute("SELECT * FROM anomaly_events WHERE event_key = ? ORDER BY id DESC LIMIT 1", (event_key,)).fetchone()
        if last and last["cooldown_until"] and epoch < float(last["cooldown_until"]):
            continue
        connection.execute("INSERT OR REPLACE INTO anomaly_events(event_key, observed_at, kind, severity, status, summary, metric, threshold, duration_seconds, last_seen_at, cooldown_until) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)", (event_key, observed_at, kind, severity, text, value, threshold, required_seconds, observed_at, epoch + ANOMALY_COOLDOWN_SECONDS))
        emitted.append({"eventKey": event_key, "observedAt": observed_at, "kind": kind, "severity": severity, "status": "active", "summary": text, "metric": value, "threshold": threshold, "durationSeconds": required_seconds})
    active_rows = connection.execute("SELECT id, event_key FROM anomaly_events WHERE status = 'active'").fetchall()
    active_keys = {item[0] for item in checks}
    for row in active_rows:
        if row["event_key"] not in active_keys:
            connection.execute("UPDATE anomaly_events SET status = 'resolved', resolved_at = ?, last_seen_at = ? WHERE id = ?", (observed_at, observed_at, row["id"]))
    connection.commit()
    return emitted


class Sampler:
    def __init__(self, path: str = DB_PATH) -> None:
        self.connection = db_connect(path)
        init_db(self.connection)
        self.stop_event = threading.Event()
        self.last_power = 0.0
        self.last_services = 0.0
        self.last_storage = 0.0
        self.last_rollup = 0.0
        self.cached = current_status()

    def collect(self) -> dict[str, Any]:
        now = time.monotonic()
        # The inexpensive native counters are refreshed every loop. Expensive
        # filesystem/service/power probes are cached at their declared cadence.
        fresh = current_status(include_power=False, include_disks=False, include_services=False)
        if now - self.last_power >= 15 or not self.cached.get("power"):
            fresh["power"] = power()
            self.last_power = now
        else:
            fresh["power"] = self.cached["power"]
        if now - self.last_storage >= 60 or not self.cached.get("disks"):
            fresh["disks"] = {"internal": disk("/"), "avalon": disk(AVALON_PATH)}
            self.last_storage = now
        else:
            fresh["disks"] = self.cached["disks"]
        if now - self.last_services >= 30 or not self.cached.get("services"):
            fresh["services"] = services()
            self.last_services = now
        else:
            fresh["services"] = self.cached["services"]
        self.cached = fresh
        return fresh

    def run(self) -> None:
        while not self.stop_event.is_set():
            observed = self.collect()
            epoch = time.time()
            insert_snapshot(self.connection, observed, epoch)
            evaluate_anomalies(self.connection, observed, epoch)
            rollup(self.connection, "minute_rollups", epoch - 120, epoch, 60)
            if epoch - self.last_rollup >= 60:
                rollup(self.connection, "hourly_rollups", epoch - 7200, epoch, 3600)
                rollup(self.connection, "daily_rollups", epoch - 2 * 86400, epoch, 86400)
                self.last_rollup = epoch
            cutoff = epoch - RETENTION_RAW_DAYS * 86400
            minute_cutoff = epoch - RETENTION_MINUTE_DAYS * 86400
            self.connection.execute("DELETE FROM host_samples WHERE observed_epoch < ?", (cutoff,))
            self.connection.execute("DELETE FROM storage_samples WHERE observed_epoch < ?", (cutoff,))
            self.connection.execute("DELETE FROM service_samples WHERE observed_epoch < ?", (cutoff,))
            self.connection.execute("DELETE FROM minute_rollups WHERE bucket_start < ?", (timestamp(dt.datetime.fromtimestamp(minute_cutoff, dt.timezone.utc)),))
            self.connection.commit()
            self.stop_event.wait(SAMPLE_SECONDS)


class Handler(BaseHTTPRequestHandler):
    server_version = "MacHostAgent/2"
    sampler: Sampler | None = None

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

    def db(self) -> sqlite3.Connection:
        if self.sampler is not None:
            return self.sampler.connection
        connection = db_connect()
        init_db(connection)
        return connection

    def do_GET(self) -> None:  # noqa: N802
        if not self.authorized():
            self.send_json(401, {"status": "unauthorized"})
            return
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        connection = self.db()
        if parsed.path == "/health":
            self.send_json(200, {"status": "ok", "host": HOST_NAME, "mode": "read-only", "database": DB_PATH})
        elif parsed.path == "/v1/status":
            start, end = day_window()
            if query.get("from") and query.get("to"):
                start = float(query["from"][0]); end = float(query["to"][0])
            value = public_snapshot(current_status())
            value["history"] = public_history(summary(connection, start, end))
            value["anomalies"] = value["history"]["anomalies"]
            self.send_json(200, value)
        elif parsed.path == "/v1/history":
            start, end = day_window()
            if query.get("from") and query.get("to"):
                start = float(query["from"][0]); end = float(query["to"][0])
            self.send_json(200, {"status": "ok", "host": HOST_NAME, "summary": public_history(summary(connection, start, end))})
        elif parsed.path == "/v1/anomalies":
            start, end = day_window()
            self.send_json(200, {"status": "ok", "items": public_anomalies(anomalies(connection, start, end))})
        elif parsed.path == "/v1/processes":
            rows = process_rows()
            self.send_json(200, {"status": "ok", "host": HOST_NAME, "topCpu": sorted(rows, key=lambda row: row["cpuPercent"], reverse=True)[:10], "topMemory": sorted(rows, key=lambda row: row["memoryPercent"], reverse=True)[:10]})
        else:
            self.send_json(404, {"status": "not_found"})


def public_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    value = json.loads(json.dumps(snapshot, ensure_ascii=False))
    memory_value = value.get("memory") if isinstance(value.get("memory"), dict) else {}
    for raw_key, display_key in (("totalBytes", "total"), ("usedBytes", "used"), ("compressedBytes", "compressed"), ("wiredBytes", "wired"), ("inactiveBytes", "inactive")):
        if raw_key in memory_value:
            memory_value[display_key] = human_bytes(memory_value.pop(raw_key))
    swap = memory_value.get("swap") if isinstance(memory_value.get("swap"), dict) else {}
    for raw_key, display_key in (("totalBytes", "total"), ("usedBytes", "used"), ("freeBytes", "free")):
        if raw_key in swap:
            swap[display_key] = human_bytes(swap.pop(raw_key))
    for item in (value.get("disks") or {}).values() if isinstance(value.get("disks"), dict) else []:
        if not isinstance(item, dict):
            continue
        for raw_key, display_key in (("totalBytes", "total"), ("usedBytes", "used"), ("freeBytes", "free")):
            if raw_key in item:
                item[display_key] = human_bytes(item.pop(raw_key))
    network = value.get("network")
    if isinstance(network, dict):
        network.pop("rxBytes", None); network.pop("txBytes", None)
    power_value = value.get("power") if isinstance(value.get("power"), dict) else {}
    watts = power_value.get("powerWatts")
    power_value["socPower"] = f"{float(watts) * 1000:.0f} mW (SoC estimate)" if isinstance(watts, (int, float)) else "未知"
    power_value["wallPower"] = "未知（需要外部墙上电表）"
    return value


def public_history(history: dict[str, Any]) -> dict[str, Any]:
    value = json.loads(json.dumps(history, ensure_ascii=False))
    current = value.get("current")
    if isinstance(current, dict):
        value["current"] = {
            "observedAt": current.get("observed_at"),
            "cpuUtilization": current.get("cpu_utilization"),
            "memoryUsed": human_bytes(current.get("memory_used_bytes")),
            "memoryPressure": current.get("memory_pressure"),
            "swapUsed": human_bytes(current.get("swap_used_bytes")),
            "powerWatts": current.get("power_watts"),
        }
    metrics = value.get("metrics") if isinstance(value.get("metrics"), dict) else {}
    metrics.pop("memoryUsedBytes", None)
    swap = metrics.get("swap") if isinstance(metrics.get("swap"), dict) else {}
    if "currentBytes" in swap:
        swap["current"] = human_bytes(swap.pop("currentBytes"))
    if "deltaBytes" in swap:
        swap["delta"] = human_bytes(swap.pop("deltaBytes"))
    power_metric = metrics.get("powerWatts") if isinstance(metrics.get("powerWatts"), dict) else {}
    power_metric["scope"] = "soc"
    power_metric["accuracy"] = "estimated_soc_not_wall_input"
    power_metric["wallPower"] = "未知（需要外部墙上电表）"
    if isinstance(value.get("anomalies"), list):
        value["anomalies"] = public_anomalies(value["anomalies"])
    return value


def auth_token() -> str | None:
    if not TOKEN_FILE:
        return None
    try:
        return Path(TOKEN_FILE).read_text(encoding="utf8").strip() or None
    except OSError:
        return None


def main() -> None:
    Path(DB_PATH).expanduser().parent.mkdir(parents=True, exist_ok=True)
    sampler = Sampler(DB_PATH)
    Handler.sampler = sampler
    worker = threading.Thread(target=sampler.run, name="machostagent-sampler", daemon=True)
    worker.start()
    try:
        ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
    finally:
        sampler.stop_event.set()
        worker.join(timeout=2)
        sampler.connection.close()


if __name__ == "__main__":
    main()
