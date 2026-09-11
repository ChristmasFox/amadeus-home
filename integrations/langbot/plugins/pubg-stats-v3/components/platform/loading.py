from __future__ import annotations

import json
from typing import Any


PLUGIN_LOADING_MARKER = '__LANGBOT_PLUGIN_PLACEHOLDER_V1__:'
PLUGIN_LOADING_TYPE = 'loading'


def loading_marker(text: str = 'Thinking...') -> str:
    value = str(text or 'Thinking...').strip() or 'Thinking...'
    return PLUGIN_LOADING_MARKER + json.dumps(
        {
            'type': PLUGIN_LOADING_TYPE,
            'text': value,
            'replace': True,
        },
        ensure_ascii=False,
        separators=(',', ':'),
    )


async def send_loading(event_context: Any, text: str = 'Thinking...') -> None:
    """Send a typed placeholder only on hosts that replace it in-place.

    KOOK's ``Unknown`` message component is ignored by its text converter,
    which previously produced an empty API request and an intermittent
    ``reply_message ActionCallError``.  KOOK receives the deterministic final
    response through the normal response stage, so it does not need this
    Telegram-only placeholder.
    """

    try:
        platform = str(getattr(event_context.event, 'platform', '') or '').strip().lower()
        if platform not in {'telegram', 'telegram-bot', 'tg'}:
            return
        from langbot_plugin.api.entities.builtin.platform import message as platform_message

        await event_context.reply(
            platform_message.MessageChain(
                [platform_message.Unknown(text=loading_marker(text))]
            )
        )
    except Exception:
        # A loading indicator is best-effort and must never block the real reply.
        return
