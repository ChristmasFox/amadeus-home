#!/usr/bin/env python3
"""Finalize a protected matrix phase stopped for memory pressure without sending more TTS."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import hashlib
import subprocess

ROOT=Path(__file__).resolve().parents[2]
APP=Path(__file__).resolve().parent
sys.path.insert(0,str(APP))
import production_boundary as boundary
from production_boundary_benchmark import read_jsonl, private_json, append_runtime_state
from production_boundary_runtime import appended_log_events, healthz, launchd_state, runtime_snapshot


def read_private(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("protected_stop_evidence_required:"+path.name)
    return json.loads(path.read_text())


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",help="record the already-observed stop and freeze the phase")
    parser.add_argument("--run-root",type=Path,required=True)
    parser.add_argument("--reported-free-percent",type=int,required=True)
    parser.add_argument("--reported-swap-total-mib",type=float,required=True)
    parser.add_argument("--reported-swap-used-mib",type=float,required=True)
    parser.add_argument("--reported-swap-free-mib",type=float,required=True)
    args=parser.parse_args()
    if not args.apply:
        print("MATRIX_STOP_RECORD=plan_only; --apply required")
        return
    root=args.run_root.resolve()
    if root==ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode&0o077:
        raise ValueError("private_run_root_required")
    start=read_private(root/"phase-matrix.start.json")
    if (root/"phase-matrix.complete.json").exists() or (root/"matrix-summary.json").exists():
        raise FileExistsError("matrix_phase_already_finalized")
    control=read_private(root/"control-manifest.json")
    run=read_private(root/"run-manifest.json")
    probe=read_private(root/"probe-summary.json")
    schedule=json.loads((root/"schedule.json").read_text())
    if boundary.schedule_sha256(schedule)!=run.get("schedule_sha256"):
        raise ValueError("schedule_hash_mismatch")
    process_list=subprocess.run(["ps","-Ao","args"],capture_output=True,text=True,check=False).stdout
    if "production_boundary_benchmark.py measure" in process_list:
        raise RuntimeError("benchmark_process_still_active")
    rows=read_jsonl(root/"matrix.jsonl")
    if len(rows)!=1 or rows[0].get("length")!=200 or rows[0].get("family")!="A" or rows[0].get("success") is not True:
        raise ValueError("unexpected_persisted_matrix_rows_at_stop")
    expected=schedule[0]
    if expected.get("length")!=200 or expected.get("family")!="A" or expected.get("fixture_run_index")!=0:
        raise ValueError("unexpected_first_matrix_schedule_item")
    partial_schedule=schedule[1]
    if partial_schedule.get("length")!=200 or partial_schedule.get("family")!="B" or partial_schedule.get("fixture_run_index")!=0:
        raise ValueError("unexpected_partial_matrix_schedule_item")
    partial_audio=root/"audio/200/B-00.mp3"
    if partial_audio.is_symlink() or not partial_audio.is_file() or partial_audio.stat().st_mode&0o077:
        raise ValueError("expected_private_partial_response_audio_missing")
    audio=partial_audio.read_bytes()
    if not (audio.startswith(b"ID3") or audio[:1]==b"\xff"):
        raise ValueError("partial_response_is_not_valid_mp3")
    state=read_private(root/"runtime-state.json")
    log=Path.home()/"Library/Logs/Amadeus/qwen3-tts.log"
    old_offset=int(state.get("last_log_offset",-1))
    events,markers,end=appended_log_events(log,old_offset)
    if markers or len(events)!=1 or events[0].get("type")!="success":
        raise RuntimeError("partial_response_log_correlation_is_not_unique")
    metrics=events[0].get("metrics") or {}
    fixture_sha=boundary.load_fixture_manifest()[0][200]["B"]["text_sha256"]
    after=runtime_snapshot()
    expected_pid=(control.get("runtime",{}).get("launchd") or {}).get("pid")
    if after.get("health",{}).get("status")!="ready" or after.get("health",{}).get("http_status")!=200:
        raise RuntimeError("production_health_not_ready_after_matrix_stop")
    if (after.get("launchd",{}).get("pid")!=expected_pid or after.get("launchd",{}).get("runs")!=(control.get("runtime",{}).get("launchd") or {}).get("runs")):
        raise RuntimeError("launchagent_changed_after_matrix_stop")
    btext=boundary.load_fixture_manifest()[0][200]["B"]["text"].encode("utf-8")
    stop={
        "phase":"matrix","status":"stopped","reason":"operator-interrupted matrix after a concurrent live snapshot showed 10% memory free and 563.44 MiB free swap during post-request confirmation",
        "observed_free_percent":args.reported_free_percent,
        "observed_swap_total_mib":args.reported_swap_total_mib,
        "observed_swap_used_mib":args.reported_swap_used_mib,
        "observed_swap_free_mib":args.reported_swap_free_mib,
        "observed_at_exact_timestamp_available":False,
        "phase_start_utc":start.get("started_utc"),
        "stop_recorded_utc":datetime.now(timezone.utc).isoformat(),
        "schedule_sha256":run.get("schedule_sha256"),
        "fixture_manifest_sha256":run.get("fixture_manifest_sha256"),
        "persisted_matrix_rows":len(rows),
        "persisted_successful_rows":sum(1 for x in rows if x.get("success")),
        "partial_response":{"fixture_id":"B-200","schedule_order_index":partial_schedule["order_index"],
            "fixture_run_index":0,"service_success_log_event_count":1,"http_200_inferred_from_validated_mp3_body":True,
            "client_total_ms":None,"model_metrics_from_service_log":metrics,
            "mp3_relative_path":"audio/200/B-00.mp3","mp3_bytes":len(audio),
            "mp3_sha256":hashlib.sha256(audio).hexdigest(),"fixture_text_sha256":hashlib.sha256(btext).hexdigest(),
            "representative":False,"percentile_eligible":False},
        "service_after_stop":{"health":after.get("health"),"launchd":after.get("launchd"),
            "memory_pressure":after.get("memory_pressure"),"swap":after.get("swap"),"process":after.get("process")},
        "additional_tts_requests_after_stop":0,
        "note":"The unchanged endpoint emitted no request ID. The single success log event and the saved fixture-B MP3 match the one scheduled B-200 request after the persisted A-200 row; client endpoint timing was not durably recorded, so it is excluded from all statistics.",
    }
    stop_path=root/"post-matrix-safety-stop.json"
    if stop_path.exists(): raise FileExistsError("matrix_safety_stop_already_recorded")
    private_json(stop_path,stop)
    print("MATRIX_STOP_OBSERVATION=recorded_private_0600")
    print("PERSISTED_ROWS=1 (A-200); partial B-200 MP3 response preserved outside Git")
    print("STOP_AT=200-codepoint matrix batch after memory-pressure observation")
    print("SERVICE=ready; same PID; no further TTS requests submitted")

if __name__=="__main__":main()
