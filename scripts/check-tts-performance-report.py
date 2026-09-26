#!/usr/bin/env python3
"""Offline, content-free audit of the published TTS performance evidence."""
from __future__ import annotations

import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/qwen3-tts-service'))
from analyze_benchmark import percentile  # noqa: E402

DATA = ROOT / 'docs/reports/data/AMADEUS_TTS_PERFORMANCE_2026_09.json'
REPORT = ROOT / 'docs/reports/AMADEUS_TTS_PERFORMANCE_2026_09.md'
EXPECTED_SECTIONS = [
    'Original production baseline', 'Instrumentation methodology', 'Reference/profile matrix',
    'Auto vs Japanese', 'MPS vs MLX', 'p50 / p95 / min / max', 'RTF', 'Memory',
    'Owner quality acceptance', 'Chosen production configuration', 'Rejected alternatives',
    'Remaining bottleneck', 'Rollback instructions',
]


def check() -> None:
    raw = DATA.read_text()
    for forbidden in ('reference.wav', 'reference.txt', 'transcript', 'Bearer ',
                      '@s.whatsapp.net', '@g.us', 'mediaUrl', 'tts.token', '/Users/', '/Volumes/'):
        if forbidden.lower() in raw.lower():
            raise ValueError('private_content_or_path_in_report_data')
    data = json.loads(raw)
    assert data['schema_version'] == 1
    assert data['decision']['profile'] == 'A'
    assert data['decision']['backend'] == 'MLX'
    assert data['decision']['language'] == 'Auto'
    assert len(data['mps']['runs']) == 26
    assert len(data['mlx']['runs']) == 12
    assert len(data['mps']['missing']) == len(data['mps']['timeouts']) == 4
    assert all(name.startswith('B-icl-') for name in data['mps']['missing'])
    assert data['decision']['B'] == 'owner_cancelled_after_safety_incomplete'
    assert data['owner_scope_amendment']['further_B_runs_required'] is False
    assert data['owner_scope_amendment']['other_goal_requirements_unchanged'] is True
    for backend in ('mps', 'mlx'):
        for name, rows in data[backend]['runs'].items():
            warm = [r for r in rows if r.get('success') and r.get('cold_or_warm') == 'warm'
                    and not r.get('first_for_fixture')]
            assert len(warm) >= 5, name
            summary = data[backend]['summaries'][name]
            assert summary['warm_count'] == len(warm), name
            for key in ('total_ms', 'engine_ms', 'queue_wait_ms', 'encode_ms', 'audio_duration_ms', 'rtf'):
                values = [r[key] for r in warm]
                assert abs(summary[key]['p50'] - round(percentile(values, .5), 2)) < .011, (name,key)
                assert abs(summary[key]['p95'] - round(percentile(values, .95), 2)) < .011, (name,key)
                assert abs(summary[key]['min'] - round(min(values), 2)) < .011
                assert abs(summary[key]['max'] - round(max(values), 2)) < .011
            for row in rows:
                assert not (set(row) & {'text', 'transcript', 'audio_bytes', 'user', 'jid', 'reference'})
    assert set(data['mlx_candidate_endpoint']) == {'short_initial_5', 'short_sustained_20', 'normal_5'}
    assert data['mlx_candidate_endpoint']['short_sustained_20']['count'] == 20
    for name, stats in {**data['qos_endpoint'], **data['mlx_candidate_endpoint']}.items():
        values = stats['total_ms_samples']
        assert stats['count'] == len(values) and all(x > 0 for x in values), name
        assert abs(stats['p50_ms'] - round(percentile(values, .5), 2)) < .011
        assert abs(stats['p95_ms'] - round(percentile(values, .95), 2)) < .011
    text = REPORT.read_text()
    for heading in EXPECTED_SECTIONS:
        if not re.search(r'^## \d+\. ' + re.escape(heading) + r'\s*$', text, re.M):
            raise ValueError('missing_report_section_' + heading)
    assert 'B' in text and '110s' in text and 'incomplete' in text.lower()
    assert 'owner-cancelled' in text.lower()
    assert 'pronunciation/naturalness, volume and rhythm' in text
    assert '9.3 GiB' in text and '18.4 GiB' in text and 'A/MLX/Auto' in text
    for forbidden in ('reference.wav', 'reference.txt', 'Bearer ', '@s.whatsapp.net', '@g.us'):
        if forbidden.lower() in text.lower():
            raise ValueError('private_content_in_report')
    print('TTS_PERFORMANCE_REPORT=passed mps_configs=26 mlx_configs=12 B_safety_incomplete=4')

if __name__ == '__main__':
    check()
