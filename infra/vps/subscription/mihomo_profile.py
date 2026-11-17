#!/usr/bin/env python3
"""Apply a versioned policy to a node-only Mihomo subscription without touching credentials."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time

BEGIN = '# BEGIN AMADEUS MIHOMO POLICY v1'
END = '# END AMADEUS MIHOMO POLICY v1'


def render(subscription, template):
    if subscription.count(BEGIN) != subscription.count(END) or subscription.count(BEGIN) > 1:
        raise ValueError('invalid existing policy markers')
    if BEGIN in subscription:
        before, rest = subscription.split(BEGIN, 1)
        _, after = rest.split(END, 1)
        if after.strip(): raise ValueError('unexpected content after managed policy')
        subscription = before.rstrip() + '\n'
    if not subscription.startswith('proxies:\n'):
        raise ValueError('expected a node-only subscription')
    if re.search(r'(?m)^(?:rules|proxy-groups|rule-providers):', subscription):
        raise ValueError('existing unmanaged policy')
    names = [json.loads(m) for m in re.findall(r'(?m)^\s*- name:\s*("[^"\n]+")\s*$', subscription)]
    node_names = {}
    for key, suffix in [('__HY2__', '-HY2'), ('__REALITY__', '-Reality'), ('__TLS__', '-TLS')]:
        candidates = [n for n in names if n.endswith(suffix)]
        if len(candidates) != 1: raise ValueError(f'expected one {suffix} node')
        node_names[key] = candidates[0]
    for key, name in node_names.items():
        if template.count(key) != 1: raise ValueError('invalid policy template')
        template = template.replace(key, json.dumps(name, ensure_ascii=False))
    return subscription.rstrip() + '\n' + BEGIN + '\n' + template.rstrip() + '\n' + END + '\n'


def main():
    p = argparse.ArgumentParser(); p.add_argument('--apply', action='store_true'); p.add_argument('--template', required=True); p.add_argument('--account', required=True); args = p.parse_args()
    c = sqlite3.connect('file:/var/lib/amadeus-accounting/subscription-accounts.sqlite?mode=ro', uri=True)
    r = c.execute('select subscription_token from accounts where account_id=? and enabled=1 and is_legacy=0', (args.account,)).fetchone()
    if not r or not re.fullmatch(r'[A-Za-z0-9_-]+', r[0]): raise ValueError('dedicated account unavailable')
    f = Path('/var/lib/caddy/subscription') / r[0] / 'clash.yaml'
    if f.is_symlink() or not f.is_file(): raise ValueError('invalid subscription file')
    original = f.read_text(); output = render(original, Path(args.template).read_text())
    print('MIHOMO_POLICY_READY=1', flush=True)
    if not args.apply or original == output: return
    backup = Path('/var/backups/amadeus-mihomo-policy') / time.strftime('%Y%m%dT%H%M%S')
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    shutil.copy2(f, backup/'clash.yaml'); os.chmod(backup/'clash.yaml', 0o600)
    st = f.stat(); fd, temp = tempfile.mkstemp(prefix='.policy-', dir=f.parent)
    try:
        with os.fdopen(fd, 'w') as stream: stream.write(output); stream.flush(); os.fsync(stream.fileno())
        os.chown(temp, st.st_uid, st.st_gid); os.chmod(temp, st.st_mode & 0o777); os.replace(temp, f)
    finally:
        if os.path.exists(temp): os.unlink(temp)
    print('MIHOMO_POLICY_APPLIED=1', flush=True)


if __name__ == '__main__': main()
