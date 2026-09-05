from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from components.pubg_client import fetch_pubg_data
from pubg_query_engine_v2.context import (
    context_key,
    context_storage_value,
    empty_context,
    load_result_set,
    parse_context_storage,
    result_set_key,
)
from pubg_query_engine_v2.engine import DeterministicQueryEngine, build_result_set
from pubg_query_engine_v2.planner import (
    DEFAULT_TEAM,
    apply_context_resolver,
    apply_default_query_semantics,
    build_query_from_text,
    is_pubg_query,
    planner_prompt,
    repair_or_fallback,
)
from pubg_query_engine_v2.renderer import render_result
from pubg_query_engine_v2.schema import QueryValidationError, validate_query
from pubg_query_engine_v2.time_resolver import TimeResolutionError, resolve_query_selectors

try:
    from langbot_plugin.api.entities.builtin.provider import message as provider_message
except ImportError:
    provider_message = None


LOGGER = logging.getLogger("pubg.query_engine_v2")
ZONE = ZoneInfo("Asia/Shanghai")
KNOWN_PLANNER_MODEL = "4d608fdb-126b-42cd-a8a5-be1349629713"


def build_pubg_session_id(
    *,
    launcher_type: Any,
    launcher_id: Any,
    sender_id: Any,
) -> str:
    from pubg_query_engine_v2.context import build_session_id

    value = getattr(launcher_type, "value", launcher_type)
    return build_session_id(
        platform="kook",
        launcher_type=str(value or "unknown"),
        launcher_id=str(launcher_id or "unknown"),
        sender_id=str(sender_id or "unknown"),
    )


async def _get_storage(plugin: Any, key: str) -> bytes:
    try:
        return await plugin.get_workspace_storage(key)
    except Exception:
        return b""


async def _set_storage(plugin: Any, key: str, value: dict[str, Any]) -> None:
    await plugin.set_workspace_storage(key, context_storage_value(value))


async def load_structured_context(plugin: Any, session_id: str) -> dict[str, Any]:
    stored = parse_context_storage(await _get_storage(plugin, context_key(session_id)))
    if not stored:
        return empty_context(session_id)
    expires_at = stored.get("expiresAt")
    if expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            current = datetime.now(timezone.utc)
            if expires <= current.astimezone(expires.tzinfo):
                return empty_context(session_id)
        except ValueError:
            return empty_context(session_id)
    stored["sessionId"] = session_id
    return stored


async def load_structured_result_set(plugin: Any, session_id: str, result_set_id: str) -> dict[str, Any] | None:
    stored = parse_context_storage(await _get_storage(plugin, result_set_key(session_id, result_set_id)))
    if not stored:
        return None
    expires_at = stored.get("expiresAt")
    if expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if expires <= datetime.now(timezone.utc).astimezone(expires.tzinfo):
                return None
        except ValueError:
            return None
    return stored


async def _save_result_set(plugin: Any, result_set: dict[str, Any]) -> None:
    await _set_storage(plugin, result_set_key(result_set["sessionId"], result_set["id"]), result_set)


async def _save_context(plugin: Any, query: dict[str, Any], result_set_id: str) -> None:
    current = datetime.now(ZONE)
    context = empty_context(str(query["sessionId"]))
    context.update(
        {
            "activeDomain": "pubg",
            "lastQuery": query,
            "lastResultSetId": result_set_id,
            "subject": query.get("subject"),
            "lastSelectors": query.get("selector"),
            "references": query.get("reference", {}),
            "updatedAt": current.isoformat(timespec="seconds"),
            "expiresAt": (current.replace(microsecond=0) + timedelta(hours=12)).isoformat(timespec="seconds"),
        }
    )
    await _set_storage(plugin, context_key(str(query["sessionId"])), context)


