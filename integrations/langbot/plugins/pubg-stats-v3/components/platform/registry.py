from __future__ import annotations

from typing import Any, Protocol

from components.platform.contracts import NormalizedBotMessage, build_normalized_message, mapping_value, normalize_platform
from components.platform.kook import KookAdapter
from components.platform.telegram import TelegramAdapter
from components.platform.whatsapp import WhatsAppAdapter


class SessionAdapter(Protocol):
    platform: str

    def normalize_session(self, session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
        ...


def _platform_from_session(session: Any) -> str:
    value = mapping_value(session, 'platform', None)
    if value is None:
        value = mapping_value(session, 'platform_name', None)
    return normalize_platform(value or 'kook')


class GenericSessionAdapter:
    platform = '*'

    def normalize_session(self, session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
        platform = _platform_from_session(session)
        return build_normalized_message(
            platform=platform,
            bot_id=mapping_value(session, 'bot_id', None) or f'{platform}-bot',
            platform_user_id=mapping_value(session, 'platform_user_id', mapping_value(session, 'sender_id', 'unknown')),
            internal_user_id=mapping_value(session, 'internal_user_id', None),
            display_name=mapping_value(session, 'display_name', mapping_value(session, 'sender_name', None)),
            chat_type=mapping_value(session, 'chat_type', mapping_value(session, 'launcher_type', 'group')),
            chat_id=mapping_value(session, 'chat_id', mapping_value(session, 'launcher_id', 'unknown')),
            chat_name=mapping_value(session, 'chat_name', mapping_value(session, 'launcher_name', None)),
            message_id=query_id,
            text=text,
            reply_to_message_id=mapping_value(session, 'reply_to_message_id', None),
            timestamp=mapping_value(session, 'timestamp', None),
        )


_GENERIC_SESSION_ADAPTER = GenericSessionAdapter()
_SESSION_ADAPTERS: dict[str, SessionAdapter] = {}


def register_session_adapter(adapter: SessionAdapter) -> None:
    _SESSION_ADAPTERS[normalize_platform(adapter.platform)] = adapter


def platform_adapter(platform: Any) -> SessionAdapter:
    """Return the registered adapter used for platform-specific event work."""
    canonical = normalize_platform(platform)
    adapter = _SESSION_ADAPTERS.get(canonical)
    if adapter is not None:
        return adapter
    return _GENERIC_SESSION_ADAPTER


register_session_adapter(KookAdapter())
register_session_adapter(TelegramAdapter())
register_session_adapter(WhatsAppAdapter())


def normalize_session_message(session: Any, *, text: str, query_id: Any) -> NormalizedBotMessage:
    platform = _platform_from_session(session)
    adapter = platform_adapter(platform)
    return adapter.normalize_session(session, text=text, query_id=query_id)


def normalize_event_message(event: Any, *, query_id: Any = None) -> NormalizedBotMessage:
    platform = mapping_value(event, 'platform', mapping_value(event, 'platform_name', None))
    raw = event if isinstance(event, dict) else getattr(event, '__dict__', {})
    if str(platform or '').strip().lower() in {'whatsapp', 'whatsapp-cloud', 'whatsapp-business', 'wa'}:
        return WhatsAppAdapter().normalize_event(event, query_id=query_id)
    if isinstance(raw, dict) and raw.get('object') == 'whatsapp_business_account':
        return WhatsAppAdapter().normalize_event(raw, query_id=query_id)
    if mapping_value(event, 'callback_query', None) is not None or isinstance(raw, dict) and raw.get('callback_query'):
        return TelegramAdapter().normalize_event(raw)
    if str(platform or '').lower() in {'telegram', 'telegram-bot', 'tg'}:
        return TelegramAdapter().normalize_event(raw) if raw.get('message') else TelegramAdapter().normalize_session(
            event,
            text=str(mapping_value(event, 'text_message', mapping_value(event, 'content', ''))),
            query_id=query_id,
            callback_id=mapping_value(event, 'callback_id', None),
            callback_data=mapping_value(event, 'callback_data', None),
        )
    return KookAdapter().normalize_event(event, query_id=query_id)
