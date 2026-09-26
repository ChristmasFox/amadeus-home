"""Create protected crop-only experimental references from one lawful private profile."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil

# Source-specific cuts are supplied in a protected JSON file, never committed.
# Each entry: {"start_seconds": 0.0, "end_seconds": 15.0, "line_start": 1, "line_end": 5}.
IDS = ("B", "C", "D", "E")


def private(path: Path, directory: bool = False) -> None:
    if path.is_symlink() or not (path.is_dir() if directory else path.is_file()) or path.stat().st_mode & 0o077:
        raise ValueError("protected_private_input_required")


def validate_cuts(cuts: dict, duration: float, lines: list[str]) -> None:
    if set(cuts) != set(IDS):
        raise ValueError("all_four_experimental_profiles_required")
    targets = {"B": (12, 18), "C": (6, 10), "D": (3.5, 6.5), "E": (3.5, 10)}
    for name, cut in cuts.items():
        if set(cut) != {"start_seconds", "end_seconds", "line_start", "line_end"}:
            raise ValueError("invalid_crop_keys")
        start, end = cut["start_seconds"], cut["end_seconds"]
        lo, hi = cut["line_start"], cut["line_end"]
        if (not isinstance(start, (float, int)) or not isinstance(end, (float, int)) or
            not isinstance(lo, int) or not isinstance(hi, int) or
            not 0 <= start < end <= duration or not 1 <= lo <= hi <= len(lines) or
            not targets[name][0] <= end-start <= targets[name][1] or
            not "".join(lines[lo-1:hi]).strip()):
            raise ValueError("invalid_crop_boundary_or_transcript_range")


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as target:
        target.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--cuts-file", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        print("PROFILE_PREPARATION=plan_only; explicit --apply required")
        return
    import soundfile as sf
    repo = Path(__file__).resolve().parents[2]
    if (not args.output_root.is_absolute() or args.output_root == repo or repo in args.output_root.parents or
        not args.source.is_absolute() or args.source == repo or repo in args.source.parents):
        raise ValueError("private_external_paths_required")
    private(args.source, directory=True)
    private(args.source / "reference.wav")
    private(args.source / "reference.txt")
    private(args.cuts_file)
    if args.output_root.exists():
        raise ValueError("experimental_root_must_not_exist")
    info = sf.info(args.source / "reference.wav")
    lines = (args.source / "reference.txt").read_text(encoding="utf-8").strip().splitlines()
    cuts = json.loads(args.cuts_file.read_text(encoding="utf-8"))
    validate_cuts(cuts, info.duration, lines)
    samples, sample_rate = sf.read(args.source / "reference.wav")
    args.output_root.mkdir(mode=0o700, parents=True)
    manifest = {"source_sha256": hashlib.sha256((args.source / "reference.wav").read_bytes()).hexdigest(),
                "profiles": {}}
    baseline = args.output_root / "A"
    baseline.mkdir(mode=0o700)
    for name in ("reference.wav", "reference.txt"):
        target = baseline / name
        shutil.copyfile(args.source / name, target)
        target.chmod(0o600)
    manifest["profiles"]["A"] = {"duration_ms": round(info.duration*1000), "mode": "icl"}
    for name in IDS:
        cut = cuts[name]
        target = args.output_root / name
        target.mkdir(mode=0o700)
        start = round(cut["start_seconds"] * sample_rate)
        end = round(cut["end_seconds"] * sample_rate)
        wav = target / "reference.wav"
        sf.write(str(wav), samples[start:end], sample_rate, format="WAV", subtype=info.subtype)
        wav.chmod(0o600)
        transcript = "\n".join(lines[cut["line_start"]-1:cut["line_end"]]).strip() + "\n"
        write_private(target / "reference.txt", transcript.encode("utf-8"))
        manifest["profiles"][name] = {"duration_ms": round((end-start)*1000/sample_rate),
                                        "mode": "x_vector_only" if name == "E" else "icl",
                                        "start_seconds": cut["start_seconds"],
                                        "end_seconds": cut["end_seconds"],
                                        "line_start": cut["line_start"], "line_end": cut["line_end"]}
    write_private(args.output_root / "manifest.json", (json.dumps(manifest, indent=2)+"\n").encode())
    print("PRIVATE_PROFILES=prepared ids=A,B,C,D,E; contents suppressed")

if __name__ == "__main__":
    main()
