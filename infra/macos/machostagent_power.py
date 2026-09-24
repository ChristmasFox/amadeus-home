#!/usr/bin/env python3
"""Privileged, fixed-surface powermetrics sampler for MacHostAgent.

The main MacHostAgent stays in the user's LaunchAgent. This small root
LaunchDaemon exists only because Apple's powermetrics requires root. It writes
one atomically replaced, bounded JSON snapshot; it does not accept requests,
arguments, shell text, or arbitrary paths.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import plistlib
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

POWER_FILE = Path(os.environ.get("MACHOSTAGENT_POWER_FILE", "/var/run/amadeus-machostagent-power.json"))
INTERVAL_SECONDS = max(2.0, float(os.environ.get("MACHOSTAGENT_POWER_INTERVAL", "5")))


def now_text() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    return None


def plist_documents(raw: bytes) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    marker = b"<?xml"
    end_marker = b"</plist>"
    offset = 0
    while True:
        start = raw.find(marker, offset)
        if start < 0:
            break
        end = raw.find(end_marker, start)
        if end < 0:
            break
        try:
            value = plistlib.loads(raw[start : end + len(end_marker)])
            if isinstance(value, dict):
                documents.append(value)
        except (plistlib.InvalidFileException, ValueError, TypeError):
            pass
        offset = end + len(end_marker)
    return documents


def power_snapshot(raw: bytes, observed_at: str | None = None) -> dict[str, Any]:
    documents = plist_documents(raw)
    if not documents:
        return {"status": "unavailable", "telemetry": "degraded", "error": "powermetrics_plist_unavailable", "updatedAt": observed_at or now_text()}
    document = documents[-1]
    processor = document.get("processor")
    if not isinstance(processor, dict):
        return {"status": "unavailable", "telemetry": "degraded", "error": "powermetrics_processor_unavailable", "updatedAt": observed_at or now_text()}
    values = {key: finite_number(processor.get(key)) for key in ("cpu_power", "gpu_power", "ane_power", "combined_power")}
    if values["combined_power"] is None or values["combined_power"] < 0:
        return {"status": "unavailable", "telemetry": "degraded", "error": "powermetrics_combined_power_unavailable", "updatedAt": observed_at or now_text()}
    elapsed_ns = finite_number(document.get("elapsed_ns"))
    return {
        "status": "ok",
        "telemetry": "supported",
        "source": "powermetrics",
        "scope": "soc",
        "accuracy": "estimated_soc_not_wall_input",
        "cpuPowerMw": round(values["cpu_power"], 1) if values["cpu_power"] is not None and values["cpu_power"] >= 0 else None,
        "gpuPowerMw": round(values["gpu_power"], 1) if values["gpu_power"] is not None and values["gpu_power"] >= 0 else None,
        "anePowerMw": round(values["ane_power"], 1) if values["ane_power"] is not None and values["ane_power"] >= 0 else None,
        "socPowerMw": round(values["combined_power"], 1),
        "powerWatts": round(values["combined_power"] / 1000.0, 3),
        "sampleWindowMs": round(elapsed_ns / 1_000_000.0, 1) if elapsed_ns is not None else None,
        "updatedAt": observed_at or now_text(),
    }


def collect() -> dict[str, Any]:
    try:
        result = subprocess.run(
            [
                "/usr/bin/powermetrics",
                "--samplers",
                "cpu_power,gpu_power,ane_power,thermal",
                "-A",
                "-n",
                "1",
                "-i",
                "1000",
                "--show-extra-power-info",
                "--format",
                "plist",
                "-b",
                "0",
            ],
            check=False,
            capture_output=True,
            timeout=8.0,
        )
    except (OSError, subprocess.SubprocessError):
        return {"status": "unavailable", "telemetry": "degraded", "error": "powermetrics_execution_failed", "updatedAt": now_text()}
    if result.returncode != 0:
        return {"status": "unavailable", "telemetry": "degraded", "error": "powermetrics_nonzero_exit", "updatedAt": now_text()}
    return power_snapshot(result.stdout)


def write_snapshot(snapshot: dict[str, Any]) -> None:
    POWER_FILE.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{POWER_FILE.name}.", dir=str(POWER_FILE.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(name, 0o644)
        os.replace(name, POWER_FILE)
    finally:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass


def main() -> None:
    while True:
        write_snapshot(collect())
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
