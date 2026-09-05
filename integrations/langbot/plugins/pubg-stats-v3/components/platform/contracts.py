from __future__ import annotations

from typing import Any, TypedDict

NORMALIZED_MESSAGE_VERSION = 1
PLATFORMS = ('kook', 'telegram', 'wechat', 'whatsapp')
CHAT_TYPES = ('private', 'group')


class NormalizedUser(TypedDict):
    platform: str
    platformUserId: str
    internalUserId: str | None
    displayName: str | None


class NormalizedChat(TypedDict):
    type: str
    id: str
    name: str | None


class NormalizedMessageInfo(TypedDict):
    id: str
    text: str
    replyToMessageId: str | None


class NormalizedCallback(TypedDict):
    id: str | None
    data: str


class NormalizedBotMessage(TypedDict, total=False):
    version: int
    platform: str
    botId: str
    user: NormalizedUser
    chat: NormalizedChat
    message: NormalizedMessageInfo
    mentions: list[dict[str, Any]]
    attachments: list[dict[str, Any]]
    timestamp: str
    callback: NormalizedCallback


def _value(value: Any, default: str = '') -> str:
    raw = getattr(value, 'value', value)
    if raw is None or raw == '':
        return default
    return str(raw)


def normalize_platform(value: Any) -> str:
    normalized = _value(value).strip().lower()
    aliases = {
        'kook': 'kook',
        'kook-bot': 'kook',
        'telegram': 'telegram',
        'telegram-bot': 'telegram',
        'tg': 'telegram',
        'wechat': 'wechat',
        'wx': 'wechat',
        'whatsapp': 'whatsapp',
        'whatsapp-cloud': 'whatsapp',
        'whatsapp-business': 'whatsapp',
        'wa': 'whatsapp',
    }
    platform = aliases.get(normalized)
    if platform is None:
        raise ValueError(f'unsupported platform: {normalized or "empty"}')
    return platform


def normalize_chat_type(value: Any) -> str:
    normalized = _value(value).strip().lower()
    return 'private' if normalized in {'private', 'person', 'direct', 'dm', 'user'} else 'group'


def _mapping_value(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def safe_text(value: Any) -> str:
    return _value(value).strip()


def safe_timestamp(value: Any) -> str:
    if value is None or value == '':
        from datetime import datetime, timezone

        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    numeric = None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        pass
    if numeric is not None:
        from datetime import datetime, timezone

        seconds = numeric / 1000 if numeric > 10_000_000_000 else numeric
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')
    return str(value)


def build_normalized_message(
    *,
    platform: Any,
    bot_id: Any,
    platform_user_id: Any,
    internal_user_id: Any = None,
    display_name: Any = None,
    chat_type: Any,
    chat_id: Any,
    chat_name: Any = None,
    message_id: Any,
    text: Any,
    reply_to_message_id: Any = None,
    timestamp: Any = None,
    callback_id: Any = None,
    callback_data: Any = None,
) -> NormalizedBotMessage:
    canonical_platform = normalize_platform(platform)
    message: NormalizedBotMessage = {
        'version': NORMALIZED_MESSAGE_VERSION,
        'platform': canonical_platform,
        'botId': safe_text(bot_id) or f'{canonical_platform}-bot',
        'user': {
            'platform': canonical_platform,
            'platformUserId': safe_text(platform_user_id) or 'unknown',
            'internalUserId': safe_text(internal_user_id) or None,
            'displayName': safe_text(display_name) or None,
        },
        'chat': {
            'type': normalize_chat_type(chat_type),
            'id': safe_text(chat_id) or 'unknown',
            'name': safe_text(chat_name) or None,
        },
        'message': {
            'id': safe_text(message_id) or 'unknown-message',
            'text': safe_text(text),
            'replyToMessageId': safe_text(reply_to_message_id) or None,
        },
        'mentions': [],
        'attachments': [],
        'timestamp': safe_timestamp(timestamp),
    }
    if callback_data:
        message['callback'] = {'id': safe_text(callback_id) or None, 'data': safe_text(callback_data)}
    return message


def mapping_value(value: Any, key: str, default: Any = None) -> Any:
    return _mapping_value(value, key, default)
