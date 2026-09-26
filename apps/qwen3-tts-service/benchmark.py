"""Protected, explicit MPS reference/language matrix. Never emits transcript or audio into Git."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import time
import wave

import service

# Public synthetic Japanese fixtures. Logs/results contain bucket labels, never the strings.
FIXTURES = {
    "short": "こんにちは。今日は落ち着いて話しましょう。",
    "normal": "こんにちは。今日は少しずつ確認して、わからないところがあれば丁寧に説明します。焦らず一緒に進めていきましょう。",
    "long": "こんにちは。今日の予定を一緒に整理しましょう。まず大切なことを確認してから、必要な手順を順番に進めます。もし途中で疑問が出たら、その場で立ち止まって考えましょう。無理をせず、落ち着いたペースで進めれば大丈夫です。",
}
PROFILES = ("A", "B", "C", "D", "E")
LANGUAGES = ("Auto", "Japanese")


def protected_file(path: Path) -> None:
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("protected_benchmark_input_required")


def prepare_paths(root: Path, out: Path, repo: Path) -> None:
    if (not root.is_absolute() or not out.is_absolute() or
        root == repo or repo in root.parents or repo == out or repo in out.parents):
        raise ValueError("external_absolute_paths_required")
    if root.is_symlink() or not root.is_dir() or root.stat().st_mode & 0o077:
        raise ValueError("protected_profile_root_required")
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    if out.is_symlink() or out.stat().st_mode & 0o077:
        raise ValueError("protected_output_directory_required")


def audio_ms(wav: bytes) -> int:
    with wave.open(io.BytesIO(wav), "rb") as reader:
        return int(reader.getnframes() * 1000 / reader.getframerate())


def rss_bytes() -> int:
    import psutil
    return psutil.Process(os.getpid()).memory_info().rss


def write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as target:
        target.write(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually load MPS and write private evidence")
    parser.add_argument("--profile-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--profiles", default=",".join(PROFILES))
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    parser.add_argument("--buckets", default=",".join(FIXTURES))
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    profiles = args.profiles.split(",")
    languages = args.languages.split(",")
    buckets = args.buckets.split(",")
    if (not profiles or not languages or not buckets or args.runs < 5 or
        set(profiles) - set(PROFILES) or set(languages) - set(LANGUAGES) or set(buckets) - set(FIXTURES)):
        raise SystemExit("invalid_matrix_selection_or_runs_below_five")
    print(f"MATRIX_CONFIGS={len(profiles)*len(languages)*len(buckets)} SAMPLES_PER_CONFIG={args.runs+1} (cold + warmed)")
    if not args.apply:
        print("BENCHMARK=plan_only; --apply required for real MPS and private output")
        return
    repo = Path(__file__).resolve().parents[2]
    prepare_paths(args.profile_root, args.output_dir, repo)
    if not args.model_path.is_dir() or not (args.model_path / "config.json").is_file():
        raise ValueError("local_model_required")
    for profile_id in profiles:
        profile = args.profile_root / profile_id
        if profile.is_symlink() or not profile.is_dir() or profile.stat().st_mode & 0o077:
            raise ValueError("protected_profile_required")
        protected_file(profile / "reference.wav")
        protected_file(profile / "reference.txt")
    import torch
    from qwen_tts import Qwen3TTSModel
    if not torch.backends.mps.is_available():
        raise RuntimeError("mps_unavailable")
    startup = time.monotonic()
    model = Qwen3TTSModel.from_pretrained(str(args.model_path), device_map="mps", dtype=torch.float16)
    startup_ms = (time.monotonic() - startup) * 1000
    print(f"MODEL_STARTUP_MS={startup_ms:.1f} RSS_BYTES={rss_bytes()}")
    global_first_synthesis = True
    for profile_id in profiles:
        for language in languages:
            mode = "x_vector_only" if profile_id == "E" else "icl"
            config_prefix = f"{profile_id}-{mode}-{language}"
            # One profile prompt reused across fixture lengths; model remains resident.
            prompt_start = time.monotonic()
            engine = service.QwenEngine(args.profile_root / profile_id, str(args.model_path),
                                        language=language, x_vector_only_mode=(profile_id == "E"),
                                        shared_model=model, warmup=False)
            prompt_ms = (time.monotonic() - prompt_start) * 1000
            first_for_profile = True
            for bucket in buckets:
                destination = args.output_dir / f"{config_prefix}-{bucket}.jsonl"
                if destination.exists():
                    protected_file(destination)
                    print(f"COMPLETE_REUSED={config_prefix}-{bucket}")
                    continue
                listen_path = args.output_dir / f"{config_prefix}-{bucket}-listen.wav"
                if listen_path.exists():
                    raise ValueError("incomplete_config_requires_private_cleanup")
                partial = args.output_dir / f"{config_prefix}-{bucket}.partial.jsonl"
                if partial.exists():
                    raise ValueError("incomplete_config_requires_private_cleanup")
                fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                rows = []
                with os.fdopen(fd, "w", encoding="utf-8") as partial_file:
                    for index in range(args.runs + 1):
                        row = run_one(engine, args, profile_id, mode, language, bucket, index,
                                      startup_ms, prompt_ms, global_first_synthesis, first_for_profile,
                                      listen_path)
                        global_first_synthesis = False
                        first_for_profile = False
                        rows.append(row)
                        partial_file.write(json.dumps(row, sort_keys=True) + "\n")
                        partial_file.flush()
                os.replace(partial, destination)
                print(f"CONFIG_COMPLETED={config_prefix}-{bucket}", flush=True)
    print("BENCHMARK=completed; private outputs are outside Git")


def run_one(engine, args, profile_id, mode, language, bucket, index,
            startup_ms, prompt_ms, global_first_synthesis, first_for_profile, listen_path):
    import torch
    config_prefix = f"{profile_id}-{mode}-{language}"
    print(f"START={config_prefix}-{bucket}-{index}", flush=True)
    started = time.monotonic()
    row = {"profile_id": profile_id, "clone_mode": mode, "language": language,
           "input_bucket": bucket,
           "cold_or_warm": "model_cold" if global_first_synthesis else "profile_cold" if first_for_profile else "warm",
           "first_for_fixture": index == 0,
           "run_index": index, "model_startup_ms": round(startup_ms, 1),
           "prompt_ms": round(prompt_ms, 1), "timestamp_utc": datetime.now(timezone.utc).isoformat()}
    try:
        wav, _, timing = engine.synthesize_timed(FIXTURES[bucket])
        duration = audio_ms(wav)
        encode_start = time.monotonic()
        encoded, _ = service.encode(wav, "mp3")
        encode_ms = (time.monotonic() - encode_start) * 1000
        if not encoded or duration <= 0:
            raise RuntimeError("invalid_audio")
        row.update({"queue_wait_ms": round(timing.queue_wait_ms, 1),
                    "engine_ms": round(timing.engine_inside_lock_ms, 1),
                    "generate_or_model_ms": round(timing.generate_or_model_ms, 1),
                    "wav_serialize_ms": round(timing.wav_serialize_ms, 1),
                    "encode_ms": round(encode_ms, 1),
                    "total_ms": round((time.monotonic()-started)*1000, 1),
                    "audio_duration_ms": duration,
                    "rtf": round(timing.engine_inside_lock_ms/duration, 3),
                    "rss_bytes": rss_bytes(),
                    "mps_current_bytes": torch.mps.current_allocated_memory(),
                    "mps_driver_bytes": torch.mps.driver_allocated_memory(),
                    "success": True})
        if index == 1:
            write_private(listen_path, wav)
    except Exception as exc:
        row.update({"success": False, "error": type(exc).__name__,
                    "total_ms": round((time.monotonic()-started)*1000, 1),
                    "rss_bytes": rss_bytes(),
                    "mps_current_bytes": torch.mps.current_allocated_memory(),
                    "mps_driver_bytes": torch.mps.driver_allocated_memory()})
    print(f"SAMPLE={config_prefix}-{bucket}-{index} success={row['success']} total_ms={row['total_ms']}", flush=True)
    return row

if __name__ == "__main__":
    main()
