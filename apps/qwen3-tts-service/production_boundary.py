"""Deterministic fixture, schedule, timing, and analysis helpers for the 1.6.2 TTS boundary study."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import random
import re
from typing import Any, Iterable, Mapping, Sequence

CONTROL_ID = "prod-1.6.2-a-mlx-auto-interactive"
HISTORICAL_LENGTHS = (25, 50, 100, 150, 200, 250, 320, 400, 500, 600, 800, 1000, 1200)
# V2 executes only 25–600. Keep the immutable full fixture corpus so its
# manifest hash and the historical 800/1000/1200 evidence remain unchanged.
DEFAULT_V2_LENGTHS = (25, 50, 100, 150, 200, 250, 320, 400, 500, 600)
LENGTHS = DEFAULT_V2_LENGTHS
FIXTURE_FILE = Path(__file__).with_name("production_boundary_fixtures.json")
SCHEDULE_SEED = 20260927
QUIET_INTERVAL_S = 2.0
WATCHDOG_S = 110.0
QUANTILE_METHOD = "Hyndman-Fan type 7 (linear interpolation; h=(n-1)p)"

LOG_METRIC_RE = re.compile(
    r"speech_synthesis_ok .*?audio_ms=(?P<audio_duration_ms>\d+) "
    r"queue_wait_ms=(?P<queue_wait_ms>[0-9.]+) "
    r"generate_or_model_ms=(?P<generate_or_model_ms>[0-9.]+) "
    r"decode_stage=inside_model_api wav_serialize_ms=(?P<wav_serialize_ms>[0-9.]+) "
    r"engine_inside_lock_ms=(?P<engine_inside_lock_ms>[0-9.]+) "
    r"encode_ms=(?P<encode_ms>\d+) total_ms=(?P<service_total_ms>\d+) "
    r"rtf=(?P<rtf>[0-9.]+)"
)


def canonical_json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_fixture_manifest(path: Path = FIXTURE_FILE) -> tuple[dict[int, dict[str, dict[str, Any]]], str]:
    raw = path.read_bytes()
    doc = json.loads(raw)
    if doc.get("control_id") != CONTROL_ID or doc.get("unit") != "python_unicode_codepoints":
        raise ValueError("fixture_control_or_length_unit_mismatch")
    if doc.get("synthetic") is not True or tuple(doc.get("lengths", ())) != HISTORICAL_LENGTHS:
        raise ValueError("fixture_manifest_scope_mismatch")
    fixtures: dict[int, dict[str, dict[str, Any]]] = {}
    seen_ids: set[str] = set()
    for item in doc.get("fixtures", []):
        fixture_id = item.get("id")
        family = item.get("family")
        target = item.get("target_codepoints")
        text = item.get("text")
        if family not in ("A", "B") or not isinstance(target, int) or target not in HISTORICAL_LENGTHS:
            raise ValueError("invalid_fixture_metadata")
        if fixture_id != f"{family}-{target}" or fixture_id in seen_ids or not isinstance(text, str):
            raise ValueError("invalid_fixture_identity")
        if len(text) != target:
            raise ValueError(f"fixture_length_mismatch:{fixture_id}:{len(text)}:{target}")
        if not text or any(ch.isspace() for ch in text) or not text.endswith(("。", "！", "？")):
            raise ValueError(f"fixture_text_shape_invalid:{fixture_id}")
        if "\ufffd" in text or any(0xD800 <= ord(ch) <= 0xDFFF for ch in text):
            raise ValueError(f"fixture_unicode_invalid:{fixture_id}")
        fixtures.setdefault(target, {})[family] = {
            "id": fixture_id,
            "family": family,
            "target_codepoints": target,
            "text": text,
            "text_sha256": sha256_bytes(text.encode("utf-8")),
        }
        seen_ids.add(fixture_id)
    if set(fixtures) != set(HISTORICAL_LENGTHS) or any(set(pair) != {"A", "B"} for pair in fixtures.values()):
        raise ValueError("fixture_matrix_incomplete")
    return fixtures, sha256_bytes(raw)


def historical_matrix_schedule(seed: int = SCHEDULE_SEED) -> list[dict[str, Any]]:
    """Reproduce the original frozen 25–1200 schedule exactly."""
    rng = random.Random(seed)
    rows: list[dict[str, Any]] = []
    run_indices = {(n, f): 0 for n in HISTORICAL_LENGTHS for f in ("A", "B")}
    for cycle in range(5):
        length_order = list(HISTORICAL_LENGTHS)
        rng.shuffle(length_order)
        for n in length_order:
            within_length = [(f, repetition) for f in ("A", "B") for repetition in range(2)]
            rng.shuffle(within_length)
            for family, repetition in within_length:
                run_index = run_indices[(n, family)]
                run_indices[(n, family)] += 1
                rows.append({
                    "order_index": len(rows),
                    "cycle": cycle,
                    "length": n,
                    "fixture_id": f"{family}-{n}",
                    "family": family,
                    "fixture_run_index": run_index,
                    "within_cycle_repetition": repetition,
                })
    if len(rows) != len(HISTORICAL_LENGTHS) * 20:
        raise AssertionError("matrix_schedule_size_invalid")
    for n in HISTORICAL_LENGTHS:
        for family in ("A", "B"):
            bucket = [r for r in rows if r["length"] == n and r["family"] == family]
            if len(bucket) != 10 or {r["fixture_run_index"] for r in bucket} != set(range(10)):
                raise AssertionError("matrix_schedule_fixture_count_invalid")
    return rows

def set_execution_lengths(lengths: Sequence[int]) -> tuple[int, ...]:
    """Set the executable safe prefix for this independently frozen run."""
    global LENGTHS
    selected = tuple(lengths)
    if (not selected or selected != tuple(sorted(set(selected))) or
            selected != DEFAULT_V2_LENGTHS[:len(selected)]):
        raise ValueError("execution_lengths_must_be_a_nonempty_v2_prefix")
    LENGTHS = selected
    return LENGTHS

def matrix_schedule(seed: int = SCHEDULE_SEED,
                    lengths: Sequence[int] | None = None) -> list[dict[str, Any]]:
    """Filter the old deterministic schedule to a V2 prefix, preserving order."""
    active_lengths = tuple(lengths) if lengths is not None else LENGTHS
    if (not active_lengths or active_lengths != tuple(sorted(set(active_lengths))) or
            active_lengths != DEFAULT_V2_LENGTHS[:len(active_lengths)]):
        raise ValueError("matrix_schedule_lengths_invalid")
    rows: list[dict[str, Any]] = []
    for historical in historical_matrix_schedule(seed):
        if historical["length"] not in active_lengths:
            continue
        row = dict(historical)
        row["source_order_index"] = historical["order_index"]
        row["order_index"] = len(rows)
        rows.append(row)
    if len(rows) != len(active_lengths) * 20:
        raise AssertionError("v2_matrix_schedule_size_invalid")
    for n in active_lengths:
        for family in ("A", "B"):
            bucket = [r for r in rows if r["length"] == n and r["family"] == family]
            if len(bucket) != 10 or {r["fixture_run_index"] for r in bucket} != set(range(10)):
                raise AssertionError("v2_matrix_schedule_fixture_count_invalid")
    return rows


def schedule_sha256(rows: Sequence[Mapping[str, Any]]) -> str:
    return sha256_bytes(canonical_json_bytes(list(rows)))


def quantile(values: Iterable[float], probability: float) -> float | None:
    """NumPy-compatible type-7 linear quantile; returns None for an empty set."""
    ordered = sorted(float(v) for v in values if math.isfinite(float(v)))
    if not ordered:
        return None
    if not 0 <= probability <= 1:
        raise ValueError("quantile_probability_out_of_range")
    h = (len(ordered) - 1) * probability
    lower = math.floor(h)
    upper = math.ceil(h)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (h - lower)


def summarize(values: Iterable[float]) -> dict[str, float | int | None]:
    ordered = sorted(float(v) for v in values if math.isfinite(float(v)))
    return {
        "n": len(ordered),
        "p50": quantile(ordered, 0.50),
        "p95": quantile(ordered, 0.95),
        "max": max(ordered) if ordered else None,
    }


def representative_a_sample(rows: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    candidates = [r for r in rows if r.get("success") is True and r.get("family") == "A"]
    if len(candidates) != 10:
        raise ValueError(f"representative_requires_10_successful_fixture_a_samples:{len(candidates)}")
    median = quantile((float(r["total_ms"]) for r in candidates), 0.50)
    assert median is not None
    return min(candidates, key=lambda r: (abs(float(r["total_ms"]) - median), int(r["fixture_run_index"])))


def parse_service_log_line(line: str) -> dict[str, float | int] | None:
    match = LOG_METRIC_RE.search(line)
    if not match:
        return None
    values: dict[str, float | int] = {}
    for key, value in match.groupdict().items():
        values[key] = int(value) if key in {"audio_duration_ms", "encode_ms", "service_total_ms"} else float(value)
    return values


def aggregate_success_rows(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    successful = [r for r in rows if r.get("success") is True]
    failed = [r for r in rows if r.get("success") is not True]
    metrics = (
        "total_ms", "generate_or_model_ms", "audio_duration_ms", "rtf", "queue_wait_ms",
        "wav_serialize_ms", "encode_ms", "engine_inside_lock_ms",
    )
    result: dict[str, Any] = {"attempts": len(rows), "success": len(successful), "failure": len(failed)}
    for metric in metrics:
        available = [float(r[metric]) for r in successful if isinstance(r.get(metric), (int, float))]
        result[metric] = summarize(available)
    return result


def paired_fixture_summaries(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    return {
        family: aggregate_success_rows([r for r in rows if r.get("family") == family])
        for family in ("A", "B")
    }
