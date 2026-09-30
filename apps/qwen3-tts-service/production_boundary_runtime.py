"""macOS production-service telemetry and content-safe log correlation for the boundary study."""
from __future__ import annotations

import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from typing import Any, Mapping, Sequence

from production_boundary import parse_service_log_line

LAUNCHD_LABEL = "com.amadeus.qwen3-tts"
TTS_HEALTH_URL = "http://127.0.0.1:18794/healthz"
SERVICE_PATH = "/v1/audio/speech"
GIB = 1024 ** 3
MIB = 1024 ** 2
SWAP_PERSISTENT_WARNING_BYTES = 512 * MIB
SWAP_STABLE_TOLERANCE_BYTES = 128 * MIB
SWAP_CLEAR_DECLINE_BYTES = SWAP_STABLE_TOLERANCE_BYTES
SWAP_CORROBORATED_STOP_BYTES = 2 * GIB
SWAP_FREE_WARNING_BYTES = 512 * MIB
SWAP_WARNING_REARM_DELTA_BYTES = 128 * MIB
# Compatibility names for older report tooling; both are warning telemetry in v2.
SWAP_IMMEDIATE_STOP_BYTES = SWAP_CORROBORATED_STOP_BYTES
SWAP_FREE_IMMEDIATE_STOP_BYTES = SWAP_FREE_WARNING_BYTES
MEMORY_DISTRESS_PERCENT = 20
MEMORY_HARD_STOP_PERCENT = 10
FOOTPRINT_DISTRESS_BYTES = 18 * GIB
FOOTPRINT_HARD_STOP_BYTES = 20 * GIB
MIN_STARTUP_DISK_FREE_BYTES = 20 * GIB
SWAP_CONFIRMATION_WINDOW_S = 30
# Pause for no more than 180 seconds, then resume if independent host-health,
# memory-pressure, and process-footprint signals are stable and hard stops absent.
SWAP_MAX_CONFIRMATION_WINDOWS = 6


def run_text(args: Sequence[str], timeout_s: float = 10) -> str:
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=timeout_s, check=False)
        return p.stdout if p.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def parse_size(value: str) -> int | None:
    m = re.fullmatch(r"\s*([0-9.]+)\s*([KMGTP]?)\s*", value, re.I)
    if not m:
        return None
    n = float(m.group(1))
    unit = m.group(2).upper()
    scale = {"": 1, "K": 1024, "M": 1024 ** 2, "G": 1024 ** 3,
             "T": 1024 ** 4, "P": 1024 ** 5}[unit]
    return int(n * scale)


def healthz(timeout_s: float = 3) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(TTS_HEALTH_URL, timeout=timeout_s) as response:
            body = json.loads(response.read())
            return {"http_status": response.status, "status": body.get("status"),
                    "model": body.get("model"), "voice": body.get("voice")}
    except Exception as exc:
        return {"http_status": None, "status": "unreachable", "error_category": type(exc).__name__}


def launchd_state() -> dict[str, Any]:
    output = run_text(["launchctl", "print", f"gui/{os.getuid()}/{LAUNCHD_LABEL}"], timeout_s=5)
    state = re.search(r"^\s*state = (.+)$", output, re.M)
    pid = re.search(r"^\s*pid = (\d+)$", output, re.M)
    runs = re.search(r"^\s*runs = (\d+)$", output, re.M)
    exit_code = re.search(r"^\s*last exit code = (.+)$", output, re.M)
    spawn = re.search(r"^\s*spawn type = ([A-Za-z_-]+)(?: \((\d+)\))?", output, re.M)
    spawn_type = spawn.group(1).lower() if spawn else None
    process_type = "Interactive" if spawn_type == "interactive" else spawn_type
    return {
        "state": state.group(1).strip() if state else None,
        "pid": int(pid.group(1)) if pid else None,
        "runs": int(runs.group(1)) if runs else None,
        "last_exit_code": exit_code.group(1).strip() if exit_code else None,
        "spawn_type": spawn_type,
        "process_type": process_type,
    }


