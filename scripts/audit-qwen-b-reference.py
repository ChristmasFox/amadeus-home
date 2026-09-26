#!/usr/bin/env python3
"""Local-only, content-free ASR audit of a protected experimental B reference."""
from __future__ import annotations

import argparse
import contextlib
from difflib import SequenceMatcher
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import unicodedata

MODEL_ID = 'mlx-community/Qwen3-ASR-0.6B-8bit'
MODEL_REV = '89e96d92ba34aca20b3e29fb10cc284097d1219f'
REPO = Path(__file__).resolve().parents[1]


def private(path: Path, directory: bool = False) -> None:
    if (path.is_symlink() or not (path.is_dir() if directory else path.is_file())
            or path.stat().st_mode & 0o077):
        raise ValueError('protected_private_input_required')


def normalized(text: str) -> str:
    return ''.join(char for char in unicodedata.normalize('NFKC', text).lower()
                   if not unicodedata.category(char).startswith(('P', 'Z', 'C')))


def memory_gate() -> float:
    output = subprocess.check_output(['memory_pressure', '-Q'], text=True)
    match = re.search(r'System-wide memory free percentage:\s*(\d+)%', output)
    if not match or int(match.group(1)) < 40:
        raise RuntimeError('insufficient_memory_headroom_for_isolated_asr')
    return float(match.group(1))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--prepare-apply', action='store_true', help='download only the pinned public local ASR model')
    mode.add_argument('--apply', action='store_true', help='run local-only ASR and write numeric private evidence')
    parser.add_argument('--model-root', type=Path, required=True)
    parser.add_argument('--profile', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.prepare_apply and not args.apply:
        print(f'B_REFERENCE_AUDIT=plan_only model={MODEL_ID}@{MODEL_REV}; no reference leaves the host')
        return
    if (not args.model_root.is_absolute() or args.model_root == REPO or REPO in args.model_root.parents
            or not args.output.is_absolute() or args.output == REPO or REPO in args.output.parents):
        raise ValueError('external_absolute_paths_required')
    private(args.profile, directory=True)
    for name in ('reference.wav', 'reference.txt'):
        private(args.profile / name)
    free = memory_gate()
    model_dir = args.model_root / 'model'
    if args.prepare_apply:
        os.umask(0o077)
        args.model_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        private(args.model_root, directory=True)
        cache = args.model_root / 'cache'
        cache.mkdir(mode=0o700, exist_ok=True)
        private(cache, directory=True)
        os.environ['HF_HOME'] = str(cache)
        from huggingface_hub import snapshot_download
        snapshot_download(MODEL_ID, revision=MODEL_REV, local_dir=model_dir)
        private(model_dir, directory=True)
        print(f'B_LOCAL_ASR_MODEL=ready free_percent_before={free:.0f} (public weights outside Git)')
        return
    private(args.model_root, directory=True)
    private(model_dir, directory=True)
    if not (model_dir / 'config.json').is_file():
        raise ValueError('pinned_local_asr_model_missing')
    if args.output.exists():
        raise ValueError('audit_output_already_exists')
    private(args.output.parent, directory=True)
    # Force local cached model/tokenizer loading: private audio is never sent to a provider.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    from mlx_audio.stt import load
    import soundfile as sf
    started = time.monotonic()
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            model = load(str(model_dir))
            result = model.generate(str(args.profile / 'reference.wav'), language='Japanese')
    except Exception as exc:
        raise SystemExit('local_asr_failed category=' + type(exc).__name__) from None
    recognized = normalized(result.text)
    expected = normalized((args.profile / 'reference.txt').read_text(encoding='utf-8'))
    if not recognized or not expected:
        raise ValueError('empty_local_asr_result')
    summary = {
        'profile_id': 'B', 'model_id': MODEL_ID, 'model_revision': MODEL_REV,
        'audio_duration_ms': round(sf.info(args.profile / 'reference.wav').duration * 1000),
        'expected_chars': len(expected), 'asr_chars': len(recognized),
        'normalized_similarity': round(SequenceMatcher(None, expected, recognized).ratio(), 4),
        'audit_wall_ms': round((time.monotonic() - started) * 1000),
        'memory_free_percent_before': free,
        'interpretation': 'ASR is approximate; this is not owner transcript/quality acceptance',
    }
    os.umask(0o077)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(summary, stream, indent=2, sort_keys=True)
        stream.write('\n')
    print('B_REFERENCE_AUDIT=completed transcript_and_voice_suppressed')
    print('B_SIMILARITY=%.4f AUDIO_MS=%d WALL_MS=%d' % (
        summary['normalized_similarity'], summary['audio_duration_ms'], summary['audit_wall_ms']))

if __name__ == '__main__':
    main()
