"""Experimental community MLX 1.7B Base 8-bit clone benchmark; not production."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import time

from benchmark import FIXTURES, LANGUAGES, PROFILES, prepare_paths, protected_file, rss_bytes, write_private
import service


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--profile-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--profiles", default="A,D")
    parser.add_argument("--languages", default=",".join(LANGUAGES))
    parser.add_argument("--buckets", default=",".join(FIXTURES))
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    profiles, languages, buckets = args.profiles.split(","), args.languages.split(","), args.buckets.split(",")
    if (args.runs < 5 or not profiles or not languages or not buckets or
        set(profiles)-set(PROFILES) or set(languages)-set(LANGUAGES) or set(buckets)-set(FIXTURES)):
        raise SystemExit("invalid_mlx_matrix_selection")
    print(f"MLX_CONFIGS={len(profiles)*len(languages)*len(buckets)} SAMPLES_PER_CONFIG={args.runs+1}", flush=True)
    if not args.apply:
        print("MLX_POC=plan_only")
        return
    repo = Path(__file__).resolve().parents[2]
    prepare_paths(args.profile_root, args.output_dir, repo)
    if not args.model_path.is_dir() or not (args.model_path / "config.json").is_file():
        raise ValueError("local_pinned_model_required")
    for profile in profiles:
        folder = args.profile_root/profile
        if folder.is_symlink() or not folder.is_dir() or folder.stat().st_mode & 0o077:
            raise ValueError("protected_profile_required")
        protected_file(folder/"reference.wav")
        protected_file(folder/"reference.txt")
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model
    started = time.monotonic()
    model = load_model(args.model_path)
    startup_ms = (time.monotonic()-started)*1000
    print(f"MLX_MODEL_STARTUP_MS={startup_ms:.1f} RSS_BYTES={rss_bytes()}", flush=True)
    global_first = True
    for profile in profiles:
        mode = "x_vector_only" if profile == "E" else "icl"
        ref_audio = args.profile_root/profile/"reference.wav"
        ref_text = None if profile == "E" else (args.profile_root/profile/"reference.txt").read_text().strip()
        for language in languages:
            for bucket in buckets:
                name = f"{profile}-{mode}-{language}-{bucket}"
                destination = args.output_dir/f"{name}.jsonl"
                if destination.exists():
                    protected_file(destination)
                    print(f"COMPLETE_REUSED={name}",flush=True)
                    continue
                partial = args.output_dir/f"{name}.partial.jsonl"
                listen = args.output_dir/f"{name}-listen.wav"
                if partial.exists() or listen.exists():
                    raise ValueError("incomplete_mlx_config_requires_private_cleanup")
                fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd,"w",encoding="utf-8") as output:
                    for index in range(args.runs+1):
                        print(f"START={name}-{index}",flush=True)
                        tick=time.monotonic()
                        row={"profile_id":profile,"clone_mode":mode,"language":language,"input_bucket":bucket,
                             "cold_or_warm":"model_cold" if global_first else "warm",
                             "first_for_fixture":index==0,"run_index":index,
                             "model_startup_ms":round(startup_ms,1),"prompt_ms":None,
                             "timestamp_utc":datetime.now(timezone.utc).isoformat()}
                        global_first=False
                        try:
                            outputs=list(model.generate(text=FIXTURES[bucket],ref_audio=str(ref_audio),
                                                        ref_text=ref_text,lang_code=language.lower(),verbose=False))
                            if len(outputs)!=1:
                                raise RuntimeError("unexpected_segment_count")
                            audio=np.asarray(outputs[0].audio)
                            rate=outputs[0].sample_rate
                            duration=int(audio.shape[0]*1000/rate)
                            generated_ms=(time.monotonic()-tick)*1000
                            wav_buf=io.BytesIO();sf.write(wav_buf,audio,rate,format="WAV")
                            wav=wav_buf.getvalue()
                            wav_ms=(time.monotonic()-tick)*1000-generated_ms
                            encode_start=time.monotonic();encoded,_=service.encode(wav,"mp3")
                            encode_ms=(time.monotonic()-encode_start)*1000
                            if not encoded or duration<=0:raise RuntimeError("invalid_audio")
                            row.update({"queue_wait_ms":0,"engine_ms":round(generated_ms,1),
                                        "generate_or_model_ms":round(generated_ms,1),
                                        "wav_serialize_ms":round(wav_ms,1),"encode_ms":round(encode_ms,1),
                                        "total_ms":round((time.monotonic()-tick)*1000,1),
                                        "audio_duration_ms":duration,"rtf":round(generated_ms/duration,3),
                                        "rss_bytes":rss_bytes(),"mlx_peak_bytes":mx.metal.get_peak_memory(),
                                        "mlx_active_bytes":mx.metal.get_active_memory(),"success":True})
                            if index==1:write_private(listen,wav)
                        except Exception as exc:
                            row.update({"success":False,"error":type(exc).__name__,
                                        "total_ms":round((time.monotonic()-tick)*1000,1),
                                        "rss_bytes":rss_bytes(),"mlx_peak_bytes":mx.metal.get_peak_memory()})
                        output.write(json.dumps(row,sort_keys=True)+"\n");output.flush()
                        print(f"SAMPLE={name}-{index} success={row['success']} total_ms={row['total_ms']}",flush=True)
                os.replace(partial,destination)
                print(f"CONFIG_COMPLETED={name}",flush=True)
    print("MLX_POC=completed; private audio/results outside Git")

if __name__ == "__main__":
    main()
