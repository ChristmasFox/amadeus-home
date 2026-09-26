"""Aggregate protected timing JSONL into content-free, machine-checkable statistics."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics

from benchmark import FIXTURES, LANGUAGES, PROFILES


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("empty_percentile")
    ordered = sorted(values)
    position = (len(ordered) - 1) * p
    lo = int(position)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (position - lo)


def summarize(rows: list[dict], minimum_warm: int = 5) -> dict:
    warm = [row for row in rows if row.get("cold_or_warm") == "warm" and row.get("success")]
    errors = [row.get("error", "unknown") for row in rows if not row.get("success")]
    if len(warm) < minimum_warm:
        raise ValueError("insufficient_successful_warm_runs")
    result = {"warm_count": len(warm), "failure_count": len(errors), "failure_categories": sorted(set(errors)),
              "cold_samples": [{"phase": row.get("cold_or_warm"), "total_ms": row.get("total_ms")}
                               for row in rows if row.get("cold_or_warm") != "warm"],
              "model_startup_ms": rows[0].get("model_startup_ms"), "prompt_ms": rows[0].get("prompt_ms"),
              "rss_peak_bytes": max(row["rss_bytes"] for row in rows if row.get("rss_bytes") is not None)}
    for key in ("total_ms", "engine_ms", "queue_wait_ms", "encode_ms", "audio_duration_ms", "rtf"):
        values = [float(row[key]) for row in warm]
        result[key] = {"p50": round(percentile(values, .50), 2),
                       "p95": round(percentile(values, .95), 2),
                       "min": round(min(values), 2), "max": round(max(values), 2)}
    return result


def aggregate(root: Path, allow_partial: bool = False) -> dict:
    if not root.is_dir() or root.is_symlink() or root.stat().st_mode & 0o077:
        raise ValueError("protected_results_required")
    output = {}
    missing = []
    for profile in PROFILES:
        mode = "x_vector_only" if profile == "E" else "icl"
        for language in LANGUAGES:
            for bucket in FIXTURES:
                name = f"{profile}-{mode}-{language}-{bucket}"
                path = root / f"{name}.jsonl"
                if not path.is_file():
                    missing.append(name)
                    continue
                if path.is_symlink() or path.stat().st_mode & 0o077:
                    raise ValueError("protected_metrics_required")
                rows = [json.loads(line) for line in path.read_text().splitlines()]
                if any(row.get("profile_id") != profile or row.get("language") != language or
                       row.get("input_bucket") != bucket or row.get("clone_mode") != mode for row in rows):
                    raise ValueError("mismatched_metrics_metadata")
                output[name] = summarize(rows)
    if missing and not allow_partial:
        raise ValueError("incomplete_matrix_" + str(len(missing)))
    return {"configs": output, "missing": missing, "complete": not missing}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--allow-partial", action="store_true")
    args = parser.parse_args()
    print(json.dumps(aggregate(args.results_dir, args.allow_partial), indent=2, sort_keys=True))

if __name__ == "__main__":
    main()
