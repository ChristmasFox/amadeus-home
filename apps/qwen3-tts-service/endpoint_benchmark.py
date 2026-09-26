"""Protected local HTTP baseline: production profile/Auto, fixed public short fixture."""
from __future__ import annotations

import argparse
import http.client
import json
import os
from pathlib import Path
import time

from benchmark import FIXTURES, write_private
from service import MODEL_ID, VOICE_ID


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--bucket", choices=tuple(FIXTURES), default="short")
    args = parser.parse_args()
    if args.runs < 5 or args.runs > 20:
        raise ValueError("five_to_twenty_runs_required")
    print(f"ENDPOINT_RUNS={args.runs} BUCKET={args.bucket} REQUEST_TIMEOUT_S=120")
    if not args.apply:
        print("ENDPOINT_BENCHMARK=plan_only")
        return
    repo = Path(__file__).resolve().parents[2]
    if not args.output.is_absolute() or repo == args.output or repo in args.output.parents:
        raise ValueError("external_output_required")
    if (not args.token_file.is_file() or args.token_file.is_symlink() or
        args.token_file.stat().st_mode & 0o077):
        raise ValueError("protected_token_required")
    token = args.token_file.read_text().strip()
    request = json.dumps({"model": MODEL_ID, "voice": VOICE_ID,
                          "input": FIXTURES[args.bucket], "response_format": "mp3"}, ensure_ascii=False).encode()
    rows = []
    for index in range(args.runs):
        start = time.monotonic()
        conn = http.client.HTTPConnection("127.0.0.1", 18792, timeout=120)
        try:
            conn.request("POST", "/v1/audio/speech", request,
                         {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
            response = conn.getresponse()
            audio = response.read()
            elapsed = round((time.monotonic() - start)*1000, 1)
            valid = response.status == 200 and (audio.startswith(b"ID3") or audio[:1] == b"\xff")
            row = {"run_index": index, "status": response.status, "total_ms": elapsed,
                   "audio_bytes": len(audio) if valid else None,
                   "success": valid, "error": None if valid else "invalid_response"}
        except Exception as exc:
            row = {"run_index": index, "total_ms": round((time.monotonic()-start)*1000, 1),
                   "success": False, "error": type(exc).__name__}
        finally:
            conn.close()
        rows.append(row)
        print(f"ENDPOINT_SAMPLE={index} success={row['success']} total_ms={row['total_ms']}", flush=True)
    write_private(args.output, ("\n".join(json.dumps(row,sort_keys=True) for row in rows)+"\n").encode())
    if not all(row["success"] for row in rows):
        raise SystemExit("endpoint_benchmark_incomplete")

if __name__ == "__main__":
    main()
