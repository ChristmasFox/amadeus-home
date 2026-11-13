#!/usr/bin/env python3
"""arthur-combo must send a stable per-session prompt_cache_key so the Codex cache prefix grows with the session."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
config = json.loads((ROOT / "integrations/openclaw/openclaw.json.example").read_text())
model = next(item for item in config["models"]["providers"]["nine_router"]["models"] if item["id"] == "arthur-combo")
assert model.get("compat", {}).get("supportsPromptCacheKey") is True, "arthur-combo must declare compat.supportsPromptCacheKey"
assert model["compat"].get("supportsReasoningEffort") is True, "without it OpenClaw never sends reasoning_effort, so session thinkingLevel has no effect"
assert config["models"]["providers"]["nine_router"]["api"] == "openai-completions"
# The chat thinking level is max: OpenClaw rejects a level the model does not list, so the example must declare it.
assert model["thinkingLevelMap"] == {"xhigh": "xhigh", "max": "max"}
assert "max" in model["compat"]["supportedReasoningEfforts"] and "xhigh" in model["compat"]["supportedReasoningEfforts"]
import importlib.util
spec = importlib.util.spec_from_file_location("openclaw_prepare", ROOT / "scripts/openclaw_prepare.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)
live = {"models": {"providers": {"nine_router": {"models": [{"id": "arthur-combo", "compat": {"supportsPromptCacheKey": True}}, {"id": "Qwen/qwen-plus"}]}}}}
prepare.ensure_arthur_combo_thinking_levels(live)
combo = live["models"]["providers"]["nine_router"]["models"][0]
assert combo["thinkingLevelMap"] == {"xhigh": "xhigh", "max": "max"} and combo["compat"]["supportsPromptCacheKey"] is True
assert combo["compat"]["supportedReasoningEfforts"] == ["low", "medium", "high", "xhigh", "max"] and combo["compat"]["supportsReasoningEffort"] is True
assert "thinkingLevelMap" not in live["models"]["providers"]["nine_router"]["models"][1], "other models are untouched"
prepare.ensure_arthur_combo_thinking_levels(live)
assert live["models"]["providers"]["nine_router"]["models"][0] == combo, "idempotent"
prepare.ensure_arthur_combo_thinking_levels({})  # no provider configured: nothing to do
print("OPENCLAW_PROMPT_CACHE_KEY=passed")

# Private chats: the non-owner sender policy gains the Luckin tools once, owner rules stay untouched, unrelated policies are refused.
senders_config = {"tools": {"toolsBySender": {"*": {"allow": list(prepare.NON_OWNER_TOOL_ALLOWLIST)}, "id:owner": {"allow": ["*"]}}}}
prepare.ensure_non_owner_luckin_tools(senders_config)
once = json.dumps(senders_config, sort_keys=True)
prepare.ensure_non_owner_luckin_tools(senders_config)
assert json.dumps(senders_config, sort_keys=True) == once
assert senders_config["tools"]["toolsBySender"]["*"]["allow"] == [*prepare.NON_OWNER_TOOL_ALLOWLIST, *prepare.LUCKIN_TOOL_ALLOWLIST]
assert senders_config["tools"]["toolsBySender"]["id:owner"] == {"allow": ["*"]}
try:
    prepare.ensure_non_owner_luckin_tools({"tools": {"toolsBySender": {"*": {"allow": ["exec"]}}}})
    raise AssertionError("an unrelated non-owner policy must be refused")
except SystemExit:
    pass

