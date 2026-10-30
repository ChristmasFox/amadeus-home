"""Pure validation contracts for the Lab automatic release smoke checks."""

from __future__ import annotations

from typing import Any


def valid_pubg_stats_smoke(payload: Any) -> bool:
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return False
    result = payload.get("result")
    meta = result.get("meta") if isinstance(result, dict) else None
    if not isinstance(meta, dict):
        return False
    final_text = meta.get("finalAssistantVisibleText")
    tool_summary = meta.get("toolSummary")
    if not isinstance(final_text, str) or not isinstance(tool_summary, dict):
        return False
    tools = tool_summary.get("tools")
    return (
        "LAB_STATS_QUERY_OK" in final_text
        and "LAB_STATS_QUERY_FAILED" not in final_text
        and isinstance(tools, list)
        and "pubg_query_stats" in tools
        and isinstance(tool_summary.get("calls"), int)
        and tool_summary["calls"] >= 1
        and tool_summary.get("failures") == 0
    )


# --- Smoke scope -----------------------------------------------------------
# A deploy only needs the domain smokes whose code paths the diff can affect. The base is the
# release that is currently live; with no usable base every smoke runs.
PUBG_SMOKE_PREFIXES = (
    "plugins/pubg/",
    "packages/identity/",
    "infra/docker/casaos/openclaw/",
)
PUBG_SMOKE_DEPENDENCY_FILES = ("package.json", "pnpm-lock.yaml", "plugins/pubg/package.json")
VOICE_SMOKE_PREFIXES = (
    "apps/qwen3-tts-service/",
    "infra/docker/casaos/9router/",
    "integrations/openclaw/delivery-boundary/",
    "plugins/amadeus/skills/voice-reply/",
    "scripts/openclaw-voice-",
    "scripts/deploy-9router",
)
VOICE_SMOKE_SOURCE_MARKERS = ("delivery-speech", "delivery-settlement", "delivery-decoder", "delivery-envelope",
                              "voice", "tts", "whatsapp-delivery")


def smoke_scope(changed_paths: "list[str] | None", dependency_diff: str = "") -> dict[str, bool]:
    """Which domain smokes a diff can affect; None means the base is unknown, so run everything."""
    if changed_paths is None:
        return {"pubg": True, "voice": True}
    paths = [p.strip() for p in changed_paths if p.strip()]
    pubg = any(p.startswith(PUBG_SMOKE_PREFIXES) for p in paths)
    if not pubg and any(p in PUBG_SMOKE_DEPENDENCY_FILES for p in paths):
        lowered = dependency_diff.lower()
        pubg = "pubg" in lowered or "rine-kit" in lowered
    voice = any(
        p.startswith(VOICE_SMOKE_PREFIXES)
        or (p.startswith("plugins/amadeus/src/") and any(m in p.rsplit("/", 1)[-1] for m in VOICE_SMOKE_SOURCE_MARKERS))
        or (p.startswith("infra/macos/") and ("tts" in p or "fish" in p))
        for p in paths
    )
    return {"pubg": pubg, "voice": voice}