def memory_pressure_snapshot() -> dict[str, Any]:
    output = run_text(["memory_pressure", "-Q"], timeout_s=5)
    match = re.search(r"System-wide memory free percentage:\s*(\d+)%", output, re.I)
    return {"free_percent": int(match.group(1)) if match else None,
            "raw_classification": "quantitative_free_percent_only"}


def swap_snapshot() -> dict[str, Any]:
    output = run_text(["sysctl", "vm.swapusage"], timeout_s=3)
    match = re.search(r"total = ([0-9.]+)M\s+used = ([0-9.]+)M\s+free = ([0-9.]+)M", output)
    if not match:
        return {"total_bytes": None, "used_bytes": None, "free_bytes": None}
    total, used, free = (int(float(v) * MIB) for v in match.groups())
    return {"total_bytes": total, "used_bytes": used, "free_bytes": free}


def process_snapshot(pid: int | None) -> dict[str, Any]:
    if not pid:
        return {"rss_bytes": None, "physical_footprint_bytes": None, "physical_footprint_peak_bytes": None,
                "process_start": None, "elapsed": None}
    rss_text = run_text(["ps", "-p", str(pid), "-o", "rss="], timeout_s=3).strip()
    start_elapsed = run_text(["ps", "-p", str(pid), "-o", "lstart=,etime="], timeout_s=3).strip()
    vmmap = run_text(["vmmap", "-summary", str(pid)], timeout_s=12)
    current_match = re.search(r"^Physical footprint:\s*([0-9.]+\s*[KMGTP]?)", vmmap, re.M)
    peak_match = re.search(r"^Physical footprint \(peak\):\s*([0-9.]+\s*[KMGTP]?)", vmmap, re.M)
    start_parts = start_elapsed.split(None, 5)
    start = " ".join(start_parts[:5]) if len(start_parts) >= 6 else None
    elapsed = start_parts[-1] if len(start_parts) >= 6 else None
    return {
        "rss_bytes": int(rss_text) * 1024 if rss_text.isdigit() else None,
        "physical_footprint_bytes": parse_size(current_match.group(1)) if current_match else None,
        "physical_footprint_peak_bytes": parse_size(peak_match.group(1)) if peak_match else None,
        "process_start": start,
        "elapsed": elapsed,
    }


def startup_disk_snapshot() -> dict[str, Any]:
    output = run_text(["df", "-k", "/System/Volumes/Data"], timeout_s=5)
    lines = [line.split() for line in output.splitlines() if line.strip()]
    if len(lines) < 2 or len(lines[-1]) < 4:
        return {"available_bytes": None, "mount": "/System/Volumes/Data"}
    try:
        available = int(lines[-1][3]) * 1024
    except (TypeError, ValueError):
        available = None
    return {"available_bytes": available, "mount": lines[-1][-1]}

def runtime_snapshot() -> dict[str, Any]:
    launchd = launchd_state()
    pid = launchd.get("pid")
    return {
        "captured_monotonic": time.monotonic(),
        "health": healthz(),
        "launchd": launchd,
        "process": process_snapshot(pid),
        "swap": swap_snapshot(),
        "memory_pressure": memory_pressure_snapshot(),
        "startup_disk": startup_disk_snapshot(),
    }


def appended_log_events(path: Path, start_offset: int) -> tuple[list[dict[str, Any]], list[str], int]:
    """Return only parsed event types/numeric metrics; never return raw log text to callers."""
    try:
        size = path.stat().st_size
        if size < start_offset:
            return [], ["log_rotated_or_truncated"], size
        with path.open("rb") as stream:
            stream.seek(start_offset)
            data = stream.read()
    except OSError:
        return [], ["log_unavailable"], start_offset
    events: list[dict[str, Any]] = []
    markers: list[str] = []
    for raw in data.decode("utf-8", errors="replace").splitlines():
        if "speech_synthesis_ok " in raw:
            parsed = parse_service_log_line(raw)
            if parsed is None:
                markers.append("unparsed_success_log")
            else:
                events.append({"type": "success", "metrics": parsed})
        elif "speech_synthesis_rejected category=tts_busy" in raw:
            events.append({"type": "tts_busy"})
        elif "speech_synthesis_failed category=" in raw:
            m = re.search(r"speech_synthesis_failed category=([A-Za-z0-9_]+)", raw)
            events.append({"type": "synthesis_failed", "error_category": m.group(1) if m else "unknown"})
    return events, markers, size


