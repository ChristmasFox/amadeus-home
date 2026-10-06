#!/usr/bin/env python3
"""Pinned native speech config contract, without a live provider request."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
config_path = ROOT / "integrations/openclaw/openclaw.json.example"
c = json.loads(config_path.read_text())
assert c["browser"]["ssrfPolicy"]["dangerouslyAllowPrivateNetwork"] is True
provider = c["models"]["providers"]["openai"]
assert provider["baseUrl"] == "http://9router:20128/v1"
assert provider["request"] == {"allowPrivateNetwork": True}
assert provider["apiKey"]["id"] == "OPENCLAW_9ROUTER_API_KEY"
assert c["agents"]["defaults"]["mediaModels"]["image"] == {
    "primary": "openai/amadeus-image",
    "timeoutMs": 600000,
}
assert provider["models"] == [{
    "id": "amadeus-image",
    "name": "Amadeus Image",
}]
amadeus_manifest = json.loads((ROOT / "plugins/amadeus/openclaw.plugin.json").read_text())
assert "skills/image-generation" in amadeus_manifest["skills"]
image_skill = (ROOT / "plugins/amadeus/skills/image-generation/SKILL.md").read_text()
assert "image_generate" in image_skill and "fixed trigger phrases" in image_skill
assert "ag/gemini-3.1-flash-image" not in image_skill
assert "cx/gpt-image-2.5" not in image_skill
assert all(k == "openai" or not v.get("request", {}).get("allowPrivateNetwork")
           for k, v in c["models"]["providers"].items())
media = c["tools"]["media"]
audio = [x for x in media["models"] if "audio" in x.get("capabilities", [])]
assert len(audio) == 1 and audio[0]["provider"] == "openai"
assert audio[0]["model"] == "amadeus-asr" and audio[0]["baseUrl"] == provider["baseUrl"]
assert media["audio"]["maxBytes"] <= 6 * 1024 * 1024
# Typed delivery owns TTS; generic auto mode and Agent-facing TTS/message tools are disabled.
assert c["tools"]["profile"] == "full"
assert c["tools"].get("deny") == ["tts", "message"]
assert c["tools"]["toolsBySender"]["*"].get("allow") == ["web_search", "web_fetch"]
assert c["agents"]["defaults"]["typingMode"] == "instant"
assert c["agents"]["defaults"]["typingIntervalSeconds"] == 3
user_seed = (ROOT / "integrations/openclaw/workspace-seed/USER.seed.md").read_text()
assert "Prefer Simplified Chinese for ordinary text replies." in user_seed
assert "Prefer Japanese replies by default" not in user_seed
speech = c["tts"]
assert speech["auto"] == "off" and speech["mode"] == "final"
assert speech["modelOverrides"] == {"enabled": False}
assert speech["providers"]["openai"]["baseUrl"] == provider["baseUrl"]
assert speech["providers"]["openai"]["model"] == "amadeus-tts"
assert speech["providers"]["openai"]["speakerVoice"] == "kurisu-v1"
assert speech["providers"]["openai"]["responseFormat"] == "mp3"
assert speech["maxTextLength"] == 1200 and speech["timeoutMs"] == 120000
for channel in ("whatsapp", "telegram"):
    group = c["channels"][channel]["groups"]["*"]
    assert group["requireMention"] is False
    assert group["tools"] == {"allow": [
        "web_search", "web_fetch", "image_generate",
        "pubg_resolve_players", "pubg_search_matches", "pubg_query_stats",
        "pubg_compare_stats", "pubg_get_match", "pubg_get_review_facts",
        "pubg_get_period_review", "pubg_query_team_damage",
        "pubg_prefetch_telemetry", "pubg_telemetry_sync_report",
        "amadeus_macos_host_status", "amadeus_macos_host_processes",
    ]}
assert c["tools"]["toolsBySender"]["*"]["allow"] == ["web_search", "web_fetch"]
voice_skill = (ROOT / "plugins/amadeus/skills/voice-reply/SKILL.md").read_text()
assert "DeliveryEnvelope v2" in voice_skill and '"kind": "voice"' in voice_skill
assert '"speechText"' in voice_skill and '"emotion"' in voice_skill
assert "NO_REPLY" not in voice_skill and "reply-modality" not in voice_skill
assert "verified inbound WhatsApp voice lease" in voice_skill
assert "tts" not in c["channels"].get("telegram", {})
cli = ROOT / "node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/openclaw.mjs"
if cli.is_file():
    env = {**os.environ, "OPENCLAW_CONFIG_PATH": str(config_path),
           "OPENCLAW_9ROUTER_API_KEY": "placeholder"}
    result = subprocess.run(["node", str(cli), "config", "validate", "--json"],
                            cwd=ROOT, env=env, capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["valid"] is True
    runtime_root = cli.parent / "dist"
    tool_descriptors = list(runtime_root.glob("core-tool-factory-descriptors-*.mjs"))
    assert len(tool_descriptors) == 1
    assert 'name: "image_generate"' in tool_descriptors[0].read_text()
    openai_image_provider = runtime_root / "extensions/openai/index.js"
    assert "api.registerImageGenerationProvider(buildOpenAIImageGenerationProvider" \
        in openai_image_provider.read_text()
    policy_module = next(cli.parent.glob("dist/tool-policy-match-*.mjs"))
    # The pinned matcher applies each layer to the remaining tools. Owner
    # allow=["*"] cannot reintroduce a tool filtered by global deny.
    policy_check = subprocess.run([
        "node", "--input-type=module", "-e",
        "import { pathToFileURL } from 'node:url'; "
        "const m = await import(pathToFileURL(process.argv[1])); const filter = m.r ?? m.filterToolsByPolicy; "
        "const tools = [{name:'image_generate'}, {name:'tts'}, {name:'message'}, {name:'web_search'}, {name:'amadeus_nas'}]; "
        "const afterGlobal = filter(tools, {deny:['tts','message']}); "
        "const afterOwner = filter(afterGlobal, {allow:['*']}); "
        "if (!afterOwner.some(t=>t.name==='image_generate') || afterOwner.some(t=>['tts','message'].includes(t.name)) || afterOwner.length!==3) process.exit(1);",
        str(policy_module),
    ], cwd=ROOT, capture_output=True, text=True)
    assert policy_check.returncode == 0, policy_check.stderr
print("OPENCLAW_SPEECH_CONFIG=passed")
