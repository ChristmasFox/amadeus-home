#!/usr/bin/env python3
"""Reconcile only the Kurisu private chat Combo; --apply enables writes."""
import argparse
import json
from pathlib import Path
from nine_router_management import Dashboard, local_cli_token

root = Path(__file__).resolve().parents[1]
desired = json.loads((root / 'infra/9router/kurisu-private-combo.json').read_text())
if desired != {'name': 'kurisu-private-combo', 'models': ['openrouter/anthropic/claude-haiku-5.5']}:
    raise SystemExit('invalid private combo desired state')
p = argparse.ArgumentParser()
p.add_argument('--apply', action='store_true')
p.add_argument('--verify-live', action='store_true')
p.add_argument('--machine', default='nyannyan')
a = p.parse_args()
if a.apply and a.verify_live:
    p.error('choose --apply or --verify-live')
if not (a.apply or a.verify_live):
    print('DRY_RUN=' + json.dumps(desired))
    raise SystemExit(0)
api = Dashboard('http://127.0.0.1:20128', cli_token=local_cli_token(a.machine))
combos = api.request('GET', '/api/combos')['combos']
matches = [c for c in combos if c.get('name') == desired['name']]
if len(matches) > 1 or (matches and matches[0].get('kind') not in (None, 'chat')):
    raise SystemExit('ambiguous or non-chat combo')
if not matches:
    if not a.apply: raise SystemExit('private combo missing')
    api.request('POST', '/api/combos', desired)
elif matches[0].get('models') != desired['models']:
    if not a.apply: raise SystemExit('private combo differs')
    raise SystemExit('existing combo differs; refusing to overwrite')
combos = api.request('GET', '/api/combos')['combos']
matches = [c for c in combos if c.get('name') == desired['name']]
if len(matches) != 1 or matches[0].get('models') != desired['models']:
    raise SystemExit('private combo verification failed')
print('KURISU_PRIVATE_COMBO=ready models=1')
