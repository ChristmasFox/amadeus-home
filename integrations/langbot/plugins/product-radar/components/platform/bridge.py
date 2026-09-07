from __future__ import annotations

import json
from typing import Any

GENERIC_INLINE_KEYBOARD_MARKER = '__LANGBOT_INLINE_KEYBOARD_V1__:'


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


def event_text(event: Any) -> str:
    _callback_id, callback_data = callback_parts(event)
    if callback_data:
        return str(callback_data)
    return str(value(event, 'text_message', value(event, 'content', value(event, 'text', ''))) or '')


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
            components.append(platform_message.Unknown(text=GENERIC_INLINE_KEYBOARD_MARKER + json.dumps({'inline_keyboard': keyboard}, ensure_ascii=False, separators=(',', ':'))))
        event.reply_message_chain = platform_message.MessageChain(components)
    except Exception:
        try:
            event.reply_message_chain = text
        except Exception:
            pass
