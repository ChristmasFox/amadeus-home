#!/usr/bin/env python3
"""Select deterministic fixture-A listening samples while preserving partial safety evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_boundary as boundary


def read_private(path: Path, *, optional: bool = False):
    if optional and not path.exists():
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("private_evidence_file_required:" + path.name)
    return json.loads(path.read_text())


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="copy selected audio and prune temporary MP3s")
    parser.add_argument("--run-root", type=Path, required=True)
    args = parser.parse_args()
    root = args.run_root.resolve()
    if root == ROOT or ROOT in root.parents or not str(root).startswith("/Volumes/Avalon/"):
        raise ValueError("protected_external_run_root_required")
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("private_run_root_required")
    control = read_private(root / "control-manifest.json")
    run = read_private(root / "run-manifest.json")
    boundary.set_execution_lengths(run.get("executed_lengths", boundary.DEFAULT_V2_LENGTHS))
    summary = read_private(root / "matrix-summary.json", optional=True) or {"buckets": {}}
    probe_summary = read_private(root / "probe-summary.json", optional=True) or {"buckets": {}}
    stop_observation = read_private(root / "post-safety-stop-observation.json", optional=True) or {}
    timed_out_sample = stop_observation.get("timed_out_sample") or {}
    stop_length = timed_out_sample.get("length")
    fixtures, fixture_sha = boundary.load_fixture_manifest()
    if fixture_sha != control.get("fixture_manifest_sha256") or fixture_sha != run.get("fixture_manifest_sha256"):
        raise ValueError("fixture_manifest_changed_after_measurement")
    rows_path = root / "matrix.jsonl"
    if rows_path.exists() and (rows_path.is_symlink() or not rows_path.is_file() or rows_path.stat().st_mode & 0o077):
        raise ValueError("protected_matrix_rows_required")
    rows = [json.loads(line) for line in rows_path.read_text().splitlines() if line] if rows_path.exists() else []
    index: dict[str, object] = {
        "control_id": boundary.CONTROL_ID,
        "fixture_manifest_sha256": fixture_sha,
        "schedule_sha256": run["schedule_sha256"],
        "selection_rule": "fixture A only; type-7 p50 total_ms; nearest absolute distance; lower fixture_run_index breaks ties",
        "artifacts": [],
        "incomplete_buckets": [],
    }
    created = []
    complete_lengths: set[int] = set()
    for length in boundary.LENGTHS:
        bucket_status = summary.get("buckets", {}).get(str(length), {})
        probe_status = probe_summary.get("buckets", {}).get(str(length), {})
        bucket_rows = [r for r in rows if r.get("length") == length and r.get("request_submitted") is not False]
        bucket_successes = [r for r in bucket_rows if r.get("success") is True]
        if (len(bucket_rows) == 20 and len(bucket_successes) == 20 and
                sum(1 for r in bucket_successes if r.get("family") == "A") == 10 and
                sum(1 for r in bucket_successes if r.get("family") == "B") == 10):
            effective_status = "complete"
        elif length == stop_length or any(r.get("error_category") == "watchdog_timeout" for r in bucket_rows):
            effective_status = "safety-incomplete"
        elif bucket_rows:
            effective_status = "incomplete"
        elif probe_status.get("status") == "passed" and stop_observation:
            effective_status = "matrix-not-run-after-safety-stop"
        elif probe_status.get("status") == "passed":
            effective_status = "probe-passed-matrix-not-run"
        else:
            effective_status = bucket_status.get("status") or probe_status.get("status", "not_run")
        if effective_status != "complete":
            attempts_value = len(bucket_rows) if bucket_rows else bucket_status.get("attempts", probe_status.get("attempts", 0))
            if isinstance(attempts_value, list):
                success_count = sum(1 for x in attempts_value if x.get("success") is True)
                attempt_count = len(attempts_value)
            else:
                success_count = len(bucket_successes) if bucket_rows else bucket_status.get("success", 0)
                attempt_count = attempts_value
            index["incomplete_buckets"].append({
                "length": length,
                "status": effective_status,
                "success": success_count,
                "attempts": attempt_count,
                "reason": (
                    ("owner-requested stop before the final persisted client row; a service success event/audio exists without a client timing row"
                     if stop_observation.get("owner_requested_stop") and length == (stop_observation.get("unpersisted_client_timing_row") or {}).get("length")
                     else f"partial bucket ended when the matrix stopped at {stop_length} codepoints; no bucket-specific hard stop")
                    if stop_observation and bucket_rows else
                    (stop_observation.get("stop_reason") if length == stop_length else
                     bucket_status.get("reason") or probe_status.get("reason"))
                ),
                "representative": False,
            })
            continue
        bucket_rows = [r for r in rows if r.get("length") == length and r.get("success") is True]
        if len(bucket_rows) != 20 or sum(1 for r in bucket_rows if r.get("family") == "A") != 10 or sum(1 for r in bucket_rows if r.get("family") == "B") != 10:
            raise ValueError(f"matrix_complete_count_mismatch:{length}")
        complete_lengths.add(length)
        selected = boundary.representative_a_sample(bucket_rows)
        relative = selected.get("temporary_audio_path")
        if not isinstance(relative, str):
            raise ValueError(f"selected_audio_path_missing:{length}")
        source = (root / relative).resolve()
        if root not in source.parents or source.is_symlink() or not source.is_file():
            raise ValueError(f"selected_audio_file_missing_or_outside_root:{length}")
        audio = source.read_bytes()
        if not (audio.startswith(b"ID3") or audio[:1] == b"\xff"):
            raise ValueError(f"selected_audio_not_mp3:{length}")
        fixture = fixtures[length]["A"]
        text_bytes = fixture["text"].encode("utf-8")
        if selected.get("fixture_text_sha256") != boundary.sha256_bytes(text_bytes):
            raise ValueError(f"selected_fixture_text_hash_mismatch:{length}")
        artifact_dir = root / "listening" / str(length)
        if not args.apply:
            print(f"REPRESENTATIVE_PLAN={length} run_index={selected['fixture_run_index']} audio_bytes={len(audio)}")
            continue
        artifact_dir.mkdir(mode=0o700, exist_ok=False)
        artifact_dir.chmod(0o700)
        metadata = {
            "control_id": boundary.CONTROL_ID,
            "length_codepoints": length,
            "fixture_id": fixture["id"],
            "fixture_run_index": selected["fixture_run_index"],
            "selection_rule": "nearest fixture-A total_ms to fixture-A type-7 p50; lower run index breaks ties",
            "total_ms": selected.get("total_ms"),
            "generate_or_model_ms": selected.get("generate_or_model_ms"),
            "audio_duration_ms": selected.get("audio_duration_ms"),
            "rtf": selected.get("rtf"),
            "text_sha256": hashlib.sha256(text_bytes).hexdigest(),
            "mp3_sha256": hashlib.sha256(audio).hexdigest(),
        }
        write_private(artifact_dir / "sample.mp3", audio)
        write_private(artifact_dir / "sample.txt", text_bytes)
        write_private(artifact_dir / "sample.json", boundary.canonical_json_bytes(metadata))
        artifact = {
            "length": length,
            "logical_external_path": f"listening/{length}/sample.mp3",
            "paired_text_path": f"listening/{length}/sample.txt",
            "metadata_path": f"listening/{length}/sample.json",
            "fixture_id": fixture["id"],
            "fixture_run_index": selected["fixture_run_index"],
            "total_ms": selected.get("total_ms"),
            "generate_or_model_ms": selected.get("generate_or_model_ms"),
            "audio_duration_ms": selected.get("audio_duration_ms"),
            "rtf": selected.get("rtf"),
        }
        index["artifacts"].append(artifact)
        created.append(artifact_dir)
    if not args.apply:
        print("LISTENING_FINALIZE=plan_only; --apply required to write artifacts or prune raw audio")
        return
    index_path = root / "listening-index.json"
    write_private(index_path, boundary.canonical_json_bytes(index))
    # For buckets made complete, the exact representatives now have verified copies
    # under listening/<length>/. Preserve every partial/safety-incomplete bucket's
    # MP3 evidence rather than deleting it without a representative.
    audio_root = root / "audio"
    removed = preserved_partial = 0
    for candidate in audio_root.rglob("*.mp3"):
        if candidate.is_symlink() or not candidate.is_file() or audio_root.resolve() not in candidate.resolve().parents:
            raise ValueError("unsafe_temporary_audio_path")
        try:
            length = int(candidate.relative_to(audio_root).parts[0])
        except (ValueError, IndexError):
            raise ValueError("temporary_audio_length_directory_invalid")
        if length not in complete_lengths:
            preserved_partial += 1
            continue
        candidate.unlink()
        removed += 1
    print(f"LISTENING_ARTIFACTS={len(created)} COMPLETE_BUCKET_TEMPORARY_MP3_REMOVED={removed} PARTIAL_BUCKET_MP3_PRESERVED={preserved_partial}")
    print("LISTENING_INDEX=listening-index.json MODE=0600 AUDIO/TEXT/METADATA=0600")


if __name__ == "__main__":
    main()
