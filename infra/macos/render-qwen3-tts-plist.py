#!/usr/bin/env python3
"""Render one Qwen TTS LaunchAgent; engine is explicit and never falls back."""
from __future__ import annotations

import argparse
from pathlib import Path
import plistlib


def render(template: Path, base: Path, voice: Path, log: Path,
           mlx_root: Path, engine: str, ominix_root: Path | None = None) -> bytes:
    if engine not in ('mps', 'mlx', 'ominix'):
        raise ValueError('unsupported_tts_engine')
    python = base / 'venv/bin/python' if engine in ('mps', 'ominix') else mlx_root / 'venv/bin/python'
    cache = base / 'model-cache' if engine in ('mps', 'ominix') else mlx_root / 'cache'
    ominix_root = ominix_root or (base / 'ominix')
    version_file = Path(__file__).resolve().parents[2] / 'VERSION'
    release_version = version_file.read_text(encoding='utf-8').strip() if version_file.is_file() else 'unknown'
    replacements = {
        '__VENV_PYTHON__': str(python),
        '__SERVICE_SCRIPT__': str(base / 'service.py'),
        '__TOKEN_FILE__': str(base / 'tts.token'),
        '__VOICE_DIR__': str(voice),
        '__LOG_DIR__': str(log),
        '__MODEL_CACHE__': str(cache),
        '__MODEL_PATH__': str(base / 'model'),
        '__MLX_MODEL_PATH__': str(mlx_root / 'model-8bit') if engine == 'mlx' else '',
        '__OMINIX_MODEL_PATH__': str(mlx_root / 'model-8bit') if engine == 'ominix' else '',
        '__OMINIX_WORKER_PATH__': str(ominix_root / 'worker') if engine == 'ominix' else '',
        '__STYLE_FILE__': str(base / 'kurisu_style.json'),
        '__RELEASE_VERSION__': release_version,
        '__TTS_ENGINE__': engine,
    }
    text = template.read_text()
    for old, new in replacements.items():
        text = text.replace(old, new)
    if '__' in text:
        raise ValueError('unresolved_plist_placeholder')
    parsed = plistlib.loads(text.encode())
    if parsed['EnvironmentVariables']['AMADEUS_TTS_ENGINE'] != engine:
        raise ValueError('tts_engine_render_mismatch')
    if parsed['ProgramArguments'][0] != str(python):
        raise ValueError('tts_python_render_mismatch')
    if parsed['StandardErrorPath'] != str(log / 'qwen3-tts-launchd.err.log'):
        raise ValueError('tts_early_log_render_mismatch')
    return text.encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('template', 'output', 'base', 'voice', 'log', 'mlx-root'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--engine', choices=('mps', 'mlx', 'ominix'), required=True)
    parser.add_argument('--ominix-root', type=Path)
    args = parser.parse_args()
    data = render(args.template, args.base, args.voice, args.log, args.mlx_root, args.engine, args.ominix_root)
    args.output.write_bytes(data)
    args.output.chmod(0o600)
    print(f'TTS_PLIST_RENDERED={args.engine}')

if __name__ == '__main__':
    main()
