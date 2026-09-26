"""Run each MPS config in an isolated process with a hard per-sample watchdog."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

from benchmark import FIXTURES, LANGUAGES, PROFILES, prepare_paths, protected_file, write_private

MAX_SAMPLE_S = 110  # below the unchanged upstream 120s TTS timeout
MAX_STARTUP_S = 900
MAX_CONFIG_S = 180  # one complete config must leave room to restore the live service


def run_config(command: list[str], log_path: Path, timeout_path: Path) -> bool:
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as log:
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, bufsize=1, start_new_session=True)
        born_at = time.monotonic()
        last_start = born_at
        sample = "startup"
        timed_out = False
        try:
            while child.poll() is None:
                ready, _, _ = select.select([child.stdout], [], [], 1)
                if ready:
                    line = child.stdout.readline()
                    if line:
                        log.write(line)
                        log.flush()
                        if line.startswith("START="):
                            sample = line.strip().split("=", 1)[1]
                            last_start = time.monotonic()
                now = time.monotonic()
                sample_limit = MAX_STARTUP_S if sample == "startup" else MAX_SAMPLE_S
                config_expired = now - born_at > MAX_CONFIG_S
                if config_expired or now - last_start > sample_limit:
                    timed_out = True
                    reason = "config_watchdog_timeout" if config_expired else "watchdog_timeout"
                    limit = MAX_CONFIG_S if config_expired else sample_limit
                    write_private(timeout_path, (json.dumps({"sample": sample, "reason": reason,
                                                             "limit_seconds": limit})+"\n").encode())
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL)
                    break
            for line in child.stdout:
                log.write(line)
            child.wait()
        finally:
            child.stdout.close()
    return not timed_out and child.returncode == 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backend", choices=("mps", "mlx"), default="mps")
    parser.add_argument("--profile-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--profiles", default=",".join(PROFILES))
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    parser.add_argument("--buckets", default=",".join(FIXTURES))
    args = parser.parse_args()
    profiles, languages, buckets = args.profiles.split(","), args.languages.split(","), args.buckets.split(",")
    if set(profiles)-set(PROFILES) or set(languages)-set(LANGUAGES) or set(buckets)-set(FIXTURES):
        raise SystemExit("invalid_matrix_selection")
    print(f"BACKEND={args.backend} CONFIGS={len(profiles)*len(languages)*len(buckets)} HARD_SAMPLE_LIMIT_S={MAX_SAMPLE_S} HARD_CONFIG_LIMIT_S={MAX_CONFIG_S}")
    if not args.apply:
        print("SUPERVISOR=plan_only")
        return
    repo = Path(__file__).resolve().parents[2]
    prepare_paths(args.profile_root, args.output_dir, repo)
    incomplete = []
    for profile in profiles:
        mode = "x_vector_only" if profile == "E" else "icl"
        for language in languages:
            for bucket in buckets:
                name = f"{profile}-{mode}-{language}-{bucket}"
                destination = args.output_dir / f"{name}.jsonl"
                if destination.exists():
                    protected_file(destination)
                    print(f"CONFIG_REUSED={name}", flush=True)
                    continue
                log = args.output_dir / f"{name}.runner.log"
                timeout = args.output_dir / f"{name}.timeout.json"
                if log.exists() or timeout.exists():
                    incomplete.append(name)
                    print(f"CONFIG_PREVIOUSLY_INCOMPLETE={name}", flush=True)
                    continue
                worker_script = "benchmark_mlx.py" if args.backend == "mlx" else "benchmark.py"
                command = [sys.executable, str(Path(__file__).with_name(worker_script)), "--apply",
                           "--profile-root", str(args.profile_root), "--output-dir", str(args.output_dir),
                           "--model-path", str(args.model_path), "--profiles", profile,
                           "--languages", language, "--buckets", bucket, "--runs", "5"]
                if run_config(command, log, timeout):
                    print(f"CONFIG_OK={name}", flush=True)
                else:
                    incomplete.append(name)
                    print(f"CONFIG_INCOMPLETE={name} timeout={timeout.exists()}", flush=True)
    print(f"SUPERVISOR_COMPLETE={not incomplete} INCOMPLETE_COUNT={len(incomplete)}")
    if incomplete:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
