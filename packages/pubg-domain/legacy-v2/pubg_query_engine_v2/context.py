from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol


class ContextStore(Protocol):
    def get(self, key: str) -> dict[str, Any] | None:
        ...

    def put(self, key: str, value: dict[str, Any]) -> None:
        ...


class InMemoryContextStore:
    def __init__(self) -> None:
        self._values: dict[str, dict[str, Any]] = {}

    def get(self, key: str) -> dict[str, Any] | None:
        value = self._values.get(key)
        return copy.deepcopy(value) if value is not None else None

    def put(self, key: str, value: dict[str, Any]) -> None:
        self._values[key] = copy.deepcopy(value)


def _safe_part(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    return text.replace(":", "%3A").replace("/", "%2F").replace(" ", "%20") or "unknown"


def build_session_id(
    *,
    platform: str,
    launcher_type: str,
    launcher_id: str | int,
    sender_id: str | int,
    domain: str = "pubg",
) -> str:
    return ":".join(
        [
            f"{domain}-session",
            _safe_part(platform),
            _safe_part(launcher_type),
            _safe_part(launcher_id),
            _safe_part(sender_id),
            _safe_part(domain),
        ]
    )


def context_key(session_id: str) -> str:
    return f"v2:context:{session_id}"


def result_set_key(session_id: str, result_set_id: str) -> str:
    return f"v2:result-set:{session_id}:{result_set_id}"


def empty_context(session_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "sessionId": session_id,
        "activeDomain": None,
        "lastQuery": None,
        "lastResultSetId": None,
        "subject": None,
        "lastSelectors": None,
        "references": {},
        "updatedAt": None,
        "expiresAt": None,
    }


def load_context(store: ContextStore, session_id: str, now: datetime | None = None) -> dict[str, Any]:
    value = store.get(context_key(session_id)) or empty_context(session_id)
    expires_at = value.get("expiresAt")
    if expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            current = now or datetime.now(timezone.utc)
            if current.tzinfo is None:
                current = current.replace(tzinfo=timezone.utc)
            if expires <= current.astimezone(expires.tzinfo):
                return empty_context(session_id)
        except ValueError:
            return empty_context(session_id)
    value["sessionId"] = session_id
    return value


def save_context(
    store: ContextStore,
    *,
    session_id: str,
    query: dict[str, Any],
    result_set_id: str,
    now: datetime | None = None,
    ttl: timedelta = timedelta(hours=12),
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    context = empty_context(session_id)
    context.update(
        {
            "activeDomain": "pubg",
            "lastQuery": copy.deepcopy(query),
            "lastResultSetId": result_set_id,
            "subject": copy.deepcopy(query.get("subject")),
            "lastSelectors": copy.deepcopy(query.get("selector")),
            "references": copy.deepcopy(query.get("reference", {})),
            "updatedAt": current.isoformat(timespec="seconds"),
            "expiresAt": (current + ttl).isoformat(timespec="seconds"),
        }
    )
    store.put(context_key(session_id), context)
    return context


def save_result_set(
    store: ContextStore,
    *,
    session_id: str,
    result_set: dict[str, Any],
) -> None:
    store.put(result_set_key(session_id, str(result_set["id"])), result_set)


def load_result_set(
    store: ContextStore,
    *,
    session_id: str,
    result_set_id: str,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    value = store.get(result_set_key(session_id, result_set_id))
    if not value:
        return None
    expires_at = value.get("expiresAt")
    if expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            current = now or datetime.now(timezone.utc)
            if current.tzinfo is None:
                current = current.replace(tzinfo=timezone.utc)
            if expires <= current.astimezone(expires.tzinfo):
                return None
        except ValueError:
            return None
    return value


def context_storage_value(value: dict[str, Any]) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def parse_context_storage(value: bytes) -> dict[str, Any] | None:
    try:
        parsed = json.loads(value.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None
