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
provider = c["models"]["providers"]["openai"]
assert provider["baseUrl"] == "http://9router:20128/v1"
assert provider["request"] == {"allowPrivateNetwork": True}
assert provider["apiKey"]["id"] == "OPENCLAW_9ROUTER_API_KEY"
assert all(k == "openai" or not v.get("request", {}).get("allowPrivateNetwork")
           for k, v in c["models"]["providers"].items())
media = c["tools"]["media"]
audio = [x for x in media["models"] if "audio" in x.get("capabilities", [])]
assert len(audio) == 1 and audio[0]["provider"] == "openai"
assert audio[0]["model"] == "amadeus-asr" and audio[0]["baseUrl"] == provider["baseUrl"]
assert media["audio"]["maxBytes"] <= 6 * 1024 * 1024
speech = c["tts"]
assert speech["auto"] == "inbound" and speech["mode"] == "final"
assert speech["providers"]["openai"]["baseUrl"] == provider["baseUrl"]
assert speech["providers"]["openai"]["model"] == "amadeus-tts"
assert speech["providers"]["openai"]["speakerVoice"] == "kurisu-v1"
assert "tts" not in c["channels"].get("telegram", {})
cli = ROOT / "node_modules/.pnpm/openclaw@2026.9.4/node_modules/openclaw/openclaw.mjs"
if cli.is_file():
    env = {**os.environ, "OPENCLAW_CONFIG_PATH": str(config_path),
           "OPENCLAW_9ROUTER_API_KEY": "placeholder"}
    result = subprocess.run(["node", str(cli), "config", "validate", "--json"],
                            cwd=ROOT, env=env, capture_output=True, text=True, check=True)
    assert json.loads(result.stdout)["valid"] is True
print("OPENCLAW_SPEECH_CONFIG=passed")
