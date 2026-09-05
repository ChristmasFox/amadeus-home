from __future__ import annotations

import json
from typing import Any

from components.platform.contracts import NormalizedBotMessage, build_normalized_message, mapping_value


TELEGRAM_INLINE_KEYBOARD_MARKER = '__PUBG_TELEGRAM_INLINE_KEYBOARD_V1__:'


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
            display_name=' '.join(filter(None, [sender.get('first_name'), sender.get('last_name')])) or sender.get('username'),
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
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=mapping_value(session, 'platform_user_id', mapping_value(session, 'sender_id', 'unknown')),
            internal_user_id=mapping_value(session, 'internal_user_id', None),
            display_name=mapping_value(session, 'display_name', None),
            chat_type=mapping_value(session, 'chat_type', mapping_value(session, 'launcher_type', 'group')),
            chat_id=mapping_value(session, 'chat_id', mapping_value(session, 'launcher_id', 'unknown')),
            chat_name=mapping_value(session, 'chat_name', None),
            message_id=query_id,
            text=text,
            reply_to_message_id=mapping_value(session, 'reply_to_message_id', None),
            timestamp=mapping_value(session, 'timestamp', None),
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
