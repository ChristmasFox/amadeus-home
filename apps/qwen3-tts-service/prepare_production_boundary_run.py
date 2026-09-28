#!/usr/bin/env python3
"""Freeze the v2 25–600 fixture/schedule contract in a private external run root."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_boundary as boundary
from production_boundary_runtime import (
    FOOTPRINT_DISTRESS_BYTES,
    FOOTPRINT_HARD_STOP_BYTES,
    MEMORY_DISTRESS_PERCENT,
    MEMORY_HARD_STOP_PERCENT,
    MIN_STARTUP_DISK_FREE_BYTES,
    SWAP_CONFIRMATION_WINDOW_S,
    SWAP_CORROBORATED_STOP_BYTES,
    SWAP_FREE_WARNING_BYTES,
    SWAP_MAX_CONFIRMATION_WINDOWS,
    SWAP_PERSISTENT_WARNING_BYTES,
)

PREVIOUS_BRANCH = "codex/tts-boundary-stress-2026-09"
PREVIOUS_COMMIT = "a6a704d5e633bd38fff8526161eb3f4c09628640"
PREVIOUS_REPORT_SHA256 = "1209e8dc3870ef7f2d933d3b397ade147da288215a98309970247142c8527b80"
PREVIOUS_DATA_SHA256 = "5a7a89cf7fceabc1288fdb85ca1c56bbe1ab2e6f0e496b07d04d978ca2da0292"

def read_private(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_evidence_file_required:" + path.name)
    return json.loads(path.read_text())

def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="create the external private run root")
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--lengths", help="comma-separated safe V2 prefix; default is 25–600")
    parser.add_argument("--prior-v2-hardstop-root", type=Path,
                        help="protected earlier V2 root proving why the safe prefix excludes 250+")
    parser.add_argument("--prior-v2-attempt-root", type=Path,
                        help="optional protected, non-pooled V2 safe-prefix attempt to preserve in the new manifest")
    parser.add_argument("--scope-rationale", help="required explanation when executing a safe prefix")
    args = parser.parse_args()
    requested_lengths = (tuple(int(value) for value in args.lengths.split(","))
                         if args.lengths else boundary.DEFAULT_V2_LENGTHS)
    executed_lengths = boundary.set_execution_lengths(requested_lengths)
    if executed_lengths != boundary.DEFAULT_V2_LENGTHS:
        if not args.prior_v2_hardstop_root or not args.scope_rationale:
            raise ValueError("safe_subset_requires_prior_hardstop_evidence_and_scope_rationale")
    elif args.prior_v2_hardstop_root:
        raise ValueError("prior_hardstop_root_requires_strictly_lower_safe_subset")

    prior_ref = subprocess.run(["git", "rev-parse", PREVIOUS_BRANCH], capture_output=True,
                               text=True, check=False, timeout=10)
    if prior_ref.returncode != 0 or prior_ref.stdout.strip() != PREVIOUS_COMMIT:
        raise RuntimeError("previous_safety_evidence_branch_or_commit_changed")
    prior_report_data = None
    for path, expected_sha in (
        ("docs/reports/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.md", PREVIOUS_REPORT_SHA256),
        ("docs/reports/data/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.json", PREVIOUS_DATA_SHA256),
    ):
        evidence = subprocess.run(["git", "show", f"{PREVIOUS_BRANCH}:{path}"],
                                  capture_output=True, check=False, timeout=10)
        if evidence.returncode != 0 or boundary.sha256_bytes(evidence.stdout) != expected_sha:
            raise RuntimeError("previous_safety_evidence_report_changed:" + path)
        if path.endswith(".json"):
            prior_report_data = json.loads(evidence.stdout)
    if not isinstance(prior_report_data, dict):
        raise RuntimeError("previous_safety_evidence_data_unavailable")
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    schedule = boundary.matrix_schedule(lengths=boundary.DEFAULT_V2_LENGTHS)
    schedule_sha = boundary.schedule_sha256(schedule)
    prior_v2_hardstop = None
    if args.prior_v2_hardstop_root:
        prior_root = args.prior_v2_hardstop_root.resolve()
        if (not str(prior_root).startswith("/Volumes/Avalon/") or not prior_root.is_dir() or
                prior_root.is_symlink() or prior_root.stat().st_mode & 0o077):
            raise ValueError("protected_prior_v2_hardstop_root_required")
        prior_run = read_private(prior_root / "run-manifest.json")
        prior_control = read_private(prior_root / "control-manifest.json")
        prior_phase = read_private(prior_root / "phase-matrix.complete.json")
        prior_stop = read_private(prior_root / "post-safety-stop-observation.json")
        prior_schedule = read_private(prior_root / "schedule.json")
        prior_fixture_sha = prior_run.get("fixture_manifest_sha256")
        prior_schedule_sha = boundary.schedule_sha256(prior_schedule)
        stopped_sample = prior_stop.get("timed_out_sample") or {}
        stop_length = stopped_sample.get("length")
        if (prior_run.get("goal_id") != "amadeus-tts-boundary-rebaseline-v2" or
                prior_control.get("control_id") != boundary.CONTROL_ID or
                prior_fixture_sha != fixture_sha or prior_schedule_sha != schedule_sha or
                prior_run.get("schedule_sha256") != schedule_sha or
                prior_phase.get("status") != "stopped" or
                prior_phase.get("reason") != "inflight_request_exceeded_110s_watchdog" or
                stopped_sample.get("error_category") != "watchdog_timeout" or
                not isinstance(stop_length, int)):
            raise ValueError("prior_v2_watchdog_hardstop_evidence_mismatch")
        prefix_before_stop = tuple(n for n in boundary.DEFAULT_V2_LENGTHS if n < stop_length)
        if executed_lengths != prefix_before_stop:
            raise ValueError("safe_subset_must_be_exact_prefix_below_prior_v2_hardstop")
        if prior_stop.get("additional_synthesis_requests_submitted_by_harness_after_stop") != 0:
            raise ValueError("prior_v2_hardstop_has_post_stop_synthesis")
        prior_v2_hardstop = {
            "run_root_basename": prior_root.name,
            "run_manifest_sha256": boundary.sha256_bytes((prior_root / "run-manifest.json").read_bytes()),
            "matrix_summary_sha256": boundary.sha256_bytes((prior_root / "matrix-summary.json").read_bytes()),
            "post_stop_observation_sha256": boundary.sha256_bytes((prior_root / "post-safety-stop-observation.json").read_bytes()),
            "stop_length_codepoints": stop_length,
            "stop_fixture_id": stopped_sample.get("fixture_id"),
            "stop_reason": prior_phase.get("reason"),
            "scope_rationale": args.scope_rationale,
            "higher_lengths_not_retested": [n for n in boundary.DEFAULT_V2_LENGTHS if n >= stop_length],
            "prior_rows_pooled": False,
        }
    prior_v2_attempt = None
    if args.prior_v2_attempt_root:
        attempt_root = args.prior_v2_attempt_root.resolve()
        if (not str(attempt_root).startswith("/Volumes/Avalon/") or not attempt_root.is_dir() or
                attempt_root.is_symlink() or attempt_root.stat().st_mode & 0o077):
            raise ValueError("protected_prior_v2_attempt_root_required")
        attempt_run = read_private(attempt_root / "run-manifest.json")
        attempt_control = read_private(attempt_root / "control-manifest.json")
        attempt_phase = read_private(attempt_root / "phase-matrix.complete.json")
        attempt_stop = read_private(attempt_root / "post-safety-stop-observation.json")
        attempt_rows = attempt_root / "matrix.jsonl"
        if (attempt_run.get("goal_id") != "amadeus-tts-boundary-rebaseline-v2" or
                attempt_run.get("fixture_manifest_sha256") != fixture_sha or
                attempt_run.get("schedule_sha256") != schedule_sha or
                attempt_control.get("control_id") != boundary.CONTROL_ID or
                attempt_phase.get("status") != "stopped" or
                attempt_phase.get("reason") != "owner_requested_stop_after_99_persisted_client_rows" or
                attempt_stop.get("owner_requested_stop") is not True or
                attempt_stop.get("additional_synthesis_requests_submitted_after_stop") != 0 or
                not attempt_rows.is_file() or attempt_rows.is_symlink() or attempt_rows.stat().st_mode & 0o077):
            raise ValueError("prior_v2_safe_prefix_attempt_evidence_mismatch")
        attempt_rows_data = attempt_rows.read_bytes()
        attempt_v2_scope = tuple(attempt_run.get("executed_lengths", ()))
        if attempt_v2_scope != tuple(executed_lengths):
            raise ValueError("prior_v2_safe_prefix_scope_mismatch")
        prior_v2_attempt = {
            "run_root_basename": attempt_root.name,
            "run_manifest_sha256": boundary.sha256_bytes((attempt_root / "run-manifest.json").read_bytes()),
            "control_manifest_sha256": boundary.sha256_bytes((attempt_root / "control-manifest.json").read_bytes()),
            "matrix_rows_sha256": boundary.sha256_bytes(attempt_rows_data),
            "matrix_rows_persisted": sum(1 for line in attempt_rows_data.splitlines() if line.strip()),
            "phase_reason": attempt_phase.get("reason"),
            "unpersisted_client_timing_row": attempt_stop.get("unpersisted_client_timing_row"),
            "prior_rows_pooled_into_this_run": False,
        }
    root = args.output_root.expanduser().absolute()
    print(f"CONTROL_ID={boundary.CONTROL_ID}")
    print(f"V2_ALLOWED_LENGTHS={','.join(map(str, boundary.DEFAULT_V2_LENGTHS))}")
    print(f"EXECUTED_LENGTHS={','.join(map(str, executed_lengths))}")
    print(f"FROZEN_FIXTURE_LENGTHS={len(fixtures)} FIXTURE_MANIFEST_SHA256={fixture_sha}")
    print(f"SCHEDULE_SEED={boundary.SCHEDULE_SEED} SCHEDULE_ROWS={len(schedule)} SCHEDULE_SHA256={schedule_sha}")
    print("PRODUCTION_CONFIGURATION=read_only VERSION_BUMP=forbidden DEPLOYMENT=forbidden")
    if not args.apply:
        print("RUN_ROOT=plan_only; --apply required")
        return

    resolved = root.resolve()
    if resolved == ROOT or ROOT in resolved.parents:
        raise ValueError("run_root_must_be_outside_git_repository")
    if not root.is_absolute() or root.is_symlink() or root.exists():
        raise FileExistsError("new_external_run_root_required")
    parent = root.parent.resolve()
    if not parent.is_dir() or parent.is_symlink() or not str(parent).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_volume_parent_required")
    if not os.access(parent, os.W_OK | os.X_OK):
        raise PermissionError("protected_external_volume_not_writable")

    root.mkdir(mode=0o700)
    root.chmod(0o700)
    for subdir in ("audio", "probes", "listening", "anchors", "soak", "contention", "recovery"):
        child = root / subdir
        child.mkdir(mode=0o700)
        child.chmod(0o700)
    previous_primary_stop = prior_report_data.get("matrix_safety_stop_observation") or {}
    previous_long_probe = prior_report_data.get("safety_stop_observation") or {}
    previous_pre_anchor = ((prior_report_data.get("pre_post_stress_control") or {}).get("pre") or {})
    previous_attempts = []
    for attempt in prior_report_data.get("prior_preflight_attempt_chain") or []:
        previous_attempts.append({key: attempt.get(key) for key in (
            "run_root_basename", "stopped_phase", "stop_reason", "successful_excluded_warmups",
            "matrix_or_anchor_samples_collected", "first_warmup_swap_delta_bytes", "idle_observation_after_stop")})
    first_rebaseline = prior_report_data.get("predecessor_preflight_attempt")
    if isinstance(first_rebaseline, dict):
        previous_attempts.append({key: first_rebaseline.get(key) for key in (
            "run_root_basename", "stopped_phase", "stop_reason", "successful_excluded_warmups",
            "matrix_or_anchor_samples_collected", "first_warmup_swap_delta_bytes", "idle_observation_after_stop")})
    previous_attempts.append({
        "run_root_basename": "boundary-stress-2026-09-rebaseline-2",
        "stopped_phase": "matrix",
        "stop_reason": previous_primary_stop.get("reason"),
        "successful_excluded_warmups": 3,
        "anchor_pre_successful_samples": previous_pre_anchor.get("success"),
        "matrix_attempts": previous_primary_stop.get("persisted_matrix_rows"),
        "matrix_successes": previous_primary_stop.get("persisted_matrix_rows"),
        "observed_free_percent": previous_primary_stop.get("observed_free_percent_at_operator_stop"),
    })
    for attempt in prior_report_data.get("additional_preserved_attempts") or []:
        previous_attempts.append({key: attempt.get(key) for key in (
            "run_root_basename", "stopped_phase", "stop_reason", "warmup", "anchor_pre_attempts",
            "anchor_pre_successful_samples", "resource_observations", "stop_marker_discrepancy")})
    prior_safety_evidence = {
        "source_branch": PREVIOUS_BRANCH,
        "source_commit": PREVIOUS_COMMIT,
        "report_path": "docs/reports/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.md",
        "report_sha256": PREVIOUS_REPORT_SHA256,
        "data_path": "docs/reports/data/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.json",
        "data_sha256": PREVIOUS_DATA_SHA256,
        "attempts": previous_attempts,
        "primary_matrix_stop": {
            "run_root_basename": "boundary-stress-2026-09-rebaseline-2",
            "reason": previous_primary_stop.get("reason"),
            "persisted_matrix_rows": previous_primary_stop.get("persisted_matrix_rows"),
            "observed_free_percent": previous_primary_stop.get("observed_free_percent_at_operator_stop"),
            "observed_swap_free_mib": previous_primary_stop.get("observed_swap_free_mib_at_operator_stop"),
            "post_stop_service": previous_primary_stop.get("post_stop_service"),
        },
        "historical_50_character_pre_anchor": {
            "attempts": previous_pre_anchor.get("attempts"),
            "success": previous_pre_anchor.get("success"),
            "endpoint_total_ms": previous_pre_anchor.get("total_ms"),
        },
        "historical_800_probe": {
            "status": "historical-safety-incomplete",
            "length_codepoints": previous_long_probe.get("stopped_at_codepoints", 800),
            "endpoint_total_ms": previous_long_probe.get("probe_total_ms"),
            "watchdog_s": previous_long_probe.get("client_watchdog_s", 110),
            "error_category": previous_long_probe.get("probe_error"),
        },
        "1000": "not-retested-after-800-watchdog",
        "1200": "not-retested-after-800-watchdog",
        "pooled_into_v2_statistics": False,
    }
    manifest = {
        "goal_id": "amadeus-tts-boundary-rebaseline-v2",
        "prior_safety_evidence": prior_safety_evidence,
        "prior_v2_hardstop_evidence": prior_v2_hardstop,
        "prior_v2_safe_prefix_attempt": prior_v2_attempt,
        "control_id": boundary.CONTROL_ID,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "measurement_branch": "codex/tts-boundary-rebaseline-v2-2026-09",
        "previous_measurement_branch": PREVIOUS_BRANCH,
        "previous_measurement_commit": PREVIOUS_COMMIT,
        "previous_report_sha256": PREVIOUS_REPORT_SHA256,
        "previous_data_sha256": PREVIOUS_DATA_SHA256,
        "fixture_manifest_path_in_git": "apps/qwen3-tts-service/production_boundary_fixtures.json",
        "fixture_manifest_sha256": fixture_sha,
        "fixture_lengths_in_manifest": list(boundary.HISTORICAL_LENGTHS),
        "executed_lengths": list(executed_lengths),
        "execution_scope_rationale": args.scope_rationale,
        "prior_v2_hardstop_evidence": prior_v2_hardstop,
        "excluded_lengths": {
            **({str(n): ("prior_v2_watchdog_safety_incomplete" if n == (prior_v2_hardstop or {}).get("stop_length_codepoints")
                         else "not_retested_after_prior_v2_watchdog")
                for n in (prior_v2_hardstop or {}).get("higher_lengths_not_retested", [])}),
            "800": "historical_safety_incomplete_watchdog_over_110s",
            "1000": "not_retested_after_800-watchdog",
            "1200": "not_retested_after_800-watchdog",
        },
        "schedule_seed": boundary.SCHEDULE_SEED,
        "schedule_sha256": schedule_sha,
        "schedule_rows": len(schedule),
        "schedule_filter": "preserve_relative_order_of_original_seeded_schedule_for_25_to_600",
        "executed_schedule_filter": "run-manifest executed_lengths applied to the unchanged full V2 schedule",
        "samples_per_fixture": 10,
        "samples_per_length": 20,
        "quiet_interval_s": boundary.QUIET_INTERVAL_S,
        "watchdog_s": boundary.WATCHDOG_S,
        "quantile_method": boundary.QUANTILE_METHOD,
        "production_configuration_changed": False,
        "safety_policy": {
            "swap_is_standalone_hard_stop": False,
            "swap_free_warning_bytes": SWAP_FREE_WARNING_BYTES,
            "swap_growth_warning_bytes": SWAP_PERSISTENT_WARNING_BYTES,
            "swap_passive_confirmation_interval_s": SWAP_CONFIRMATION_WINDOW_S,
            "swap_passive_confirmation_max_windows": SWAP_MAX_CONFIRMATION_WINDOWS,
            "swap_corroborated_stop_growth_bytes": SWAP_CORROBORATED_STOP_BYTES,
            "swap_corroborating_memory_free_at_or_below_percent": MEMORY_DISTRESS_PERCENT,
            "swap_corroborating_footprint_bytes_at_or_above": FOOTPRINT_DISTRESS_BYTES,
            "memory_free_at_or_below_percent_hard_stop": MEMORY_HARD_STOP_PERCENT,
            "physical_footprint_bytes_at_or_above_hard_stop": FOOTPRINT_HARD_STOP_BYTES,
            "startup_disk_free_bytes_hard_stop": MIN_STARTUP_DISK_FREE_BYTES,
            "restart_pid_health_route_failure_hard_stop": True,
            "request_watchdog_s": boundary.WATCHDOG_S,
        },
    }
    write_private(root / "run-manifest.json", boundary.canonical_json_bytes(manifest))
    write_private(root / "schedule.json", boundary.canonical_json_bytes(schedule))
    write_private(root / "fixture-manifest.sha256", (fixture_sha + "  production_boundary_fixtures.json\n").encode())
    write_private(root / "schedule.sha256", (schedule_sha + "  schedule.json\n").encode())
    print("RUN_ROOT_CREATED=private_0700")
    print("SCHEDULE_FROZEN=private_0600 before any synthesis request")
    print("RUN_ROOT=" + str(root))

if __name__ == "__main__":
    main()
