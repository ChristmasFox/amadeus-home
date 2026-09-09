from __future__ import annotations

import json
from typing import Any

from components.platform.normalized import context_key as normalized_context_key, normalize_event_message

# Keep the same inert marker consumed by the existing Telegram host adapter
# used by the PUBG plugin. Product Radar only uses the platform bridge; it
# never calls Telegram/KOOK APIs directly.
TELEGRAM_INLINE_KEYBOARD_MARKER = '__PUBG_TELEGRAM_INLINE_KEYBOARD_V1__:'


def value(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def source_object(event: Any) -> Any:
    source = value(event, 'source_platform_object')
    if source is not None:
        return source
    message_event = value(event, 'message_event')
    return value(message_event, 'source_platform_object') or message_event


def platform_name(event: Any) -> str:
    raw = str(value(event, 'platform', value(event, 'platform_name', 'kook')) or 'kook').lower()
    if raw in {'telegram', 'telegram-bot', 'tg'}:
        return 'telegram'
    if raw in {'whatsapp', 'whatsapp-cloud', 'whatsapp-business', 'wa'}:
        return 'whatsapp'
    return 'kook'


def callback_parts(event: Any) -> tuple[str | None, str | None]:
    source = source_object(event) or event
    callback = value(source, 'callback_query')
    if callback is not None:
        return value(callback, 'id'), value(callback, 'data')
    return value(event, 'callback_id'), value(event, 'callback_data')


def _chain_components(event: Any) -> list[Any]:
    components: list[Any] = []
    for candidate in (event, source_object(event)):
        chain = value(candidate, 'message_chain')
        if chain is None:
            continue
        raw = value(chain, 'root', chain)
        try:
            components.extend(list(raw))
        except TypeError:
            pass
    return components


def attachment_sources(event: Any) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []
    seen: set[str] = set()
    raw_attachments = value(event, 'attachments', [])
    if isinstance(raw_attachments, list):
        for item in raw_attachments:
            url = value(item, 'url', value(item, 'image_url'))
            base64_value = value(item, 'base64')
            source = {'referenceImageBase64': str(base64_value)} if base64_value else {'referenceImageUrl': str(url)} if url else None
            if source:
                key = next(iter(source.values()))
                if key not in seen:
                    seen.add(key)
                    sources.append(source)
    for component in _chain_components(event):
        component_type = str(value(component, 'type', component.__class__.__name__) or '').lower()
        if component_type != 'image':
            continue
        base64_value = value(component, 'base64')
        url = value(component, 'url')
        source = {'referenceImageBase64': str(base64_value)} if base64_value else {'referenceImageUrl': str(url)} if url else None
        if source:
            key = next(iter(source.values()))
            if key not in seen:
                seen.add(key)
                sources.append(source)
    return sources


def event_text(event: Any) -> str:
    _callback_id, callback_data = callback_parts(event)
    if callback_data:
        return str(callback_data)
    source = source_object(event)
    candidates = [event, source, value(event, 'message_event')]
    for candidate in candidates:
        for key in ('text_message', 'content', 'text'):
            candidate_value = value(candidate, key)
            if candidate_value is not None and str(candidate_value).strip():
                return str(candidate_value)
        message = value(candidate, 'message')
        message_text = value(message, 'text')
        if message_text:
            return str(message_text)
    plain_parts = []
    for component in _chain_components(event):
        component_type = str(value(component, 'type', component.__class__.__name__) or '').lower()
        if component_type == 'plain':
            component_text = value(component, 'text')
            if component_text:
                plain_parts.append(str(component_text))
    return ''.join(plain_parts)


def conversation_key(event: Any) -> str:
    # Keep the legacy helper name, but use the same ownership-aware key as the
    # structured Product Radar context.  It includes platform, chat, sender,
    # and domain rather than a process-global conversation bucket.
    return normalized_context_key(normalize_event_message(event))


def reply(event_context: Any, text: str, buttons: list[dict[str, str]] | None = None) -> None:
    event = value(event_context, 'event')
    try:
        from langbot_plugin.api.entities.builtin.platform import message as platform_message

        components = [platform_message.Plain(text=text)]
        if buttons and platform_name(event) == 'telegram':
            keyboard = [
                [{'text': item['text'], 'callback_data': item['callbackData']} for item in buttons[index:index + 2]]
                for index in range(0, len(buttons), 2)
            ]
            marker = TELEGRAM_INLINE_KEYBOARD_MARKER + json.dumps(
                {'inline_keyboard': keyboard}, ensure_ascii=False, separators=(',', ':')
            )
            components.append(platform_message.Unknown(text=marker))
        event.reply_message_chain = platform_message.MessageChain(components)
    except Exception:
        try:
            event.reply_message_chain = text
        except Exception:
            pass
