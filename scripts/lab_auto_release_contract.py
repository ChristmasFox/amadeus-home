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
