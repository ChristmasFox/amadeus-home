from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from components.platform.contracts import NormalizedBotMessage, build_normalized_message, mapping_value


def _text(value: Any, default: str = '') -> str:
    if value is None:
        return default
    return str(value).strip()


def _timestamp(value: Any) -> str:
    if value is None or value == '':
        return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return str(value)
    seconds = numeric / 1000 if numeric > 10_000_000_000 else numeric
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace('+00:00', 'Z')


def _cloud_text_messages(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract only Meta text messages; later message types stay out of phase one."""
    messages: list[dict[str, Any]] = []
    for entry in payload.get('entry') or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get('changes') or []:
            if not isinstance(change, dict):
                continue
            value = change.get('value') or {}
            if not isinstance(value, dict):
                continue
            for message in value.get('messages') or []:
                if not isinstance(message, dict) or str(message.get('type', '')).lower() != 'text':
                    continue
                text = message.get('text') or {}
                if not isinstance(text, dict):
                    continue
                messages.append({
                    'message': message,
                    'value': value,
                    'entry_id': entry.get('id'),
                })
    return messages


class WhatsAppAdapter:
    """Platform normalization and text reply conversion for Meta Cloud API."""

    platform = 'whatsapp'

    def __init__(self, bot_id: str = 'whatsapp-cloud-api') -> None:
        self.bot_id = bot_id

    def normalize_event(self, event: Any, *, query_id: Any = None) -> NormalizedBotMessage:
        if isinstance(event, dict) and event.get('object') == 'whatsapp_business_account':
            records = _cloud_text_messages(event)
            if not records:
                raise ValueError('invalid whatsapp webhook message: no text messages')
            record = records[0]
            raw = record['message']
            value = record['value']
            sender_id = _text(raw.get('from'))
            message_id = _text(raw.get('id'))
            text = raw.get('text') or {}
            contacts = value.get('contacts') or []
            name = None
            for contact in contacts:
                if isinstance(contact, dict) and _text(contact.get('wa_id')) == sender_id:
                    profile = contact.get('profile') or {}
                    name = _text(profile.get('name')) or None
                    break
            return build_normalized_message(
                platform=self.platform,
                bot_id=self.bot_id,
                platform_user_id=sender_id,
                display_name=name,
                chat_type='private',
                chat_id=sender_id,
                message_id=message_id or query_id,
                text=text.get('body', '') if isinstance(text, dict) else '',
                reply_to_message_id=(raw.get('context') or {}).get('id') if isinstance(raw.get('context'), dict) else None,
                timestamp=raw.get('timestamp'),
            )

        message_event = mapping_value(event, 'message_event', None)
        sender = mapping_value(event, 'sender', mapping_value(message_event, 'sender', None))
        sender_id = mapping_value(sender, 'id', mapping_value(event, 'sender_id', 'unknown'))
        sender_name = mapping_value(sender, 'nickname', mapping_value(sender, 'member_name', None))
        chain = mapping_value(event, 'message_chain', None)
        source_id = None
        text_parts: list[str] = []
        if chain is not None:
            for component in chain:
                if getattr(component, 'type', '') == 'Source':
                    source_id = getattr(component, 'id', None)
                elif getattr(component, 'type', '') == 'Plain':
                    text_parts.append(str(getattr(component, 'text', '')))
        text = ''.join(text_parts) if text_parts else str(chain or '')
        message_id = source_id or query_id or mapping_value(event, 'message_id', None)
        return build_normalized_message(
            platform=self.platform,
            bot_id=self.bot_id,
            platform_user_id=sender_id,
            display_name=sender_name,
            chat_type='private',
            chat_id=sender_id,
            message_id=message_id,
            text=text,
            reply_to_message_id=None,
            timestamp=mapping_value(event, 'time', mapping_value(message_event, 'time', None)),
        )

    def normalize_session(self, session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
        sender_id = mapping_value(session, 'platform_user_id', mapping_value(session, 'sender_id', 'unknown'))
        return build_normalized_message(
            platform=self.platform,
            bot_id=mapping_value(session, 'bot_id', self.bot_id),
            platform_user_id=sender_id,
            internal_user_id=mapping_value(session, 'internal_user_id', None),
            display_name=mapping_value(session, 'display_name', None),
            chat_type='private',
            chat_id=mapping_value(session, 'chat_id', sender_id),
            chat_name=None,
            message_id=query_id,
            text=text,
            reply_to_message_id=mapping_value(session, 'reply_to_message_id', None),
            timestamp=mapping_value(session, 'timestamp', None),
        )

    @staticmethod
    def _message_chain(text: str) -> Any:
        from langbot_plugin.api.entities.builtin.platform import message as platform_message

        return platform_message.MessageChain([platform_message.Plain(text=text)])

    def reply_response(self, event_context: Any, response: Any) -> None:
        messages = response.get('messages') if isinstance(response, dict) else None
        texts = [
            item.get('text', '')
            for item in messages or []
            if isinstance(item, dict) and item.get('type') == 'text' and item.get('text')
        ]
        if not texts and isinstance(response, dict) and response.get('response'):
            texts = [str(response['response'])]
        if texts:
            event = getattr(event_context, 'event', None)
            if event is not None:
                event.reply_message_chain = self._message_chain('\n\n'.join(texts))
