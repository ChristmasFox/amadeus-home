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
    """Send a typed placeholder only on hosts that replace it in-place."""

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
        return
