#!/usr/bin/env python3
"""Publish an operator-supplied Shadowrocket profile at a token-scoped URL."""
import argparse
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
from urllib.request import urlopen

CADDY = Path('/etc/caddy/Caddyfile')
ROOT = Path('/var/lib/caddy/subscription')
FILENAME = 'shadowrocket-rules.conf'
MARKER = '@amadeus_shadowrocket_rules'


def caddy_candidate(text, token):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', token): raise ValueError('invalid token')
    if MARKER in text: raise ValueError('existing Shadowrocket rule route requires review')
    matches = []
    for match in re.finditer(r'(?m)^([^\s{}]+) \{\n', text):
        depth, end = 1, match.end()
        for line in text[match.end():].splitlines(keepends=True):
            depth += line.count('{') - line.count('}'); end += len(line)
            if depth == 0: break
        if depth != 0: raise ValueError('invalid site block')
        if 'import /etc/caddy/subscription-accounts.caddy' in text[match.end():end]:
            matches.append(match)
    if len(matches) != 2: raise ValueError('expected two subscription sites')
    hosts = {m.group(1).removesuffix(':8443') for m in matches}
    if len(hosts) != 1 or {m.group(1).endswith(':8443') for m in matches} != {True, False}:
        raise ValueError('subscription site mismatch')
    host = hosts.pop()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host): raise ValueError('invalid subscription host')
    route = (f'\t{MARKER} path /{token}/{FILENAME}\n'
             f'\thandle {MARKER} {{\n\t\troot * {ROOT}\n\t\tfile_server\n\t}}\n')
    for match in reversed(matches): text = text[:match.end()] + route + text[match.end():]
    return host, text


def build_profile(content):
    text = content.decode('utf-8-sig')
    if '[Proxy Group]' not in text or '[Rule]' not in text: raise ValueError('expected Shadowrocket rule profile')
    lines = text.splitlines(keepends=True)
    found = [i for i, line in enumerate(lines) if re.match(r'^\s*美国节点\s*=\s*url-test,', line)]
    if len(found) != 1 or 'policy-regex-filter=' not in lines[found[0]]: raise ValueError('expected one US selector')
    i = found[0]
    if 'Amadeus-.*-(HY2|Reality|TLS)' not in lines[i]:
        lines[i] = lines[i].rstrip('\r\n') + '|Amadeus-.*-(HY2|Reality|TLS)\n'
    return ''.join(lines)


def run(*args):
    result = subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    if result.returncode: raise RuntimeError(f'{args[0]} failed')


def replace(path, text, mode=None, gid=None):
    exists = path.exists()
    st = path.stat() if exists else None
    fd, name = tempfile.mkstemp(prefix='.shadowrocket-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as f: f.write(text); f.flush(); os.fsync(f.fileno())
        os.chown(name, st.st_uid if st else 0, st.st_gid if st else gid)
        os.chmod(name, (st.st_mode & 0o777) if st else mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def main():
    p = argparse.ArgumentParser(); p.add_argument('--account', required=True); p.add_argument('--source', required=True); p.add_argument('--apply', action='store_true'); args = p.parse_args()
    c = sqlite3.connect('file:/var/lib/amadeus-accounting/subscription-accounts.sqlite?mode=ro', uri=True)
    row = c.execute('select subscription_token from accounts where account_id=? and enabled=1 and is_legacy=0', (args.account,)).fetchone()
    if not row: raise ValueError('active account unavailable')
    token = row[0]
    if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', token): raise ValueError('invalid token')
    directory = ROOT/token
    if directory.is_symlink() or not directory.is_dir(): raise ValueError('invalid subscription directory')
    target = directory/FILENAME
    if target.is_symlink(): raise ValueError('invalid policy target')
    profile = build_profile(Path(args.source).read_bytes())
    old_caddy = CADDY.read_text(); host, candidate = caddy_candidate(old_caddy, token)
    with tempfile.TemporaryDirectory(prefix='amadeus-shadowrocket-') as td:
        candidate_path = Path(td)/'Caddyfile'; candidate_path.write_text(candidate)
        run('/usr/bin/caddy', 'validate', '--config', str(candidate_path))
        print('SHADOWROCKET_PROFILE_READY=1', flush=True)
        if not args.apply: return
        backup = Path('/var/backups/amadeus-shadowrocket-policy')/time.strftime('%Y%m%dT%H%M%S')
        backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        shutil.copy2(CADDY, backup/'Caddyfile'); os.chmod(backup/'Caddyfile', 0o600)
        old_profile = target.read_text() if target.exists() else None
        if old_profile is not None:
            (backup/'shadowrocket-rules.conf').write_text(old_profile); os.chmod(backup/'shadowrocket-rules.conf', 0o600)
        try:
            replace(target, profile, mode=0o640, gid=directory.stat().st_gid)
            replace(CADDY, candidate)
            run('/bin/systemctl', 'reload', 'caddy')
            try:
                with urlopen(f'https://{host}/{token}/{FILENAME}', timeout=15) as response:
                    if response.status != 200 or response.read().decode('utf-8') != profile: raise ValueError('body mismatch')
            except Exception: raise RuntimeError('public profile check failed') from None
        except BaseException:
            replace(CADDY, old_caddy); run('/usr/bin/caddy', 'validate', '--config', str(CADDY)); run('/bin/systemctl', 'reload', 'caddy')
            if old_profile is None: target.unlink(missing_ok=True)
            else: replace(target, old_profile)
            print('SHADOWROCKET_PROFILE_ROLLBACK=1', flush=True)
            raise
        print('SHADOWROCKET_PROFILE_APPLIED=1', flush=True)


if __name__ == '__main__': main()
