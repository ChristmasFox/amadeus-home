from __future__ import annotations

import asyncio
import hashlib
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
DEFAULT_RUNTIME_URL = 'http://pubg-query-engine-v3:5310'
DEFAULT_SECRET_FILE = '/run/secrets/kurisu_gateway_secret'
RELATIVE_PERIODS = {'today', 'yesterday'}


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


async def trusted_session_context_from_plugin(session: Any, query_id: Any, plugin: Any) -> dict[str, Any]:
    """Resolve the real platform from LangBot's bot registry, not Session guesses."""
    bot_uuid = str(_value(session, 'bot_uuid', '') or '').strip()
    if not bot_uuid:
        raise RuntimeError('bot_uuid is missing from LangBot session')
    try:
        bot_info = await plugin.get_bot_info(bot_uuid)
    except Exception as exc:
        raise RuntimeError('LangBot bot metadata is unavailable') from exc
    platform = _platform(_value(bot_info, 'adapter', ''))
    if platform not in {'telegram', 'kook'}:
        raise RuntimeError('LangBot bot adapter is unsupported')
    context = trusted_session_context(session, query_id)
    context['platform'] = platform
    context['botId'] = bot_uuid
    return context


def stable_call_id(query_id: Any, tool_name: str, tool_input: dict[str, Any]) -> str:
    """Derive a retry-stable boundary ID without trusting model metadata."""
    material = json.dumps(
        {'toolName': tool_name, 'input': tool_input},
        ensure_ascii=False,
        sort_keys=True,
        separators=(',', ':'),
    ).encode('utf-8')
    digest = hashlib.sha256(material).hexdigest()[:32]
    query_part = str(query_id).strip()[:200] or 'query'
    return f'{query_part}:{digest}'


def runtime_secret() -> str:
    direct = str(os.environ.get('KURISU_GATEWAY_SECRET') or '').strip()
    if direct:
        return direct
    file_path = str(os.environ.get('KURISU_GATEWAY_SECRET_FILE') or DEFAULT_SECRET_FILE).strip()
    if not file_path:
        return ''
    try:
        with open(file_path, encoding='utf-8') as handle:
            return handle.read().strip()
    except OSError:
        return ''


def runtime_url(plugin: Any = None) -> str:
    """Resolve the private Runtime URL inside LangBot's isolated plugin process."""
    configured = str(os.environ.get('KURISU_RUNTIME_URL') or '').strip()
    if not configured and plugin is not None:
        try:
            configured = str((plugin.get_config() or {}).get('runtime_url') or '').strip()
        except Exception:
            configured = ''
    return (configured or DEFAULT_RUNTIME_URL).rstrip('/')


def normalize_tool_input(tool_name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Normalize known legacy PUBG shapes before the Runtime schema check."""
    if tool_name not in {'kurisu.pubg.query', 'kurisu.pubg.list'}:
        return dict(tool_input)

    normalized = dict(tool_input)
    time_range = normalized.get('timeRange')
    if not isinstance(time_range, dict):
        legacy_date = normalized.pop('date', None)
        legacy_period = normalized.pop('period', None)
        legacy_selector = normalized.pop('selector', None)
        if legacy_date:
            time_range = {'kind': 'date', 'start': str(legacy_date), 'timezone': 'Asia/Shanghai'}
        elif isinstance(legacy_selector, dict) and legacy_selector.get('type') == 'relative_period':
            value = str(legacy_selector.get('value') or '').strip().lower()
            if value in RELATIVE_PERIODS:
                time_range = {'kind': value, 'timezone': 'Asia/Shanghai'}
        elif str(legacy_period or '').strip().lower() in RELATIVE_PERIODS:
            time_range = {'kind': str(legacy_period).strip().lower(), 'timezone': 'Asia/Shanghai'}
        if time_range is not None:
            normalized['timeRange'] = time_range

    if tool_name == 'kurisu.pubg.query' and 'operation' not in normalized:
        normalized = {
            'operation': 'report',
            'subject': {'type': 'team', 'ids': []},
            'timeRange': normalized.get('timeRange', {'kind': 'today', 'timezone': 'Asia/Shanghai'}),
            'metrics': [],
        }
    return normalized


def _post(url: str, payload: dict[str, Any], secret: str) -> dict[str, Any]:
    encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        url,
        data=encoded,
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Kurisu-Gateway-Secret': secret,
        },
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
        if not tool_name.startswith(ALLOWED_TOOL_PREFIXES) or not isinstance(tool_input, dict):
            return json.dumps({'status': 'error', 'error': {'code': 'STRUCTURED_INPUT_REQUIRED', 'retryable': False}}, ensure_ascii=False)
        tool_input = normalize_tool_input(tool_name, tool_input)
        call_id = stable_call_id(query_id, tool_name, tool_input)
        target_runtime_url = runtime_url(self.plugin)
        secret = runtime_secret()
        if not secret:
            return json.dumps({'status': 'unsupported', 'error': {'code': 'RUNTIME_SECRET_UNCONFIGURED', 'retryable': False}}, ensure_ascii=False)
        try:
            host_context = await trusted_session_context_from_plugin(session, query_id, self.plugin)
        except RuntimeError:
            return json.dumps(
                {'status': 'error', 'error': {'code': 'SESSION_CONTEXT_UNAVAILABLE', 'retryable': False}},
                ensure_ascii=False,
                separators=(',', ':'),
            )
        payload = {
            'callId': call_id,
            'toolName': tool_name,
            'input': tool_input,
            'hostContext': host_context,
        }
        result = await asyncio.to_thread(_post, f'{target_runtime_url}/kurisu/tool-call', payload, secret)
        return json.dumps(result, ensure_ascii=False, separators=(',', ':'))
