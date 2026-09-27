#!/usr/bin/env python3
"""Acknowledge the single delayed service-failure log from a preserved watchdog stop, without sending TTS."""
from __future__ import annotations

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
from production_boundary_runtime import appended_log_events, healthz, launchd_state


def protected_json(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_stop_evidence_required:" + path.name)
    return json.loads(path.read_text())


def write_private(path: Path, value: object) -> None:
    data = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="advance only the private benchmark log cursor")
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--log-file", type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        print("STOP_LOG_ACK=plan_only; --apply required")
        return
    root = args.run_root.resolve()
    if root == ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")
    control = protected_json(root / "control-manifest.json")
    phase = protected_json(root / "phase-probes.complete.json")
    probe_summary = protected_json(root / "probe-summary.json")
    stop = protected_json(root / "post-safety-stop-observation.json")
    state_path = root / "runtime-state.json"
    state = protected_json(state_path)
    if phase.get("status") != "stopped" or phase.get("reason") != "probe_measurement_or_connection_integrity_failed":
        raise ValueError("run_is_not_the_documented_watchdog_stopped_probe_phase")
    if probe_summary.get("stopped_at") != 800:
        raise ValueError("unexpected_safety_stop_length")
    expected_failure = stop.get("latest_post_stop_synthesis_failure_log") or {}
    if expected_failure.get("error_category") != "RuntimeError" or not expected_failure.get("timestamp_local"):
        raise ValueError("post_stop_failure_log_evidence_missing")
    log_path = args.log_file
    if log_path.is_symlink() or not log_path.is_file():
        raise ValueError("service_log_file_required")
    start_offset = int(state.get("last_log_offset", -1))
    end_offset = log_path.stat().st_size
    events, markers, actual_end = appended_log_events(log_path, start_offset)
    if markers or actual_end != end_offset:
        raise RuntimeError("service_log_rotated_or_changed_during_stop_ack")
    if len(events) != 1 or events[0].get("type") != "synthesis_failed" or events[0].get("error_category") != "RuntimeError":
        raise RuntimeError("unexpected_or_ambiguous_service_events_after_watchdog_stop")
    with log_path.open("rb") as f:
        f.seek(start_offset)
        appended = f.read().decode("utf-8", errors="replace").splitlines()
    matching = []
    for line in appended:
        m = re.match(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d+).*speech_synthesis_failed category=RuntimeError", line)
        if m:
            matching.append(m.group(1))
    if len(matching) != 1 or not matching[0].startswith(expected_failure["timestamp_local"].split(",")[0]):
        raise RuntimeError("late_failure_event_does_not_match_preserved_stop_observation")
    health = healthz()
    job = launchd_state()
    expected_pid = int(control.get("runtime", {}).get("launchd", {}).get("pid", 0))
    if health.get("status") != "ready" or health.get("http_status") != 200:
        raise RuntimeError("production_health_not_ready_after_watchdog_stop")
    if job.get("pid") != expected_pid or job.get("runs") != 1 or job.get("process_type") != "Interactive":
        raise RuntimeError("production_launchagent_state_changed_after_watchdog_stop")
    ack = {
        "acknowledged_utc": datetime.now().astimezone().isoformat(),
        "phase": "probes",
        "safety_stop_codepoints": 800,
        "client_watchdog_ms": 110000,
        "acknowledged_event": {"type": "synthesis_failed", "error_category": "RuntimeError",
                                "timestamp_local": matching[0]},
        "request_id_available": False,
        "correlation_note": "The single RuntimeError is time-correlated with the watchdog request; the unchanged service has no request IDs.",
        "uncontrolled_success_or_busy_event_between_stop_and_ack": False,
        "production_health": health,
        "launchd_pid": job["pid"],
        "launchd_runs": job["runs"],
        "launchd_process_type": job["process_type"],
        "tts_request_submitted_by_ack_command": False,
    }
    write_private(root / "post-stop-acknowledgement.json", ack)
    state["last_log_offset"] = end_offset
    state["acknowledged_post_stop_event"] = ack["acknowledged_event"]
    temp = root / "runtime-state.json.ack.tmp"
    data = (json.dumps(state, ensure_ascii=False, sort_keys=True) + "\n").encode()
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp, state_path)
    state_path.chmod(0o600)
    print("STOP_LOG_EVENT_ACKNOWLEDGED=single_time_correlated_RuntimeError")
    print(f"SAFETY_STOP=800_chars_after_110s_watchdog; late_error_at={matching[0]}")
    print(f"SERVICE_RECOVERED=ready PID={job['pid']} RUNS={job['runs']} TTS_REQUESTS_SENT=0")


if __name__ == "__main__":
    main()
