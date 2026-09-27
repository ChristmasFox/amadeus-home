#!/usr/bin/env python3
"""Collect the unchanged 1.6.2 production TTS boundary/stress study with protected raw evidence."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import http.client
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
import production_boundary as boundary
from production_boundary_runtime import (
    GIB, MIB, appended_log_events, check_host_route, confirm_swap_stability, healthz, runtime_snapshot,
    safety_reason,
)

AUDIO_MAGIC_OK = lambda b: b.startswith(b"ID3") or b[:1] == b"\xff"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def private_write(path: Path, data: bytes, *, exclusive: bool = True) -> None:
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def private_json(path: Path, value: object, *, exclusive: bool = True) -> None:
    private_write(path, boundary.canonical_json_bytes(value), exclusive=exclusive)


def append_jsonl(path: Path, value: object) -> None:
    line = boundary.canonical_json_bytes(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)
    if path.stat().st_mode & 0o077:
        path.chmod(0o600)


def read_json(path: Path) -> dict:
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("protected_run_manifest_required:" + path.name)
    return json.loads(path.read_text())


def validate_run(root_arg: Path) -> tuple[Path, dict[int, dict], dict, list[dict], dict]:
    root = root_arg.resolve()
    if root == ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")
    run_manifest = read_json(root / "run-manifest.json")
    schedule = read_json(root / "schedule.json")
    control = read_json(root / "control-manifest.json")
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    if fixture_sha != run_manifest.get("fixture_manifest_sha256") or fixture_sha != control.get("fixture_manifest_sha256"):
        raise ValueError("fixture_manifest_changed_after_freeze")
    schedule_sha = boundary.schedule_sha256(schedule)
    if schedule_sha != run_manifest.get("schedule_sha256") or schedule_sha != control.get("schedule_sha256"):
        raise ValueError("frozen_schedule_changed")
    if run_manifest.get("control_id") != boundary.CONTROL_ID or control.get("control_id") != boundary.CONTROL_ID:
        raise ValueError("production_control_id_mismatch")
    if control.get("production_configuration_changed_by_goal") is not False:
        raise ValueError("production_control_not_immutable")
    return root, fixtures, run_manifest, schedule, control


def service_log_path(control: dict) -> Path:
    # Only the log file path is resolved locally. Log contents are parsed into numeric fields only.
    path = Path.home() / "Library/Logs/Amadeus/qwen3-tts.log"
    if not path.is_file() or path.is_symlink():
        raise ValueError("production_service_log_unavailable")
    return path


def load_token(path: Path) -> str:
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_tts_token_required")
    token = path.read_text().strip()
    if len(token) < 32:
        raise ValueError("protected_tts_token_invalid")
    return token


def error_category(status: int | None, body: bytes) -> str | None:
    if status in (200, None):
        return None
    try:
        obj = json.loads(body)
        value = obj.get("error", {}).get("type")
        if value in ("tts_busy", "synthesis_failed", "provider_unavailable", "invalid_input"):
            return value
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError, TypeError):
        pass
    return "http_error"


def current_log_offset(log_path: Path) -> int:
    return log_path.stat().st_size


def external_log_events(log_path: Path, start: int, end: int) -> list[dict]:
    events, markers, actual_end = appended_log_events(log_path, start)
    if markers or actual_end != end:
        raise RuntimeError("service_log_changed_or_rotated_during_sample")
    return events


def assert_quiet_gap(log_path: Path, cursor: int) -> int:
    current = current_log_offset(log_path)
    events = external_log_events(log_path, cursor, current)
    if events:
        raise RuntimeError("uncontrolled_tts_traffic_between_benchmark_requests")
    return current


def request_once(*, token: str, log_path: Path, text: str, fixture_id: str, length: int,
                 family: str, run_index: int, phase: str, audio_path: Path | None,
                 timeout_s: float = boundary.WATCHDOG_S,
                 expected_log_offset: int | None = None) -> tuple[dict, int]:
    request = json.dumps({
        "model": "qwen3-tts-1.7b", "voice": "kurisu-v1", "input": text,
        "response_format": "mp3",
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    offset = current_log_offset(log_path)
    if expected_log_offset is not None and offset != expected_log_offset:
        events = external_log_events(log_path, expected_log_offset, offset)
        if events:
            return ({
                "timestamp_utc": utc_now(), "phase": phase, "length": length,
                "fixture_id": fixture_id, "family": family, "fixture_run_index": run_index,
                "request_submitted": False, "http_status": None, "success": False,
                "total_ms": None, "error_category": "uncontrolled_tts_traffic_before_request",
                "audio_bytes": None, "fixture_text_sha256": boundary.sha256_bytes(text.encode("utf-8")),
                "log_event_count": len(events),
                "measurement_warnings": ["uncontrolled_tts_traffic_before_request"],
            }, offset)
    started = time.perf_counter()
    response_body = b""
    status: int | None = None
    request_error: str | None = None
    try:
        conn = http.client.HTTPConnection("127.0.0.1", 18792, timeout=timeout_s)
        try:
            conn.request("POST", "/v1/audio/speech", request, {
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            })
            response = conn.getresponse()
            status = response.status
            response_body = response.read()
        finally:
            conn.close()
    except (socket.timeout, TimeoutError):
        request_error = "watchdog_timeout"
    except Exception as exc:
        request_error = type(exc).__name__
    total_ms = round((time.perf_counter() - started) * 1000, 1)
    end_offset = current_log_offset(log_path)
    events = external_log_events(log_path, offset, end_offset)
    marker_list: list[str] = []
    if status == 200:
        if len(events) == 1 and events[0]["type"] == "success":
            log_metrics = events[0]["metrics"]
        else:
            log_metrics = None
            marker_list.append("success_log_correlation_count_mismatch")
    elif status == 503:
        log_metrics = None
        if len(events) != 1 or events[0]["type"] not in ("tts_busy", "synthesis_failed"):
            marker_list.append("failure_log_correlation_count_mismatch")
    else:
        log_metrics = None
        if events:
            marker_list.append("unexpected_service_log_event")
    valid_audio = status == 200 and AUDIO_MAGIC_OK(response_body)
    row: dict = {
        "timestamp_utc": utc_now(),
        "phase": phase,
        "length": length,
        "fixture_id": fixture_id,
        "family": family,
        "fixture_run_index": run_index,
        "http_status": status,
        "request_submitted": True,
        "success": bool(valid_audio and log_metrics is not None and not marker_list),
        "total_ms": total_ms,
        "error_category": request_error or error_category(status, response_body),
        "audio_bytes": len(response_body) if valid_audio else None,
        "fixture_text_sha256": boundary.sha256_bytes(text.encode("utf-8")),
        "log_event_count": len(events),
        "measurement_warnings": marker_list,
    }
    if log_metrics:
        row.update(log_metrics)
    if status == 200 and not valid_audio:
        row["error_category"] = "invalid_mp3_response"
    if audio_path is not None and valid_audio:
        audio_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if audio_path.parent.stat().st_mode & 0o077:
            audio_path.parent.chmod(0o700)
        private_write(audio_path, response_body)
        row["temporary_audio_path"] = str(audio_path.relative_to(audio_path.parents[2]))
    return row, end_offset


def append_runtime_state(root: Path, *, log_offset: int, extra: dict | None = None) -> None:
    state = read_json(root / "runtime-state.json") if (root / "runtime-state.json").exists() else {}
    state["last_log_offset"] = log_offset
    if extra:
        state.update(extra)
    private_json(root / "runtime-state.json", state, exclusive=False)
    (root / "runtime-state.json").chmod(0o600)


def load_runtime_state(root: Path, control: dict) -> dict:
    path = root / "runtime-state.json"
    if path.exists():
        return read_json(path)
    runtime = control.get("runtime", {})
    process = runtime.get("launchd", {})
    return {
        "last_log_offset": int(control.get("service_log_size_bytes", 0)),
        "expected_pid": process.get("pid"),
        "baseline_swap_used_bytes": (runtime.get("swap") or {}).get("used_bytes"),
    }


def start_phase(root: Path, phase: str, state: dict, log_path: Path) -> dict:
    start = root / f"phase-{phase}.start.json"
    complete = root / f"phase-{phase}.complete.json"
    if start.exists() or complete.exists():
        raise FileExistsError("phase_already_started_or_completed:" + phase)
    current = current_log_offset(log_path)
    old = int(state.get("last_log_offset", current))
    events = external_log_events(log_path, old, current)
    if events:
        raise RuntimeError("uncontrolled_tts_traffic_since_previous_phase")
    private_json(start, {"phase": phase, "started_utc": utc_now(), "start_log_offset": current})
    return {**state, "last_log_offset": current}


def finish_phase(root: Path, phase: str, status: str, *, reason: str | None = None,
                 extra: dict | None = None) -> None:
    complete = {"phase": phase, "completed_utc": utc_now(), "status": status}
    if reason:
        complete["reason"] = reason
    if extra:
        complete.update(extra)
    private_json(root / f"phase-{phase}.complete.json", complete)


def check_safe_now(control: dict) -> tuple[dict, str | None]:
    snapshot = runtime_snapshot()
    runtime = control.get("runtime", {})
    expected_pid = (runtime.get("launchd") or {}).get("pid")
    baseline_swap = (runtime.get("swap") or {}).get("used_bytes")
    reason = safety_reason(snapshot, expected_pid=expected_pid, baseline_swap_bytes=baseline_swap)
    if reason:
        return snapshot, reason
    return confirm_swap_stability(snapshot, expected_pid=expected_pid, baseline_swap_bytes=baseline_swap)


def read_probe_summary(root: Path) -> dict:
    path = root / "probe-summary.json"
    return read_json(path)


def run_warmup(root: Path, fixtures: dict, control: dict, token: str, log_path: Path, state: dict) -> None:
    phase = "warmup"
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    passed = True
    reason = None
    for index in range(3):
        if index:
            time.sleep(1)
        cursor = assert_quiet_gap(log_path, cursor)
        snapshot, reason = check_safe_now(control)
        if reason:
            passed = False
            break
        row, cursor = request_once(token=token, log_path=log_path,
                                  text=fixtures[50]["A"]["text"], fixture_id="A-50", length=50,
                                  family="A", run_index=index, phase=phase, audio_path=None,
                                  expected_log_offset=cursor)
        row.update({"excluded_from_quantiles": True, "host_before": snapshot})
        after, reason = check_safe_now(control)
        row["host_after"] = after
        append_jsonl(root / "warmup.jsonl", row)
        append_runtime_state(root, log_offset=cursor)
        if not row["success"] or reason:
            passed = False
            break
    finish_phase(root, phase, "complete" if passed else "stopped", reason=None if passed else (reason or "warmup_request_failed"),
                 extra={"successful_warmups": 3 if passed else None, "excluded_from_quantiles": True})
    print("WARMUP=" + ("complete" if passed else "stopped"))


def run_anchor(root: Path, fixtures: dict, control: dict, token: str, log_path: Path,
               state: dict, *, recovery: bool = False) -> None:
    phase = "recovery" if recovery else "anchor-pre"
    anchor_dir = root / "recovery" if recovery else root / "anchors"
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    before = runtime_snapshot()
    private_json(anchor_dir / "host-before.json", before)
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    rows_path = anchor_dir / "samples.jsonl"
    success = 0
    for index in range(20):
        if index:
            time.sleep(boundary.QUIET_INTERVAL_S)
        cursor = assert_quiet_gap(log_path, cursor)
        snapshot, reason = check_safe_now(control)
        if reason:
            finish_phase(root, phase, "stopped", reason=reason, extra={"successful_samples": success})
            append_runtime_state(root, log_offset=cursor)
            return
        row, cursor = request_once(token=token, log_path=log_path, text=fixtures[50]["A"]["text"],
                                  fixture_id="A-50", length=50, family="A", run_index=index,
                                  phase=phase, audio_path=None, expected_log_offset=cursor)
        row.update({"host_before": snapshot, "excluded_from_length_matrix": True})
        after, reason = check_safe_now(control)
        row["host_after"] = after
        append_jsonl(rows_path, row)
        append_runtime_state(root, log_offset=cursor)
        if row.get("request_submitted") is False:
            finish_phase(root, phase, "incomplete", reason="uncontrolled_tts_traffic_before_request",
                         extra={"successful_samples": success, "attempts": index})
            return
        if row["success"]:
            success += 1
        else:
            finish_phase(root, phase, "incomplete", reason=row.get("error_category") or "anchor_sample_failed",
                         extra={"successful_samples": success, "attempts": index + 1})
            return
        if reason:
            finish_phase(root, phase, "stopped", reason=reason, extra={"successful_samples": success})
            return
    after = runtime_snapshot()
    private_json(anchor_dir / "host-after.json", after)
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy",
                     extra={"successful_samples": success})
        return
    finish_phase(root, phase, "complete", extra={"successful_samples": success, "attempts": 20})
    print(f"{phase.upper()}_SAMPLES={success}")


def host_machine_from_control(control: dict) -> str:
    return str(control.get("host_machine", "nyannyan"))


def run_probes(root: Path, fixtures: dict, control: dict, token: str, log_path: Path, state: dict) -> None:
    phase = "probes"
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    summary: dict[str, Any] = {"passed_lengths": [], "stopped_at": None, "stop_reason": None, "buckets": {}}
    route_machine = host_machine_from_control(control)
    if not check_host_route(route_machine):
        reason = "9router_host_tts_route_unhealthy"
        for length in boundary.LENGTHS:
            summary["buckets"][str(length)] = {"status": "not_probed", "reason": reason}
        private_json(root / "probe-summary.json", summary)
        finish_phase(root, phase, "stopped", reason=reason)
        return
    for length in boundary.LENGTHS:
        attempts: list[dict] = []
        passed = False
        reason: str | None = None
        for index in range(2):
            if index:
                time.sleep(5)
            cursor = assert_quiet_gap(log_path, cursor)
            before, safety = check_safe_now(control)
            if safety:
                reason = safety
                break
            row, cursor = request_once(token=token, log_path=log_path,
                                      text=fixtures[length]["A"]["text"], fixture_id=f"A-{length}",
                                      length=length, family="A", run_index=index, phase=phase,
                                      audio_path=None, expected_log_offset=cursor)
            row.update({"excluded_from_quantiles": True, "host_before": before})
            after, after_safety = check_safe_now(control)
            row["host_after"] = after
            append_jsonl(root / "probes" / "samples.jsonl", row)
            append_runtime_state(root, log_offset=cursor)
            attempts.append({"success": row["success"], "request_submitted": row.get("request_submitted", True),
                             "http_status": row["http_status"], "error_category": row["error_category"],
                             "total_ms": row["total_ms"]})
            if after_safety:
                reason = after_safety
                break
            if row["success"]:
                passed = True
                break
            if row.get("request_submitted") is False or row.get("measurement_warnings") or row.get("error_category") in (
                "watchdog_timeout", "TimeoutError", "socket.timeout", "ConnectionError",
            ):
                reason = "probe_measurement_or_connection_integrity_failed"
                break
            if row.get("error_category") == "tts_busy":
                reason = "unexpected_tts_busy_during_sequential_probe"
                break
            if row.get("error_category") not in ("synthesis_failed", "provider_unavailable"):
                reason = "probe_http_or_audio_failure"
                break
            # A single synthesis failure is rechecked once; a second failure is a safety stop.
            reason = "synthesis_failed_twice_same_bucket"
        route_ok = check_host_route(route_machine) if passed else False
        if passed and route_ok:
            summary["passed_lengths"].append(length)
            summary["buckets"][str(length)] = {"status": "passed", "attempts": attempts}
            time.sleep(5)
            continue
        reason = reason or ("9router_host_tts_route_unhealthy" if not route_ok else "probe_failed")
        summary["stopped_at"] = length
        summary["stop_reason"] = reason
        summary["buckets"][str(length)] = {"status": "safety-incomplete", "attempts": attempts, "reason": reason}
        for later in boundary.LENGTHS:
            if later > length:
                summary["buckets"][str(later)] = {"status": "not_probed_after_stop", "reason": reason}
        break
    summary["fixture_manifest_sha256"] = control["fixture_manifest_sha256"]
    summary["schedule_sha256"] = control["schedule_sha256"]
    private_json(root / "probe-summary.json", summary)
    append_runtime_state(root, log_offset=cursor)
    finish_phase(root, phase, "complete" if summary["stopped_at"] is None else "stopped",
                 reason=summary["stop_reason"], extra={"passed_lengths": summary["passed_lengths"]})
    print(f"PROBES_PASSED={len(summary['passed_lengths'])}/{len(boundary.LENGTHS)} STOPPED_AT={summary['stopped_at']}")


def run_matrix(root: Path, fixtures: dict, control: dict, schedule: list[dict],
               token: str, log_path: Path, state: dict) -> None:
    phase = "matrix"
    if not (root / "phase-probes.complete.json").is_file():
        raise RuntimeError("safety_probes_must_complete_before_matrix")
    probes = read_probe_summary(root)
    safe_lengths = set(probes.get("passed_lengths", []))
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    if not safe_lengths:
        finish_phase(root, phase, "not_run", reason="no_length_buckets_passed_safety_preflight")
        private_json(root / "matrix-summary.json", {"safe_lengths": [], "buckets": {}})
        return
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    counts = {str(n): {"attempts": 0, "success": 0, "failure": 0} for n in boundary.LENGTHS}
    errors_by_length: dict[int, int] = {}
    phase_reason: str | None = None
    rows_file = root / "matrix.jsonl"
    matrix_measurements = 0
    for item in schedule:
        length = item["length"]
        if length not in safe_lengths:
            continue
        if counts[str(length)]["success"] >= 20:
            continue
        if counts[str(length)]["attempts"] >= 20:
            continue
        if matrix_measurements:
            time.sleep(boundary.QUIET_INTERVAL_S)
        try:
            cursor = assert_quiet_gap(log_path, cursor)
        except RuntimeError as exc:
            phase_reason = str(exc)
            break
        before, safety = check_safe_now(control)
        if safety:
            phase_reason = safety
            break
        run_index = int(item["fixture_run_index"])
        audio_path = root / "audio" / str(length) / f"{item['family']}-{run_index:02d}.mp3"
        row, cursor = request_once(token=token, log_path=log_path,
                                  text=fixtures[length][item["family"]]["text"],
                                  fixture_id=item["fixture_id"], length=length,
                                  family=item["family"], run_index=run_index, phase=phase,
                                  audio_path=audio_path, expected_log_offset=cursor)
        row.update({"schedule_order_index": item["order_index"], "cycle": item["cycle"],
                    "host_before": before})
        matrix_measurements += 1
        if row.get("request_submitted") is not False:
            counts[str(length)]["attempts"] += 1
            if row["success"]:
                counts[str(length)]["success"] += 1
            else:
                counts[str(length)]["failure"] += 1
                errors_by_length[length] = errors_by_length.get(length, 0) + 1
        after, safety = check_safe_now(control)
        row["host_after"] = after
        append_jsonl(rows_file, row)
        append_runtime_state(root, log_offset=cursor)
        if safety:
            phase_reason = safety
            break
        if row.get("request_submitted") is False or row.get("measurement_warnings"):
            phase_reason = "uncontrolled_or_uncorrelated_service_log_event"
            break
        if row.get("error_category") == "tts_busy":
            phase_reason = "unexpected_tts_busy_during_quiet_matrix"
            break
        if row.get("error_category") == "watchdog_timeout":
            phase_reason = "inflight_request_exceeded_110s_watchdog"
            break
        if errors_by_length.get(length, 0) >= 2:
            phase_reason = f"repeated_synthesis_failure_at_{length}"
            break
        if row.get("error_category") in ("ConnectionError", "RemoteDisconnected", "TimeoutError"):
            phase_reason = "endpoint_connection_failure"
            break
    # Rows are appended immediately; the host-after sample is captured alongside summary telemetry.
    buckets = {}
    rows = read_jsonl(rows_file) if rows_file.exists() else []
    for n in boundary.LENGTHS:
        bucket_rows = [r for r in rows if r.get("length") == n and r.get("request_submitted") is not False]
        total_success = sum(1 for r in bucket_rows if r.get("success"))
        total_attempts = len(bucket_rows)
        buckets[str(n)] = {
            "status": "complete" if n in safe_lengths and total_success == 20 and total_attempts == 20 else
                      "safety-incomplete" if n in safe_lengths else
                      probes.get("buckets", {}).get(str(n), {}).get("status", "not_probed"),
            "attempts": total_attempts,
            "success": total_success,
            "failure": total_attempts - total_success,
        }
        if buckets[str(n)]["status"] != "complete" and n in safe_lengths and phase_reason:
            buckets[str(n)]["reason"] = phase_reason
    matrix_summary = {"safe_lengths": sorted(safe_lengths), "buckets": buckets,
                      "stop_reason": phase_reason, "schedule_sha256": control["schedule_sha256"]}
    private_json(root / "matrix-summary.json", matrix_summary)
    route_ok = check_host_route(host_machine_from_control(control))
    if not route_ok and phase_reason is None:
        phase_reason = "9router_host_tts_route_unhealthy"
    append_runtime_state(root, log_offset=cursor)
    finish_phase(root, phase, "complete" if phase_reason is None else "stopped", reason=phase_reason,
                 extra={"complete_buckets": sum(v["status"] == "complete" for v in buckets.values()),
                        "stop_reason": phase_reason})
    print(f"MATRIX_COMPLETE_BUCKETS={sum(v['status']=='complete' for v in buckets.values())}/{len(boundary.LENGTHS)} STOP={phase_reason}")


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("private_jsonl_required")
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def matrix_bucket_status(root: Path) -> dict:
    return read_json(root / "matrix-summary.json").get("buckets", {}) if (root / "matrix-summary.json").exists() else {}


def choose_stress_lengths(root: Path) -> tuple[list[int], dict]:
    probes = set(read_probe_summary(root).get("passed_lengths", []))
    matrix = matrix_bucket_status(root)
    complete = {n for n in boundary.LENGTHS if n in probes and matrix.get(str(n), {}).get("status") == "complete"}
    if 50 not in complete:
        return [], {"status": "not_run", "reason": "required_50_bucket_not_complete", "missing": [50]}
    selected = [50]
    missing = []
    if 150 in complete:
        selected.append(150)
    else:
        missing.append(150)
    if 320 in complete:
        extended = 320
        extended_reason = "requested_320_bucket_complete"
    else:
        lower = [n for n in boundary.LENGTHS if n < 320 and n in complete]
        extended = max(lower) if lower else None
        extended_reason = "320_incomplete; largest_complete_lower_bucket_substituted"
    if extended is not None and extended not in selected:
        selected.append(extended)
    elif extended is None:
        missing.append("third_length")
    return selected, {"status": "ready", "missing_requested_lengths": missing,
                      "extended_length": extended, "extended_reason": extended_reason}

def run_soak(root: Path, fixtures: dict, control: dict, token: str, log_path: Path, state: dict) -> None:
    phase = "soak"
    if not (root / "phase-matrix.complete.json").is_file():
        raise RuntimeError("latency_matrix_must_finish_before_soak")
    lengths, selection = choose_stress_lengths(root)
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    if not lengths:
        finish_phase(root, phase, "not_run", reason=selection.get("reason"))
        private_json(root / "soak" / "summary.json", {"status": "not_run", **selection, "lengths": lengths})
        return
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    summaries = {}
    for length in lengths:
        start_snapshot = runtime_snapshot()
        private_json(root / "soak" / f"{length}-before.json", start_snapshot)
        rows_file = root / "soak" / f"{length}.jsonl"
        rows: list[dict] = []
        failures = 0
        for index in range(30):
            try:
                cursor = assert_quiet_gap(log_path, cursor)
            except RuntimeError as exc:
                finish_phase(root, phase, "stopped", reason=str(exc), extra={"length": length, "completed": index})
                return
            before, safety = check_safe_now(control)
            if safety:
                finish_phase(root, phase, "stopped", reason=safety, extra={"length": length, "completed": index})
                return
            family = "A" if index % 2 == 0 else "B"
            row, cursor = request_once(token=token, log_path=log_path,
                                      text=fixtures[length][family]["text"], fixture_id=f"{family}-{length}",
                                      length=length, family=family, run_index=index, phase=phase, audio_path=None,
                                      expected_log_offset=cursor)
            row.update({"soak_index": index, "host_before": before})
            if not row["success"]:
                failures += 1
            after, safety = check_safe_now(control)
            row["host_after"] = after
            rows.append(row)
            append_jsonl(rows_file, row)
            append_runtime_state(root, log_offset=cursor)
            if safety or row.get("request_submitted") is False or row.get("measurement_warnings") or row.get("error_category") in ("watchdog_timeout", "tts_busy") or failures >= 2:
                finish_phase(root, phase, "stopped", reason=safety or "soak_request_failed_or_uncorrelated",
                             extra={"length": length, "completed": index + 1})
                return
        end_snapshot = runtime_snapshot()
        private_json(root / "soak" / f"{length}-after.json", end_snapshot)
        successful = [r for r in rows if r.get("success")]
        first = [float(r["total_ms"]) for r in successful[:10]]
        last = [float(r["total_ms"]) for r in successful[-10:]]
        snapshots = [r.get(side) for r in rows for side in ("host_before", "host_after") if isinstance(r.get(side), dict)]
        pressure = [s.get("memory_pressure", {}).get("free_percent") for s in snapshots]
        pressure = [p for p in pressure if isinstance(p, int)]
        footprints = [s.get("process", {}).get("physical_footprint_bytes") for s in snapshots]
        footprints = [p for p in footprints if isinstance(p, int)]
        rss = [s.get("process", {}).get("rss_bytes") for s in snapshots]
        rss = [p for p in rss if isinstance(p, int)]
        start_swap = start_snapshot.get("swap", {}).get("used_bytes")
        end_swap = end_snapshot.get("swap", {}).get("used_bytes")
        summaries[str(length)] = {
            "attempts": len(rows), "success": len(successful), "failure": len(rows) - len(successful),
            "total_ms": boundary.summarize(float(r["total_ms"]) for r in successful),
            "first_10_total_p50_ms": boundary.quantile(first, 0.50),
            "last_10_total_p50_ms": boundary.quantile(last, 0.50),
            "max_physical_footprint_bytes": max(footprints) if footprints else None,
            "max_rss_bytes": max(rss) if rss else None,
            "swap_start_bytes": start_swap, "swap_end_bytes": end_swap,
            "swap_delta_bytes": end_swap - start_swap if isinstance(start_swap, int) and isinstance(end_swap, int) else None,
            "minimum_memory_free_percent": min(pressure) if pressure else None,
            "launchd_pid_start": start_snapshot.get("launchd", {}).get("pid"),
            "launchd_pid_end": end_snapshot.get("launchd", {}).get("pid"),
            "launchd_runs_start": start_snapshot.get("launchd", {}).get("runs"),
            "launchd_runs_end": end_snapshot.get("launchd", {}).get("runs"),
        }
    private_json(root / "soak" / "summary.json", {"status": "complete", **selection, "lengths": lengths, "buckets": summaries})
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    append_runtime_state(root, log_offset=cursor)
    finish_phase(root, phase, "complete", extra={"lengths": lengths})
    print("SOAK_LENGTHS=" + ",".join(map(str, lengths)))


def concurrent_request(*, token: str, text: str, request_id: int, length: int, burst: int) -> dict:
    body = json.dumps({"model": "qwen3-tts-1.7b", "voice": "kurisu-v1", "input": text,
                       "response_format": "mp3"}, ensure_ascii=False, separators=(",", ":")).encode()
    barrier: threading.Barrier = CONCURRENCY_BARRIER.get()
    if barrier is None:
        raise RuntimeError("concurrency_barrier_unavailable")
    try:
        barrier.wait(timeout=10)
        started = time.perf_counter()
        conn = http.client.HTTPConnection("127.0.0.1", 18792, timeout=boundary.WATCHDOG_S)
        try:
            conn.request("POST", "/v1/audio/speech", body, {
                "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "audio/mpeg",
            })
            response = conn.getresponse()
            payload = response.read()
            status = response.status
        finally:
            conn.close()
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        valid_audio = status == 200 and AUDIO_MAGIC_OK(payload)
        return {"request_id": request_id, "burst": burst, "length": length, "http_status": status,
                "total_ms": elapsed, "success": bool(valid_audio), "audio_bytes": len(payload) if valid_audio else None,
                "error_category": error_category(status, payload) if status != 200 else None}
    except (socket.timeout, TimeoutError):
        return {"request_id": request_id, "burst": burst, "length": length,
                "http_status": None, "total_ms": None, "success": False, "error_category": "watchdog_timeout"}
    except Exception as exc:
        return {"request_id": request_id, "burst": burst, "length": length,
                "http_status": None, "total_ms": None, "success": False, "error_category": type(exc).__name__}


class _BarrierHolder:
    value: threading.Barrier | None = None

CONCURRENCY_BARRIER = _BarrierHolder()


def run_contention(root: Path, fixtures: dict, control: dict, token: str, log_path: Path, state: dict) -> None:
    phase = "contention"
    if not (root / "phase-soak.complete.json").is_file():
        raise RuntimeError("sequential_soak_must_finish_before_contention")
    lengths, selection = choose_stress_lengths(root)
    state = start_phase(root, phase, state, log_path)
    cursor = int(state["last_log_offset"])
    if not lengths:
        finish_phase(root, phase, "not_run", reason=selection.get("reason"))
        private_json(root / "contention" / "summary.json", {"status": "not_run", **selection, "lengths": lengths})
        return
    rows_file = root / "contention" / "requests.jsonl"
    burst_summaries = []
    previous_burst = False
    for length in lengths:
        for burst in range(10):
            if previous_burst:
                time.sleep(2)
            before, safety = check_safe_now(control)
            if safety:
                finish_phase(root, phase, "stopped", reason=safety, extra={"length": length, "burst": burst})
                return
            cursor = assert_quiet_gap(log_path, cursor)
            start_offset = current_log_offset(log_path)
            pre_burst_events = external_log_events(log_path, cursor, start_offset)
            if pre_burst_events:
                finish_phase(root, phase, "stopped", reason="uncontrolled_tts_traffic_before_contention_burst",
                             extra={"length": length, "burst": burst})
                return
            CONCURRENCY_BARRIER.value = threading.Barrier(3)
            with ThreadPoolExecutor(max_workers=3) as pool:
                futures = [pool.submit(concurrent_request, token=token, text=fixtures[length]["A"]["text"],
                                      request_id=i, length=length, burst=burst) for i in range(3)]
                responses = [future.result(timeout=boundary.WATCHDOG_S + 15) for future in futures]
            CONCURRENCY_BARRIER.value = None
            end_offset = current_log_offset(log_path)
            events = external_log_events(log_path, start_offset, end_offset)
            successes = sum(1 for r in responses if r.get("http_status") == 200 and r.get("success"))
            busy = sum(1 for r in responses if r.get("http_status") == 503 and r.get("error_category") == "tts_busy")
            failed = [r for r in responses if not r.get("success") and r.get("http_status") not in (503,)]
            log_success = sum(1 for e in events if e["type"] == "success")
            log_busy = sum(1 for e in events if e["type"] == "tts_busy")
            correlation_ok = (log_success == successes and log_busy == busy and
                              sum(1 for e in events if e["type"] == "synthesis_failed") ==
                              sum(1 for r in responses if r.get("http_status") == 503 and r.get("error_category") == "synthesis_failed"))
            after = runtime_snapshot()
            health_ok = after.get("health", {}).get("status") == "ready" and after.get("health", {}).get("http_status") == 200
            for row in responses:
                row.update({"phase": phase, "fixture_id": f"A-{length}", "fixture_text_sha256":
                            boundary.sha256_bytes(fixtures[length]["A"]["text"].encode("utf-8")),
                            "service_health_after": health_ok, "host_before": before,
                            "host_after": after, "log_correlation_ok_for_burst": correlation_ok})
                append_jsonl(rows_file, row)
            cursor = end_offset
            previous_burst = True
            append_runtime_state(root, log_offset=cursor)
            burst_summary = {
                "length": length, "burst": burst, "responses": 3,
                "http_200": successes, "http_503_tts_busy": busy,
                "unexpected_failures": len(failed), "log_correlation_ok": correlation_ok,
                "health_after": health_ok,
                "success_latency_ms": boundary.summarize(r["total_ms"] for r in responses if r.get("http_status") == 200 and r.get("success")),
                "rejected_latency_ms": boundary.summarize(r["total_ms"] for r in responses if r.get("http_status") == 503),
            }
            burst_summaries.append(burst_summary)
            if not correlation_ok or not health_ok or failed or successes + busy != 3:
                finish_phase(root, phase, "stopped", reason="contention_burst_unexpected_or_log_contaminated",
                             extra={"length": length, "burst": burst})
                private_json(root / "contention" / "summary.json", {"status": "stopped", "bursts": burst_summaries})
                return
            _, safety = check_safe_now(control)
            if safety:
                finish_phase(root, phase, "stopped", reason=safety, extra={"length": length, "burst": burst})
                private_json(root / "contention" / "summary.json", {"status": "stopped", "bursts": burst_summaries})
                return
    private_json(root / "contention" / "summary.json", {"status": "complete", **selection, "lengths": lengths,
                 "bursts_per_length": 10, "requests_per_burst": 3, "bursts": burst_summaries})
    if not check_host_route(host_machine_from_control(control)):
        finish_phase(root, phase, "stopped", reason="9router_host_tts_route_unhealthy")
        return
    finish_phase(root, phase, "complete", extra={"lengths": lengths})
    print("CONTENTION_BURSTS=" + str(len(burst_summaries)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("measure",))
    parser.add_argument("--phase", required=True,
                        choices=("warmup", "anchor-pre", "probes", "matrix", "soak", "contention", "recovery"))
    parser.add_argument("--apply", action="store_true", help="submit real requests to the unchanged production endpoint")
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--log-file", type=Path, required=True)
    args = parser.parse_args()
    root, fixtures, manifest, schedule, control = validate_run(args.run_root)
    print(f"PHASE={args.phase} ROOT=protected CONTROL={boundary.CONTROL_ID}")
    if not args.apply:
        print("MEASUREMENT=plan_only; --apply required to send production TTS requests")
        return
    token = load_token(args.token_file)
    log_path = args.log_file
    if log_path.is_symlink() or not log_path.is_file():
        raise ValueError("production_service_log_required")
    state = load_runtime_state(root, control)
    if args.phase == "warmup":
        run_warmup(root, fixtures, control, token, log_path, state)
    elif args.phase == "anchor-pre":
        if not (root / "phase-warmup.complete.json").is_file():
            raise RuntimeError("three_excluded_warmups_must_precede_anchor")
        run_anchor(root, fixtures, control, token, log_path, state)
    elif args.phase == "probes":
        if not (root / "phase-anchor-pre.complete.json").is_file():
            raise RuntimeError("pre_anchor_must_precede_length_probes")
        run_probes(root, fixtures, control, token, log_path, state)
    elif args.phase == "matrix":
        if not (root / "phase-probes.complete.json").is_file():
            raise RuntimeError("length_probes_must_precede_matrix")
        run_matrix(root, fixtures, control, schedule, token, log_path, state)
    elif args.phase == "soak":
        run_soak(root, fixtures, control, token, log_path, state)
    elif args.phase == "contention":
        run_contention(root, fixtures, control, token, log_path, state)
    elif args.phase == "recovery":
        if not (root / "phase-contention.complete.json").is_file():
            raise RuntimeError("contention_must_finish_before_recovery_anchor")
        run_anchor(root, fixtures, control, token, log_path, state, recovery=True)
    state_path = root / "runtime-state.json"
    if state_path.exists():
        state_path.chmod(0o600)


if __name__ == "__main__":
    main()
