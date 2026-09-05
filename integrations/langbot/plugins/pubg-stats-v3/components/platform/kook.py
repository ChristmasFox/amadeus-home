from __future__ import annotations

from typing import Any

from components.platform.contracts import (
    NormalizedBotMessage,
    build_normalized_message,
    mapping_value,
)


class KookAdapter:
    platform = 'kook'

    def __init__(self, bot_id: str = 'kook-bot') -> None:
        self.bot_id = bot_id

    def normalize_event(self, event: Any, *, query_id: Any = None) -> NormalizedBotMessage:
        launcher_type = mapping_value(event, 'launcher_type', mapping_value(event, 'channel_type', 'group'))
        launcher_id = mapping_value(event, 'launcher_id', mapping_value(event, 'target_id', 'unknown'))
        sender_id = mapping_value(event, 'sender_id', mapping_value(event, 'author_id', 'unknown'))
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=sender_id,
            internal_user_id=None,
            display_name=mapping_value(event, 'sender_name', mapping_value(event, 'display_name', None)),
            chat_type=launcher_type,
            chat_id=launcher_id,
            chat_name=mapping_value(event, 'launcher_name', mapping_value(event, 'channel_name', None)),
            message_id=mapping_value(event, 'message_id', mapping_value(event, 'msg_id', query_id)),
            text=mapping_value(event, 'text_message', mapping_value(event, 'content', '')),
            reply_to_message_id=mapping_value(event, 'reply_to_message_id', mapping_value(event, 'reply_msg_id', None)),
            timestamp=mapping_value(event, 'timestamp', None),
        )

    def normalize_session(self, session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=mapping_value(session, 'sender_id', 'unknown'),
            internal_user_id=None,
            display_name=mapping_value(session, 'sender_name', None),
            chat_type=mapping_value(session, 'launcher_type', 'group'),
            chat_id=mapping_value(session, 'launcher_id', 'unknown'),
            chat_name=None,
            message_id=query_id,
            text=text,
            timestamp=None,
        )

    @staticmethod
    def _message_chain(text: str) -> Any:
        from langbot_plugin.api.entities.builtin.platform import message as platform_message

        return platform_message.MessageChain([platform_message.Plain(text=text)])

    def reply(self, event_context: Any, text: str) -> None:
        event_context.event.reply_message_chain = self._message_chain(text)

    def reply_response(self, event_context: Any, response: Any) -> None:
        messages = response.get('messages') if isinstance(response, dict) else None
        texts = [
            item.get('text', '')
            for item in messages or []
            if isinstance(item, dict) and item.get('type') == 'text' and item.get('text')
        ]
        self.reply(event_context, '\n\n'.join(texts) if texts else str(response.get('response') or '') if isinstance(response, dict) else str(response))
