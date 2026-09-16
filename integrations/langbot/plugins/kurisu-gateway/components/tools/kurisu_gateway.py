from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any

try:
    from langbot_plugin.api.definition.components.tool.tool import Tool
except ImportError:
    class Tool:  # pragma: no cover - only used by source-only tests
        pass


ALLOWED_TOOL_PREFIXES = ('kurisu.',)
MAX_RESPONSE_BYTES = 256 * 1024


def _value(source: Any, name: str, default: Any = '') -> Any:
    if isinstance(source, dict):
        return source.get(name, default)
    return getattr(source, name, default)


def _platform(value: Any) -> str:
    normalized = str(value or '').strip().lower()
    return {'tg': 'telegram', 'telegram-bot': 'telegram', 'kook-bot': 'kook'}.get(normalized, normalized or 'test')


def trusted_session_context(session: Any, query_id: Any) -> dict[str, Any]:
    """Build the host context from LangBot's Session, never from model params."""
    platform = _platform(_value(session, 'platform', _value(session, 'platform_name', 'test')))
    user_id = str(_value(session, 'platform_user_id', _value(session, 'sender_id', 'unknown'))).strip()
    chat_id = str(_value(session, 'chat_id', _value(session, 'launcher_id', 'unknown'))).strip()
    chat_type = str(_value(session, 'chat_type', _value(session, 'launcher_type', 'private'))).strip().lower()
    return {
        'platform': platform,
        'platformUserId': user_id or 'unknown',
        'conversation': {
            'kind': 'group' if chat_type in {'group', 'channel', 'guild'} else 'private',
            'chatId': chat_id or 'unknown',
        },
        'botId': str(_value(session, 'bot_id', f'{platform}-bot')),
        'queryId': str(query_id),
    }


def _post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        url,
        data=encoded,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                return {'status': 'error', 'error': {'code': 'RESPONSE_TOO_LARGE', 'retryable': False}}
            value = json.loads(raw.decode('utf-8'))
            return value if isinstance(value, dict) else {'status': 'error', 'error': {'code': 'INVALID_RESPONSE', 'retryable': False}}
    except urllib.error.HTTPError as exc:
        return {'status': 'error', 'error': {'code': f'HTTP_{exc.code}', 'retryable': exc.code >= 500}}
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
        return {'status': 'unknown', 'error': {'code': type(exc).__name__, 'retryable': True}}


class KurisuGatewayTool(Tool):
    """Forward a structured tool call to the Kurisu runtime."""

    async def call(self, params: dict[str, Any], session: Any, query_id: Any) -> str:
        if not isinstance(params, dict):
            return json.dumps({'status': 'error', 'error': {'code': 'INPUT_INVALID', 'retryable': False}}, ensure_ascii=False)
        tool_name = str(params.get('toolName') or params.get('tool_name') or '').strip()
        tool_input = params.get('input')
        call_id = str(params.get('callId') or params.get('call_id') or query_id or '').strip()
        if not tool_name.startswith(ALLOWED_TOOL_PREFIXES) or not isinstance(tool_input, dict):
            return json.dumps({'status': 'error', 'error': {'code': 'STRUCTURED_INPUT_REQUIRED', 'retryable': False}}, ensure_ascii=False)
        if not call_id:
            return json.dumps({'status': 'error', 'error': {'code': 'CALL_ID_REQUIRED', 'retryable': False}}, ensure_ascii=False)
        runtime_url = str(os.environ.get('KURISU_RUNTIME_URL') or '').strip().rstrip('/')
        if not runtime_url:
            try:
                runtime_url = str(self.plugin.get_config().get('runtime_url') or '').strip().rstrip('/')
            except Exception:
                runtime_url = ''
        if not runtime_url:
            return json.dumps({'status': 'unsupported', 'error': {'code': 'RUNTIME_URL_UNCONFIGURED', 'retryable': False}}, ensure_ascii=False)
        payload = {
            'callId': call_id,
            'toolName': tool_name,
            'input': tool_input,
            'hostContext': trusted_session_context(session, query_id),
        }
        result = await asyncio.to_thread(_post, f'{runtime_url}/kurisu/tool-call', payload)
        return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