async def _planner_model_uuid(plugin: Any) -> str | None:
    config = {}
    try:
        config = plugin.get_config() or {}
    except Exception:
        pass
    configured = str(config.get("planner_model_uuid") or os.environ.get("PUBG_PLANNER_MODEL_UUID") or "").strip()
    try:
        models = await plugin.get_llm_models()
    except Exception:
        models = []
    if configured and (not models or configured in models):
        return configured
    if KNOWN_PLANNER_MODEL in models:
        return KNOWN_PLANNER_MODEL
    return str(models[0]) if models else configured or KNOWN_PLANNER_MODEL


async def _plan_with_llm(
    plugin: Any,
    *,
    text: str,
    session_id: str,
    query_id: str,
    context: dict[str, Any],
    now: datetime,
    subject: dict[str, Any] | None,
) -> dict[str, Any]:
    planning_subject = context.get("subject") or subject or DEFAULT_TEAM
    fallback = build_query_from_text(
        text,
        session_id=session_id,
        query_id=query_id,
        context=context,
        now=now,
        subject=planning_subject,
    )
    if provider_message is None:
        return fallback
    model_uuid = await _planner_model_uuid(plugin)
    if not model_uuid:
        return fallback
    prompt = planner_prompt(
        user_text=text,
        now=now,
        timezone="Asia/Shanghai",
        context=context,
    )
    try:
        messages = [
            provider_message.Message(
                role="system",
                content="只做结构化规划。不得回答 PUBG 事实，不得调用工具，不得计算统计。",
            ),
            provider_message.Message(role="user", content=prompt),
        ]
        output = await plugin.invoke_llm(model_uuid, messages, funcs=[])
        return repair_or_fallback(
            output,
            text=text,
            session_id=session_id,
            query_id=query_id,
            context=context,
            now=now,
            subject=planning_subject,
        )
    except Exception as exc:
        LOGGER.warning("planner fallback queryId=%s reason=%s", query_id, type(exc).__name__)
        return fallback


def _provided_plan_or_none(plan: Any, *, query_id: str, session_id: str) -> dict[str, Any] | None:
    if not isinstance(plan, dict):
        return None
    candidate = dict(plan)
    candidate["queryId"] = query_id
    candidate["sessionId"] = session_id
    try:
        return validate_query(candidate)
    except QueryValidationError:
        return None