def check_host_route(machine: str, timeout_s: float = 20) -> bool:
    js = ('fetch("http://host.docker.internal:18794/healthz",'
          '{signal:AbortSignal.timeout(3000)}).then(async r=>{let x=await r.json();'
          'process.exit(r.status===200&&x.status==="ready"?0:1)}).catch(()=>process.exit(1))')
    try:
        result = subprocess.run(
            ["orb", "-m", machine, "-u", "root", "docker", "exec", "9router", "node", "-e", js],
            capture_output=True, text=True, timeout=timeout_s, check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def swap_growth_state(initial_used: int | None, baseline_used: int | None,
                      confirmed_used: int | None = None) -> tuple[str, int | None, int | None]:
    """Classify system-wide swap as warning telemetry, never as a standalone hard stop."""
    if not isinstance(initial_used, int) or not isinstance(baseline_used, int):
        return "unavailable", None, None
    initial_delta = initial_used - baseline_used
    if initial_delta < SWAP_PERSISTENT_WARNING_BYTES:
        return "below_warning", initial_delta, None
    if initial_delta >= SWAP_CORROBORATED_STOP_BYTES:
        return "large_growth_requires_pressure_corroboration", initial_delta, None
    if not isinstance(confirmed_used, int):
        return "pause_and_confirm", initial_delta, None
    confirmed_delta = confirmed_used - baseline_used
    if confirmed_delta < SWAP_PERSISTENT_WARNING_BYTES:
        return "transient_or_receding", initial_delta, confirmed_delta
    if initial_delta - confirmed_delta >= SWAP_STABLE_TOLERANCE_BYTES:
        return "elevated_but_decreasing", initial_delta, confirmed_delta
    return "elevated_swap_telemetry_only", initial_delta, confirmed_delta


def safety_reason(snapshot: Mapping[str, Any], *, expected_pid: int | None,
                  baseline_swap_bytes: int | None,
                  expected_runs: int | None = None) -> str | None:
    """Return only hard stops from the v2 Goal; swap alone is never sufficient."""
    health = snapshot.get("health", {})
    if health.get("http_status") != 200 or health.get("status") != "ready":
        return "health_not_ready"
    launchd = snapshot.get("launchd", {})
    if expected_pid is not None and launchd.get("pid") != expected_pid:
        return "launchagent_pid_changed"
    if expected_runs is not None and launchd.get("runs") != expected_runs:
        return "launchagent_restart_count_changed"
    if snapshot.get("host_route_ready") is False:
        return "9router_host_tts_route_unhealthy"

    free = (snapshot.get("memory_pressure", {}) or {}).get("free_percent")
    if not isinstance(free, int):
        return "memory_pressure_telemetry_unavailable"
    if free <= MEMORY_HARD_STOP_PERCENT:
        return "critical_memory_pressure_free_at_or_below_10_percent"

    process = snapshot.get("process", {}) or {}
    footprint = process.get("physical_footprint_bytes")
    if not isinstance(footprint, int):
        return "tts_physical_footprint_telemetry_unavailable"
    if footprint >= FOOTPRINT_HARD_STOP_BYTES:
        return "physical_footprint_reached_20_gib_safety_guard"

    swap = snapshot.get("swap", {}) or {}
    used = swap.get("used_bytes")
    if not isinstance(used, int) or not isinstance(baseline_swap_bytes, int):
        return "swap_telemetry_unavailable"
    delta = used - baseline_swap_bytes
    if (delta >= SWAP_CORROBORATED_STOP_BYTES and
            (free <= MEMORY_DISTRESS_PERCENT or footprint >= FOOTPRINT_DISTRESS_BYTES)):
        return "large_swap_growth_with_memory_distress"

    disk_free = (snapshot.get("startup_disk") or {}).get("available_bytes")
    if not isinstance(disk_free, int):
        return "startup_disk_telemetry_unavailable"
    if (disk_free < MIN_STARTUP_DISK_FREE_BYTES and
            (delta >= SWAP_PERSISTENT_WARNING_BYTES or
             (isinstance(swap.get("free_bytes"), int) and
              swap["free_bytes"] < SWAP_FREE_WARNING_BYTES))):
        return "startup_disk_free_below_20_gib_with_swap_warning"
    return None


def confirm_swap_stability(snapshot: dict[str, Any], *, expected_pid: int | None,
                           baseline_swap_bytes: int | None,
                           expected_runs: int | None = None,
                           host_machine: str | None = None,
                           warning_reference_used_bytes: int | None = None,
                           warning_reference_free_bytes: int | None = None) -> tuple[dict[str, Any], str | None]:
    """Pause new requests on swap warnings and passively confirm independent host stability."""
    swap = snapshot.get("swap", {}) or {}
    used = swap.get("used_bytes")
    free_swap = swap.get("free_bytes")
    state, initial_delta, _ = swap_growth_state(used, baseline_swap_bytes)
    warning_reference_used = (warning_reference_used_bytes if isinstance(warning_reference_used_bytes, int)
                              else baseline_swap_bytes)
    warning_delta = used - warning_reference_used if isinstance(used, int) and isinstance(warning_reference_used, int) else None
    free_drop = (warning_reference_free_bytes - free_swap
                 if isinstance(warning_reference_free_bytes, int) and isinstance(free_swap, int) else None)
    free_swap_warning = (isinstance(free_swap, int) and free_swap < SWAP_FREE_WARNING_BYTES and
                         (not isinstance(warning_reference_free_bytes, int) or
                          warning_reference_free_bytes >= SWAP_FREE_WARNING_BYTES or
                          (isinstance(free_drop, int) and free_drop >= SWAP_WARNING_REARM_DELTA_BYTES)))
    warned = (free_swap_warning or
              (isinstance(warning_delta, int) and warning_delta >= SWAP_PERSISTENT_WARNING_BYTES))
    hard_reason = safety_reason(snapshot, expected_pid=expected_pid,
                                baseline_swap_bytes=baseline_swap_bytes,
                                expected_runs=expected_runs)
    if hard_reason:
        snapshot["swap_growth_check"] = {"state": "hard_stop_before_confirmation",
                                         "initial_delta_bytes": initial_delta,
                                         "confirmation_snapshots": []}
        return snapshot, hard_reason
    if not warned:
        snapshot["swap_growth_check"] = {"state": "no_new_warning", "initial_delta_bytes": initial_delta,
                                         "warning_reference_used_bytes": warning_reference_used,
                                         "warning_growth_since_ack_bytes": warning_delta,
                                         "warning_reference_free_bytes": warning_reference_free_bytes,
                                         "warning_free_drop_since_ack_bytes": free_drop,
                                         "confirmation_count": 0, "confirmation_snapshots": [],
                                         "system_swap_is_standalone_stop": False}
        return snapshot, None

    confirmations: list[dict[str, Any]] = []
    previous = snapshot
    stable_confirmation_count = 0
    for _ in range(SWAP_MAX_CONFIRMATION_WINDOWS):
        time.sleep(SWAP_CONFIRMATION_WINDOW_S)
        confirmation = runtime_snapshot()
        if host_machine:
            confirmation["host_route_ready"] = check_host_route(host_machine)
        hard_reason = safety_reason(confirmation, expected_pid=expected_pid,
                                    baseline_swap_bytes=baseline_swap_bytes,
                                    expected_runs=expected_runs)
        confirmations.append(confirmation)
        if hard_reason:
            snapshot["swap_growth_check"] = {
                "state": "hard_stop_during_passive_confirmation",
                "initial_delta_bytes": initial_delta,
                "confirmation_snapshots": confirmations,
                "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
                "confirmation_count": len(confirmations),
            }
            return snapshot, hard_reason

        current_free = (confirmation.get("memory_pressure") or {}).get("free_percent")
        previous_free = (previous.get("memory_pressure") or {}).get("free_percent")
        current_fp = (confirmation.get("process") or {}).get("physical_footprint_bytes")
        previous_fp = (previous.get("process") or {}).get("physical_footprint_bytes")
        memory_stable = (isinstance(current_free, int) and current_free > MEMORY_HARD_STOP_PERCENT and
                         isinstance(previous_free, int) and current_free >= previous_free - 3)
        footprint_stable = (isinstance(current_fp, int) and isinstance(previous_fp, int) and
                            current_fp < FOOTPRINT_DISTRESS_BYTES and current_fp <= previous_fp + 512 * MIB)
        stable_confirmation_count = stable_confirmation_count + 1 if memory_stable and footprint_stable else 0
        if stable_confirmation_count >= 2:
            snapshot["swap_growth_check"] = {
                "state": "stable_or_recovering_elevated_swap",
                "initial_delta_bytes": initial_delta,
                "warning_reference_used_bytes": warning_reference_used,
                "warning_growth_since_ack_bytes": warning_delta,
                "warning_reference_free_bytes": warning_reference_free_bytes,
                "warning_free_drop_since_ack_bytes": free_drop,
                "confirmation_snapshots": confirmations,
                "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
                "confirmation_count": len(confirmations),
                "system_swap_is_standalone_stop": False,
            }
            return snapshot, None
        previous = confirmation

    snapshot["swap_growth_check"] = {
        "state": "passive_confirmation_window_elapsed_no_hard_stop",
        "initial_delta_bytes": initial_delta,
        "warning_reference_used_bytes": warning_reference_used,
        "warning_growth_since_ack_bytes": warning_delta,
        "warning_reference_free_bytes": warning_reference_free_bytes,
        "warning_free_drop_since_ack_bytes": free_drop,
        "confirmation_snapshots": confirmations,
        "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
        "confirmation_count": len(confirmations),
        "system_swap_is_standalone_stop": False,
    }
    # Even after the full 180-second window, elevated host-wide swap alone is
    # telemetry. Any actual pressure/restart/route/disk hard stop was checked at
    # every snapshot; the next request will be gated by another fresh snapshot.
    return snapshot, None


def admission_baseline_reason(snapshots: Sequence[Mapping[str, Any]]) -> str | None:
    """Validate the Goal's three-snapshot fresh-run admission gate."""
    if len(snapshots) != 3:
        return "admission_requires_three_snapshots"
    first = snapshots[0]
    first_launchd = first.get("launchd", {})
    expected_pid = first_launchd.get("pid")
    expected_runs = first_launchd.get("runs")
    memory_values: list[int] = []
    swap_values: list[int] = []
    for snapshot in snapshots:
        health = snapshot.get("health", {})
        if health.get("http_status") != 200 or health.get("status") != "ready":
            return "admission_health_not_ready"
        launchd = snapshot.get("launchd", {})
        if not expected_pid or launchd.get("pid") != expected_pid or launchd.get("runs") != expected_runs:
            return "admission_launchagent_changed"
        if snapshot.get("host_route_ready") is not True:
            return "admission_host_route_unhealthy"
        memory_free = (snapshot.get("memory_pressure") or {}).get("free_percent")
        if not isinstance(memory_free, int) or memory_free < 25:
            return "admission_memory_free_below_25_percent"
        memory_values.append(memory_free)
        footprint = (snapshot.get("process") or {}).get("physical_footprint_bytes")
        if not isinstance(footprint, int) or footprint >= 10 * GIB:
            return "admission_tts_footprint_at_or_above_10_gib"
        disk_free = (snapshot.get("startup_disk") or {}).get("available_bytes")
        if not isinstance(disk_free, int) or disk_free < MIN_STARTUP_DISK_FREE_BYTES:
            return "admission_startup_disk_below_20_gib"
        swap_used = (snapshot.get("swap") or {}).get("used_bytes")
        if not isinstance(swap_used, int):
            return "admission_swap_telemetry_unavailable"
        swap_values.append(swap_used)
    if memory_values[-1] < memory_values[0] - 5:
        return "admission_memory_pressure_trending_down"
    if swap_values[-1] > swap_values[0] + SWAP_STABLE_TOLERANCE_BYTES:
        return "admission_swap_not_stable_or_declining"
    return None
