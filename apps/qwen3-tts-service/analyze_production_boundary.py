#!/usr/bin/env python3
"""Reproducibly aggregate protected TTS boundary evidence into the public report and JSON."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
APP = Path(__file__).resolve().parent
sys.path.insert(0, str(APP))
import production_boundary as boundary

REPORT_MD = ROOT / "docs/reports/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.md"
REPORT_JSON = ROOT / "docs/reports/data/AMADEUS_TTS_BOUNDARY_REBASELINE_V2_2026_09.json"


def read_private(path: Path, *, optional: bool = False):
    if not path.exists() and optional:
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_evidence_file_required:" + path.name)
    return json.loads(path.read_text())


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_jsonl_required:" + path.name)
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def fmt_num(value, digits=1):
    return "—" if value is None else f"{float(value):.{digits}f}"


def fmt_bytes(value):
    return "—" if value is None else f"{float(value) / (1024 ** 3):.2f} GiB"


def fmt_triplet(summary: dict | None, suffix: str = "") -> str:
    if not summary or summary.get("n", 0) == 0:
        return "not reported"
    return f"{fmt_num(summary.get('p50'))}{suffix} / {fmt_num(summary.get('p95'))}{suffix} / {fmt_num(summary.get('max'))}{suffix}"


def sample_summary(rows: list[dict]) -> dict:
    return boundary.aggregate_success_rows(rows)


def anchor_summary(root: Path, which: str) -> dict:
    directory = root / ("recovery" if which == "post" else "anchors")
    observations = read_jsonl(directory / "samples.jsonl")
    rows = [r for r in observations if r.get("request_submitted") is not False]
    success_rows = [r for r in rows if r.get("success") is True]
    before = read_private(directory / "host-before.json", optional=True)
    after = read_private(directory / "host-after.json", optional=True)
    result = {
        "attempts": len(rows),
        "observations": len(observations),
        "success": len(success_rows),
        "failure": len(rows) - len(success_rows),
        "total_ms": boundary.summarize(float(r["total_ms"]) for r in success_rows),
        "host_before": before,
        "host_after": after,
    }
    return result


def snapshot_public(snapshot: dict | None) -> dict | None:
    if not snapshot:
        return None
    launchd = snapshot.get("launchd", {})
    process = snapshot.get("process", {})
    swap = snapshot.get("swap", {})
    pressure = snapshot.get("memory_pressure", {})
    disk = snapshot.get("startup_disk", {}) or {}
    raw_check = snapshot.get("swap_growth_check")
    public_check = None
    if isinstance(raw_check, dict):
        public_check = {key: value for key, value in raw_check.items() if key != "confirmation_snapshots"}
        public_check["confirmation_snapshots"] = [snapshot_public(item)
                                                  for item in raw_check.get("confirmation_snapshots", [])
                                                  if isinstance(item, dict)]
    return {
        "swap_growth_check": public_check,
        "health": (snapshot.get("health", {}) or {}).get("status"),
        "host_route_ready": snapshot.get("host_route_ready"),
        "launchd_state": launchd.get("state"),
        "pid": launchd.get("pid"),
        "launchd_runs": launchd.get("runs"),
        "process_start": process.get("process_start"),
        "process_elapsed": process.get("elapsed"),
        "rss_bytes": process.get("rss_bytes"),
        "physical_footprint_bytes": process.get("physical_footprint_bytes"),
        "physical_footprint_peak_bytes": process.get("physical_footprint_peak_bytes"),
        "swap_used_bytes": swap.get("used_bytes"),
        "swap_total_bytes": swap.get("total_bytes"),
        "swap_free_bytes": swap.get("free_bytes"),
        "memory_free_percent": pressure.get("free_percent"),
        "startup_disk_free_bytes": disk.get("available_bytes"),
    }


def phase_info(root: Path, phase: str) -> dict:
    marker = read_private(root / f"phase-{phase}.complete.json", optional=True)
    return marker or {"phase": phase, "status": "not_run"}

def summarize_related_attempt(root: Path, primary_run: dict, primary_control: dict,
                              fixture_sha: str, schedule_sha: str) -> dict:
    """Summarize a separate protected run without mixing its rows into primary statistics."""
    run = read_private(root / "run-manifest.json")
    control = read_private(root / "control-manifest.json")
    if (run.get("control_id") != primary_run.get("control_id") or
            control.get("control_id") != primary_control.get("control_id")):
        raise ValueError("related_attempt_control_id_mismatch")
    if (run.get("fixture_manifest_sha256") != fixture_sha or
            control.get("fixture_manifest_sha256") != fixture_sha):
        raise ValueError("related_attempt_fixture_manifest_mismatch")
    schedule = read_private(root / "schedule.json")
    related_schedule_sha = boundary.schedule_sha256(schedule)
    if (run.get("schedule_sha256") != schedule_sha or
            control.get("schedule_sha256") != schedule_sha or
            related_schedule_sha != schedule_sha):
        raise ValueError("related_attempt_schedule_mismatch")
    invariant_fields = (
        "git_commit", "version", "service_source_sha256", "engine_source_config_sha256",
        "engine", "voice_profile_id", "language", "launchd_process_type", "response_format",
        "workers", "pending_slots", "pending_start_timeout_s", "openclaw_external_timeout_ms",
        "max_text_codepoints",
    )
    for field in invariant_fields:
        if control.get(field) != primary_control.get(field):
            raise ValueError("related_attempt_production_control_mismatch:" + field)

    warmup_rows = read_jsonl(root / "warmup.jsonl")
    anchor_rows = read_jsonl(root / "anchors" / "samples.jsonl")
    matrix_rows = [r for r in read_jsonl(root / "matrix.jsonl") if r.get("request_submitted") is not False]
    observation_rows = warmup_rows + anchor_rows
    runtime = control.get("runtime", {}) or {}
    baseline_swap = (runtime.get("swap") or {}).get("used_bytes")
    snapshots = [runtime]
    for row in observation_rows:
        snapshots.extend(s for s in (row.get("host_before"), row.get("host_after")) if isinstance(s, dict))
    observed_swap = [s.get("swap", {}).get("used_bytes") for s in snapshots
                     if isinstance(s.get("swap", {}).get("used_bytes"), int)]
    swap_growth = [value - baseline_swap for value in observed_swap if isinstance(baseline_swap, int)]
    min_memory_free = [s.get("memory_pressure", {}).get("free_percent") for s in snapshots
                       if isinstance(s.get("memory_pressure", {}).get("free_percent"), int)]
    observed_free_swap = [s.get("swap", {}).get("free_bytes") for s in snapshots
                          if isinstance(s.get("swap", {}).get("free_bytes"), int)]
    for row in observation_rows:
        check = (row.get("host_after") or {}).get("swap_growth_check") or {}
        swap_growth.extend(v for v in [check.get("initial_delta_bytes"),
                                       *check.get("confirmed_deltas_bytes", [])] if isinstance(v, int))
        min_memory_free.extend(v for v in check.get("confirmation_memory_free_percent", []) if isinstance(v, int))
        confirmed_free = check.get("confirmation_swap_free_bytes")
        if isinstance(confirmed_free, int):
            observed_free_swap.append(confirmed_free)

    phases = {phase: phase_info(root, phase) for phase in
              ("warmup", "anchor-pre", "probes", "matrix", "soak", "contention", "recovery")}
    stopped_phase = next((phase for phase, marker in phases.items() if marker.get("status") == "stopped"), None)
    successful_warmups = [r for r in warmup_rows if r.get("success") is True]
    guards = run.get("safety_stop_guards", {}) or {}
    stop_reason = phases[stopped_phase].get("reason") if stopped_phase else None
    discrepancy = None
    configured_swap_stop = guards.get("swap_free_immediate_stop_bytes")
    if stop_reason == "system_free_swap_below_256_mib_safety_guard" and configured_swap_stop == 512 * 1024 ** 2:
        discrepancy = {
            "marker_text_threshold_mib": 256,
            "run_manifest_threshold_bytes": configured_swap_stop,
            "observed_min_free_swap_bytes": min(observed_free_swap) if observed_free_swap else None,
            "note": "Preserved marker text says 256 MiB; run manifest/configured guard is 512 MiB. Raw evidence is not rewritten.",
        }
    return {
        "run_root_basename": root.name,
        "created_utc": run.get("created_utc"),
        "relationship": "separate preserved attempt; not merged into primary statistics",
        "production_control_invariants_verified": True,
        "fixture_manifest_sha256": fixture_sha,
        "schedule_sha256": schedule_sha,
        "launchagent_pid": (runtime.get("launchd") or {}).get("pid"),
        "warmup": {
            "attempts": len(warmup_rows),
            "successful": len(successful_warmups),
            "successful_endpoint_ms_excluded": [r.get("total_ms") for r in successful_warmups],
        },
        "resource_observations": {
            "min_memory_free_percent": min(min_memory_free) if min_memory_free else None,
            "max_observed_swap_growth_bytes": max(swap_growth) if swap_growth else None,
            "min_observed_swap_free_bytes": min(observed_free_swap) if observed_free_swap else None,
            "baseline_swap_used_bytes": baseline_swap,
        },
        "anchor_pre_attempts": len(anchor_rows),
        "anchor_pre_successful_samples": sum(r.get("success") is True for r in anchor_rows),
        "anchor_pre_successful_endpoint_ms_excluded": [r.get("total_ms") for r in anchor_rows
                                                        if r.get("success") is True],
        "matrix_attempts": len(matrix_rows),
        "matrix_successes": sum(r.get("success") is True for r in matrix_rows),
        "phase_status": phases,
        "stopped_phase": stopped_phase,
        "stop_reason": stop_reason,
        "safety_stop_guards": guards,
        "stop_marker_discrepancy": discrepancy,
    }

def checked_listening_index(root: Path, complete_lengths: list[int]) -> dict:
    index = read_private(root / "listening-index.json", optional=True)
    if index is None:
        if complete_lengths:
            raise ValueError("listening_artifacts_not_finalized")
        return {"artifacts": [], "incomplete_buckets": []}
    found = {item["length"]: item for item in index.get("artifacts", [])}
    if set(found) != set(complete_lengths):
        raise ValueError("listening_index_does_not_cover_exact_complete_lengths")
    for length, item in found.items():
        directory = root / "listening" / str(length)
        for name in ("sample.mp3", "sample.txt", "sample.json"):
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
                raise ValueError(f"listening_artifact_missing_or_unprotected:{length}:{name}")
        metadata = read_private(directory / "sample.json")
        fixture_text = (directory / "sample.txt").read_bytes()
        audio = (directory / "sample.mp3").read_bytes()
        if metadata.get("length_codepoints") != length or len(fixture_text.decode("utf-8")) != length:
            raise ValueError(f"listening_artifact_text_length_mismatch:{length}")
        if metadata.get("text_sha256") != boundary.sha256_bytes(fixture_text):
            raise ValueError(f"listening_artifact_text_hash_mismatch:{length}")
        if metadata.get("mp3_sha256") != boundary.sha256_bytes(audio):
            raise ValueError(f"listening_artifact_audio_hash_mismatch:{length}")
        if (item.get("fixture_run_index") != metadata.get("fixture_run_index") or
                item.get("total_ms") != metadata.get("total_ms")):
            raise ValueError(f"listening_artifact_index_metadata_mismatch:{length}")
    return index


def build_document(root: Path, related_attempt_roots: list[Path] | None = None) -> tuple[dict, str]:
    run = read_private(root / "run-manifest.json")
    control = read_private(root / "control-manifest.json")
    tooling_revisions = read_private(root / "tooling-revisions.json", optional=True) or {}
    probe = read_private(root / "probe-summary.json", optional=True) or {"passed_lengths": [], "buckets": {}}
    matrix = read_private(root / "matrix-summary.json", optional=True) or {"buckets": {}, "safe_lengths": []}
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    if fixture_sha != run.get("fixture_manifest_sha256") or fixture_sha != control.get("fixture_manifest_sha256"):
        raise ValueError("fixture_manifest_changed_after_measurement")
    schedule = read_private(root / "schedule.json")
    schedule_sha = boundary.schedule_sha256(schedule)
    if schedule_sha != run.get("schedule_sha256") or schedule_sha != control.get("schedule_sha256"):
        raise ValueError("schedule_hash_mismatch")

    rows = [r for r in read_jsonl(root / "matrix.jsonl") if r.get("request_submitted") is not False]
    probe_rows = read_jsonl(root / "probes" / "samples.jsonl")
    stop_observation = read_private(root / "post-safety-stop-observation.json", optional=True)
    timed_out_sample = (stop_observation or {}).get("timed_out_sample") or {}
    matrix_stop_length = timed_out_sample.get("length")
    matrix_file_present = (root / "matrix.jsonl").is_file()
    matrix_phase = phase_info(root, "matrix")
    probe_stop_reason = probe.get("stop_reason")
    probe_stopped_at = probe.get("stopped_at")
    buckets: list[dict] = []
    complete_lengths = []
    probe_observations = []
    for length in boundary.LENGTHS:
        bucket_rows = [r for r in rows if r.get("length") == length]
        success_rows = [r for r in bucket_rows if r.get("success") is True]
        declared = matrix.get("buckets", {}).get(str(length), {})
        p = probe.get("buckets", {}).get(str(length), {})
        probe_status = p.get("status", "not_run")
        raw_probe_rows = [r for r in probe_rows if r.get("length") == length]
        for r in raw_probe_rows:
            probe_observations.append({
                "length_codepoints": length,
                "fixture_id": r.get("fixture_id"),
                "request_submitted": r.get("request_submitted", True),
                "http_status": r.get("http_status"),
                "success": r.get("success"),
                "endpoint_total_ms": r.get("total_ms"),
                "generate_or_model_ms": r.get("generate_or_model_ms"),
                "audio_duration_ms": r.get("audio_duration_ms"),
                "rtf": r.get("rtf"),
                "error_category": r.get("error_category"),
                "excluded_from_quantiles": True,
                "swap_growth_check": (r.get("host_after") or {}).get("swap_growth_check"),
                "memory_free_percent_after": (((r.get("host_after") or {}).get("memory_pressure") or {}).get("free_percent")),
                "physical_footprint_bytes_after": (((r.get("host_after") or {}).get("process") or {}).get("physical_footprint_bytes")),
            })
        declared_status = declared.get("status")
        complete = len(bucket_rows) == 20 and len(success_rows) == 20 and declared_status == "complete"
        if complete:
            if sum(1 for r in success_rows if r.get("family") == "A") != 10 or sum(1 for r in success_rows if r.get("family") == "B") != 10:
                raise ValueError(f"fixture_sample_count_mismatch:{length}")
            complete_lengths.append(length)
            metrics = sample_summary(success_rows)
            by_family = boundary.paired_fixture_summaries(success_rows)
            status = "complete"
        else:
            metrics = {key: {"n": 0, "p50": None, "p95": None, "max": None}
                       for key in ("total_ms", "generate_or_model_ms", "audio_duration_ms", "rtf",
                                   "queue_wait_ms", "wav_serialize_ms", "encode_ms", "engine_inside_lock_ms")}
            by_family = None
            watchdog_row = next((row for row in bucket_rows if row.get("error_category") == "watchdog_timeout"), None)
            if watchdog_row is not None or (isinstance(matrix_stop_length, int) and length == matrix_stop_length):
                status = "safety-incomplete"
            elif matrix_phase.get("status") == "stopped" and bucket_rows:
                status = "incomplete"
            elif (matrix_phase.get("status") == "stopped" and not bucket_rows and
                  probe_status == "passed"):
                status = "matrix-not-run-after-safety-stop"
            elif declared_status:
                status = declared_status
            elif probe_status == "passed" and not matrix_file_present:
                status = "probe-passed-matrix-not-run"
            else:
                status = probe_status
        reason = declared.get("reason") or p.get("reason")
        if matrix_phase.get("status") == "stopped" and stop_observation:
            if length == matrix_stop_length:
                reason = (stop_observation.get("stop_reason") or
                          f"request watchdog at {length} codepoints")
            elif bucket_rows:
                reason = (f"matrix stopped at {matrix_stop_length} codepoints after a request watchdog; "
                          f"this bucket had {len(success_rows)}/20 successful partial rows and no bucket-specific hard stop")
            elif status == "matrix-not-run-after-safety-stop":
                reason = f"matrix not run after hard stop at {matrix_stop_length} codepoints"
        if not reason and status == "probe-passed-matrix-not-run" and probe_stopped_at is not None:
            reason = f"Phase C not run after Phase B safety stop at {probe_stopped_at} codepoints"
        buckets.append({
            "length_codepoints": length,
            "status": status,
            "successful_samples": len(success_rows),
            "attempts": len(bucket_rows),
            "failures": len(bucket_rows) - len(success_rows),
            "failure_rate": ((len(bucket_rows) - len(success_rows)) / len(bucket_rows)) if bucket_rows else None,
            "reason": reason,
            "probe": {"status": probe_status, "attempts": p.get("attempts", [])},
            "metrics": metrics,
            "fixture_A_B": by_family,
        })
    listening = checked_listening_index(root, complete_lengths)
    audio_root = root / "audio"
    listening["partial_raw_audio_files_preserved"] = (sum(1 for path in audio_root.rglob("*.mp3")
                                                               if path.is_file() and not path.is_symlink())
                                                      if audio_root.is_dir() else 0)
    listening["representative_eligible_complete_buckets"] = list(complete_lengths)

    soak_summary = read_private(root / "soak" / "summary.json", optional=True)
    if soak_summary is None:
        soak_summary = {"status": phase_info(root, "soak").get("status", "not_run"),
                        "reason": phase_info(root, "soak").get("reason")}
    contention_summary = read_private(root / "contention" / "summary.json", optional=True)
    contention_rows = read_jsonl(root / "contention" / "requests.jsonl")
    contention_by_length = {}
    for length in sorted({r.get("length") for r in contention_rows if isinstance(r.get("length"), int)}):
        selected = [r for r in contention_rows if r.get("length") == length]
        successful = [r for r in selected if r.get("http_status") == 200 and r.get("success")]
        rejected = [r for r in selected if r.get("http_status") == 503 and r.get("error_category") == "tts_busy"]
        other = [r for r in selected if r.get("http_status") not in (200, 503)]
        contention_by_length[str(length)] = {
            "bursts_observed": len({r.get("burst") for r in selected}),
            "responses": len(selected),
            "http_200": len(successful),
            "http_503_tts_busy": len(rejected),
            "unexpected_responses": len(other),
            "success_latency_ms": boundary.summarize(float(r["total_ms"]) for r in successful if isinstance(r.get("total_ms"), (int, float))),
            "rejected_latency_ms": boundary.summarize(float(r["total_ms"]) for r in rejected if isinstance(r.get("total_ms"), (int, float))),
            "log_correlations_ok": all(r.get("log_correlation_ok_for_burst") is True for r in selected),
            "service_health_after": all(r.get("service_health_after") is True for r in selected),
        }
    if contention_summary is None:
        contention_summary = {"status": phase_info(root, "contention").get("status", "not_run"),
                              "reason": phase_info(root, "contention").get("reason")}

    pre_anchor = anchor_summary(root, "pre")
    post_anchor = anchor_summary(root, "post")
    pre_metrics = pre_anchor["total_ms"]
    post_metrics = post_anchor["total_ms"]
    p50_pre, p50_post = pre_metrics.get("p50"), post_metrics.get("p50")
    recovery_change = None
    if isinstance(p50_pre, (int, float)) and p50_pre != 0 and isinstance(p50_post, (int, float)):
        recovery_change = {"absolute_ms": p50_post - p50_pre, "relative_percent": 100 * (p50_post - p50_pre) / p50_pre}
    anchors = {
        "pre": {**pre_anchor, "host_before": snapshot_public(pre_anchor.get("host_before")),
                "host_after": snapshot_public(pre_anchor.get("host_after"))},
        "post": {**post_anchor, "host_before": snapshot_public(post_anchor.get("host_before")),
                 "host_after": snapshot_public(post_anchor.get("host_after"))},
        "post_p50_change_vs_pre": recovery_change,
    }

    complete = [b for b in buckets if b["status"] == "complete"]
    ratios = []
    for b in complete:
        p50, p95 = b["metrics"]["total_ms"].get("p50"), b["metrics"]["total_ms"].get("p95")
        if p50 and p95 is not None:
            ratios.append({"length": b["length_codepoints"], "p95_to_p50_ratio": p95 / p50})
    high_dispersion = sorted(ratios, key=lambda x: (-x["p95_to_p50_ratio"], x["length"]))[:3]
    safety_incomplete = [
        {"length": b["length_codepoints"], "status": b["status"], "reason": b.get("reason"),
         "successful_samples": b["successful_samples"], "attempts": b["attempts"]}
        for b in buckets if b["status"] in ("safety-incomplete", "not_probed_after_stop", "incomplete",
                                                 "matrix-not-run-after-safety-stop")
    ]
    matrix_not_run = [
        {"length": b["length_codepoints"], "status": b["status"], "reason": b.get("reason")}
        for b in buckets if b["status"] in ("probe-passed-matrix-not-run", "matrix-not-run-after-safety-stop")
    ]
    probe_failures = [r for r in probe_rows if not r.get("success")]
    memory_rows = [r for r in rows if r.get("host_before") or r.get("host_after")]
    snapshots = []
    for row in memory_rows:
        snapshots.extend([row.get("host_before"), row.get("host_after")])
    snapshots = [s for s in snapshots if isinstance(s, dict)]
    matrix_swap_checks = [s.get("swap_growth_check") for s in snapshots
                          if isinstance(s.get("swap_growth_check"), dict)]
    matrix_confirmations = [confirmed for check in matrix_swap_checks
                            for confirmed in check.get("confirmation_snapshots", [])
                            if isinstance(confirmed, dict)]
    snapshots.extend(matrix_confirmations)
    all_footprints = [s.get("process", {}).get("physical_footprint_bytes") for s in snapshots]
    all_footprints = [v for v in all_footprints if isinstance(v, int)]
    all_rss = [s.get("process", {}).get("rss_bytes") for s in snapshots]
    all_rss = [v for v in all_rss if isinstance(v, int)]
    all_free = [s.get("memory_pressure", {}).get("free_percent") for s in snapshots]
    all_free = [v for v in all_free if isinstance(v, int)]
    all_swaps = [s.get("swap", {}).get("used_bytes") for s in snapshots]
    all_swaps = [v for v in all_swaps if isinstance(v, int)]
    swap_checks = matrix_swap_checks
    pre_anchor_raw_rows = read_jsonl(root / "anchors" / "samples.jsonl")
    warmup_raw_rows = read_jsonl(root / "warmup.jsonl")
    preflight_snapshots = [s for r in (warmup_raw_rows + probe_rows + pre_anchor_raw_rows)
                           for s in (r.get("host_before"), r.get("host_after")) if isinstance(s, dict)]
    preflight_swap_checks = [s.get("swap_growth_check") for s in preflight_snapshots
                             if isinstance(s.get("swap_growth_check"), dict)]
    preflight_confirmations = [confirmed for check in preflight_swap_checks
                               for confirmed in check.get("confirmation_snapshots", [])
                               if isinstance(confirmed, dict)]
    preflight_snapshots.extend(preflight_confirmations)
    preflight_footprints = [s.get("process", {}).get("physical_footprint_bytes") for s in preflight_snapshots]
    preflight_footprints = [v for v in preflight_footprints if isinstance(v, int)]
    preflight_rss = [s.get("process", {}).get("rss_bytes") for s in preflight_snapshots]
    preflight_rss = [v for v in preflight_rss if isinstance(v, int)]
    preflight_free = [s.get("memory_pressure", {}).get("free_percent") for s in preflight_snapshots]
    preflight_free = [v for v in preflight_free if isinstance(v, int)]
    preflight_swaps = [s.get("swap", {}).get("used_bytes") for s in preflight_snapshots]
    preflight_swaps = [v for v in preflight_swaps if isinstance(v, int)]
    all_swap_checks = swap_checks + preflight_swap_checks
    confirmed_swap_checks = [check for check in all_swap_checks
                             if isinstance(check.get("confirmation_count"), int) and check.get("confirmation_count") > 0]
    memory = {
        "baseline_before_stress": snapshot_public(control.get("runtime")),
        "swap_growth_confirmation_observations": all_swap_checks,
        "swap_growth_confirmation_episode_count": len(confirmed_swap_checks),
        "swap_growth_confirmation_snapshot_count": sum(check.get("confirmation_count", 0) for check in confirmed_swap_checks),
        "matrix_max_sampled_physical_footprint_bytes": max(all_footprints) if all_footprints else None,
        "matrix_max_sampled_process_lifetime_footprint_peak_bytes": max((s.get("process", {}).get("physical_footprint_peak_bytes") for s in snapshots if isinstance(s.get("process", {}).get("physical_footprint_peak_bytes"), int)), default=None),
        "matrix_max_sampled_rss_bytes": max(all_rss) if all_rss else None,
        "matrix_min_system_memory_free_percent": min(all_free) if all_free else None,
        "matrix_swap_min_bytes": min(all_swaps) if all_swaps else None,
        "matrix_swap_max_bytes": max(all_swaps) if all_swaps else None,
        "matrix_swap_delta_min_to_max_bytes": (max(all_swaps) - min(all_swaps)) if all_swaps else None,
        "preflight_point_sampled_max_physical_footprint_bytes": max(preflight_footprints) if preflight_footprints else None,
        "preflight_process_lifetime_footprint_peak_bytes": max((s.get("process", {}).get("physical_footprint_peak_bytes") for s in preflight_snapshots if isinstance(s.get("process", {}).get("physical_footprint_peak_bytes"), int)), default=None),
        "preflight_point_sampled_max_rss_bytes": max(preflight_rss) if preflight_rss else None,
        "preflight_min_system_memory_free_percent": min(preflight_free) if preflight_free else None,
        "preflight_swap_min_bytes": min(preflight_swaps) if preflight_swaps else None,
        "preflight_swap_max_bytes": max(preflight_swaps) if preflight_swaps else None,
        "preflight_swap_growth_checks": preflight_swap_checks,
        "accounting_notes": [
            "RSS is the inference process resident set; physical footprint comes from point-sampled vmmap output after/before requests.",
            "vmmap physical-footprint peak is a process-lifetime high-water mark, not an individual-request attribution.",
            "memory_pressure free percentage and vm.swapusage are system-wide macOS snapshots; swap can retain prior workload history.",
            "A sampled maximum is not a continuous trace; transient peaks between snapshots may be missed.",
        ],
    }
    matrix_stop_raw = read_private(root / "post-matrix-safety-stop.json", optional=True)
    matrix_stop_annotation = read_private(root / "matrix-stop-operator-annotation.json", optional=True)
    matrix_stop_public = None
    partial_matrix_points = []
    if matrix_stop_raw:
        raw_partial = matrix_stop_raw.get("partial_response") or {}
        raw_service = matrix_stop_raw.get("service_after_stop") or {}
        raw_job = raw_service.get("launchd") or {}
        raw_pressure = raw_service.get("memory_pressure") or {}
        raw_swap = raw_service.get("swap") or {}
        raw_process = raw_service.get("process") or {}
        matrix_stop_public = {
            "reason": (matrix_stop_annotation or {}).get("reason") or matrix_stop_raw.get("reason"),
            "observed_free_percent_at_operator_stop": (matrix_stop_annotation or {}).get("observed_memory_free_percent"),
            "observed_swap_free_mib_at_operator_stop": (matrix_stop_annotation or {}).get("observed_swap_free_mib"),
            "operator_interrupted": bool(matrix_stop_annotation),
            "persisted_matrix_rows": matrix_stop_raw.get("persisted_matrix_rows"),
            "partial_response_count": 1 if raw_partial else 0,
            "post_stop_service": {
                "health": (raw_service.get("health") or {}).get("status"),
                "pid": raw_job.get("pid"), "launchd_runs": raw_job.get("runs"),
                "memory_free_percent": raw_pressure.get("free_percent"),
                "swap_used_bytes": raw_swap.get("used_bytes"), "swap_free_bytes": raw_swap.get("free_bytes"),
                "physical_footprint_bytes": raw_process.get("physical_footprint_bytes"),
                "physical_footprint_peak_bytes": raw_process.get("physical_footprint_peak_bytes"),
            },
            "additional_tts_requests_after_stop": matrix_stop_raw.get("additional_tts_requests_after_stop"),
        }
        first_matrix = next((r for r in rows if r.get("length") == 200 and r.get("family") == "A"), None)
        if first_matrix:
            partial_matrix_points.append({
                "length": 200, "family": "A", "request_submitted": True, "client_total_ms": first_matrix.get("total_ms"),
                "generate_or_model_ms": first_matrix.get("generate_or_model_ms"),
                "audio_duration_ms": first_matrix.get("audio_duration_ms"), "rtf": first_matrix.get("rtf"),
                "success_response_row_persisted": True, "percentile_eligible": False, "representative": False,
            })
        if raw_partial:
            metrics = raw_partial.get("model_metrics_from_service_log") or {}
            partial_matrix_points.append({
                "length": 200, "family": "B", "request_submitted": True, "client_total_ms": None,
                "generate_or_model_ms": metrics.get("generate_or_model_ms"),
                "audio_duration_ms": metrics.get("audio_duration_ms"), "rtf": metrics.get("rtf"),
                "success_response_row_persisted": False, "percentile_eligible": False, "representative": False,
                "note": "Validated MP3 was retained outside Git, but the client-timing JSON row was interrupted before fsync; service metrics are time-correlated only and client total_ms is unavailable.",
            })
    if matrix_stop_public:
        stop_pf_peak = (matrix_stop_public.get("post_stop_service") or {}).get("physical_footprint_peak_bytes")
        memory["post_safety_stop_process_lifetime_footprint_peak_bytes"] = stop_pf_peak
    else:
        memory["post_safety_stop_process_lifetime_footprint_peak_bytes"] = None
    v2_post_runtime = (stop_observation or {}).get("post_stop_runtime") or {}
    memory["post_safety_stop_process_lifetime_footprint_peak_bytes"] = v2_post_runtime.get("physical_footprint_peak_bytes")
    memory["post_safety_stop_physical_footprint_bytes"] = v2_post_runtime.get("physical_footprint_bytes")
    memory["post_safety_stop_memory_free_percent"] = v2_post_runtime.get("memory_free_percent")
    memory["post_safety_stop_swap_used_bytes"] = v2_post_runtime.get("swap_used_bytes")
    memory["post_safety_stop_swap_free_bytes"] = v2_post_runtime.get("swap_free_bytes")
    peak_candidates = [
        ((control.get("runtime") or {}).get("process") or {}).get("physical_footprint_peak_bytes"),
        memory.get("matrix_max_sampled_process_lifetime_footprint_peak_bytes"),
        memory.get("preflight_process_lifetime_footprint_peak_bytes"),
        memory.get("post_safety_stop_process_lifetime_footprint_peak_bytes"),
    ]
    peak_candidates = [x for x in peak_candidates if isinstance(x, int)]
    memory["maximum_observed_process_lifetime_footprint_peak_bytes"] = max(peak_candidates) if peak_candidates else None
    related_attempts = []
    seen_related_roots = {root.resolve()}
    for related_root in related_attempt_roots or []:
        resolved_related = related_root.resolve()
        if resolved_related in seen_related_roots:
            raise ValueError("duplicate_related_attempt_root")
        seen_related_roots.add(resolved_related)
        related_attempts.append(summarize_related_attempt(
            resolved_related, run, control, fixture_sha, schedule_sha))

    phase_names = ("warmup", "anchor-pre", "probes", "matrix", "soak", "contention", "recovery")
    phase_status = {phase: phase_info(root, phase) for phase in phase_names}
    required_phases_complete = all(phase_status[name].get("status") == "complete" for name in phase_names)
    probes_all_passed = all(probe.get("buckets", {}).get(str(n), {}).get("status") == "passed"
                            for n in boundary.LENGTHS)
    pre_anchor_complete = pre_anchor.get("success") == 20 and pre_anchor.get("attempts") == 20
    post_anchor_complete = post_anchor.get("success") == 20 and post_anchor.get("attempts") == 20
    warmups_complete = phase_status["warmup"].get("successful_warmups") == 3
    soak_complete = phase_status["soak"].get("status") == "complete" and soak_summary.get("status") == "complete"
    contention_complete = (phase_status["contention"].get("status") == "complete" and
                           contention_summary.get("status") == "complete")
    listening_complete = len(listening.get("artifacts", [])) == len(boundary.LENGTHS)
    done = (len(complete_lengths) == len(boundary.LENGTHS) and probes_all_passed and
            warmups_complete and pre_anchor_complete and post_anchor_complete and
            soak_complete and contention_complete and listening_complete and required_phases_complete)
    has_hard_stop = any(phase_status[name].get("status") == "stopped" for name in phase_names)
    goal_status = "complete" if done else ("incomplete-safety-stopped" if has_hard_stop else "incomplete")
    admission = control.get("admission_baseline") or {}
    admission_public = {
        "status": admission.get("status"),
        "snapshot_interval_s": admission.get("snapshot_interval_s"),
        "validation_reason": admission.get("validation_reason"),
        "snapshots": [snapshot_public(item) for item in admission.get("snapshots", [])],
    }
    prior_evidence = run.get("prior_safety_evidence") or {}
    safety_policy = dict(run.get("safety_policy", {}))
    safety_policy["warning_episode_rearm"] = tooling_revisions.get("swap_warning_episode_rearm", {})
    report = {
        "schema_version": 2,
        "goal_status": goal_status,
        "additional_preserved_attempts": related_attempts,
        "report_generated_utc": datetime.now(timezone.utc).isoformat(),
        "control_id": boundary.CONTROL_ID,
        "control": {
            "git_commit": control.get("git_commit"),
            "canonical_main_commit": control.get("canonical_main_commit"),
            "branch_base_commit": control.get("branch_base_commit"),
            "canonical_production_file_sha256": control.get("canonical_production_file_sha256"),
            "version": control.get("version"),
            "service_source_sha256": control.get("service_source_sha256"),
            "engine_source_config_sha256": control.get("engine_source_config_sha256"),
            "engine_config": control.get("engine_config"),
            "engine": control.get("engine"),
            "voice_profile_id": control.get("voice_profile_id"),
            "protected_a_reference_verified_unchanged": control.get("protected_a_reference_verified_unchanged"),
            "language": control.get("language"),
            "launchd_process_type": control.get("launchd_process_type"),
            "launchd_spawn_type": control.get("launchd_spawn_type"),
            "active_mlx_library_mapped": control.get("active_mlx_library_mapped"),
            "disk_plist_valid_at_capture": control.get("disk_plist_valid_at_capture"),
            "response_format": control.get("response_format"),
            "workers": control.get("workers"),
            "pending_slots": control.get("pending_slots"),
            "pending_start_timeout_s": control.get("pending_start_timeout_s"),
            "openclaw_external_timeout_ms": control.get("openclaw_external_timeout_ms"),
            "live_openclaw_tts_config": control.get("live_openclaw_tts_config"),
            "max_text_codepoints": control.get("max_text_codepoints"),
            "service_port": control.get("service_port"),
            "service_bind": control.get("service_bind"),
            "mac_model_identifier": control.get("mac_model_identifier"),
            "unified_memory": control.get("unified_memory"),
            "macos_version": control.get("macos_version"),
            "launchagent_runtime_before_measurement": snapshot_public(control.get("runtime")),
            "admission_baseline": admission_public,
            "9router_host_tts_health_route": control.get("9router_host_tts_health_route"),
            "production_configuration_changed_by_goal": control.get("production_configuration_changed_by_goal"),
        },
        "fixture_manifest_sha256": fixture_sha,
        "schedule_seed": run.get("schedule_seed"),
        "schedule_sha256": schedule_sha,
        "schedule_rows": len(schedule),
        "v2_executed_lengths": list(boundary.LENGTHS),
        "historical_fixture_lengths": list(boundary.HISTORICAL_LENGTHS),
        "schedule_filter": run.get("schedule_filter"),
        "prior_safety_evidence": prior_evidence,
        "tooling_revisions": tooling_revisions,
        "historical_long_input_status": {
            "800": prior_evidence.get("historical_800_probe"),
            "1000": prior_evidence.get("1000"),
            "1200": prior_evidence.get("1200"),
            "retested_in_v2": False,
        },
        "safety_stop_guards": safety_policy,
        "quantile_method": boundary.QUANTILE_METHOD,
        "p95_interpretation": "Controlled descriptive p95; n=20 is not an SLA or a high-confidence production tail estimate.",
        "input_length_unit": "Python Unicode codepoints; same semantics as len(text)",
        "matrix_buckets": buckets,
        "matrix_not_run_after_safety_stop": matrix_not_run,
        "safety_stop_observation": stop_observation,
        "matrix_safety_stop_observation": matrix_stop_public,
        "partial_matrix_attempts_excluded_from_quantiles": partial_matrix_points,
        "single_safety_probe_observations_excluded_from_quantiles": probe_observations,
        "safety_probe_failures": [{"length": r.get("length"), "error_category": r.get("error_category"),
                                   "http_status": r.get("http_status"), "total_ms": r.get("total_ms")} for r in probe_failures],
        "representative_listening_artifacts": listening,
        "sequential_soak": soak_summary,
        "queue_contention": {"phase": phase_info(root, "contention"), "summary": contention_summary,
                             "by_length": contention_by_length},
        "pre_post_stress_control": anchors,
        "memory_observations": memory,
        "phase_status": phase_status,
        "known_limitations": [
            "This is one host, one protected voice profile, one selected MLX model revision, Auto Japanese fixtures, and MP3 endpoint responses.",
            "The workload is a controlled synthetic benchmark and not real WhatsApp user traffic or a production SLA sample.",
            "The unchanged MLX HTTP service does not expose separate Metal-driver allocation counters; physical footprint/RSS are point-sampled process/host proxies, not direct Metal allocation traces.",
            "Model/decode work is exposed as generate_or_model_ms; the current MLX API does not provide a separate decode-stage boundary.",
            "The experimental 110-second watchdog is below the unchanged 120-second OpenClaw timeout.",
            "The report does not select a MAX_TEXT value, preferred spoken length, production warning threshold, segmentation policy, or lifecycle policy.",
            "Host swap is system-wide and cannot be attributed byte-for-byte to the TTS process; v2 treats it as telemetry unless corroborated by active memory/footprint distress.",
        ],
        "decision_input_only": {
            "routine_anchor_length": 150,
            "extended_anchor_length": 320 if 320 in complete_lengths else None,
            "highest_p95_to_p50_ratios": high_dispersion,
            "safety_incomplete_buckets": safety_incomplete,
            "final_production_boundary_decision": "deferred to owner review; no policy recommendation",
        },
    }

    def triplet_n(summary: dict | None, suffix: str = "") -> str:
        if not summary or not summary.get("n"):
            return "not reported"
        return (f"{fmt_num(summary.get('p50'))}{suffix} / "
                f"{fmt_num(summary.get('p95'))}{suffix} / "
                f"{fmt_num(summary.get('max'))}{suffix} (n={summary.get('n')})")

    prior = report.get("prior_safety_evidence") or {}
    tool_revision = report.get("tooling_revisions") or {}
    anchors_report = report.get("pre_post_stress_control") or {}
    admission_report = ((report.get("control") or {}).get("admission_baseline") or {})
    matrix_buckets = report.get("matrix_buckets") or []
    all_phases = report.get("phase_status") or {}
    lines = [
        "# Amadeus TTS — Production Boundary Rebaseline v2",
        "",
        f"Generated: {report['report_generated_utc']} UTC<br>",
        f"Control ID: `{boundary.CONTROL_ID}`<br>",
        f"Overall V2 status: **{report['goal_status']}**",
        "",
        "Measurement-only. Production Amadeus 1.6.2 configuration and output policy were not changed. "
        "This report does not select a new text limit, segmentation rule, or lifecycle policy.",
        "",
        "## Immutable production control",
        "",
        f"- Canonical production baseline: `{control.get('canonical_main_commit')}` / Amadeus `{control.get('version')}`; measurement branch commit `{control.get('git_commit')}`.",
        f"- Service SHA-256 `{control.get('service_source_sha256')}`; engine-config SHA-256 `{control.get('engine_source_config_sha256')}`.",
        f"- Engine/profile/language: `{control.get('engine')}` / `{control.get('voice_profile_id')}` / `{control.get('language')}`; protected A reference verified unchanged: `{control.get('protected_a_reference_verified_unchanged')}`.",
        f"- LaunchAgent: `{control.get('launchd_process_type')}` / `{control.get('launchd_spawn_type')}`; MP3; workers={control.get('workers')}, pending={control.get('pending_slots')}, admission wait={control.get('pending_start_timeout_s')}s.",
        f"- OpenClaw timeout={control.get('openclaw_external_timeout_ms')}ms; `MAX_TEXT={control.get('max_text_codepoints')}`; port={control.get('service_port')}; bind=`{control.get('service_bind')}`.",
        f"- Live TTS config: `{json.dumps(control.get('live_openclaw_tts_config'), ensure_ascii=False, sort_keys=True)}`.",
        f"- Control capture: disk plist valid `{control.get('disk_plist_valid_at_capture')}`; active MLX mapped `{control.get('active_mlx_library_mapped')}`; no production configuration change `{control.get('production_configuration_changed_by_goal')}`.",
        f"- Host: {control.get('mac_model_identifier')}, {control.get('unified_memory')}, macOS {control.get('macos_version')}; 9Router route `{control.get('9router_host_tts_health_route')}`.",
        "",
        "### Three-snapshot admission baseline",
        "",
        "| snapshot | health | PID/runs | memory free | TTS footprint | swap used/free | startup disk free | 9Router route |",
        "| :---: | :--- | :---: | ---: | ---: | :--- | ---: | :---: |",
    ]
    for index, snap in enumerate(admission_report.get("snapshots", []), start=1):
        lines.append(
            f"| {index} | {snap.get('health')} | {snap.get('pid')}/{snap.get('launchd_runs')} | "
            f"{snap.get('memory_free_percent')}% | {fmt_bytes(snap.get('physical_footprint_bytes'))} | "
            f"{fmt_bytes(snap.get('swap_used_bytes'))} / {fmt_bytes(snap.get('swap_free_bytes'))} | "
            f"{fmt_bytes(snap.get('startup_disk_free_bytes'))} | {snap.get('host_route_ready')} |"
        )
    lines += [
        f"Admission status: `{admission_report.get('status')}`; snapshots spaced {admission_report.get('snapshot_interval_s')}s; swap was accepted as stable/declining without an absolute-free-swap admission floor.",
        "",
        "## Preserved historical safety-stop evidence",
        "",
        f"- Original evidence remains on `{prior.get('source_branch')}` at `{prior.get('source_commit')}`. Previous report SHA-256 `{prior.get('report_sha256')}`; data SHA-256 `{prior.get('data_sha256')}`. The old report/raw roots were not rewritten, and none of their rows were pooled into V2.",
        f"- Historical primary 50-character A control: {prior.get('historical_50_character_pre_anchor', {}).get('success')}/{prior.get('historical_50_character_pre_anchor', {}).get('attempts')} successes; endpoint p50/p95/max {triplet_n(prior.get('historical_50_character_pre_anchor', {}).get('endpoint_total_ms'), ' ms')}.",
        f"- Historical progressive probes passed through 600. The 800-codepoint A request took {fmt_num((prior.get('historical_800_probe') or {}).get('endpoint_total_ms'))} ms and hit `{(prior.get('historical_800_probe') or {}).get('error_category')}` at the {fmt_num((prior.get('historical_800_probe') or {}).get('watchdog_s'))}s watchdog. 1000/1200: `{prior.get('1000')}` / `{prior.get('1200')}`.",
        f"- Historical primary matrix stop: {prior.get('primary_matrix_stop', {}).get('persisted_matrix_rows')} persisted row; memory free {prior.get('primary_matrix_stop', {}).get('observed_free_percent')}%, swap free {fmt_num(prior.get('primary_matrix_stop', {}).get('observed_swap_free_mib'))} MiB. These partial 200-character observations remain excluded from percentiles and representatives.",
        "",
        "| preserved run root | stopped phase | original stop reason | excluded warmups | anchor / matrix evidence |",
        "| :--- | :--- | :--- | :---: | :--- |",
    ]
    for attempt in prior.get("attempts", []):
        warmup = attempt.get("warmup") or {}
        warmups = attempt.get("successful_excluded_warmups", warmup.get("successful", "—"))
        anchors_count = attempt.get("anchor_pre_successful_samples", 0)
        matrix_attempts = attempt.get("matrix_attempts", 0)
        matrix_successes = attempt.get("matrix_successes", 0)
        evidence = f"anchor {anchors_count}; matrix {matrix_successes}/{matrix_attempts}"
        lines.append(f"| `{attempt.get('run_root_basename')}` | {attempt.get('stopped_phase')} | `{attempt.get('stop_reason')}` | {warmups} | {evidence} |")
    lines += [
        "",
        "## Revised V2 swap and memory policy",
        "",
        "- Host-wide swap is telemetry/corroboration, not proof of TTS failure and never a standalone hard stop. Low free swap (<512 MiB) or >=512 MiB growth from the fresh run baseline starts a passive-confirmation episode: finish the current healthy request, pause new synthesis, then sample every 30s for up to 180s.",
        "- After stable/recovering snapshots acknowledge a warning, redundant pauses are suppressed until >=512 MiB additional swap-used growth, a new crossing below 512 MiB free, or >=128 MiB further free-swap decline while already below that warning level. The change is recorded below and applies from `anchor-pre`; the three excluded warmups were completed under the prior repeated-confirmation implementation.",
        "- Hard stops remain: health not ready; PID or LaunchAgent run-count change; memory free <=10%; TTS footprint >=20 GiB; a request reaches the 110s watchdog; repeated same-bucket synthesis failures; host/route instability; low startup-disk space combined with a swap warning; or >=2 GiB fresh swap growth corroborated by memory free <=20% or TTS footprint >=18 GiB.",
        "- A hard stop ends the active dataset. High but stable/recovering swap with healthy PID/health and safe memory does not by itself stop the run.",
        "",
        "### Tooling revision ledger",
        "",
        f"- Recorded in protected evidence at `{tool_revision.get('effective_from_phase')}`; prior/current benchmark and runtime source hashes are in the JSON report (`tooling_revisions`). Hard-stop thresholds remained unchanged.",
        "",
        "## Frozen fixtures and statistics",
        "",
        f"- Fixture manifest SHA-256: `{report.get('fixture_manifest_sha256')}`. Historical corpus lengths: {', '.join(map(str, report.get('historical_fixture_lengths', [])))}.",
        f"- Executed V2 lengths only: {', '.join(map(str, report.get('v2_executed_lengths', [])))}; fixed seed {report.get('schedule_seed')}; 200 rows; V2 schedule SHA-256 `{report.get('schedule_sha256')}`.",
        f"- Schedule derivation: `{report.get('schedule_filter')}`. Five cycles; fixture A=10 and B=10 measured requests per complete bucket; three excluded A-50 warmups; 2s quiet interval. Input length uses Python Unicode codepoints (`len(text)`).",
        f"- Quantile method: {report.get('quantile_method')}. p95 is descriptive for n=20, not an SLA or a high-confidence tail estimate.",
        "",
        "## Pre-matrix control anchor",
        "",
        "| status | successes/attempts | endpoint p50 / p95 / max |",
        "| :--- | :---: | :--- |",
    ]
    pre = anchors_report.get("pre") or {}
    lines.append(f"| `{all_phases.get('anchor-pre', {}).get('status')}` | {pre.get('success')}/{pre.get('attempts')} | {triplet_n(pre.get('total_ms'), ' ms')} |")
    lines += [
        "",
        "## Progressive safety probes (excluded from quantiles)",
        "",
        "| codepoints | status | attempts | endpoint observations |",
        "| ---: | :--- | ---: | :--- |",
    ]
    for bucket in matrix_buckets:
        probe = bucket.get("probe") or {}
        attempts = probe.get("attempts") or []
        endpoints = ", ".join(
            f"{fmt_num(item.get('total_ms'))} ms ({'ok' if item.get('success') else item.get('error_category')})"
            for item in attempts
        ) or "—"
        lines.append(f"| {bucket.get('length_codepoints')} | {probe.get('status')} | {len(attempts)} | {endpoints} |")
    lines += [
        "",
        "Historical 800 watchdog evidence is listed above and was not re-probed. 1000 and 1200 were not included in the V2 execution scope.",
        "",
        "## Production matrix — 25–600 codepoints",
        "",
        "All reported complete buckets require exactly 20 successful rows (10 A + 10 B). Incomplete buckets have null distributions, never fabricated percentiles.",
        "",
        "| chars | status | reason | success/attempts | endpoint p50/p95/max ms | model p50/p95/max ms | audio p50/p95/max ms | RTF p50/p95/max |",
        "| ---: | :--- | :--- | :---: | :--- | :--- | :--- | :--- |",
    ]
    for bucket in matrix_buckets:
        metrics = bucket.get("metrics") or {}
        lines.append(
            f"| {bucket.get('length_codepoints')} | {bucket.get('status')} | {bucket.get('reason') or '—'} | "
            f"{bucket.get('successful_samples')}/{bucket.get('attempts')} | "
            f"{triplet_n(metrics.get('total_ms'))} | {triplet_n(metrics.get('generate_or_model_ms'))} | "
            f"{triplet_n(metrics.get('audio_duration_ms'))} | {triplet_n(metrics.get('rtf'))} |"
        )
    stop = report.get("safety_stop_observation") or {}
    if stop:
        sample = stop.get("timed_out_sample") or {}
        post = stop.get("post_stop_runtime") or {}
        late = stop.get("post_saved_log_cursor_events") or []
        lines += [
            "",
            "## V2 matrix hard stop and post-stop verification",
            "",
            f"- Matrix stopped immediately on `{sample.get('fixture_id')}` at {fmt_num(sample.get('total_ms'))} ms with `{sample.get('error_category')}`; hard-stop reason `{stop.get('stop_reason')}`.",
            f"- Persisted matrix rows: {stop.get('matrix_rows_persisted')}; successful rows: {stop.get('matrix_successful_rows')}; failures: {stop.get('matrix_failures')}; no request was submitted after stop by the harness.",
            f"- Post-stop service: health `{post.get('health')}` (HTTP {post.get('health_http_status')}), PID/runs {post.get('pid')}/{post.get('runs')}, memory free {post.get('memory_free_percent')}%, current TTS footprint {fmt_bytes(post.get('physical_footprint_bytes'))}, lifetime peak {fmt_bytes(post.get('physical_footprint_peak_bytes'))}, swap free {fmt_bytes(post.get('swap_free_bytes'))}, route `{post.get('host_route_ready')}`. Restart: `{stop.get('production_service_restarted_after_stop')}`.",
            f"- A late log event after the saved matrix cursor was observed: `{late}`. Attribution is time-correlated only (the unchanged service has no request ID); it was not pooled as a successful client sample and no retry was sent.",
        ]
    lines += [
        "",
        "### Fixture-family summaries",
        "",
        "| chars | family | endpoint p50/p95/max ms | model p50/p95/max ms |",
        "| ---: | :---: | :--- | :--- |",
    ]
    for bucket in matrix_buckets:
        family_data = bucket.get("fixture_A_B") or {}
        for family in ("A", "B"):
            summary = family_data.get(family) or {}
            if not summary:
                continue
            lines.append(
                f"| {bucket.get('length_codepoints')} | {family} | "
                f"{triplet_n(summary.get('total_ms'))} | {triplet_n(summary.get('generate_or_model_ms'))} |"
            )
    lines += [
        "",
        "## Representative listening artifacts",
        "",
        "One actual measured fixture-A MP3 nearest that bucket's fixture-A type-7 p50 is selected. MP3/text/metadata stay in the protected external run root, not Git; hashes and exact pairing are verified before report generation.",
        "",
        "| chars | fixture | run index | endpoint ms | MP3 path | paired text | metadata |",
        "| ---: | :--- | ---: | ---: | :--- | :--- | :--- |",
    ]
    artifacts = (report.get("representative_listening_artifacts") or {}).get("artifacts", [])
    for item in artifacts:
        lines.append(
            f"| {item.get('length')} | {item.get('fixture_id')} | {item.get('fixture_run_index')} | "
            f"{fmt_num(item.get('total_ms'))} | `{item.get('logical_external_path')}` | "
            f"`{item.get('paired_text_path')}` | `{item.get('metadata_path')}` |"
        )
    listening_index = report.get("representative_listening_artifacts") or {}
    lines.append(
        f"\nVerified artifacts: {len(artifacts)} / {len(boundary.LENGTHS)} complete buckets. "
        f"Partial measured MP3s retained outside Git: {listening_index.get('partial_raw_audio_files_preserved', 0)}; "
        "no incomplete bucket was assigned a representative."
    )

    soak = report.get("sequential_soak") or {}
    lines += ["", "## Sequential soak", "",
              f"Status: `{soak.get('status', all_phases.get('soak', {}).get('status'))}`; reason: `{soak.get('reason', all_phases.get('soak', {}).get('reason'))}`.",
              "", "| chars | successes/attempts | p50/p95/max ms | first10 vs last10 p50 ms | max footprint | swap delta | min memory free | failures |",
              "| ---: | :---: | :--- | :--- | ---: | ---: | ---: | ---: |"]
    for length, item in sorted((soak.get("buckets") or {}).items(), key=lambda pair: int(pair[0])):
        lines.append(
            f"| {length} | {item.get('success')}/{item.get('attempts')} | {triplet_n(item.get('total_ms'))} | "
            f"{fmt_num(item.get('first_10_total_p50_ms'))} / {fmt_num(item.get('last_10_total_p50_ms'))} | "
            f"{fmt_bytes(item.get('max_physical_footprint_bytes'))} | {fmt_bytes(item.get('swap_delta_bytes'))} | "
            f"{item.get('minimum_memory_free_percent')}% | {item.get('failure')} |"
        )

    contention = report.get("queue_contention") or {}
    lines += ["", "## Bounded-queue contention", "",
              f"Status: `{(contention.get('summary') or {}).get('status', (contention.get('phase') or {}).get('status'))}`; "
              f"bursts: 10 per length; 3 simultaneous requests per burst; unchanged one-worker/one-pending/5s admission policy.",
              "", "| chars | bursts | HTTP 200 | 503 tts_busy | unexpected | successful latency p50/p95/max ms | rejected latency p50/p95/max ms |",
              "| ---: | ---: | ---: | ---: | ---: | :--- | :--- |"]
    for length, item in sorted((contention.get("by_length") or {}).items(), key=lambda pair: int(pair[0])):
        lines.append(
            f"| {length} | {item.get('bursts_observed')} | {item.get('http_200')} | {item.get('http_503_tts_busy')} | "
            f"{item.get('unexpected_responses')} | {triplet_n(item.get('success_latency_ms'))} | "
            f"{triplet_n(item.get('rejected_latency_ms'))} |"
        )

    pre = anchors_report.get("pre") or {}
    post = anchors_report.get("post") or {}
    change = anchors_report.get("post_p50_change_vs_pre")
    lines += ["", "## Post-stress recovery anchor", "",
              "| anchor | successes/attempts | endpoint p50/p95/max ms | PID | memory free | swap used | footprint |",
              "| :--- | :---: | :--- | ---: | ---: | ---: | ---: |"]
    for label, item in (("pre", pre), ("post", post)):
        before, after = item.get("host_before") or {}, item.get("host_after") or {}
        lines.append(
            f"| {label} | {item.get('success')}/{item.get('attempts')} | {triplet_n(item.get('total_ms'))} | "
            f"{(after or before).get('pid')} | {(after or before).get('memory_free_percent')}% | "
            f"{fmt_bytes((after or before).get('swap_used_bytes'))} | "
            f"{fmt_bytes((after or before).get('physical_footprint_bytes'))} |"
        )
    lines.append("Post-stress median change: " +
                 (f"{fmt_num(change.get('absolute_ms'))} ms ({fmt_num(change.get('relative_percent'))}%)" if change else "not comparable/incomplete") +
                 ". No automatic restart/eviction policy is inferred.")

    memory = report.get("memory_observations") or {}
    lines += ["", "## Memory, swap, and footprint observations", "",
              f"- Matrix point-sampled TTS footprint max {fmt_bytes(memory.get('matrix_max_sampled_physical_footprint_bytes'))}; process lifetime peak {fmt_bytes(memory.get('maximum_observed_process_lifetime_footprint_peak_bytes'))}; RSS max {fmt_bytes(memory.get('matrix_max_sampled_rss_bytes'))}.",
              f"- Matrix system memory-free minimum {memory.get('matrix_min_system_memory_free_percent')}%; swap used min/max {fmt_bytes(memory.get('matrix_swap_min_bytes'))} / {fmt_bytes(memory.get('matrix_swap_max_bytes'))}.",
              f"- Preflight/anchor memory-free minimum {memory.get('preflight_min_system_memory_free_percent')}%; swap used min/max {fmt_bytes(memory.get('preflight_swap_min_bytes'))} / {fmt_bytes(memory.get('preflight_swap_max_bytes'))}.",
              f"- Passive confirmation episodes: {memory.get('swap_growth_confirmation_episode_count', 0)}; individual 30-second confirmation snapshots: {memory.get('swap_growth_confirmation_snapshot_count', 0)}. Full sanitized telemetry is retained in the protected run root and summarized in the JSON.",
              "- `vmmap` footprint and host `vm.swapusage` are point/system-wide measurements, not per-request Metal allocation or per-process swap attribution; short-lived peaks between observations may be missed.",
              "",
              "## Phase status", "",
              "| phase | status | reason |", "| :--- | :--- | :--- |"]
    for phase, item in all_phases.items():
        lines.append(f"| {phase} | {item.get('status')} | {item.get('reason') or '—'} |")
    lines += ["", "## Limitations and disposition", ""]
    lines.extend(f"- {item}" for item in report.get("known_limitations", []))
    lines += [
        "- This is one host/configuration and synthetic Japanese text, not real WhatsApp traffic or an SLA sample.",
        "- Contention success/rejection latency is client-observed; the unchanged service has no per-request identifier, so log correlation is burst-level.",
        "- No final production hard limit, segmentation rule, warning threshold, or lifecycle policy is selected. Results are for owner review only.",
        "",
    ]
    return report, "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the aggregate report and JSON under docs/reports")
    parser.add_argument("--run-root", type=Path, required=True)
    parser.add_argument("--related-attempt-root", type=Path, action="append", default=[],
                        help="separate protected attempt to document without pooling into primary statistics; repeatable")
    args = parser.parse_args()
    root = args.run_root.resolve()
    if root == ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")
    related_roots = []
    for candidate in args.related_attempt_root:
        related = candidate.resolve()
        if (candidate.is_symlink() or related == ROOT or ROOT in related.parents or
                not str(related).startswith("/Volumes/Avalon/")):
            raise ValueError("protected_external_related_attempt_root_required")
        if not related.is_dir() or related.is_symlink() or related.stat().st_mode & 0o077:
            raise ValueError("private_related_attempt_root_required")
        related_roots.append(related)
    report, markdown = build_document(root, related_roots)
    print(f"COMPLETE_LENGTHS={sum(1 for b in report['matrix_buckets'] if b['status']=='complete')}/{len(boundary.LENGTHS)}")
    print(f"LISTENING_ARTIFACTS={len(report['representative_listening_artifacts'].get('artifacts', []))}")
    if not args.apply:
        print("REPORT=plan_only; --apply required to write aggregate docs")
        return
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text(markdown, encoding="utf-8")
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("REPORT_WRITTEN=" + str(REPORT_MD.relative_to(ROOT)))
    print("DATA_WRITTEN=" + str(REPORT_JSON.relative_to(ROOT)))
    print("PRODUCTION_CONFIGURATION=unchanged; no boundary policy recommendation")


if __name__ == "__main__":
    main()
