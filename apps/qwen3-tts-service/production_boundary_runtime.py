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
TTS_HEALTH_URL = "http://127.0.0.1:18792/healthz"
SERVICE_PATH = "/v1/audio/speech"
GIB = 1024 ** 3
MIB = 1024 ** 2
SWAP_PERSISTENT_WARNING_BYTES = 512 * MIB
SWAP_CLEAR_DECLINE_BYTES = 128 * MIB
SWAP_IMMEDIATE_STOP_BYTES = 2 * 1024 * MIB
SWAP_FREE_IMMEDIATE_STOP_BYTES = 512 * MIB
SWAP_CONFIRMATION_WINDOW_S = 30
# The protected runs showed that swap can continue to recede for several minutes after a
# synthesis even while free memory/health remain stable. Extend passive confirmation only;
# all immediate pressure/growth stops and the 512 MiB threshold remain unchanged.
SWAP_MAX_CONFIRMATION_WINDOWS = 12


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
    js = ('fetch("http://host.docker.internal:18792/healthz",'
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
    """Classify system-wide swap growth, requiring persistent/non-declining evidence."""
    if not isinstance(initial_used, int) or not isinstance(baseline_used, int):
        return "unavailable", None, None
    initial_delta = initial_used - baseline_used
    if initial_delta < SWAP_PERSISTENT_WARNING_BYTES:
        return "below_guard", initial_delta, None
    if initial_delta >= SWAP_IMMEDIATE_STOP_BYTES:
        return "immediate_stop", initial_delta, None
    if not isinstance(confirmed_used, int):
        return "confirmation_required", initial_delta, None
    confirmed_delta = confirmed_used - baseline_used
    if confirmed_delta < SWAP_PERSISTENT_WARNING_BYTES:
        return "transient_recovered", initial_delta, confirmed_delta
    if initial_delta - confirmed_delta >= SWAP_CLEAR_DECLINE_BYTES:
        return "elevated_but_decreasing", initial_delta, confirmed_delta
    return "persistent_no_clear_decline", initial_delta, confirmed_delta


def safety_reason(snapshot: Mapping[str, Any], *, expected_pid: int | None,
                  baseline_swap_bytes: int | None) -> str | None:
    health = snapshot.get("health", {})
    if health.get("http_status") != 200 or health.get("status") != "ready":
        return "health_not_ready"
    launchd = snapshot.get("launchd", {})
    if expected_pid and launchd.get("pid") != expected_pid:
        return "launchagent_pid_changed"
    free = (snapshot.get("memory_pressure", {}) or {}).get("free_percent")
    if isinstance(free, int) and free < 10:
        return "critical_memory_pressure_free_below_10_percent"
    process = snapshot.get("process", {}) or {}
    footprint = process.get("physical_footprint_bytes")
    if isinstance(footprint, int) and footprint >= 20 * GIB:
        return "physical_footprint_reached_20_gib_safety_guard"
    swap = snapshot.get("swap", {}) or {}
    free_swap = swap.get("free_bytes")
    if isinstance(free_swap, int) and free_swap < SWAP_FREE_IMMEDIATE_STOP_BYTES:
        return "system_free_swap_below_512_mib_safety_guard"
    used = swap.get("used_bytes")
    state, _, _ = swap_growth_state(used, baseline_swap_bytes)
    if state == "immediate_stop":
        return "swap_growth_reached_2_gib_immediate_safety_guard"
    return None


def confirm_swap_stability(snapshot: dict[str, Any], *, expected_pid: int | None,
                           baseline_swap_bytes: int | None) -> tuple[dict[str, Any], str | None]:
    used = (snapshot.get("swap", {}) or {}).get("used_bytes")
    state, initial_delta, _ = swap_growth_state(used, baseline_swap_bytes)
    if state != "confirmation_required":
        if state in ("immediate_stop",):
            snapshot["swap_growth_check"] = {"state": state, "initial_delta_bytes": initial_delta}
            return snapshot, "swap_growth_reached_2_gib_immediate_safety_guard"
        return snapshot, safety_reason(snapshot, expected_pid=expected_pid,
                                       baseline_swap_bytes=baseline_swap_bytes)

    deltas = [initial_delta]
    free_samples = []
    last_confirmation: dict[str, Any] | None = None
    final_state = state
    for _ in range(SWAP_MAX_CONFIRMATION_WINDOWS):
        time.sleep(SWAP_CONFIRMATION_WINDOW_S)
        confirmation = runtime_snapshot()
        last_confirmation = confirmation
        hard_reason = safety_reason(confirmation, expected_pid=expected_pid,
                                    baseline_swap_bytes=baseline_swap_bytes)
        if hard_reason:
            snapshot["swap_growth_check"] = {
                "state": "safety_stop_during_idle_confirmation",
                "initial_delta_bytes": initial_delta,
                "confirmed_deltas_bytes": deltas,
                "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
                "confirmation_count": len(deltas) - 1,
            }
            return snapshot, hard_reason
        confirmed_used = (confirmation.get("swap") or {}).get("used_bytes")
        final_state, _, confirmed_delta = swap_growth_state(used, baseline_swap_bytes, confirmed_used)
        deltas.append(confirmed_delta if confirmed_delta is not None else -1)
        free_samples.append((confirmation.get("memory_pressure") or {}).get("free_percent"))
        if final_state in ("transient_recovered", "elevated_but_decreasing"):
            snapshot["swap_growth_check"] = {
                "state": final_state,
                "initial_delta_bytes": initial_delta,
                "confirmed_deltas_bytes": deltas,
                "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
                "confirmation_count": len(deltas) - 1,
                "confirmation_memory_free_percent": free_samples,
                "confirmation_swap_free_bytes": (confirmation.get("swap") or {}).get("free_bytes"),
                "confirmation_physical_footprint_bytes": (confirmation.get("process") or {}).get("physical_footprint_bytes"),
            }
            return snapshot, None
        # If the first idle check is flat/up, one more 30-second sample distinguishes a brief plateau from persistence.
    snapshot["swap_growth_check"] = {
        "state": "persistent_no_clear_decline",
        "initial_delta_bytes": initial_delta,
        "confirmed_deltas_bytes": deltas,
        "confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
        "confirmation_count": len(deltas) - 1,
        "confirmation_memory_free_percent": free_samples,
        "confirmation_swap_free_bytes": ((last_confirmation or {}).get("swap") or {}).get("free_bytes"),
        "confirmation_physical_footprint_bytes": ((last_confirmation or {}).get("process") or {}).get("physical_footprint_bytes"),
    }
    return snapshot, f"swap_growth_over_512_mib_persisted_without_clear_decline_after_{SWAP_CONFIRMATION_WINDOW_S * SWAP_MAX_CONFIRMATION_WINDOWS}s_idle_confirmation"
