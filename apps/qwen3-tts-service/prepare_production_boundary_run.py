#!/usr/bin/env python3
"""Freeze the fixture/schedule contract and create a private external evidence root."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
import subprocess
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_boundary as boundary
from production_boundary_runtime import (
    runtime_snapshot,
    SWAP_CLEAR_DECLINE_BYTES,
    SWAP_CONFIRMATION_WINDOW_S,
    SWAP_MAX_CONFIRMATION_WINDOWS,
    SWAP_PERSISTENT_WARNING_BYTES,
)


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
    parser.add_argument("--predecessor-root", type=Path,
                        help="preserve and link a separately terminated preflight-only attempt")
    parser.add_argument("--recovery-checkpoint", type=Path,
                        help="protected checkpoint for an explicitly authorized same-value service recovery")
    args = parser.parse_args()
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    schedule = boundary.matrix_schedule()
    schedule_sha = boundary.schedule_sha256(schedule)
    predecessor = None
    same_value_recovery = None
    if args.predecessor_root:
        prior_root = args.predecessor_root.resolve()
        if (not str(prior_root).startswith("/Volumes/Avalon/") or not prior_root.is_dir() or
                prior_root.is_symlink() or prior_root.stat().st_mode & 0o077):
            raise ValueError("protected_predecessor_run_required")
        prior_run = json.loads((prior_root / "run-manifest.json").read_text())
        prior_control = json.loads((prior_root / "control-manifest.json").read_text())
        prior_phase = json.loads((prior_root / "phase-warmup.complete.json").read_text())
        prior_rows_path = prior_root / "warmup.jsonl"
        prior_rows = [json.loads(line) for line in prior_rows_path.read_text().splitlines() if line]
        if prior_run.get("fixture_manifest_sha256") != fixture_sha or prior_control.get("fixture_manifest_sha256") != fixture_sha:
            raise ValueError("predecessor_fixture_manifest_differs")
        if prior_run.get("schedule_sha256") != schedule_sha or prior_control.get("schedule_sha256") != schedule_sha:
            raise ValueError("predecessor_schedule_differs")
        allowed_stop_reasons = {
            "swap_growth_reached_512_mib_safety_guard",
            "swap_growth_persisted_512_mib_after_30s_idle_confirmation",
            "swap_growth_over_512_mib_persisted_without_clear_decline_after_120s_idle_confirmation",
            "swap_growth_over_512_mib_persisted_without_clear_decline_after_360s_idle_confirmation",
        }
        if prior_phase.get("status") != "stopped" or prior_phase.get("reason") not in allowed_stop_reasons:
            raise ValueError("predecessor_was_not_a_documented_preflight_swap_safety_stop")
        if (prior_root / "matrix.jsonl").exists() or (prior_root / "phase-anchor-pre.start.json").exists():
            raise ValueError("predecessor_contains_measured_matrix_or_anchor_data")
        prior_baseline_swap = (prior_control.get("runtime", {}).get("swap") or {}).get("used_bytes")
        prior_warmup_after = next((r.get("host_after") for r in prior_rows if r.get("host_after")), {})
        prior_warmup_swap = (prior_warmup_after.get("swap") or {}).get("used_bytes")
        idle = runtime_snapshot()
        prior_pid = prior_control.get("runtime", {}).get("launchd", {}).get("pid")
        if args.recovery_checkpoint:
            recovery_root = args.recovery_checkpoint.resolve()
            if (not str(recovery_root).startswith("/Volumes/Avalon/") or not recovery_root.is_dir() or
                    recovery_root.is_symlink() or recovery_root.stat().st_mode & 0o077):
                raise ValueError("protected_same_value_recovery_checkpoint_required")
            recovery_manifest_path = recovery_root / "checkpoint.json"
            if (recovery_manifest_path.is_symlink() or not recovery_manifest_path.is_file() or
                    recovery_manifest_path.stat().st_mode & 0o077):
                raise ValueError("protected_recovery_manifest_required")
            recovery_manifest = json.loads(recovery_manifest_path.read_text())
            recovery_after = recovery_manifest.get("after") or {}
            current_plist = Path.home() / "Library/LaunchAgents/com.amadeus.qwen3-tts.plist"
            current_plist_sha = __import__("hashlib").sha256(current_plist.read_bytes()).hexdigest()
            if (recovery_manifest.get("applied") is not True or
                    recovery_manifest.get("live_pid_before") != prior_pid or
                    recovery_after.get("pid") != idle.get("launchd", {}).get("pid") or
                    recovery_after.get("engine") != "mlx" or
                    recovery_after.get("launchd_spawn_type") != "interactive" or
                    recovery_after.get("service_source_sha256") != prior_control.get("service_source_sha256") or
                    recovery_after.get("current_plist_sha256") != current_plist_sha):
                raise RuntimeError("same_value_recovery_checkpoint_does_not_match_current_active_runtime")
            lint = subprocess.run(["plutil", "-lint", str(current_plist)], capture_output=True, text=True, check=False)
            if lint.returncode != 0:
                raise RuntimeError("repaired_launchagent_plist_is_not_valid")
            same_value_recovery = {
                "checkpoint_root_basename": recovery_root.name,
                "pre_repair_pid": prior_pid,
                "post_repair_pid": recovery_after.get("pid"),
                "engine": recovery_after.get("engine"),
                "process_type": recovery_after.get("launchd_spawn_type"),
                "current_plist_sha256": current_plist_sha,
                "service_source_sha256_unchanged": recovery_after.get("service_source_sha256"),
                "tts_parameters_changed": False,
            }
        if idle.get("health", {}).get("status") != "ready":
            raise RuntimeError("production_service_not_ready_after_preflight_stop")
        expected_pid = same_value_recovery.get("post_repair_pid") if same_value_recovery else prior_pid
        if idle.get("launchd", {}).get("pid") != expected_pid:
            raise RuntimeError("production_service_pid_does_not_match_linked_predecessor_or_repair_checkpoint")
        idle_swap = (idle.get("swap") or {}).get("used_bytes")
        stop_utc = datetime.fromisoformat(prior_phase["completed_utc"])
        observed_utc = datetime.now(timezone.utc)
        predecessor = {
            "run_root_basename": prior_root.name,
            "status": prior_phase["status"],
            "stopped_phase": "excluded 50-character A warmup phase",
            "stop_reason": prior_phase["reason"],
            "successful_excluded_warmups": sum(1 for r in prior_rows if r.get("success") is True),
            "matrix_or_anchor_samples_collected": 0,
            "fixture_manifest_sha256": fixture_sha,
            "schedule_sha256": schedule_sha,
            "prior_control_baseline_swap_used_bytes": prior_baseline_swap,
            "first_warmup_post_sample_swap_used_bytes": prior_warmup_swap,
            "first_warmup_swap_delta_bytes": prior_warmup_swap - prior_baseline_swap if isinstance(prior_warmup_swap, int) and isinstance(prior_baseline_swap, int) else None,
            "first_warmup_swap_growth_check": prior_warmup_after.get("swap_growth_check"),
            "idle_observation_after_stop": {
                "observed_utc": observed_utc.isoformat(),
                "elapsed_seconds": round((observed_utc - stop_utc).total_seconds(), 1),
                "health": idle.get("health"),
                "launchd_pid": idle.get("launchd", {}).get("pid"),
                "launchd_runs": idle.get("launchd", {}).get("runs"),
                "memory_free_percent": (idle.get("memory_pressure") or {}).get("free_percent"),
                "swap_used_bytes": idle_swap,
                "swap_delta_from_prior_control_bytes": idle_swap - prior_baseline_swap if isinstance(idle_swap, int) and isinstance(prior_baseline_swap, int) else None,
                "swap_delta_from_first_warmup_bytes": idle_swap - prior_warmup_swap if isinstance(idle_swap, int) and isinstance(prior_warmup_swap, int) else None,
                "physical_footprint_bytes": (idle.get("process") or {}).get("physical_footprint_bytes"),
                "physical_footprint_peak_bytes": (idle.get("process") or {}).get("physical_footprint_peak_bytes"),
                "production_service_restarted_for_same_value_repair": same_value_recovery is not None,
            },
            "prior_attempt_chain": [x for x in (prior_run.get("predecessor_preflight_attempt"),) if x],
            "rebaseline_reason": "All stopped attempts are preserved and excluded. This run shares the exact frozen fixture/schedule hashes, captures a fresh ambient control, and applies the same documented safety guards without changing production configuration.",
        }
    root = args.output_root.expanduser().absolute()
    print(f"CONTROL_ID={boundary.CONTROL_ID}")
    print(f"FIXTURE_BUCKETS={len(fixtures)} LENGTHS={','.join(map(str, boundary.LENGTHS))}")
    print(f"FIXTURE_MANIFEST_SHA256={fixture_sha}")
    print(f"SCHEDULE_SEED={boundary.SCHEDULE_SEED} SCHEDULE_ROWS={len(schedule)} SCHEDULE_SHA256={schedule_sha}")
    print("RAW_AUDIO=temporary_private_until_representative_selection")
    print("PRODUCTION_CONFIGURATION=read_only")
    if not args.apply:
        print("RUN_ROOT=plan_only; --apply required")
        return
    resolved = root.resolve()
    if resolved == ROOT or ROOT in resolved.parents or ROOT == resolved.parent:
        raise ValueError("run_root_must_be_outside_git_repository")
    if not root.is_absolute() or root.is_symlink() or root.exists():
        raise FileExistsError("new_external_run_root_required")
    parent = root.parent.resolve()
    if not parent.is_dir() or parent.is_symlink():
        raise ValueError("external_run_parent_must_exist")
    # This Goal explicitly keeps protected raw evidence on the attached external backup volume.
    if not str(resolved).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_volume_required")
    root.mkdir(mode=0o700)
    root.chmod(0o700)
    for subdir in ("audio", "probes", "listening", "anchors", "soak", "contention", "recovery"):
        child = root / subdir
        child.mkdir(mode=0o700)
        child.chmod(0o700)
    manifest = {
        "control_id": boundary.CONTROL_ID,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "fixture_manifest_path_in_git": "apps/qwen3-tts-service/production_boundary_fixtures.json",
        "fixture_manifest_sha256": fixture_sha,
        "schedule_seed": boundary.SCHEDULE_SEED,
        "schedule_sha256": schedule_sha,
        "schedule_rows": len(schedule),
        "samples_per_fixture": 10,
        "samples_per_length": 20,
        "quiet_interval_s": boundary.QUIET_INTERVAL_S,
        "watchdog_s": boundary.WATCHDOG_S,
        "quantile_method": boundary.QUANTILE_METHOD,
        "production_configuration_changed": False,
        "predecessor_preflight_attempt": predecessor,
        "same_value_recovery_checkpoint": same_value_recovery,
        "safety_stop_guards": {
            "memory_free_percent_below": 10,
            "physical_footprint_bytes_at_or_above": 20 * (1024 ** 3),
            "swap_growth_immediate_stop_bytes": 2 * (1024 ** 3),
            "swap_free_immediate_stop_bytes": 512 * (1024 ** 2),
            "swap_growth_persistent_warning_bytes": SWAP_PERSISTENT_WARNING_BYTES,
            "swap_growth_clear_decline_bytes": SWAP_CLEAR_DECLINE_BYTES,
            "swap_growth_confirmation_window_s": SWAP_CONFIRMATION_WINDOW_S,
            "swap_growth_max_confirmation_windows": SWAP_MAX_CONFIRMATION_WINDOWS,
        },
    }
    write_private(root / "run-manifest.json", boundary.canonical_json_bytes(manifest))
    write_private(root / "schedule.json", boundary.canonical_json_bytes(schedule))
    write_private(root / "fixture-manifest.sha256", (fixture_sha + "  production_boundary_fixtures.json\n").encode())
    write_private(root / "schedule.sha256", (schedule_sha + "  schedule.json\n").encode())
    if predecessor is not None:
        write_private(root / "predecessor-attempt.json", boundary.canonical_json_bytes(predecessor))
    print("RUN_ROOT_CREATED=private_0700")
    print("SCHEDULE_FROZEN=private_0600 before any synthesis request")
    print("RUN_ROOT=" + str(root))


if __name__ == "__main__":
    main()
