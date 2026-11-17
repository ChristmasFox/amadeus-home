#!/usr/bin/env python3
"""Publish an operator-supplied GeoSite snapshot at a token-scoped URL."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen

CADDY = Path('/etc/caddy/Caddyfile')
ROOT = Path('/var/lib/caddy/subscription')
MARKER = '@amadeus_geosite'
FILENAME = 'geosite.dat'


def caddy_candidate(text, token):
    if not re.fullmatch(r'[A-Za-z0-9_-]+', token): raise ValueError('invalid token')
    matches = []
    for m in re.finditer(r'(?m)^([^\s{}]+) \{\n', text):
        depth, end = 1, m.end()
        for line in text[m.end():].splitlines(keepends=True):
            depth += line.count('{') - line.count('}'); end += len(line)
            if depth == 0: break
        if depth != 0: raise ValueError('invalid site block')
        if 'import /etc/caddy/subscription-accounts.caddy' in text[m.end():end]: matches.append(m)
    if len(matches) != 2: raise ValueError('expected two subscription sites')
    hosts = {m.group(1).removesuffix(':8443') for m in matches}
    if len(hosts) != 1 or {m.group(1).endswith(':8443') for m in matches} != {True, False}: raise ValueError('subscription site mismatch')
    host = hosts.pop()
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host): raise ValueError('invalid subscription host')
    route = (f'\t{MARKER} path /{token}/{FILENAME}\n'
             f'\thandle {MARKER} {{\n\t\troot * {ROOT}\n\t\tfile_server\n\t}}\n')
    if MARKER in text:
        if text.count(route) != 2 or text.count(MARKER) != 4: raise ValueError('existing GeoSite route conflicts')
        return host, text
    for m in reversed(matches): text = text[:m.end()] + route + text[m.end():]
    return host, text


def replace(path, data, mode=None, gid=None):
    st = path.stat() if path.exists() else None
    fd, name = tempfile.mkstemp(prefix='.geosite-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.chown(name, st.st_uid if st else 0, st.st_gid if st else gid)
        os.chmod(name, (st.st_mode & 0o777) if st else mode); os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def run(*args):
    if subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30).returncode:
        raise RuntimeError(f'{args[0]} failed')


def main():
    p = argparse.ArgumentParser(); p.add_argument('--account', required=True); p.add_argument('--source', required=True); p.add_argument('--apply', action='store_true'); args = p.parse_args()
    c = sqlite3.connect('file:/var/lib/amadeus-accounting/subscription-accounts.sqlite?mode=ro', uri=True)
    r = c.execute('select subscription_token from accounts where account_id=? and enabled=1 and is_legacy=0', (args.account,)).fetchone()
    if not r or not re.fullmatch(r'[A-Za-z0-9_-]+', r[0]): raise ValueError('active account unavailable')
    token = r[0]; directory = ROOT/token; target = directory/FILENAME
    if directory.is_symlink() or not directory.is_dir() or target.is_symlink(): raise ValueError('invalid target')
    data = Path(args.source).read_bytes()
    if len(data) < 100_000 or len(data) > 50_000_000: raise ValueError('invalid GeoSite snapshot size')
    old_caddy = CADDY.read_bytes(); host, candidate = caddy_candidate(old_caddy.decode(), token)
    with tempfile.TemporaryDirectory(prefix='amadeus-geosite-') as td:
        temp_caddy = Path(td)/'Caddyfile'; temp_caddy.write_text(candidate)
        run('/usr/bin/caddy','validate','--config',str(temp_caddy))
        print('GEOSITE_MIRROR_READY=1', flush=True)
        if not args.apply: return
        backup = Path('/var/backups/amadeus-geosite')/time.strftime('%Y%m%dT%H%M%S')
        backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        (backup/'Caddyfile').write_bytes(old_caddy); os.chmod(backup/'Caddyfile',0o600)
        old_data = target.read_bytes() if target.exists() else None
        if old_data is not None: (backup/FILENAME).write_bytes(old_data); os.chmod(backup/FILENAME,0o600)
        try:
            replace(target,data,mode=0o640,gid=directory.stat().st_gid)
            replace(CADDY,candidate.encode()); run('/bin/systemctl','reload','caddy')
            try:
                with urlopen(Request(f'https://{host}/{token}/{FILENAME}',method='HEAD'),timeout=20) as r:
                    if r.status != 200 or int(r.headers['Content-Length']) != len(data): raise ValueError('size mismatch')
            except Exception: raise RuntimeError('public GeoSite check failed') from None
            if hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(data).digest(): raise RuntimeError('GeoSite checksum mismatch')
        except BaseException:
            replace(CADDY,old_caddy);run('/usr/bin/caddy','validate','--config',str(CADDY));run('/bin/systemctl','reload','caddy')
            if old_data is None: target.unlink(missing_ok=True)
            else: replace(target,old_data)
            print('GEOSITE_MIRROR_ROLLBACK=1',flush=True);raise
        print('GEOSITE_MIRROR_APPLIED=1',flush=True)


if __name__ == '__main__': main()
