#!/usr/bin/env python3
"""Minimal protected pre-apply OpenClaw config/image/WhatsApp patch checkpoint.

Requires --apply. This precedes the first 9Router Combo or OpenClaw production
write; it does not restart a service or copy any secret/runtime payload to Git.
The normal release workflow still creates its broader protected checkpoint.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import subprocess

GUEST = r'''import hashlib,json,os,shutil,stat,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
data=Path(sys.argv[1]); target=Path(sys.argv[2]); source_commit=sys.argv[3]
if str(data) != '/DATA/AppData/openclaw' or target.parent != data/'backups' or target.exists():
    raise SystemExit('protected_checkpoint_path_invalid')
config=data/'config/openclaw.json'
if config.is_symlink() or not config.is_file(): raise SystemExit('openclaw_config_missing_or_symlinked')
project=data/'config/npm/projects'
monitors=list(project.glob('*/node_modules/@openclaw/whatsapp/dist/monitor-*.js'))
if len(monitors)!=1 or monitors[0].is_symlink() or not monitors[0].is_file():
    raise SystemExit('whatsapp_monitor_not_unique_or_regular')
def inspect(name):
    result=subprocess.check_output(['docker','inspect','--format','{{.Config.Image}} {{.Image}}',name],text=True,timeout=12).strip()
    tag,digest=result.split(' ',1)
    if not tag or not digest.startswith('sha256:'): raise SystemExit('container_image_metadata_invalid')
    return {'tag':tag,'digest':digest}
openclaw=inspect('openclaw'); router=inspect('9router')
old_umask=os.umask(0o077)
try:
    target.mkdir(mode=0o700,parents=True,exist_ok=False)
    if stat.S_IMODE(target.stat().st_mode)!=0o700: raise SystemExit('checkpoint_directory_not_private')
    for src,name in ((config,'openclaw-config.before.json'),(monitors[0],'whatsapp-monitor.before.js')):
        dest=target/name
        shutil.copy2(src,dest,follow_symlinks=False)
        dest.chmod(0o600)
    manifest={'createdAt':datetime.now(timezone.utc).isoformat(),'sourceCommit':source_commit,
              'openclawImage':openclaw,'nineRouterImage':router,
              'whatsappMonitorRelativePath':str(monitors[0].relative_to(data)),
              'files':{name:hashlib.sha256((target/name).read_bytes()).hexdigest() for name in
                       ('openclaw-config.before.json','whatsapp-monitor.before.js')}}
    (target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (target/'manifest.json').chmod(0o600)
finally:
    os.umask(old_umask)
print('PRECHECKPOINT='+str(target))
print('LIVE_OPENCLAW_IMAGE='+openclaw['tag'])
print('SOURCE_COMMIT='+source_commit)
print('CHECKPOINT_MODES=0700/0600')
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--machine", default="nyannyan")
    args = parser.parse_args()
    if not args.apply:
        print("MODE=dry-run; no OpenClaw checkpoint or external write")
        return
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        raise SystemExit("checkpoint requires a clean source worktree")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = f"/DATA/AppData/openclaw/backups/amadeus-model-capability-pre-{stamp}"
    result = subprocess.run(
        ["orb", "-m", args.machine, "-u", "root", "python3", "-c", GUEST,
         "/DATA/AppData/openclaw", target, commit],
        capture_output=True, text=True, timeout=40,
    )
    if result.returncode:
        raise SystemExit("protected OpenClaw pre-apply checkpoint failed; inspect guest state privately")
    lines = result.stdout.strip().splitlines()
    if len(lines) != 4 or lines[0] != "PRECHECKPOINT=" + target or lines[3] != "CHECKPOINT_MODES=0700/0600":
        raise SystemExit("protected checkpoint evidence invalid; inspect guest state privately")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
