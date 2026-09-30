#!/usr/bin/env python3
"""Explicit, idempotent 9Router STT/TTS connection and alias provisioning.

Uses the upstream's protected local CLI token by default; an operator password
file is optional. Provider keys remain outside Git. Never prints credentials.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import subprocess
import time
import re
from pathlib import Path
from nine_router_management import Dashboard, local_cli_token, protected
import urllib.error
import urllib.request

ASR_PROVIDER = "selfhosted-stt"
TTS_PROVIDER = "selfhosted-tts"
ASR_CONNECTION = "Amadeus ASR (Qwen upstream)"
TTS_CONNECTION = "Amadeus TTS (Qwen3-TTS MLX primary + Qwen Audio fallback)"
ASR_URL = "http://127.0.0.1:20129/v1/audio/transcriptions"
TTS_ADAPTER_URL = "http://127.0.0.1:20130"
TTS_DIRECT_HOST_URL = "http://host.docker.internal:18792"
# Compatibility alias used by the existing deterministic provisioning tests.
TTS_URL = TTS_ADAPTER_URL
TTS_MODEL = "selfhosted-tts/qwen3-tts-1.7b/kurisu-v1"


def ensure_connection(api: Dashboard, provider: str, name: str, key: str, url: str) -> str:
    connections = api.request("GET", "/api/providers").get("connections", [])
    matches = [c for c in connections if c.get("name") == name]
    if len(matches) > 1:
        raise RuntimeError(f"ambiguous_connection:{name}")
    if matches:
        current = matches[0]
        if current.get("provider") != provider or current.get("providerSpecificData", {}).get("baseUrl", "").rstrip("/") != url.rstrip("/"):
            raise RuntimeError(f"connection_drift:{name}")
        return "existing"
    api.request("POST", "/api/providers", {
        "provider": provider,
        "name": name,
        "apiKey": key,
        "providerSpecificData": {"baseUrl": url},
    })
    return "created"


def ensure_alias(api: Dashboard, alias: str, model: str) -> str:
    aliases = api.request("GET", "/api/models/alias").get("aliases", {})
    current = aliases.get(alias)
    if current == model:
        return "existing"
    if current is not None:
        # The old amadeus-asr Chat Combo is separate storage; an alias may not
        # override a Combo in getModelInfo. Refuse instead of false success.
        raise RuntimeError(f"alias_drift:{alias}")
    api.request("PUT", "/api/models/alias", {"alias": alias, "model": model})
    return "created"


def ensure_tts_connection(api: Dashboard, key: str, url: str = TTS_ADAPTER_URL) -> str:
    """Keep exactly one Amadeus self-hosted TTS connection on the bridge.

    The route is repaired add-before-remove, so the logical model remains
    available while duplicate known bridge/direct-host entries are retired.
    Unknown self-hosted TTS endpoints fail closed rather than being guessed.
    """
    if url.rstrip("/") != TTS_ADAPTER_URL:
        raise RuntimeError(f"connection_drift:{TTS_CONNECTION}")
    connections = api.request("GET", "/api/providers").get("connections", [])
    owned = [c for c in connections if c.get("provider") == TTS_PROVIDER]
    known_urls = {TTS_ADAPTER_URL, TTS_DIRECT_HOST_URL}
    for connection in owned:
        base = (connection.get("providerSpecificData") or {}).get("baseUrl", "").rstrip("/")
        if base not in known_urls:
            raise RuntimeError(f"connection_drift:{TTS_CONNECTION}")
    named = [c for c in owned if c.get("name") == TTS_CONNECTION]
    if len(named) > 1:
        raise RuntimeError(f"ambiguous_connection:{TTS_CONNECTION}")
    created = False
    if named:
        connection = named[0]
        base = (connection.get("providerSpecificData") or {}).get("baseUrl", "").rstrip("/")
        if base != TTS_ADAPTER_URL:
            raise RuntimeError(f"connection_drift:{TTS_CONNECTION}")
    else:
        ensure_connection(api, TTS_PROVIDER, TTS_CONNECTION, key, TTS_ADAPTER_URL)
        created = True
    current = api.request("GET", "/api/providers").get("connections", [])
    keep = [c for c in current if c.get("name") == TTS_CONNECTION and c.get("provider") == TTS_PROVIDER]
    if len(keep) != 1 or (keep[0].get("providerSpecificData") or {}).get("baseUrl", "").rstrip("/") != TTS_ADAPTER_URL:
        raise RuntimeError(f"connection_drift:{TTS_CONNECTION}")
    keep_id = keep[0].get("id")
    if not keep_id:
        raise RuntimeError(f"connection_id_missing:{TTS_CONNECTION}")
    retired = 0
    for connection in current:
        if connection.get("provider") != TTS_PROVIDER or connection.get("id") == keep_id:
            continue
        if not connection.get("id"):
            raise RuntimeError(f"connection_id_missing:{TTS_CONNECTION}")
        api.request("DELETE", "/api/providers/" + str(connection["id"]))
        retired += 1
    if created or retired:
        return "reconciled"
    return "existing"

def backup_live(machine: str) -> str:
    """SQLite online backup plus protected env/compose and image metadata in guest."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = f"/DATA/AppData/9router/backups/qwen-audio-tts-{stamp}"
    code = r"""import os,sqlite3,shutil,sys,json,subprocess
from pathlib import Path
out=Path(sys.argv[1]); out.mkdir(mode=0o700,parents=True,exist_ok=False)
src=sqlite3.connect('file:/DATA/AppData/9router/data/db/data.sqlite?mode=ro',uri=True)
dst=sqlite3.connect(out/'data.sqlite'); src.backup(dst); dst.close(); src.close()
for source,name in [('/DATA/AppData/9router/9router.env','9router.env'),('/var/lib/casaos/apps/9router/docker-compose.yml','docker-compose.yml')]:
    p=Path(source)
    if p.is_file(): shutil.copyfile(p,out/name); (out/name).chmod(0o600)
image=subprocess.check_output(['docker','inspect','9router','--format','{{.Config.Image}} {{.Image}}'],text=True).strip()
(out/'runtime.json').write_text(json.dumps({'image_and_digest':image,'purpose':'qwen-audio-tts-rollback'},indent=2)+'\n')
for p in out.iterdir(): p.chmod(0o600)
print('BACKUP_CREATED')
"""
    try:
        result = subprocess.run(["orb", "-m", machine, "-u", "root", "python3", "-c", code, target],
                                capture_output=True, text=True, timeout=120, check=True)
    except subprocess.CalledProcessError:
        raise RuntimeError("protected_guest_backup_failed") from None
    if result.stdout.strip() != "BACKUP_CREATED":
        raise RuntimeError("guest_backup_unverified")
    return target


