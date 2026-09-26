"""Create a protected owner listening checklist; never auto-rate voice quality."""
from __future__ import annotations

import argparse
import csv
import os
from pathlib import Path

from benchmark import FIXTURES, LANGUAGES, PROFILES

FIELDS = ("profile_id", "clone_mode", "language", "input_bucket", "sample_file",
          "similarity_1to5", "audio_quality_1to5", "japanese_naturalness_1to5",
          "pronunciation_regression_yes_no", "volume_rhythm_anomaly_yes_no",
          "owner_accepted_yes_no", "owner_notes")


def rows(root: Path) -> list[dict]:
    results = []
    for profile in PROFILES:
        mode = "x_vector_only" if profile == "E" else "icl"
        for language in LANGUAGES:
            for bucket in FIXTURES:
                sample = root / f"{profile}-{mode}-{language}-{bucket}-listen.wav"
                if not sample.is_file():
                    continue
                if sample.is_symlink() or sample.stat().st_mode & 0o077:
                    raise ValueError("unprotected_listening_sample")
                row = dict.fromkeys(FIELDS, "")
                row.update(profile_id=profile, clone_mode=mode, language=language,
                           input_bucket=bucket, sample_file=str(sample))
                results.append(row)
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--results-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        print("QUALITY_SHEET=plan_only; no listening verdict is inferred")
        return
    repo = Path(__file__).resolve().parents[2]
    if not args.output.is_absolute() or repo == args.output or repo in args.output.parents:
        raise ValueError("external_output_required")
    if not args.results_dir.is_dir() or args.results_dir.stat().st_mode & 0o077:
        raise ValueError("protected_results_required")
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDS)
        writer.writeheader()
        entries = rows(args.results_dir)
        writer.writerows(entries)
    print(f"QUALITY_SHEET_CREATED={len(entries)}/30 entries; owner ratings intentionally blank")

if __name__ == "__main__":
    main()
