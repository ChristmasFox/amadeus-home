#!/usr/bin/env python3
"""Add an authenticated VLESS/WSS/TLS backup to existing account subscriptions.

Run on the gateway as root. The default is a read-only plan. --apply creates
root-only checkpoints, validates candidates, and rolls back on failure.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
from urllib.parse import urlencode, quote

XRAY = Path('/etc/xray/config.json')
CADDY = Path('/etc/caddy/Caddyfile')
DB = Path('/var/lib/amadeus-accounting/subscription-accounts.sqlite')
SUBS = Path('/var/lib/caddy/subscription')
PATH = '/amadeus-vless-tls'
PORT = 24432
TAG = 'amadeus-vless-wss-in'
FILES = ('clash.yaml', 'shadowrocket.txt', 'qx.conf', 'server.snippet')


def caddy_candidate(text):
    match = list(re.finditer(r'(?m)^([^\s:{}]+) \{\n(?=\s*import /etc/caddy/subscription-accounts\.caddy\s*$)', text))
    if len(match) != 1:
        raise ValueError('expected one standard subscription HTTPS site')
    host = match[0].group(1)
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host) or '.' not in host:
        raise ValueError('invalid subscription hostname')
    if PATH in text:
        raise ValueError('TLS route already exists; inspect current deployment')
    route = f'\thandle {PATH} {{\n\t\treverse_proxy 127.0.0.1:{PORT}\n\t}}\n'
    return host, text[:match[0].end()] + route + text[match[0].end():]


def xray_candidate(text, accounts):
    data = json.loads(text)
    inbounds = data['inbounds']
    if any(x.get('tag') == TAG or x.get('port') == PORT for x in inbounds):
        raise ValueError('TLS inbound conflicts with an existing inbound')
    original = [x for x in inbounds if x.get('tag') == 'vless-reality-in']
    if len(original) != 1:
        raise ValueError('expected one original Reality inbound')
    clients = original[0]['settings']['clients']
    by_id = {x['id']: x for x in clients}
    if len(accounts) != 6 or len(by_id) != 6 or set(by_id) != {a['vless_uuid'] for a in accounts}:
        raise ValueError('active accounts and Reality clients do not match')
    incoming = [{'id': a['vless_uuid'], 'email': by_id[a['vless_uuid']]['email'], 'level': by_id[a['vless_uuid']].get('level', 0)} for a in accounts]
    inbounds.append({'tag': TAG, 'listen': '127.0.0.1', 'port': PORT, 'protocol': 'vless',
                     'settings': {'clients': incoming, 'decryption': 'none'},
                     'streamSettings': {'network': 'ws', 'security': 'none', 'wsSettings': {'path': PATH}}})
    return json.dumps(data, indent=2, ensure_ascii=False) + '\n'


def subscription_candidate(filename, text, account, host):
    label = f"Amadeus-{account['account_id']}-TLS"
    if label in text:
        raise ValueError('TLS node already present in subscription')
    uid = account['vless_uuid']
    if filename == 'clash.yaml':
        if not text.startswith('proxies:'):
            raise ValueError('unexpected Clash subscription layout')
        content = (f'  - name: {json.dumps(label)}\n    type: vless\n    server: {json.dumps(host)}\n'
                   f'    port: 443\n    uuid: {json.dumps(uid)}\n    tls: true\n    servername: {json.dumps(host)}\n'
                   f'    network: ws\n    udp: false\n    ws-opts:\n      path: {json.dumps(PATH)}\n      headers:\n        Host: {json.dumps(host)}\n')
    elif filename == 'shadowrocket.txt':
        query = urlencode({'encryption': 'none', 'security': 'tls', 'sni': host, 'type': 'ws', 'host': host, 'path': PATH})
        content = f'vless://{uid}@{host}:443?{query}#{quote(label)}\n'
    elif filename in ('qx.conf', 'server.snippet'):
        content = f'vless={host}:443, method=none, password={uid}, obfs=wss, obfs-host={host}, obfs-uri={PATH}, tls-verification=true, fast-open=false, udp-relay=false, tag={label}\n'
    else:
        raise ValueError('unexpected subscription format')
    return text.rstrip('\n') + '\n' + content


def run(*command, timeout=30):
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed (exit {result.returncode})')


def replace(path, data):
    st = path.stat()
    fd, name = tempfile.mkstemp(prefix='.tls-node-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(name, st.st_mode & 0o777); os.chown(name, st.st_uid, st.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def smoke(host, account, tmp):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    config = {'log': {'loglevel': 'none'}, 'inbounds': [{'listen': '127.0.0.1', 'port': port, 'protocol': 'socks', 'settings': {'udp': False}}],
              'outbounds': [{'protocol': 'vless', 'settings': {'vnext': [{'address': host, 'port': 443, 'users': [{'id': account['vless_uuid'], 'encryption': 'none'}]}]},
                             'streamSettings': {'network': 'ws', 'security': 'tls', 'tlsSettings': {'serverName': host}, 'wsSettings': {'path': PATH, 'headers': {'Host': host}}}}]}
    client = tmp / 'client.json'; client.write_text(json.dumps(config)); os.chmod(client, 0o600)
    p = subprocess.Popen(['/usr/local/bin/xray', 'run', '-config', str(client)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(.5)
        if p.poll() is not None: raise RuntimeError('temporary smoke client did not start')
        run('/usr/bin/curl', '--fail', '--silent', '--show-error', '--max-time', '20', '--noproxy', '', '--proxy', f'socks5h://127.0.0.1:{port}', 'https://www.google.com/generate_204', timeout=25)
    finally:
        p.terminate()
        try: p.wait(timeout=3)
        except subprocess.TimeoutExpired: p.kill(); p.wait()


def main():
    p = argparse.ArgumentParser(); p.add_argument('--apply', action='store_true'); args = p.parse_args()
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True); c.row_factory = sqlite3.Row
    accounts = [dict(r) for r in c.execute('select account_id, subscription_token, vless_uuid from accounts where enabled=1 and is_legacy=0 order by account_id')]
    host, caddy = caddy_candidate(CADDY.read_text())
    xray = xray_candidate(XRAY.read_text(), accounts)
    updates = {XRAY: xray, CADDY: caddy}
    for a in accounts:
        token = a['subscription_token']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', token): raise ValueError('invalid subscription token')
        directory = SUBS / token
        if directory.is_symlink() or not directory.is_dir(): raise ValueError('unsafe subscription directory')
        for name in FILES:
            target = directory / name
            if target.is_symlink() or not target.is_file(): raise ValueError('unsafe subscription file')
            updates[target] = subscription_candidate(name, target.read_text(), a, host)
    with tempfile.TemporaryDirectory(prefix='amadeus-tls-candidate-') as name:
        tmp = Path(name); os.chmod(tmp, 0o700)
        (tmp/'xray.json').write_text(xray); (tmp/'Caddyfile').write_text(caddy)
        run('/usr/local/bin/xray', 'run', '-test', '-config', str(tmp/'xray.json'))
        run('/usr/bin/caddy', 'validate', '--config', str(tmp/'Caddyfile'))
        print(f'TLS_CANDIDATE_VALID=1 ACCOUNTS={len(accounts)} SUBSCRIPTIONS={len(updates)-2}', flush=True)
        if not args.apply: return
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', PORT))  # Fail before changing anything if the port is occupied.
        backup = Path('/var/backups/amadeus-tls-node') / time.strftime('%Y%m%dT%H%M%S')
        backup.mkdir(mode=0o700, parents=True, exist_ok=False)
        originals = {target: target.read_text() for target in updates}
        for i, (target, content) in enumerate(originals.items()):
            (backup / str(i)).write_text(content); os.chmod(backup / str(i), 0o600)
        (backup/'manifest.json').write_text(json.dumps([str(x) for x in originals])); os.chmod(backup/'manifest.json', 0o600)
        def interrupted(signum, _frame): raise RuntimeError(f'interrupted by signal {signum}')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        try:
            replace(XRAY, xray); run('/bin/systemctl', 'restart', 'xray')
            replace(CADDY, caddy); run('/bin/systemctl', 'reload', 'caddy')
            run('/bin/systemctl', 'is-active', '--quiet', 'xray'); run('/bin/systemctl', 'is-active', '--quiet', 'caddy')
            for a in accounts:
                smoke(host, a, tmp); print(f"TLS_ACCOUNT_SMOKE={a['account_id']}:passed", flush=True)
            for target, content in updates.items():
                if target not in (XRAY, CADDY): replace(target, content)
        except BaseException:
            for target, content in originals.items(): replace(target, content)
            run('/usr/local/bin/xray', 'run', '-test', '-config', str(XRAY))
            run('/usr/bin/caddy', 'validate', '--config', str(CADDY))
            run('/bin/systemctl', 'restart', 'xray'); run('/bin/systemctl', 'reload', 'caddy')
            print('TLS_APPLY=rolled_back', flush=True)
            raise
        print('TLS_APPLY=success', flush=True)


if __name__ == '__main__': main()