def retire_old_combo(api: Dashboard) -> str:
    combos = api.request("GET", "/api/combos").get("combos", [])
    matches = [c for c in combos if c.get("name") == "amadeus-asr"]
    if not matches:
        return "absent"
    if len(matches) != 1 or not matches[0].get("id"):
        raise RuntimeError("ambiguous_old_asr_combo")
    api.request("DELETE", "/api/combos/" + str(matches[0]["id"]))
    return "retired"


def runtime_speech_ready(machine: str) -> bool:
    """Refuse alias writes until both actual speech endpoints are healthy."""
    probe = f'''Promise.all([
      fetch("http://127.0.0.1:20129/healthz"),
      fetch("{TTS_ADAPTER_URL}/healthz")
    ]).then(([asr,tts])=>process.exit(asr.ok&&tts.ok?0:1)).catch(()=>process.exit(1))'''
    return subprocess.run(["orb", "-m", machine, "-u", "root", "docker", "exec", "9router", "node", "-e", probe],
                          capture_output=True, timeout=12).returncode == 0


def restart_and_verify(machine: str) -> None:
    subprocess.run(["orb", "-m", machine, "-u", "root", "docker", "restart", "9router"],
                   capture_output=True, timeout=90, check=True)
    probe = r'''Promise.all([
      fetch("http://127.0.0.1:20128/api/health"),
      fetch("http://127.0.0.1:20129/healthz")
    ]).then(([router,bridge])=>process.exit(router.ok&&bridge.ok?0:1)).catch(()=>process.exit(1))'''
    for _ in range(45):
        result = subprocess.run(["orb", "-m", machine, "-u", "root", "docker", "exec", "9router", "node", "-e", probe],
                                capture_output=True, timeout=12)
        if result.returncode == 0:
            try:
                urllib.request.urlopen("http://127.0.0.1:20128/v1/models", timeout=4)
            except urllib.error.HTTPError as exc:
                if exc.code == 401:
                    return
        time.sleep(2)
    raise RuntimeError("post_alias_restart_health_or_auth_failed; restore protected checkpoint")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true", help="explicitly select the default plan-only mode")
    parser.add_argument("--dashboard-password-file")
    parser.add_argument("--asr-key-file")
    parser.add_argument("--tts-key-file")
    parser.add_argument("--asr-model", default="qwen-audio-3.0-asr-flash")
    parser.add_argument("--machine", default="nyannyan", help="M204 OrbStack guest")
    args = parser.parse_args()
    if not args.apply:
        print("MODE=dry-run; no local CLI auth, provider or alias write")
        print("ASR=selfhosted-stt via local bounded DashScope multimodal protocol adapter; old Chat Combo retired after guest checkpoint")
        print("TTS=selfhosted-tts via container bridge (Qwen3-TTS MLX :18794 -> Qwen Audio 3.1 -> 3.0)")
        return
    if not all((args.asr_key_file, args.tts_key_file)):
        parser.error("--apply requires protected ASR bridge/TTS key files")
    if "/" in args.asr_model or not args.asr_model.strip():
        parser.error("ASR model id must be a single segment")
    if not runtime_speech_ready(args.machine):
        raise RuntimeError("speech_runtime_not_ready; no dashboard write")
    api = Dashboard("http://127.0.0.1:20128",
                    cli_token=None if args.dashboard_password_file else local_cli_token(args.machine))
    if args.dashboard_password_file:
        api.login(protected(args.dashboard_password_file))
    api.request("GET", "/api/providers")  # fail closed on auth before backup/write
    checkpoint = backup_live(args.machine)
    print("ROLLBACK_CHECKPOINT=" + checkpoint)
    asr = ensure_connection(api, ASR_PROVIDER, ASR_CONNECTION, protected(args.asr_key_file), ASR_URL)
    tts = ensure_tts_connection(api, protected(args.tts_key_file), tts_url)
    print("ASR_CONNECTION=" + asr)
    print("TTS_CONNECTION=" + tts)
    print("OLD_ASR_COMBO=" + retire_old_combo(api))
    print("ASR_ALIAS=" + ensure_alias(api, "amadeus-asr", f"selfhosted-stt/{args.asr_model}"))
    print("TTS_ALIAS=" + ensure_alias(api, "amadeus-tts", TTS_MODEL))
    # Pinned 0.5.81 and evaluated 0.5.86 each cache STT aliases inside a
    # route bundle. The alias only resolves after a 9Router process restart.
    restart_and_verify(args.machine)
    print("SPEECH_ALIASES=active_after_restart (direct media smoke still required)")


if __name__ == "__main__":
    main()
