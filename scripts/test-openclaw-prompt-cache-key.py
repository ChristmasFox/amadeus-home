#!/usr/bin/env python3
"""arthur-combo must send a stable per-session prompt_cache_key so the Codex cache prefix grows with the session."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "integrations/openclaw/openclaw.json.example").read_text())
model = next(item for item in config["models"]["providers"]["nine_router"]["models"] if item["id"] == "arthur-combo")
assert model.get("compat", {}).get("supportsPromptCacheKey") is True, "arthur-combo must declare compat.supportsPromptCacheKey"
assert model["compat"].get("supportsReasoningEffort") is True, "without it OpenClaw never sends reasoning_effort, so session thinkingLevel (low/medium) has no effect"
assert config["models"]["providers"]["nine_router"]["api"] == "openai-completions"
print("OPENCLAW_PROMPT_CACHE_KEY=passed")
