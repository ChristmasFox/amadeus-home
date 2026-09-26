#!/usr/bin/env python3
"""Export only numeric, non-sensitive TTS benchmark evidence into Git."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/qwen3-tts-service'))
from analyze_benchmark import aggregate, percentile  # noqa: E402

ALLOWED = {
    'audio_duration_ms', 'clone_mode', 'cold_or_warm', 'encode_ms', 'engine_ms',
    'first_for_fixture', 'generate_or_model_ms', 'input_bucket', 'language',
    'mlx_active_bytes', 'mlx_peak_bytes', 'model_startup_ms', 'mps_current_bytes',
    'mps_driver_bytes', 'profile_id', 'prompt_ms', 'queue_wait_ms', 'rss_bytes',
    'rtf', 'run_index', 'success', 'total_ms', 'wav_serialize_ms', 'error',
    'timestamp_utc',
}
EXPORT_FIELDS = ALLOWED - {'timestamp_utc'}
EXPECTED_B_TIMEOUTS = {
    'B-icl-Auto-normal', 'B-icl-Auto-long',
    'B-icl-Japanese-short', 'B-icl-Japanese-normal',
}
ENDPOINT_FILES = {
    'background_initial': 'endpoint-A-Auto-short.jsonl',
    'background_reversal': 'endpoint-A-Auto-short-background-reversal.jsonl',
    'interactive_initial': 'endpoint-A-Auto-short-interactive.jsonl',
    'interactive_20': 'endpoint-A-Auto-short-interactive-20.jsonl',
    'interactive_reversal': 'endpoint-A-Auto-short-interactive-reversal.jsonl',
}


def protected_rows(path: Path) -> list[dict]:
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError('protected_timing_file_required')
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    for row in rows:
        if set(row) - ALLOWED:
            raise ValueError('unexpected_timing_field')
    return [{key: row[key] for key in sorted(set(row) & EXPORT_FIELDS)} for row in rows]


def endpoint_summary(path: Path) -> dict:
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    if any(set(row) - {'audio_bytes', 'error', 'run_index', 'status', 'success', 'total_ms'} for row in rows):
        raise ValueError('unexpected_endpoint_field')
    if not rows or any(not row.get('success') for row in rows):
        raise ValueError('incomplete_endpoint_batch')
    times = [row['total_ms'] for row in rows]
    return {'total_ms_samples': times, 'count': len(times),
            'p50_ms': round(percentile(times, .5), 2),
            'p95_ms': round(percentile(times, .95), 2),
            'min_ms': min(times), 'max_ms': max(times)}


def export(mps_root: Path, mlx_root: Path, endpoint_root: Path, source_sync_root: Path) -> dict:
    mps = aggregate(mps_root, allow_partial=True)
    mlx = aggregate(mlx_root, allow_partial=True)
    if set(mps['missing']) != EXPECTED_B_TIMEOUTS or set(mps['timeouts']) != EXPECTED_B_TIMEOUTS:
        raise ValueError('MPS matrix safety boundary changed; re-audit B')
    mlx_expected = {f'{profile}-icl-{language}-{bucket}'
                    for profile in ('A', 'D') for language in ('Auto', 'Japanese')
                    for bucket in ('short', 'normal', 'long')}
    if set(mlx['configs']) != mlx_expected:
        raise ValueError('MLX comparison scope changed')
    data = {'schema_version': 1,
            'method': {'warm_runs_per_complete_config': 5, 'p95': 'linear interpolation',
                       'first_fixture_trial_excluded': True, 'max_experimental_sample_seconds': 110},
            'mps': {'summaries': mps['configs'], 'missing': mps['missing'],
                    'timeouts': mps['timeouts'],
                    'runs': {name: protected_rows(mps_root / f'{name}.jsonl') for name in mps['configs']}},
            'mlx': {'scope': 'A,D x Auto,Japanese x short,normal,long',
                    'summaries': {name: mlx['configs'][name] for name in sorted(mlx_expected)},
                    'runs': {name: protected_rows(mlx_root / f'{name}.jsonl') for name in sorted(mlx_expected)}},
            'qos_endpoint': {name: endpoint_summary(endpoint_root / filename)
                             for name, filename in ENDPOINT_FILES.items()},
            'post_source_sync_endpoint': endpoint_summary(
                source_sync_root / 'endpoint-A-Auto-short-after-source-sync.jsonl'),
            'decision': {'profile': 'A', 'backend': 'MLX', 'language': 'Auto',
                         'quality': 'owner_A_MLX_direct_sample_acceptable',
                         'rejected': ['D:owner_voice_character_loss'],
                         'B': 'four_configs_safety_incomplete'},
            }
    for name in EXPECTED_B_TIMEOUTS:
        partial = mps_root / f'{name}.partial.jsonl'
        if partial.exists():
            data['mps'].setdefault('partial_runs', {})[name] = protected_rows(partial)
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--mps-root', type=Path, required=True)
    parser.add_argument('--mlx-root', type=Path, required=True)
    parser.add_argument('--endpoint-root', type=Path, required=True)
    parser.add_argument('--source-sync-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if not args.apply:
        print('TTS_REPORT_EXPORT=plan_only; output is sanitized numeric JSON')
        return
    expected = ROOT / 'docs/reports/data/AMADEUS_TTS_PERFORMANCE_2026_09.json'
    if args.output.resolve() != expected:
        raise ValueError('report_output_path_mismatch')
    data = export(args.mps_root, args.mlx_root, args.endpoint_root, args.source_sync_root)
    expected.parent.mkdir(parents=True, exist_ok=True)
    temporary = expected.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + '\n')
    temporary.replace(expected)
    print(f'TTS_REPORT_EXPORT=written mps_configs={len(data["mps"]["runs"])} mlx_configs={len(data["mlx"]["runs"])} B_incomplete={len(data["mps"]["missing"])}')

if __name__ == '__main__':
    main()
