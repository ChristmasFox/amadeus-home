from __future__ import annotations

"""Small, ownership-aware context boundary for Product Radar.

The LangBot plugin is short-lived and the Product Radar service owns durable
Watch state.  This context only keeps conversational references needed to
resolve follow-ups.  Every value is indexed by the normalized message key,
which includes platform, chat, sender, and domain.
"""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any

from components.platform.normalized import NormalizedBotMessage, context_key


CONTEXT_SCHEMA_VERSION = 1
CONTEXT_TTL = timedelta(hours=12)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec='seconds').replace('+00:00', 'Z')


def _not_expired(value: dict[str, Any]) -> bool:
    raw = value.get('expiresAt')
    if not raw:
        return False
    try:
        expires = datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
    except ValueError:
        return False
    return expires > _now()


def _stores(plugin: Any) -> dict[str, dict[str, Any]]:
    stores = getattr(plugin, 'product_radar_contexts', None)
    if not isinstance(stores, dict):
        stores = {}
        setattr(plugin, 'product_radar_contexts', stores)
    return stores


def _public_watch(watch: Any) -> dict[str, Any] | None:
    if not isinstance(watch, dict):
        return None
    target = watch.get('target') if isinstance(watch.get('target'), dict) else {}
    safe_target = {
        str(key): value
        for key, value in target.items()
        if not str(key).lower().endswith('base64')
        and key not in {'visionProfile'}
    }
    return {
        'id': str(watch.get('id') or ''),
        'source': str(watch.get('source') or ''),
        'type': str(watch.get('type') or ''),
        'enabled': bool(watch.get('enabled')),
        'intervalSeconds': watch.get('intervalSeconds'),
        'target': safe_target,
        'rules': deepcopy(watch.get('rules')) if isinstance(watch.get('rules'), dict) else {},
    }


def _new_context(key: str) -> dict[str, Any]:
    now = _now()
    return {
        'schemaVersion': CONTEXT_SCHEMA_VERSION,
        'domain': 'product_radar',
        'contextKey': key,
        'activeWatch': None,
        'pendingProposalToken': None,
        'lastCommand': None,
        'updatedAt': _iso(now),
        'expiresAt': _iso(now + CONTEXT_TTL),
    }


def load_context(plugin: Any, message: NormalizedBotMessage) -> dict[str, Any] | None:
    key = context_key(message)
    value = _stores(plugin).get(key)
    if not isinstance(value, dict) or not _not_expired(value):
        if key in _stores(plugin):
            _stores(plugin).pop(key, None)
        return None
    return deepcopy(value)


def save_context(plugin: Any, message: NormalizedBotMessage, context: dict[str, Any]) -> dict[str, Any]:
    key = context_key(message)
    current = _new_context(key)
    current.update(deepcopy(context))
    current['contextKey'] = key
    current['domain'] = 'product_radar'
    current['updatedAt'] = _iso(_now())
    current['expiresAt'] = _iso(_now() + CONTEXT_TTL)
    _stores(plugin)[key] = current
    return deepcopy(current)


def record_command(plugin: Any, message: NormalizedBotMessage, command: dict[str, Any]) -> dict[str, Any]:
    current = load_context(plugin, message) or _new_context(context_key(message))
    safe_command = deepcopy(command)
    entities = safe_command.get('entities') if isinstance(safe_command.get('entities'), dict) else {}
    if isinstance(entities, dict):
        entities.pop('referenceImage', None)
        for key in list(entities):
            if str(key).lower().endswith('base64'):
                entities.pop(key, None)
    safe_command['entities'] = entities
    safe_command.pop('targetProfile', None)
    current['lastCommand'] = safe_command
    return save_context(plugin, message, current)


def set_pending(plugin: Any, message: NormalizedBotMessage, token: str | None) -> dict[str, Any]:
    current = load_context(plugin, message) or _new_context(context_key(message))
    current['pendingProposalToken'] = token
    return save_context(plugin, message, current)


def set_active_watch(plugin: Any, message: NormalizedBotMessage, watch: Any) -> dict[str, Any]:
    current = load_context(plugin, message) or _new_context(context_key(message))
    current['activeWatch'] = _public_watch(watch)
    current['pendingProposalToken'] = None
    return save_context(plugin, message, current)


def clear_active_watch(plugin: Any, message: NormalizedBotMessage) -> dict[str, Any]:
    current = load_context(plugin, message) or _new_context(context_key(message))
    current['activeWatch'] = None
    current['pendingProposalToken'] = None
    return save_context(plugin, message, current)


def context_for_parser(context: dict[str, Any] | None) -> dict[str, Any]:
    """Return a compact context hint; never pass image bytes to the model."""
    if not isinstance(context, dict):
        return {'domain': 'product_radar', 'activeWatch': None, 'pendingProposal': False}
    active = _public_watch(context.get('activeWatch'))
    return {
        'domain': 'product_radar',
        'activeWatch': active,
        'pendingProposal': bool(context.get('pendingProposalToken')),
    }


def active_watch(context: dict[str, Any] | None) -> dict[str, Any] | None:
    value = context.get('activeWatch') if isinstance(context, dict) else None
    return _public_watch(value)
