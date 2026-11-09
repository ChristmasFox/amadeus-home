#!/usr/bin/env python3
"""Post-switch Lab release smokes. Generic chat always runs; PUBG and voice smokes run only when the
deployed diff can affect them (see lab_auto_release_contract.smoke_scope). Nothing is sent to WhatsApp."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lab_auto_release_contract import smoke_scope, valid_pubg_stats_smoke  # noqa: E402

ATTEMPTS = 3  # model-driven smokes are nondeterministic; a real regression fails every attempt
FISH_LOG = Path.home() / "Library/Logs/Amadeus/fish-tts.log"


def run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False, timeout=timeout)


def agent(machine: str, session: str, message: str) -> dict | None:
    try:
        response = run(["orb", "-m", machine, "-u", "root", "docker", "exec", "openclaw", "node", "dist/index.js", "agent",
                        "--agent", "main", "--session-key", "agent:main:" + session, "--message", message,
                        "--json", "--timeout", "180"], 200)
        payload = json.loads(response.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError):
        return None
    return payload if response.returncode == 0 and isinstance(payload, dict) else None


def chat_smoke(machine: str, key: str) -> None:
    prompt = "Reply with exactly the token LAB_CHAT_OK and nothing else."
    for attempt in range(1, ATTEMPTS + 1):
        payload = agent(machine, f"{key}-chat{attempt}", prompt)
        meta = (payload or {}).get("result", {}).get("meta", {}) if payload else {}
        if payload and payload.get("status") == "ok" and "LAB_CHAT_OK" in str(meta.get("finalAssistantVisibleText", "")):
            print("CHAT_SMOKE=passed")
            return
        print(f"CHAT_SMOKE=retry attempt={attempt}")
    raise SystemExit("Basic chat smoke failed on every attempt; automatic rollback will restore the prior image")


def pubg_smoke(machine: str, key: str) -> None:
    # recentMatches is a first-class count (no date), so the model cannot swap in "today", which is empty before
    # the squad plays. Only an all-attempts failure counts.
    prompt = ('Use the native pubg_query_stats tool with team=true, recentMatches=5, metrics=["matches","kills","damage"], '
              'and refresh=false. Do not guess or use memory. '
              'If the tool returns ok or partial, reply LAB_STATS_QUERY_OK. Otherwise reply '
              'LAB_STATS_QUERY_FAILED. Do not include player names, identifiers, or statistics in the reply.')
    for attempt in range(1, ATTEMPTS + 1):
        payload = agent(machine, key + ("" if attempt == 1 else f"-retry{attempt}"), prompt)
        if payload and valid_pubg_stats_smoke(payload):
            print("PUBG_STATS_QUERY=passed")
            return
        print(f"PUBG_STATS_QUERY=retry attempt={attempt}")
    raise SystemExit("PUBG stats query was not verified on every attempt; automatic rollback will restore the prior image")


def voice_smoke(machine: str) -> None:
    health = run(["curl", "-s", "--max-time", "5", "http://127.0.0.1:18794/healthz"], 10).stdout
    if '"status": "ready"' not in health and '"status":"ready"' not in health:
        raise SystemExit("fish-tts /healthz is not ready; automatic rollback will restore the prior image")
    print("FISH_TTS_HEALTH=ready")
    script = (
        'const k=process.env.OPENCLAW_9ROUTER_API_KEY;'
        'fetch("http://9router:20128/v1/audio/speech",{method:"POST",headers:{Authorization:"Bearer "+k,"Content-Type":"application/json"},'
        'body:JSON.stringify({model:"amadeus-tts",voice:"kurisu-v1",input:"もう、仕方ないわね。",response_format:"mp3",style:"irritated"})})'
        '.then(async r=>{const b=Buffer.from(await r.arrayBuffer());console.log(JSON.stringify({s:r.status,t:r.headers.get("content-type"),n:b.length}))})'
        '.catch(()=>console.log(JSON.stringify({s:0})))'
    )
    for attempt in range(1, ATTEMPTS + 1):
        offset = FISH_LOG.stat().st_size if FISH_LOG.exists() else 0
        out = run(["orb", "-m", machine, "-u", "root", "docker", "exec", "openclaw", "node", "-e", script], 150).stdout.strip().splitlines()
        try:
            result = json.loads(out[-1])
        except (IndexError, json.JSONDecodeError):
            result = {"s": 0}
        fresh = ""
        if FISH_LOG.exists():
            with FISH_LOG.open("rb") as handle:
                handle.seek(offset)
                fresh = handle.read().decode("utf-8", "replace")
        local_emotion = "speech_synthesis_ok" in fresh and "emotion=irritated tags=irritated tone" in fresh
        if result.get("s") == 200 and str(result.get("t", "")).startswith("audio/") and result.get("n", 0) > 2000 and local_emotion:
            print("VOICE_SMOKE=passed bridge=local_fish emotion_tag=applied")
            return
        print(f"VOICE_SMOKE=retry attempt={attempt} status={result.get('s')} local_emotion={local_emotion}")
        time.sleep(5)
    raise SystemExit("Voice smoke (bridge -> local Fish with emotion tag) failed; automatic rollback will restore the prior image")


def changed_paths(root: Path, base: str | None) -> tuple[list[str] | None, str]:
    if not base or run(["git", "-C", str(root), "cat-file", "-e", base + "^{commit}"], 20).returncode:
        return None, ""
    paths = run(["git", "-C", str(root), "diff", "--name-only", base, "HEAD"], 30).stdout.splitlines()
    dependency = run(["git", "-C", str(root), "diff", base, "HEAD", "--", "package.json", "pnpm-lock.yaml", "plugins/pubg/package.json"], 30).stdout
    return paths, dependency


def main() -> None:
    machine, key, root = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    paths, dependency = changed_paths(root, os.environ.get("LAB_SMOKE_BASE_SHA"))
    scope = smoke_scope(paths, dependency)
    print(f"SMOKE_SCOPE=pubg:{scope['pubg']} voice:{scope['voice']} base={'unknown' if paths is None else 'diff'}")
    chat_smoke(machine, key)
    if scope["pubg"]:
        pubg_smoke(machine, key)
    else:
        print("PUBG_STATS_QUERY=skipped reason=no_pubg_paths_changed")
    if scope["voice"]:
        voice_smoke(machine)
    else:
        print("VOICE_SMOKE=skipped reason=no_voice_paths_changed")


if __name__ == "__main__":
    main()
