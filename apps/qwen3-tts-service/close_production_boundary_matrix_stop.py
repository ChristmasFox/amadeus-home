#!/usr/bin/env python3
"""Close a matrix phase already stopped for pressure, validating late evidence without more TTS."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
import production_boundary as boundary
from production_boundary_benchmark import read_jsonl
from production_boundary_runtime import appended_log_events, healthz, launchd_state


def read_private(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_stop_evidence_required:" + path.name)
    return json.loads(path.read_text())


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def replace_private(path: Path, data: bytes) -> None:
    temporary = path.with_name(path.name + ".stop-update.tmp")
    write_private(temporary, data)
    os.replace(temporary, path)
    path.chmod(0o600)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write private stop summary/index; sends no TTS")
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--log-file", type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        print("STOP_RECORD_CLOSE=plan_only; --apply required")
        return
    root = args.run_root.resolve()
    if root == ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")

    stop = read_private(root / "post-matrix-safety-stop.json")
    run = read_private(root / "run-manifest.json")
    control = read_private(root / "control-manifest.json")
    probes = read_private(root / "probe-summary.json")
    schedule = json.loads((root / "schedule.json").read_text())
    if boundary.schedule_sha256(schedule) != run.get("schedule_sha256"):
        raise ValueError("schedule_hash_mismatch")
    rows = read_jsonl(root / "matrix.jsonl")
    if len(rows) != 1 or rows[0].get("length") != 200 or rows[0].get("family") != "A" or rows[0].get("success") is not True:
        raise ValueError("unexpected_persisted_matrix_rows")
    partial = stop.get("partial_response") or {}
    if partial.get("fixture_id") != "B-200" or partial.get("client_total_ms") is not None:
        raise ValueError("unexpected_partial_response_contract")
    audio_path = root / str(partial.get("mp3_relative_path", ""))
    if audio_path.is_symlink() or not audio_path.is_file() or audio_path.stat().st_mode & 0o077:
        raise ValueError("partial_response_audio_missing_or_unprotected")
    audio = audio_path.read_bytes()
    if boundary.sha256_bytes(audio) != partial.get("mp3_sha256"):
        raise ValueError("partial_response_audio_hash_mismatch")

    state_path = root / "runtime-state.json"
    state = read_private(state_path)
    log = args.log_file
    if log.is_symlink() or not log.is_file():
        raise ValueError("sanitized_service_log_required")
    end_offset = log.stat().st_size
    acknowledgement = state.get("acknowledged_matrix_partial_response")
    metrics = partial.get("model_metrics_from_service_log") or {}
    if acknowledgement:
        if acknowledgement.get("fixture_id") != "B-200" or acknowledgement.get("service_log_metrics") != metrics:
            raise ValueError("existing_matrix_log_acknowledgement_mismatch")
    else:
        events, markers, parsed_end = appended_log_events(log, int(state.get("last_log_offset", -1)))
        if (markers or parsed_end != end_offset or len(events) != 1 or events[0].get("type") != "success" or
                events[0].get("metrics") != metrics):
            raise ValueError("partial_response_service_log_event_not_uniquely_reconciled")

    health = healthz()
    job = launchd_state()
    control_runtime = control.get("runtime", {})
    control_job = control_runtime.get("launchd", {})
    if (health.get("status") != "ready" or health.get("http_status") != 200 or
            job.get("pid") != control_job.get("pid") or job.get("runs") != control_job.get("runs")):
        raise RuntimeError("production_service_not_recovered_without_restart")
    process = subprocess.run(["ps", "-Ao", "args"], capture_output=True, text=True, check=False).stdout
    if "production_boundary_benchmark.py measure" in process:
        raise RuntimeError("benchmark_process_still_active")

    passed = set(probes.get("passed_lengths", []))
    probe_buckets = probes.get("buckets", {})
    buckets = {}
    for length in boundary.LENGTHS:
        if length == 200:
            buckets[str(length)] = {
                "status": "safety-incomplete", "attempts": 1, "success": 1, "failure": 0,
                "partial_unrecorded_response_count": 1,
                "reason": "matrix stopped during post-request memory-pressure confirmation after one persisted and one partial 200-codepoint response",
            }
        elif length == 800:
            buckets[str(length)] = {
                "status": "safety-incomplete", "attempts": 0, "success": 0, "failure": 0,
                "reason": probe_buckets.get("800", {}).get("reason", "110-second experimental watchdog"),
            }
        elif length > 800:
            buckets[str(length)] = {
                "status": "not_probed_after_stop", "attempts": 0, "success": 0, "failure": 0,
                "reason": "progressive safety probes stopped at 800 codepoints",
            }
        elif length in passed:
            buckets[str(length)] = {
                "status": "matrix-not-run-after-safety-stop", "attempts": 0, "success": 0, "failure": 0,
                "reason": "Phase C stopped at the 200-codepoint matrix batch",
            }
        else:
            buckets[str(length)] = {
                "status": "not_probed", "attempts": 0, "success": 0, "failure": 0,
                "reason": "not reached in progressive safety probes",
            }
    summary = {
        "status": "stopped", "safe_lengths": sorted(passed), "buckets": buckets,
        "schedule_sha256": run.get("schedule_sha256"), "stop_reason": stop.get("reason"),
        "persisted_matrix_rows": 1, "partial_unrecorded_responses": 1, "percentiles_generated": False,
    }
    summary_path = root / "matrix-summary.json"
    if summary_path.exists():
        old_summary = read_private(summary_path)
        if old_summary.get("status") != "stopped" or old_summary.get("schedule_sha256") != summary["schedule_sha256"]:
            raise ValueError("existing_matrix_summary_mismatch")
    else:
        write_private(summary_path, boundary.canonical_json_bytes(summary))

    phase_path = root / "phase-matrix.complete.json"
    if phase_path.exists():
        old_phase = read_private(phase_path)
        if old_phase.get("status") != "stopped":
            raise ValueError("existing_matrix_phase_marker_mismatch")
    else:
        write_private(phase_path, boundary.canonical_json_bytes({
            "phase": "matrix", "status": "stopped", "completed_utc": stop.get("stop_recorded_utc"),
            "reason": stop.get("reason"), "persisted_rows": 1, "partial_responses": 1,
            "scheduled_length_at_stop": 200, "memory_free_percent_at_stop": stop.get("observed_free_percent"),
            "swap_free_mib_at_stop": stop.get("observed_swap_free_mib"), "uncontrolled_service_restart": False,
        }))

    listening = {
        "control_id": boundary.CONTROL_ID,
        "fixture_manifest_sha256": run["fixture_manifest_sha256"],
        "schedule_sha256": run["schedule_sha256"],
        "selection_rule": "fixture A only; type-7 p50 total_ms; nearest absolute distance; lower fixture_run_index breaks ties",
        "artifacts": [],
        "incomplete_buckets": [
            {"length": n, "status": value["status"], "success": value["success"],
             "attempts": value["attempts"], "reason": value.get("reason"), "representative": False}
            for n, value in sorted(((int(k), v) for k, v in buckets.items()))
        ],
    }
    index_path = root / "listening-index.json"
    if index_path.exists():
        old_index = read_private(index_path)
        if set(x.get("length") for x in old_index.get("artifacts", [])):
            raise ValueError("unexpected_representative_audio_before_matrix_completion")
        backup = root / "listening-index.before-matrix-stop.json"
        if not backup.exists():
            write_private(backup, index_path.read_bytes())
        if old_index != listening:
            replace_private(index_path, boundary.canonical_json_bytes(listening))
    else:
        write_private(index_path, boundary.canonical_json_bytes(listening))

    if not acknowledgement:
        state["last_log_offset"] = end_offset
        state["acknowledged_matrix_partial_response"] = {
            "fixture_id": "B-200", "service_log_event": "success", "service_log_metrics": metrics,
            "client_total_ms": None, "representative": False,
        }
        replace_private(state_path, boundary.canonical_json_bytes(state))
    closure_path = root / "matrix-stop-closure.json"
    closure = {
        "completed_utc": datetime.now(timezone.utc).isoformat(),
        "matrix_phase_status": "stopped", "persisted_rows": 1, "partial_responses": 1,
        "listening_index_artifacts": 0, "prior_empty_index_preserved": "listening-index.before-matrix-stop.json",
        "late_service_event_acknowledged": "one success event correlated to partial B-200 response; no client total_ms, excluded from statistics",
        "service_health": health.get("status"), "launchd_pid": job.get("pid"),
        "additional_tts_requests": 0,
    }
    if not closure_path.exists():
        write_private(closure_path, boundary.canonical_json_bytes(closure))
    print("MATRIX_PHASE_CLOSED=stopped; percentiles=none for incomplete buckets")
    print("PERSISTED_ROWS=1; partial B-200 MP3 preserved outside Git; representatives=0")
    print("SERVICE=ready; PID and launchd run count unchanged; additional TTS requests=0")


if __name__ == "__main__":
    main()
