from __future__ import annotations

"""Platform-neutral message normalization for the Product Radar boundary.

This module intentionally mirrors the shape used by the PUBG V3 gateway while
remaining independent of PUBG.  Product Radar intent parsing consumes this
contract rather than inspecting LangBot platform event objects directly.
"""

from datetime import datetime, timezone
from typing import Any, TypedDict
from urllib.parse import quote


NORMALIZED_MESSAGE_VERSION = 1
PRODUCT_RADAR_DOMAIN = 'product_radar'


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


class NormalizedAttachment(TypedDict, total=False):
    type: str
    url: str | None
    name: str | None
    mimeType: str | None
    base64: str | None


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
    attachments: list[NormalizedAttachment]
    timestamp: str
    callback: NormalizedCallback


def value(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def _first_value(sources: list[Any], keys: tuple[str, ...], default: Any = None) -> Any:
    for source in sources:
        for key in keys:
            candidate = value(source, key)
            if candidate is not None and candidate != '':
                return candidate
    return default


def _source_object(event: Any) -> Any:
    source = value(event, 'source_platform_object')
    if source is not None:
        return source
    message_event = value(event, 'message_event')
    return value(message_event, 'source_platform_object') or message_event


def _raw_mapping(source: Any) -> dict[str, Any]:
    if isinstance(source, dict):
        return source
    raw = getattr(source, '__dict__', {})
    return raw if isinstance(raw, dict) else {}


def safe_text(raw: Any, default: str = '') -> str:
    if raw is None:
        return default
    value_attr = getattr(raw, 'value', raw)
    if value_attr is None:
        return default
    return str(value_attr).strip()


def normalize_platform(raw: Any) -> str:
    normalized = safe_text(raw).lower()
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
    return aliases.get(normalized, normalized or 'kook')


def normalize_chat_type(raw: Any) -> str:
    normalized = safe_text(raw).lower()
    return 'private' if normalized in {'private', 'person', 'direct', 'dm', 'user'} else 'group'


def safe_timestamp(raw: Any) -> str:
    if raw is None or raw == '':
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    try:
        numeric = float(raw)
    except (TypeError, ValueError):
        return safe_text(raw)
    seconds = numeric / 1000 if numeric > 10_000_000_000 else numeric
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def _telegram_callback(source: Any, event: Any) -> Any:
    for candidate in (source, event):
        callback = value(candidate, 'callback_query')
        if callback is not None:
            return callback
    return None


def _message_object(source: Any, event: Any, callback: Any = None) -> Any:
    if callback is not None:
        message = value(callback, 'message')
        if message is not None:
            return message
    for candidate in (source, event):
        message = value(candidate, 'message')
        if message is not None and not isinstance(message, str):
            return message
    return None


def _chain_components(event: Any, source: Any) -> list[Any]:
    components: list[Any] = []
    for candidate in (event, source):
        chain = value(candidate, 'message_chain')
        if chain is None:
            continue
        raw = value(chain, 'root', chain)
        try:
            components.extend(list(raw))
        except TypeError:
            continue
    return components


def _attachment_from_item(item: Any) -> NormalizedAttachment | None:
    item_type = safe_text(value(item, 'type', value(item, 'mime_type', 'file'))).lower()
    mime_type = safe_text(value(item, 'mimeType', value(item, 'mime_type', None))) or None
    url = value(item, 'url', value(item, 'image_url'))
    if isinstance(url, dict):
        url = value(url, 'url')
    base64_value = value(item, 'base64')
    is_image = (
        item_type == 'image'
        or bool(mime_type and mime_type.startswith('image/'))
        or bool(url and 'image' in str(url).lower())
        or bool(base64_value)
    )
    if not is_image:
        return None
    return {
        'type': 'image',
        'url': safe_text(url) or None,
        'name': safe_text(value(item, 'name', value(item, 'filename', None))) or None,
        'mimeType': mime_type,
        'base64': safe_text(base64_value) or None,
    }


def _attachments(event: Any, source: Any, message: Any) -> list[NormalizedAttachment]:
    result: list[NormalizedAttachment] = []
    seen: set[str] = set()
    for candidate in (value(event, 'attachments', []), value(source, 'attachments', []), value(message, 'attachments', [])):
        if not isinstance(candidate, list):
            continue
        for item in candidate:
            attachment = _attachment_from_item(item)
            if attachment is None:
                continue
            identity = safe_text(attachment.get('base64')) or safe_text(attachment.get('url'))
            if not identity or identity in seen:
                continue
            seen.add(identity)
            result.append(attachment)
    for component in _chain_components(event, source):
        component_type = safe_text(value(component, 'type', component.__class__.__name__)).lower()
        if component_type != 'image':
            continue
        attachment = _attachment_from_item(component)
        if attachment is None:
            continue
        identity = safe_text(attachment.get('base64')) or safe_text(attachment.get('url'))
        if not identity or identity in seen:
            continue
        seen.add(identity)
        result.append(attachment)
    return result


def _plain_text(event: Any, source: Any, message: Any) -> str:
    for candidate in (message, event, source):
        for key in ('text_message', 'content', 'text', 'caption'):
            text = safe_text(value(candidate, key))
            if text:
                return text
    plain_parts: list[str] = []
    for component in _chain_components(event, source):
        component_type = safe_text(value(component, 'type', component.__class__.__name__)).lower()
        if component_type == 'plain':
            text = safe_text(value(component, 'text'))
            if text:
                plain_parts.append(text)
    return ''.join(plain_parts)


def _callback_values(callback: Any, event: Any) -> tuple[str | None, str | None]:
    if callback is not None:
        callback_id = safe_text(value(callback, 'id')) or None
        callback_data = safe_text(value(callback, 'data')) or None
        return callback_id, callback_data
    return (
        safe_text(value(event, 'callback_id')) or None,
        safe_text(value(event, 'callback_data')) or None,
    )


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
    attachments: list[NormalizedAttachment] | None = None,
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
        'attachments': attachments or [],
        'timestamp': safe_timestamp(timestamp),
    }
    if callback_data:
        message['callback'] = {'id': safe_text(callback_id) or None, 'data': safe_text(callback_data)}
    return message


