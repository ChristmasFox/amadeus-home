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

REPORT_MD = ROOT / "docs/reports/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.md"
REPORT_JSON = ROOT / "docs/reports/data/AMADEUS_TTS_BOUNDARY_STRESS_2026_09.json"


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
    return {
        "swap_growth_check": snapshot.get("swap_growth_check"),
        "health": (snapshot.get("health", {}) or {}).get("status"),
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
        "memory_free_percent": pressure.get("free_percent"),
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
        complete = declared_status == "complete" and len(bucket_rows) == 20 and len(success_rows) == 20
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
            if declared_status:
                status = declared_status
            elif probe_status == "passed" and not matrix_file_present:
                status = "probe-passed-matrix-not-run"
            else:
                status = probe_status
        reason = declared.get("reason") or p.get("reason")
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
        for b in buckets if b["status"] in ("safety-incomplete", "not_probed_after_stop", "incomplete")
    ]
    matrix_not_run = [
        {"length": b["length_codepoints"], "status": b["status"], "reason": b.get("reason")}
        for b in buckets if b["status"] == "probe-passed-matrix-not-run"
    ]
    probe_failures = [r for r in probe_rows if not r.get("success")]
    memory_rows = [r for r in rows if r.get("host_before") or r.get("host_after")]
    snapshots = []
    for row in memory_rows:
        snapshots.extend([row.get("host_before"), row.get("host_after")])
    snapshots = [s for s in snapshots if isinstance(s, dict)]
    all_footprints = [s.get("process", {}).get("physical_footprint_bytes") for s in snapshots]
    all_footprints = [v for v in all_footprints if isinstance(v, int)]
    all_rss = [s.get("process", {}).get("rss_bytes") for s in snapshots]
    all_rss = [v for v in all_rss if isinstance(v, int)]
    all_free = [s.get("memory_pressure", {}).get("free_percent") for s in snapshots]
    all_free = [v for v in all_free if isinstance(v, int)]
    all_swaps = [s.get("swap", {}).get("used_bytes") for s in snapshots]
    all_swaps = [v for v in all_swaps if isinstance(v, int)]
    swap_checks = [s.get("swap_growth_check") for s in snapshots if isinstance(s.get("swap_growth_check"), dict)]
    for check in swap_checks:
        if isinstance(check.get("confirmation_swap_used_bytes"), int):
            all_swaps.append(check["confirmation_swap_used_bytes"])
        if isinstance(check.get("confirmation_memory_free_percent"), int):
            all_free.append(check["confirmation_memory_free_percent"])
        if isinstance(check.get("confirmation_physical_footprint_bytes"), int):
            all_footprints.append(check["confirmation_physical_footprint_bytes"])
    pre_anchor_raw_rows = read_jsonl(root / "anchors" / "samples.jsonl")
    preflight_snapshots = [s for r in (probe_rows + pre_anchor_raw_rows)
                           for s in (r.get("host_before"), r.get("host_after")) if isinstance(s, dict)]
    preflight_footprints = [s.get("process", {}).get("physical_footprint_bytes") for s in preflight_snapshots]
    preflight_footprints = [v for v in preflight_footprints if isinstance(v, int)]
    preflight_rss = [s.get("process", {}).get("rss_bytes") for s in preflight_snapshots]
    preflight_rss = [v for v in preflight_rss if isinstance(v, int)]
    preflight_free = [s.get("memory_pressure", {}).get("free_percent") for s in preflight_snapshots]
    preflight_free = [v for v in preflight_free if isinstance(v, int)]
    preflight_swaps = [s.get("swap", {}).get("used_bytes") for s in preflight_snapshots]
    preflight_swaps = [v for v in preflight_swaps if isinstance(v, int)]
    preflight_swap_checks = [s.get("swap_growth_check") for s in preflight_snapshots if isinstance(s.get("swap_growth_check"), dict)]
    memory = {
        "baseline_before_stress": snapshot_public(control.get("runtime")),
        "swap_growth_confirmation_observations": swap_checks,
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
    stop_observation = read_private(root / "post-safety-stop-observation.json", optional=True)
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

    report = {
        "schema_version": 1,
        "additional_preserved_attempts": related_attempts,
        "goal_status": "incomplete-safety-stopped" if probe_stopped_at is not None and not complete_lengths else "incomplete",
        "report_generated_utc": datetime.now(timezone.utc).isoformat(),
        "control_id": boundary.CONTROL_ID,
        "control": {
            "git_commit": control.get("git_commit"),
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
            "9router_host_tts_health_route": control.get("9router_host_tts_health_route"),
            "production_configuration_changed_by_goal": control.get("production_configuration_changed_by_goal"),
        },
        "fixture_manifest_sha256": fixture_sha,
        "schedule_seed": run.get("schedule_seed"),
        "schedule_sha256": schedule_sha,
        "schedule_rows": len(schedule),
        "predecessor_preflight_attempt": run.get("predecessor_preflight_attempt"),
        "prior_preflight_attempt_chain": run.get("predecessor_preflight_attempt", {}).get("prior_attempt_chain", []),
        "same_value_recovery_checkpoint": run.get("same_value_recovery_checkpoint"),
        "safety_stop_guards": run.get("safety_stop_guards", {}),
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
        "phase_status": {phase: phase_info(root, phase) for phase in
                         ("warmup", "anchor-pre", "probes", "matrix", "soak", "contention", "recovery")},
        "known_limitations": [
            "This is one host, one protected voice profile, one selected MLX model revision, Auto Japanese fixtures, and MP3 endpoint responses.",
            "The workload is a controlled synthetic benchmark and not real WhatsApp user traffic or a production SLA sample.",
            "The unchanged MLX HTTP service does not expose separate Metal-driver allocation counters; physical footprint/RSS are point-sampled process/host proxies, not direct Metal allocation traces.",
            "Model/decode work is exposed as generate_or_model_ms; the current MLX API does not provide a separate decode-stage boundary.",
            "The experimental 110-second watchdog is below the unchanged 120-second OpenClaw timeout.",
            "The report does not select a MAX_TEXT value, preferred spoken length, warning threshold, segmentation policy, or lifecycle policy.",
        ],
        "decision_input_only": {
            "routine_anchor_length": 150,
            "extended_anchor_length": 320 if 320 in complete_lengths else None,
            "highest_p95_to_p50_ratios": high_dispersion,
            "safety_incomplete_buckets": safety_incomplete,
            "final_production_boundary_decision": "deferred to owner review; no policy recommendation",
        },
    }

    lines = [
        "# Amadeus TTS — Production Boundary & Stress Characterization",
        "",
        f"Generated: {report['report_generated_utc']}<br>",
        f"Control: `{boundary.CONTROL_ID}`<br>",
        "Result type: controlled measurement only; production TTS configuration and policy were not changed.",
        f"Overall Goal status: **{report['goal_status']}**. No complete Phase C length matrix exists in this attempt.",
        "",
        "## Control group",
        "",
        f"- Canonical source: `{control.get('git_commit')}` / Amadeus `{control.get('version')}`.",
        f"- Service source SHA-256: `{control.get('service_source_sha256')}`.",
        f"- Engine config SHA-256: `{control.get('engine_source_config_sha256')}`; MLX model/dependency revisions are recorded below.",
        f"- Engine/profile/language: `{control.get('engine')}` / `{control.get('voice_profile_id')}` / `{control.get('language')}`; active `libmlx` mapping verified, protected A reference verified unchanged against the private baseline.",
        f"- Scheduling/format: loaded launchd spawn type `{control.get('launchd_spawn_type')}` (`{control.get('launchd_process_type')}`) / `{control.get('response_format')}`; workers={control.get('workers')}, pending={control.get('pending_slots')}, admission wait={control.get('pending_start_timeout_s')}s.",
        f"- LaunchAgent disk plist valid at this control capture: `{control.get('disk_plist_valid_at_capture')}`. Same-value recovery checkpoint: `{(run.get('same_value_recovery_checkpoint') or {}).get('checkpoint_root_basename', 'none')}`; no engine/model/profile/timeout/worker/output-limit parameter changed.",
        f"- OpenClaw live TTS timeout={control.get('openclaw_external_timeout_ms')}ms; service ceiling=`MAX_TEXT={control.get('max_text_codepoints')}` codepoints.",
        f"- Host: {control.get('mac_model_identifier')}, {control.get('unified_memory')}, macOS {control.get('macos_version')}; baseline LaunchAgent PID={((control.get('runtime') or {}).get('launchd') or {}).get('pid')}, state={((control.get('runtime') or {}).get('launchd') or {}).get('state')}, `/healthz`={((control.get('runtime') or {}).get('health') or {}).get('status')}.",
        f"- Baseline swap used: {fmt_bytes(((control.get('runtime') or {}).get('swap') or {}).get('used_bytes'))}; system memory free: {((control.get('runtime') or {}).get('memory_pressure') or {}).get('free_percent')}%.",
        f"- 9Router→host TTS health route: `{control.get('9router_host_tts_health_route')}`. The protected profile is reported only as verified unchanged; reference bytes/text and hashes are not published.",
        "",
        "## Fixture and statistical contract",
        "",
        f"- Public synthetic fixture manifest SHA-256: `{fixture_sha}`; schedule seed `{run.get('schedule_seed')}`, SHA-256 `{schedule_sha}`.",
        "- Input length is Python Unicode codepoints (`len(text)`). Each target has fixed fixture A and B; both were validated at their exact declared length.",
        f"- Matrix design: five cycles × two fixture families × two repetitions per cycle = 20 measured requests per complete length; {boundary.QUIET_INTERVAL_S:.1f}s quiet interval; three 50-character A warmups excluded.",
        f"- Quantiles: {boundary.QUANTILE_METHOD}. p95 is descriptive for n=20, not an SLA or a high-confidence production tail estimate.",
        "- Runtime-log correlation records numeric timings only. Any uncontrolled concurrent TTS log event stops or invalidates the affected phase; request text is never logged.",
        "",
        "## Preserved preflight attempt history",
        "",
    ]
    predecessor = run.get("predecessor_preflight_attempt")
    attempt_chain = list(run.get("prior_preflight_attempt_chain") or [])
    if predecessor:
        attempt_chain.append(predecessor)
    if attempt_chain:
        lines.append("Earlier preflight attempts are preserved separately and are excluded from every quantile:")
        for attempt in attempt_chain:
            idle = attempt.get("idle_observation_after_stop") or {}
            lines.append(f"- `{attempt.get('run_root_basename')}` stopped during an excluded 50-character A warmup: `{attempt.get('stop_reason')}`; successful warmups={attempt.get('successful_excluded_warmups')}; anchor/matrix samples={attempt.get('matrix_or_anchor_samples_collected', 0)}; first sample swap delta={fmt_bytes(attempt.get('first_warmup_swap_delta_bytes'))}.")
            if idle:
                lines.append(f"  Later idle observation: swap delta from that run's control={fmt_bytes(idle.get('swap_delta_from_prior_control_bytes'))}, memory free={idle.get('memory_free_percent')}%, health={(idle.get('health') or {}).get('status')}, PID={idle.get('launchd_pid')}.")
        repair = run.get("same_value_recovery_checkpoint")
        if repair:
            lines.append(f"- Between attempts, an explicitly authorized same-value LaunchAgent plist repair was applied and verified from checkpoint `{repair.get('checkpoint_root_basename')}`; PID {repair.get('pre_repair_pid')}→{repair.get('post_repair_pid')}, same MLX/Interactive settings, no TTS parameter change.")
        lines.append(f"- The primary measurement run is a fresh protected attempt with the same fixture/schedule hashes (`{run.get('fixture_manifest_sha256')}`, `{run.get('schedule_sha256')}`) and its own captured control; predecessor warmups are not merged.")
        lines.append("")
    else:
        lines.append("No earlier preflight attempt is linked to this run.")
    if related_attempts:
        lines += ["## Additional protected attempts (excluded from primary statistics)", "",
                  "These separately captured runs use the same fixture, schedule, and verified production configuration. They are preserved as attempt history only; no warmup or partial row is pooled into matrix percentiles.", "",
                  "| run | stop phase/reason | excluded warmups (endpoint ms) | min memory free | max observed swap growth from control | min free swap | idle confirmation cap | anchor/matrix rows |",
                  "| :--- | :--- | :--- | ---: | ---: | ---: | ---: | :--- |"]
        for attempt in related_attempts:
            warmup = attempt["warmup"]
            resources = attempt["resource_observations"]
            times = ", ".join(fmt_num(v) for v in warmup["successful_endpoint_ms_excluded"]) or "—"
            stop = (f"{attempt['stopped_phase']}: `{attempt['stop_reason']}`" if attempt.get("stopped_phase")
                    else "no safety stop recorded")
            guards = attempt.get("safety_stop_guards") or {}
            idle_cap = f"{guards.get('swap_growth_max_confirmation_windows', '—')} × {guards.get('swap_growth_confirmation_window_s', '—')}s"
            lines.append(
                f"| `{attempt['run_root_basename']}` | {stop} | {warmup['successful']}/{warmup['attempts']} ({times}; excluded) | "
                f"{resources['min_memory_free_percent'] if resources['min_memory_free_percent'] is not None else '—'}% | "
                f"{fmt_bytes(resources['max_observed_swap_growth_bytes'])} | {fmt_bytes(resources['min_observed_swap_free_bytes'])} | {idle_cap} | "
                f"anchor {attempt['anchor_pre_successful_samples']}; matrix {attempt['matrix_successes']}/{attempt['matrix_attempts']} |"
            )
        for attempt in related_attempts:
            discrepancy = attempt.get("stop_marker_discrepancy")
            if discrepancy:
                lines.append(
                    f"- Stop-marker label mismatch for `{attempt['run_root_basename']}`: recorded reason says "
                    f"{discrepancy['marker_text_threshold_mib']} MiB, but its manifest configured 512 MiB and "
                    f"the lowest persisted free-swap observation was {fmt_bytes(discrepancy['observed_min_free_swap_bytes'])}. "
                    "The original marker is preserved; the runtime reason label is corrected for future runs."
                )
        lines.append("")
    lines += [
        "## Safety stop and production recovery",
        "",
    ]
    stop_phase = phase_info(root, "probes")
    if stop_observation:
        lines += [
            f"- Phase B stopped at {stop_observation.get('stopped_at_codepoints')} codepoints after the {stop_observation.get('client_watchdog_s')}-second experimental watchdog; no larger safety probes were sent.",
            f"- The 800-character fixture-A probe recorded {fmt_num(stop_observation.get('probe_total_ms'))} ms from the client and `{stop_observation.get('probe_error')}`. A later service `RuntimeError` log was observed; because the unchanged service has no request ID, attribution is time-correlated rather than exact.",
        ]
    if matrix_stop_public:
        job=matrix_stop_public.get("post_stop_service") or {}
        lines += [
            f"- Phase C then sampled only the preflight-passed set. It was stopped during the scheduled 200-character A/B batch after a live snapshot showed {matrix_stop_public.get('observed_free_percent_at_operator_stop')}% system memory free and {fmt_num(matrix_stop_public.get('observed_swap_free_mib_at_operator_stop'))} MiB swap free. The harness was interrupted before issuing any more requests.",
            f"- Matrix rows persisted: {matrix_stop_public.get('persisted_matrix_rows')}; a second B-200 MP3 response existed but its client latency row was not committed. Both 200-character point observations are excluded from percentiles and representative selection.",
            f"- The process-lifetime vmmap footprint peak after the stop was {fmt_bytes((matrix_stop_public.get('post_stop_service') or {}).get('physical_footprint_peak_bytes'))}; this is a high-water mark, not an 800-character attribution.",
            f"- Post-stop service state: `/healthz` `{job.get('health')}`, PID {job.get('pid')}, LaunchAgent runs {job.get('launchd_runs')}, memory free {job.get('memory_free_percent')}%, swap free {fmt_bytes(job.get('swap_free_bytes'))}, physical footprint {fmt_bytes(job.get('physical_footprint_bytes'))}, process peak {fmt_bytes(job.get('physical_footprint_peak_bytes'))}. No service restart and no additional TTS request followed the stop.",
            "",
            "### Partial matrix points (not percentiles)",
            "",
            "| length | fixture | client total ms | model ms | audio ms | RTF | eligibility |",
            "| ---: | :--- | ---: | ---: | ---: | ---: | :--- |",
        ]
        for point in partial_matrix_points:
            lines.append(f"| {point['length']} | {point['family']} | {fmt_num(point.get('client_total_ms'))} | {fmt_num(point.get('generate_or_model_ms'))} | {fmt_num(point.get('audio_duration_ms'))} | {fmt_num(point.get('rtf'),3)} | excluded; not representative |")
        lines += ["", "The B-200 audio bytes remain in the protected external run directory only to preserve stop evidence; they are not published or indexed as a listening sample.", ""]
    else:
        lines.append(f"Probe-phase status: `{stop_phase.get('status')}`; reason: {stop_phase.get('reason') or 'none'}. No post-stop observation was captured.")
        lines.append("")
    lines += [
        "## Single safety-probe observations (excluded from quantiles)",
        "",
        "These are one-time ascending preflight points, not matrix samples, not p50/p95/max, and not representative listening artifacts.",
        "",
        "| chars | probe status | attempt | HTTP | client ms | model ms | audio ms | RTF | result/reason |",
        "| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
    ]
    observation_by_length = {}
    for point in probe_observations:
        observation_by_length.setdefault(point['length_codepoints'], []).append(point)
    for length in boundary.LENGTHS:
        bucket = next(b for b in buckets if b['length_codepoints'] == length)
        points = observation_by_length.get(length, [])
        if not points:
            lines.append(f"| {length} | {bucket['probe'].get('status')} | — | — | — | — | — | — | {bucket.get('reason') or 'not probed'} |")
            continue
        for index, point in enumerate(points, 1):
            result = point.get('error_category') or ('success' if point.get('success') else 'failed')
            lines.append(f"| {length} | {bucket['probe'].get('status')} | {index} | {point.get('http_status') or '—'} | "
                         f"{fmt_num(point.get('endpoint_total_ms'))} | {fmt_num(point.get('generate_or_model_ms'))} | "
                         f"{fmt_num(point.get('audio_duration_ms'))} | {fmt_num(point.get('rtf'), 3)} | {result} |")
    lines += ["", "## Production length matrix", "",
        "Times are milliseconds; audio duration is milliseconds; RTF is unitless. Incomplete buckets have no reported percentile.",
        "",
        "| chars | status | success/attempts (failure rate) | endpoint p50 / p95 / max | model p50 / p95 / max | audio p50 / p95 / max | RTF p50 / p95 / max |",
        "| ---: | :--- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for b in buckets:
        m = b["metrics"]
        n = b["successful_samples"]
        total = fmt_triplet(m.get("total_ms"), " ms") if b["status"] == "complete" else "not reported"
        model = fmt_triplet(m.get("generate_or_model_ms"), " ms") if b["status"] == "complete" else "not reported"
        audio = fmt_triplet(m.get("audio_duration_ms"), " ms") if b["status"] == "complete" else "not reported"
        rtf = fmt_triplet(m.get("rtf")) if b["status"] == "complete" else "not reported"
        rate = f"{100*b['failure_rate']:.1f}%" if b.get("failure_rate") is not None else "—"
        lines.append(f"| {b['length_codepoints']} | {b['status']} | {n}/{b['attempts']} ({rate}) | {total} | {model} | {audio} | {rtf} |")
    lines += ["", "For complete rows, each triplet uses n=20 successful samples and type-7 quantiles. Failure rates are reported separately; failed requests are not mixed into successful percentiles.", "",
              "### A/B fixture family results", "",
              "Endpoint/model medians and descriptive p95 are shown by family for every complete bucket.", "",
              "| chars | A endpoint p50/p95 ms | B endpoint p50/p95 ms | A model p50/p95 ms | B model p50/p95 ms |",
              "| ---: | ---: | ---: | ---: | ---: |"]
    for b in buckets:
        if b["status"] != "complete":
            continue
        families = b["fixture_A_B"]
        vals=[]
        for family in ("A", "B"):
            total = families[family]["total_ms"]
            model = families[family]["generate_or_model_ms"]
            vals += [f"{fmt_num(total['p50'])}/{fmt_num(total['p95'])}", f"{fmt_num(model['p50'])}/{fmt_num(model['p95'])}"]
        lines.append(f"| {b['length_codepoints']} | {vals[0]} | {vals[2]} | {vals[1]} | {vals[3]} |")
    lines += ["", "## Safety probes and representative listening artifacts", "",
              "Safety probes are excluded from quantiles. No percentile is fabricated for a failed or safety-incomplete bucket.", "",
              "| chars | safety-probe status | attempts / reason | listening artifact | selected A run |",
              "| ---: | :--- | :--- | :--- | ---: |"]
    listen_by_len = {a["length"]: a for a in listening.get("artifacts", [])}
    for b in buckets:
        p = b["probe"]
        reason = b.get("reason") or (p.get("attempts", [{}])[-1].get("error_category") if p.get("attempts") else "—")
        artifact = listen_by_len.get(b["length_codepoints"])
        lines.append(f"| {b['length_codepoints']} | {p.get('status')} | {len(p.get('attempts', []))} / {reason or '—'} | "
                     f"{artifact['logical_external_path'] if artifact else '—'} | {artifact['fixture_run_index'] if artifact else '—'} |")
    lines += ["", ("No Phase C bucket completed in this safety-stopped run; no representative MP3/text pair was produced. The protected index explicitly lists the incomplete lengths." if not complete_lengths else "The representative is the exact MP3 response from the measured Phase C HTTP request: among the 10 successful fixture-A samples, choose the sample nearest the fixture-A type-7 total-latency p50; tie-break on lower run index. Paired UTF-8 text and metadata are stored next to each MP3 outside Git. The external index covers every complete length and no other sample is labeled representative."), "",
              "## Sustained sequential soak", ""]
    if soak_summary.get("status") == "complete":
        lines += ["Thirty back-to-back requests were run per listed length without restarting the model. A/B fixtures alternated deterministically.", "",
                  "| chars | success/attempts | total p50/p95/max ms | first 10 vs last 10 p50 ms | max footprint | max RSS | swap delta | min memory free | launchd runs start→end |",
                  "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for length in soak_summary.get("lengths", []):
            s = soak_summary.get("buckets", {}).get(str(length), {})
            lines.append(f"| {length} | {s.get('success', 0)}/{s.get('attempts', 0)} | {fmt_triplet(s.get('total_ms'), ' ms')} | "
                         f"{fmt_num(s.get('first_10_total_p50_ms'))} → {fmt_num(s.get('last_10_total_p50_ms'))} | "
                         f"{fmt_bytes(s.get('max_physical_footprint_bytes'))} | {fmt_bytes(s.get('max_rss_bytes'))} | "
                         f"{fmt_bytes(s.get('swap_delta_bytes'))} | {s.get('minimum_memory_free_percent', '—')}% | "
                         f"{s.get('launchd_runs_start', '—')}→{s.get('launchd_runs_end', '—')} |")
        missing = soak_summary.get("missing_requested_lengths", [])
        if missing:
            lines.append("")
            lines.append("Not run because a required matrix bucket was incomplete: " + ", ".join(map(str, missing)) + ".")
        if soak_summary.get("extended_reason"):
            lines.append("Extended soak point: " + str(soak_summary.get("extended_length")) + " characters (" + str(soak_summary["extended_reason"]) + ").")
    else:
        lines.append(f"Status: {soak_summary.get('status', 'not_run')}; reason: {soak_summary.get('reason') or phase_info(root, 'soak').get('reason') or 'not available'}.")
    lines += ["", "## Bounded-queue contention", ""]
    if contention_by_length:
        lines += ["Ten bursts of three simultaneous requests were scheduled for each listed length. Acceptance concerns bounded behavior and recovery, not three successes.", "",
                  "| chars | bursts | HTTP 200 | 503 tts_busy | unexpected | success p50/p95/max ms | rejected p50/p95/max ms | health/log correlation |",
                  "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |"]
        for length, c in contention_by_length.items():
            lines.append(f"| {length} | {c['bursts_observed']} | {c['http_200']} | {c['http_503_tts_busy']} | {c['unexpected_responses']} | "
                         f"{fmt_triplet(c['success_latency_ms'], ' ms')} | {fmt_triplet(c['rejected_latency_ms'], ' ms')} | "
                         f"health={'ready' if c['service_health_after'] else 'not-ready'}; log={'matched' if c['log_correlations_ok'] else 'unmatched'} |")
    else:
        lines.append(f"Status: {contention_summary.get('status', 'not_run')}; reason: {contention_summary.get('reason') or phase_info(root, 'contention').get('reason') or 'not available'}.")
    lines += ["", "## Pre/post stress 50-character control", "",
              "Both anchors use the same fixture-A bytes, separate from the matrix. Warmups are excluded.", "",
              "| control | success/attempts | p50 ms | p95 ms | max ms | before footprint | after footprint | swap before→after | memory free before→after | PID before→after |",
              "| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :--- |"]
    for label, a in (("pre", pre_anchor), ("post", post_anchor)):
        m=a["total_ms"]; before=a.get("host_before") or {}; after=a.get("host_after") or {}
        lines.append(f"| {label} | {a['success']}/{a['attempts']} | {fmt_num(m.get('p50'))} | {fmt_num(m.get('p95'))} | {fmt_num(m.get('max'))} | "
                     f"{fmt_bytes(((before.get('process') or {}).get('physical_footprint_bytes')))} | {fmt_bytes(((after.get('process') or {}).get('physical_footprint_bytes')))} | "
                     f"{fmt_bytes(((before.get('swap') or {}).get('used_bytes')))} → {fmt_bytes(((after.get('swap') or {}).get('used_bytes')))} | "
                     f"{((before.get('memory_pressure') or {}).get('free_percent', '—'))}% → {((after.get('memory_pressure') or {}).get('free_percent', '—'))}% | "
                     f"{((before.get('launchd') or {}).get('pid', '—'))} → {((after.get('launchd') or {}).get('pid', '—'))} |")
    lines.append("")
    lines.append("Post-stress minus pre-stress median: " + (f"{recovery_change['absolute_ms']:.1f} ms ({recovery_change['relative_percent']:.1f}%)" if recovery_change else "not comparable; one or both anchors incomplete") + ". This is descriptive drift evidence, not an automatic restart/eviction trigger.")
    safety_guards = run.get("safety_stop_guards") or {}
    idle_windows = safety_guards.get("swap_growth_max_confirmation_windows", 4)
    idle_window_s = safety_guards.get("swap_growth_confirmation_window_s", 30)
    lines += ["", "## Memory and accounting caveats", "",
              f"- Baseline point sample: RSS {fmt_bytes(((control.get('runtime') or {}).get('process') or {}).get('rss_bytes'))}; physical footprint {fmt_bytes(((control.get('runtime') or {}).get('process') or {}).get('physical_footprint_bytes'))}; process-lifetime peak {fmt_bytes(((control.get('runtime') or {}).get('process') or {}).get('physical_footprint_peak_bytes'))}.",
              f"- Matrix observed max point-sampled physical footprint {fmt_bytes(memory['matrix_max_sampled_physical_footprint_bytes'])}, max RSS {fmt_bytes(memory['matrix_max_sampled_rss_bytes'])}, lowest system memory free {memory['matrix_min_system_memory_free_percent'] if memory['matrix_min_system_memory_free_percent'] is not None else '—'}%, swap min/max {fmt_bytes(memory['matrix_swap_min_bytes'])}/{fmt_bytes(memory['matrix_swap_max_bytes'])}.",
              f"- Preflight/anchor-only sampled max physical footprint {fmt_bytes(memory['preflight_point_sampled_max_physical_footprint_bytes'])}, max RSS {fmt_bytes(memory['preflight_point_sampled_max_rss_bytes'])}, minimum memory-free {memory['preflight_min_system_memory_free_percent'] if memory['preflight_min_system_memory_free_percent'] is not None else '—'}%, swap min/max {fmt_bytes(memory['preflight_swap_min_bytes'])}/{fmt_bytes(memory['preflight_swap_max_bytes'])}.",
              f"- Highest observed process-lifetime vmmap physical-footprint peak across control/preflight/stop observations: {fmt_bytes(memory['maximum_observed_process_lifetime_footprint_peak_bytes'])}.",
              "- Physical footprint and RSS were sampled around each HTTP request; a short-lived peak may be missed. The reported `vmmap` peak is cumulative since process start and cannot be attributed to an individual request.",
              f"- Swap-used is system-wide and encrypted; a high starting value can reflect workload before this study. Safety guards were memory-free below 10%, current footprint at/above 20 GiB, swap growth at/above 2 GiB immediately, free swap below 512 MiB, or growth at/above 512 MiB without a clear decline across up to {idle_windows} {idle_window_s}-second idle confirmations. A brief spike that retreats is recorded but not labeled runaway. These are experiment stop guards, not production policy.",
              "",
              "## Known limitations", ""]
    lines.extend(f"- {item}" for item in report["known_limitations"])
    lines += ["- No physical LAN peer was used for the direct loopback benchmark; the 9Router container-to-host `/healthz` route was verified before measurement and between major phases.",
              "- Contention success timings are client-observed per request; timing-log correlation is validated by event counts per burst because the unchanged production service has no per-request identifier.",
              "",
              "## Neutral decision inputs (measured facts only)", "",
              "- **Routine 150-character comparison point:** " + ("complete; total p50/p95/max=" + fmt_triplet(next((b['metrics']['total_ms'] for b in buckets if b['length_codepoints']==150 and b['status']=='complete'), None), " ms") if any(b['length_codepoints']==150 and b['status']=='complete' for b in buckets) else "not complete; see safety status above") + ". The separate 50-character pre/post control is listed above.",
              "- **Extended comparison point:** " + ("320 characters complete; total p50/p95/max=" + fmt_triplet(next((b['metrics']['total_ms'] for b in buckets if b['length_codepoints']==320 and b['status']=='complete'), None), " ms") if any(b['length_codepoints']==320 and b['status']=='complete' for b in buckets) else "320 was not complete; stress substitution, if any, is identified in the soak table") + ".",
              "- **Highest descriptive dispersion:** " + (", ".join(f"{x['length']} chars (p95/p50={x['p95_to_p50_ratio']:.2f})" for x in high_dispersion) if high_dispersion else "no complete bucket available") + ".",
              "- **Safety-incomplete/not-probed region:** " + (", ".join(f"{x['length']} chars: {x['status']} ({x.get('reason') or 'no complete matrix'}; {x['successful_samples']}/{x['attempts']} matrix successes)" for x in safety_incomplete) if safety_incomplete else "none") + ".",
              "- **Probe-passed but matrix not run:** " + (", ".join(f"{x['length']} chars" for x in matrix_not_run) if matrix_not_run else "none") + ". These single preflight points do not define a stable operating region.",
              "- These categories summarize the observed matrix only. **No final hard limit or production output-length policy is selected here.** Owner review of the tables and representative listening samples is the next decision point.",
              ""]
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