async def run_pubg_query(
    plugin: Any,
    *,
    text: str,
    launcher_type: Any,
    launcher_id: Any,
    sender_id: Any,
    query_id: int | str,
    provided_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    session_id = build_pubg_session_id(
        launcher_type=launcher_type,
        launcher_id=launcher_id,
        sender_id=sender_id,
    )
    query_id_text = str(query_id)
    context = await load_structured_context(plugin, session_id)
    now = datetime.now(ZONE)
    query = _provided_plan_or_none(provided_plan, query_id=query_id_text, session_id=session_id)
    if query is None:
        query = await _plan_with_llm(
            plugin,
            text=text,
            session_id=session_id,
            query_id=query_id_text,
            context=context,
            now=now,
            subject=DEFAULT_TEAM,
        )
    query = apply_context_resolver(query, text=text, context=context)
    query = apply_default_query_semantics(query, text=text, context=context)
    try:
        query = resolve_query_selectors(query, now)
        validate_query(query)
    except (QueryValidationError, TimeResolutionError) as exc:
        result = {
            "status": "INVALID_QUERY",
            "data": {"errors": [str(exc)]},
            "coverage": {},
            "source": {},
            "evidence": {"matchIds": [], "playerIds": [], "recordCount": 0, "calculation": "none"},
            "queryId": query_id_text,
            "sessionId": session_id,
        }
    else:
        result_set_map: dict[str, dict[str, Any]] = {}
        last_result_set_id = context.get("lastResultSetId")
        if last_result_set_id:
            previous = await load_structured_result_set(plugin, session_id, str(last_result_set_id))
            if previous:
                result_set_map[str(last_result_set_id)] = previous
        referenced = query.get("reference", {}).get("resultSetId")
        if referenced and str(referenced) not in result_set_map:
            previous = await load_structured_result_set(plugin, session_id, str(referenced))
            if previous:
                result_set_map[str(referenced)] = previous
        if query.get("selector", {}).get("type") == "result_set":
            result_set_id = str(query.get("selector", {}).get("resultSetId") or referenced or "")
            result_set = result_set_map.get(result_set_id)
            if result_set:
                query.setdefault("reference", {})["resultSetId"] = result_set_id
                query["reference"]["matchIds"] = list(result_set.get("matchIds") or [])
        unsupported = query.get("reference", {}).get("unsupportedCapability")
        missing_result_set_id = ""
        selectors_to_check = [query.get("selector", {})]
        selectors_to_check.extend(
            segment.get("selector", {})
            for segment in query.get("segments", [])
            if isinstance(segment, dict)
        )
        for selector in selectors_to_check:
            if isinstance(selector, dict) and selector.get("type") == "result_set":
                candidate_id = str(selector.get("resultSetId") or "")
                if candidate_id not in result_set_map:
                    missing_result_set_id = candidate_id
                    break
        if missing_result_set_id:
            result = {
                "status": "INVALID_QUERY",
                "data": {
                    "code": "RESULT_SET_NOT_FOUND",
                    "resultSetId": missing_result_set_id,
                    "errors": [f"ResultSet 不存在或已过期：{missing_result_set_id}"],
                },
                "coverage": {},
                "source": {"store": "none", "syncTriggered": False, "syncStatus": "NOT_NEEDED"},
                "evidence": {"matchIds": [], "playerIds": [], "recordCount": 0, "calculation": "none"},
                "queryId": query_id_text,
                "sessionId": session_id,
            }
        elif unsupported:
            data_contract = {
                "records": [],
                "coverage": {"status": "OK", "complete": True},
                "source": {"store": "none", "syncTriggered": False, "syncStatus": "NOT_NEEDED"},
                "diagnostics": {"dataAccessSkipped": True, "reason": "unsupported_capability"},
            }
        else:
            data_contract = await __import__("asyncio").to_thread(fetch_pubg_data, query)
            LOGGER.info(
                "pubg queryId=%s data source=%s syncTriggered=%s syncStatus=%s records=%s coverage=%s",
                query_id_text,
                data_contract.get("source", {}).get("store"),
                data_contract.get("source", {}).get("syncTriggered"),
                data_contract.get("source", {}).get("syncStatus"),
                len(data_contract.get("records", [])),
                data_contract.get("coverage", {}).get("status"),
            )
        if not missing_result_set_id:
            result = DeterministicQueryEngine().execute(
                query,
                data_contract.get("records", []),
                coverage=data_contract.get("coverage", {}),
                source=data_contract.get("source", {}),
                result_sets=result_set_map,
                now=now,
            )
    result_set = build_result_set(query, result, now=now)
    try:
        await _save_result_set(plugin, result_set)
        await _save_context(plugin, query, result_set["id"])
    except Exception as exc:
        LOGGER.warning("context persistence failed queryId=%s reason=%s", query_id_text, type(exc).__name__)
    rendered = render_result(query, result)
    LOGGER.info(
        "pubg queryId=%s sessionId=%s operation=%s selector=%s status=%s resultSetId=%s evidenceMatches=%s evidencePlayers=%s",
        query_id_text,
        session_id,
        query.get("operation"),
        query.get("selector", {}).get("type"),
        result.get("status"),
        result_set["id"],
        len(result.get("evidence", {}).get("matchIds", [])),
        len(result.get("evidence", {}).get("playerIds", [])),
    )
    return {
        "response": rendered,
        "status": result.get("status"),
        "resultSetId": result_set["id"],
        "queryId": query_id_text,
        "sessionId": session_id,
        "query": query,
        "data": result.get("data", {}),
        "coverage": result.get("coverage", {}),
        "source": result.get("source", {}),
        "evidence": result.get("evidence", {}),
        "diagnostics": {"planner": "llm_or_deterministic_fallback", "deterministicCore": True},
    }


def is_pubg_message(text: str, context: dict[str, Any] | None = None) -> bool:
    return is_pubg_query(text, context)