def normalize_event_message(event: Any, *, query_id: Any = None) -> NormalizedBotMessage:
    source = _source_object(event)
    callback = _telegram_callback(source, event)
    message = _message_object(source, event, callback)
    callback_id, callback_data = _callback_values(callback, event)
    raw_platform = _first_value([event, source], ('platform', 'platform_name'), 'kook')
    if callback is not None and safe_text(raw_platform).lower() in {'', 'kook'}:
        raw_platform = 'telegram'
    platform = normalize_platform(raw_platform)
    callback_user = (
        value(callback, 'from') or value(callback, 'from_user')
        if callback is not None
        else None
    )
    message_user = (
        value(message, 'from')
        or value(message, 'from_user')
        or value(message, 'author')
        if message is not None
        else None
    )
    message_sources = [event, source, message, callback]
    authoritative_sender = _first_value([callback_user, message_user], ('id', 'user_id'), None)
    if authoritative_sender is not None:
        platform_user_id = authoritative_sender
    else:
        platform_user_id = _first_value(
            [event, source, message, callback],
            ('platform_user_id', 'sender_id', 'user_id', 'author_id'),
            'unknown',
        )
    chat_object = (
        value(message, 'chat')
        or value(source, 'effective_chat')
        or value(source, 'chat')
        if message is not None or source is not None
        else None
    )
    chat_id = _first_value([chat_object], ('id', 'chat_id'), None)
    if chat_id is None:
        chat_id = _first_value([event, source, message], ('chat_id', 'launcher_id', 'conversation_id', 'target_id'), 'unknown')
    chat_type = _first_value([chat_object], ('type', 'chat_type'), None)
    if chat_type is None:
        chat_type = _first_value([event, source, message], ('chat_type', 'launcher_type', 'channel_type'), 'group')
    chat_sources = [chat_object, event, source, message]
    display_name = _first_value(
        [callback_user, message_user],
        ('display_name', 'full_name', 'username', 'name', 'first_name'),
        None,
    )
    if display_name is None:
        display_name = _first_value(
            [event, source, message, callback],
            ('display_name', 'sender_name', 'username', 'name'),
            value(message_user, 'first_name'),
        )
    text = _plain_text(event, source, message)
    reply_to = _first_value(message_sources, ('reply_to_message_id', 'replyToMessageId'), None)
    if reply_to is None:
        reply_to = value(value(message, 'reply_to_message') if message is not None else None, 'message_id')
    message_id = _first_value([message], ('message_id', 'messageId', 'msg_id'), None)
    if message_id is None:
        message_id = value(message, 'id') if message is not None else None
    if message_id is None:
        message_id = _first_value([event, source], ('message_id', 'messageId', 'msg_id', 'id'), query_id or 'unknown-message')
    bot_id = _first_value([event, source], ('bot_id', 'botId'), f'{platform}-bot')
    return build_normalized_message(
        platform=platform,
        bot_id=bot_id,
        platform_user_id=platform_user_id,
        internal_user_id=_first_value(message_sources, ('internal_user_id', 'internalUserId'), None),
        display_name=display_name,
        chat_type=chat_type,
        chat_id=chat_id,
        chat_name=_first_value(chat_sources, ('chat_name', 'launcher_name', 'title'), None),
        message_id=message_id,
        text=text,
        reply_to_message_id=reply_to,
        timestamp=_first_value(message_sources, ('timestamp', 'date'), None),
        attachments=_attachments(event, source, message),
        callback_id=callback_id,
        callback_data=callback_data,
    )


def normalize_session_message(session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
    platform = normalize_platform(value(session, 'platform', value(session, 'platform_name', 'kook')))
    return build_normalized_message(
        platform=platform,
        bot_id=value(session, 'bot_id', f'{platform}-bot'),
        platform_user_id=value(session, 'platform_user_id', value(session, 'sender_id', 'unknown')),
        internal_user_id=value(session, 'internal_user_id', None),
        display_name=value(session, 'display_name', value(session, 'sender_name', None)),
        chat_type=value(session, 'chat_type', value(session, 'launcher_type', 'group')),
        chat_id=value(session, 'chat_id', value(session, 'launcher_id', 'unknown')),
        chat_name=value(session, 'chat_name', value(session, 'launcher_name', None)),
        message_id=query_id,
        text=text,
        reply_to_message_id=value(session, 'reply_to_message_id', None),
        timestamp=value(session, 'timestamp', None),
    )


def context_key(message: NormalizedBotMessage, domain: str = PRODUCT_RADAR_DOMAIN) -> str:
    """Build a context key with all four required ownership dimensions."""
    parts = (
        domain,
        message.get('platform', 'unknown'),
        (message.get('chat') or {}).get('type', 'unknown'),
        (message.get('chat') or {}).get('id', 'unknown'),
        (message.get('user') or {}).get('platformUserId', 'unknown'),
    )
    return ':'.join(quote(str(part or 'unknown'), safe='') for part in parts)


def image_sources(message: NormalizedBotMessage) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    for attachment in message.get('attachments', []):
        base64_value = safe_text(attachment.get('base64'))
        url = safe_text(attachment.get('url'))
        if base64_value:
            sources.append({'referenceImageBase64': base64_value})
        elif url:
            sources.append({'referenceImageUrl': url})
    return sources
