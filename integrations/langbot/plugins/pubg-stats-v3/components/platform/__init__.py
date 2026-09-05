from components.platform.contracts import (
    CHAT_TYPES,
    PLATFORMS,
    NORMALIZED_MESSAGE_VERSION,
    NormalizedBotMessage,
)
from components.platform.kook import KookAdapter
from components.platform.registry import GenericSessionAdapter, normalize_session_message, register_session_adapter
from components.platform.telegram import TelegramAdapter
from components.platform.whatsapp import WhatsAppAdapter

__all__ = [
    'CHAT_TYPES',
    'PLATFORMS',
    'NORMALIZED_MESSAGE_VERSION',
    'NormalizedBotMessage',
    'KookAdapter',
    'TelegramAdapter',
    'WhatsAppAdapter',
    'GenericSessionAdapter',
    'normalize_session_message',
    'register_session_adapter',
]
