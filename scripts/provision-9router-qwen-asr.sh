#!/usr/bin/env bash
# Reuse the operator's existing Qwen custom provider credential for the private ASR bridge.
# Never prints or passes the credential through shell arguments or Git.
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT"
MODE=dry-run
case "${1:---dry-run}" in --dry-run) ;; --apply) MODE=apply ;; *) echo 'Usage: provision-9router-qwen-asr.sh [--dry-run|--apply]' >&2; exit 2;; esac
[[ "$(hostname -s)" == Amadeus-M204 ]] || { echo 'M204 required' >&2; exit 1; }
printf 'MODE=%s\nSOURCE=active Qwen custom provider in protected 9Router SQLite\nTARGET=guest ASR upstream file + protected 9router.env\n' "$MODE"
orb -m "$ORBSTACK_MACHINE" -u root python3 - "$MODE" <<'PY'
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlparse
import hmac,json,os,shutil,sqlite3,sys
mode=sys.argv[1]
base=Path('/DATA/AppData/9router'); db=base/'data/db/data.sqlite'; env=base/'9router.env'
read=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
rows=read.execute('SELECT data FROM providerConnections WHERE provider LIKE "openai-compatible-chat-%" AND isActive=1').fetchall()
if len(rows)!=1: raise SystemExit('expected exactly one active Qwen custom provider')
d=json.loads(rows[0][0]); key=d.get('apiKey'); configured=urlparse((d.get('providerSpecificData') or {}).get('baseUrl') or '')
if not isinstance(key,str) or not key.startswith('sk-') or len(key)<24 or configured.scheme!='https' or configured.hostname!='maas.qianwenaiapi.com' or configured.path!='/compatible-mode/v1':
    raise SystemExit('Qwen credential/endpoint does not match strict source allowlist')
upstream='https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation'
if not env.is_file() or env.stat().st_mode & 0o077: raise SystemExit('protected 9router.env required')
lines=env.read_text().splitlines()
existing=[x.split('=',1)[1] for x in lines if x.startswith('AMADEUS_ASR_UPSTREAM_URL=')]
if len(existing)>1 or existing and existing[0]!=upstream: raise SystemExit('ASR upstream URL drift; no overwrite')
target=base/'secrets/asr-upstream-api-key'
if target.exists() and (not target.is_file() or not hmac.compare_digest(target.read_text().strip(),key)):
    raise SystemExit('ASR upstream key drift; no overwrite')
print('QWEN_SOURCE=active key present; model route verified separately (value suppressed)')
print('UPSTREAM_ENDPOINT=allowlisted qianwenaiapi.com multimodal-generation (workspace not printed)')
if mode!='apply': raise SystemExit(0)
checkpoint=base/'backups'/('voice-qwen-source-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
checkpoint.mkdir(parents=True,mode=0o700,exist_ok=False)
copy=sqlite3.connect(checkpoint/'data.sqlite');read.backup(copy);copy.close();read.close()
shutil.copyfile(env,checkpoint/'9router.env');(checkpoint/'9router.env').chmod(0o600)
if target.exists():
    shutil.copyfile(target,checkpoint/'asr-upstream-api-key.before');(checkpoint/'asr-upstream-api-key.before').chmod(0o600)
(checkpoint/'data.sqlite').chmod(0o600)
secrets=target.parent;secrets.mkdir(parents=True,exist_ok=True,mode=0o700)
if secrets.stat().st_mode & 0o077: raise SystemExit('secrets dir not private')
if not target.exists():
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f: f.write(key+'\n')
    os.chown(target,1000,1000)
st=target.stat()
if st.st_uid!=1000 or st.st_mode & 0o077: raise SystemExit('ASR upstream key unreadable by container node uid')
if not existing:
    temp=env.with_name('9router.env.voice-tmp')
    temp.write_text('\n'.join(lines+['AMADEUS_ASR_UPSTREAM_URL='+upstream])+'\n')
    temp.chmod(0o600);os.replace(temp,env)
print('PROVISIONED=key and URL outside Git; live container unchanged')
print('CHECKPOINT='+str(checkpoint))
PY
