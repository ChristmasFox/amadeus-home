from __future__ import annotations

import json
from typing import Any

from components.platform.contracts import NormalizedBotMessage, build_normalized_message, mapping_value


TELEGRAM_INLINE_KEYBOARD_MARKER = '__PUBG_TELEGRAM_INLINE_KEYBOARD_V1__:'


def _value(source: Any, key: str, default: Any = None) -> Any:
    if source is None:
        return default
    if isinstance(source, dict):
        return source.get(key, default)
    return getattr(source, key, default)


def _source_object(value: Any) -> Any:
    source = _value(value, 'source_platform_object')
    if source is not None:
        return source
    message_event = _value(value, 'message_event')
    source = _value(message_event, 'source_platform_object')
    return source if source is not None else message_event


def _telegram_parts(value: Any) -> tuple[Any, Any, Any]:
    """Return callback query, effective message and effective chat if present."""
    source = _source_object(value)
    if source is None:
        return None, None, None
    callback = _value(source, 'callback_query')
    if callback is None and _value(source, 'data') is not None and _value(source, 'from_user') is not None:
        callback = source
    message = _value(callback, 'message') if callback is not None else None
    message = message or _value(source, 'effective_message') or _value(source, 'message')
    chat = _value(message, 'chat') or _value(source, 'effective_chat') or _value(source, 'chat')
    return callback, message, chat


def _user_id(user: Any) -> Any:
    return _value(user, 'id')


def _user_name(user: Any) -> Any:
    return (
        ' '.join(filter(None, [_value(user, 'first_name'), _value(user, 'last_name')])).strip()
        or _value(user, 'full_name')
        or _value(user, 'username')
    )


class TelegramAdapter:
    platform = 'telegram'

    def __init__(self, bot_id: str = 'telegram-bot') -> None:
        self.bot_id = bot_id

    def normalize_event(self, update: dict[str, Any]) -> NormalizedBotMessage:
        callback = update.get('callback_query') or {}
        message = update.get('message') or callback.get('message') or {}
        # For callback updates, message.from is the bot authoring the picker;
        # callback_query.from is the member who clicked it.
        sender = callback.get('from') or message.get('from') or {}
        chat = message.get('chat') or {}
        reply = message.get('reply_to_message') or {}
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=sender.get('id'),
            display_name=_user_name(sender),
            chat_type=chat.get('type'),
            chat_id=chat.get('id'),
            chat_name=chat.get('title'),
            message_id=message.get('message_id'),
            text=message.get('text', ''),
            reply_to_message_id=reply.get('message_id'),
            timestamp=message.get('date'),
            callback_id=callback.get('id'),
            callback_data=callback.get('data'),
        )

    def normalize_session(
        self,
        session: Any,
        *,
        text: str,
        query_id: Any,
        callback_id: Any = None,
        callback_data: Any = None,
    ) -> NormalizedBotMessage:
        # LangBot's historical query.sender_id can equal launcher_id in a
        # Telegram group. Prefer the raw Telegram Message/Update carried by
        # message_event, where from_user.id and chat.id are authoritative.
        callback, source_message, source_chat = _telegram_parts(session)
        source_user = _value(callback, 'from_user') or _value(callback, 'from') or _value(source_message, 'from_user') or _value(source_message, 'from') or _value(session, 'telegram_user')
        source_user_id = _user_id(source_user)
        source_chat_id = _value(source_chat, 'id')
        source_chat_type = _value(source_chat, 'type')
        source_chat_name = _value(source_chat, 'title')
        source_message_id = _value(source_message, 'message_id')
        source_reply = _value(_value(source_message, 'reply_to_message'), 'message_id')
        callback_id = callback_id or _value(callback, 'id') or _value(session, 'callback_id')
        callback_data = callback_data or _value(callback, 'data') or _value(session, 'callback_data')

        has_raw_telegram_source = callback is not None or source_message is not None or source_chat is not None
        # If a raw Telegram object is present but omits a sender/chat, do not
        # fall back to LangBot's legacy sender_id/launcher_id fields: in group
        # events those fields historically contained the group ID.
        platform_user_id = source_user_id if source_user_id is not None else (
            'unknown' if has_raw_telegram_source else mapping_value(
                session, 'platform_user_id', mapping_value(session, 'sender_id', 'unknown')
            )
        )
        chat_id = source_chat_id if source_chat_id is not None else (
            'unknown' if has_raw_telegram_source else mapping_value(
                session, 'chat_id', mapping_value(session, 'launcher_id', 'unknown')
            )
        )
        chat_type = source_chat_type if source_chat_type is not None else mapping_value(
            session, 'chat_type', mapping_value(session, 'launcher_type', 'group')
        )
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=platform_user_id,
            internal_user_id=None,
            display_name=_user_name(source_user) or mapping_value(session, 'display_name', None),
            chat_type=chat_type,
            chat_id=chat_id,
            chat_name=source_chat_name or mapping_value(session, 'chat_name', None),
            message_id=source_message_id or query_id,
            text=text,
            reply_to_message_id=source_reply or mapping_value(session, 'reply_to_message_id', None),
            timestamp=_value(source_message, 'date') or mapping_value(session, 'timestamp', None),
            callback_id=callback_id,
            callback_data=callback_data,
        )

    async def acknowledge_callback(self, event_context: Any, text: str = '') -> None:
        callback = getattr(event_context, 'answer_callback_query', None)
        if not callable(callback):
            callback = getattr(getattr(event_context, 'event', None), 'answer_callback_query', None)
        if callable(callback):
            value = callback(text=text) if text else callback()
            if hasattr(value, '__await__'):
                await value

    def reply_response(self, event_context: Any, response: Any) -> None:
        messages = response.get('messages') if isinstance(response, dict) else None
        texts = [
            item.get('text', '')
            for item in messages or []
            if isinstance(item, dict) and item.get('type') == 'text' and item.get('text')
        ]
        first = next((item for item in messages or [] if isinstance(item, dict) and item.get('buttons')), None)
        buttons = first.get('buttons', []) if isinstance(first, dict) else []
        event = getattr(event_context, 'event', None)
        if event is not None:
            try:
                from langbot_plugin.api.entities.builtin.platform import message as platform_message

                content = '\n\n'.join(texts)
                if not content and isinstance(response, dict):
                    content = str(response.get('response') or '')
                components = [platform_message.Plain(text=content)]
                if buttons:
                    keyboard = [
                        [{'text': item['text'], 'callback_data': item['callbackData']} for item in buttons[index:index + 2]]
                        for index in range(0, len(buttons), 2)
                    ]
                    marker = TELEGRAM_INLINE_KEYBOARD_MARKER + json.dumps(
                        {'inline_keyboard': keyboard},
                        ensure_ascii=False,
                        separators=(',', ':'),
                    )
                    # LangBot's cross-process event contract only serializes a
                    # MessageChain. The Telegram host adapter consumes this
                    # inert marker and turns it into reply_markup.
                    components.append(platform_message.Unknown(text=marker))
                event.reply_message_chain = platform_message.MessageChain(components)
            except Exception:
                pass
