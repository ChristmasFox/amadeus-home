from __future__ import annotations

import asyncio
import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from components.platform.contracts import NormalizedBotMessage


DEFAULT_RUNTIME_URL = 'http://pubg-query-engine-v3:5310'
REQUEST_TIMEOUT_SECONDS = 180
UNAVAILABLE_MESSAGE = '暂时无法获取 PUBG 战绩，请稍后再试。'
WHOAMI_UNAVAILABLE_MESSAGE = '暂时无法读取当前平台身份，请稍后再试。'
WHOAMI_COMMAND = re.compile(r'^/whoami(?:@[A-Za-z0-9_]+)?\s*$', re.IGNORECASE)
LOCAL_PUBG_SIGNAL = re.compile(
    r'PUBG|绝地求生|吃鸡|战绩|KD|K/D|击杀|杀人|人头|伤害|助攻|倒地|击倒|救援|扶人|排名|名次|场均|几把|多少场|谁最强|谁最菜|谁最拉|拉完了|发挥最好|状态最好|表现最好|复盘|对局复盘|分析某一局|分析这把|分析这局|看看这把怎么打|看看这局怎么打|最后一把为什么输|这把怎么打|上一把|下一把|火箭筒|重武器|开车|载具|最近\s*\d+\s*(?:场|把|局)|最近\s*\d+\s*天|上周|前天|昨天|昨日|昨晚|今天|今日',
    re.IGNORECASE,
)


def is_whoami_command(text: Any) -> bool:
    return bool(WHOAMI_COMMAND.fullmatch(str(text or '').strip()))


def _runtime_url(plugin: Any = None) -> str:
    configured = ''
    if plugin is not None:
        try:
            config = plugin.get_config() or {}
            configured = str(config.get('runtime_url') or '').strip()
        except Exception:
            configured = ''
    return (configured or os.environ.get('PUBG_QUERY_ENGINE_V3_URL', '') or DEFAULT_RUNTIME_URL).rstrip('/')


def _post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    encoded = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        url,
        data=encoded,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read().decode('utf-8'))
        except (OSError, json.JSONDecodeError):
            body = {}
        if isinstance(body, dict):
            body.setdefault('status', 'SOURCE_UNAVAILABLE')
            body.setdefault('error', f'http_{error.code}')
            return body
        return {'status': 'SOURCE_UNAVAILABLE', 'error': f'http_{error.code}'}
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        return {'status': 'SOURCE_UNAVAILABLE', 'error': type(error).__name__}
    return body if isinstance(body, dict) else {'status': 'SOURCE_UNAVAILABLE', 'error': 'invalid_runtime_response'}


async def classify_pubg_message(
    plugin: Any,
    *,
    message: NormalizedBotMessage,
) -> dict[str, Any]:
    payload = {
        'message': message,
    }
    result = await asyncio.to_thread(_post_json, f'{_runtime_url(plugin)}/v3/route', payload)
    if result.get('route') in {'mandatory', 'pass'}:
        return result
    if LOCAL_PUBG_SIGNAL.search(message['message']['text']):
        return {
            'domain': 'pubg',
            'route': 'mandatory',
            'reason': 'explicit_pubg_signal',
            'contextActive': False,
            'fallback': True,
        }
    return {'domain': 'unknown', 'route': 'pass', 'reason': 'runtime_unavailable'}


async def run_pubg_query(
    plugin: Any,
    *,
    message: NormalizedBotMessage,
    query_id: int | str,
    provided_plan: Any = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        'message': message,
        'queryId': str(query_id),
    }
    if isinstance(provided_plan, dict):
        payload['queryPlan'] = provided_plan
    result = await asyncio.to_thread(_post_json, f'{_runtime_url(plugin)}/v3/query', payload)
    if not result.get('response'):
        result['response'] = UNAVAILABLE_MESSAGE
    result.setdefault('status', 'SOURCE_UNAVAILABLE')
    result.setdefault('queryId', str(query_id))
    try:
        setattr(plugin, 'last_pubg_query_result', result)
        setattr(plugin, 'last_pubg_query_message', {
            'version': message.get('version'),
            'platform': message.get('platform'),
            'botId': message.get('botId'),
            'user': message.get('user'),
            'chat': message.get('chat'),
            'message': message.get('message'),
            'mentions': message.get('mentions', []),
            'attachments': message.get('attachments', []),
            'timestamp': message.get('timestamp'),
        })
    except Exception:
        pass
    return result


async def run_pubg_callback(
    plugin: Any,
    *,
    message: NormalizedBotMessage,
    query_id: int | str,
) -> dict[str, Any]:
    callback = message.get('callback') or {}
    payload = {
        'message': message,
        'queryId': str(query_id),
        'callbackId': callback.get('id'),
        'callbackData': callback.get('data'),
    }
    result = await asyncio.to_thread(_post_json, f'{_runtime_url(plugin)}/v3/callback', payload)
    if not result.get('response'):
        result['response'] = UNAVAILABLE_MESSAGE
    result.setdefault('status', 'SOURCE_UNAVAILABLE')
    result.setdefault('queryId', str(query_id))
    return result


async def run_whoami(
    plugin: Any,
    *,
    message: NormalizedBotMessage,
    query_id: int | str,
) -> dict[str, Any]:
    user = message.get('user') or {}
    platform_user_id = str(user.get('platformUserId') or '').strip()
    if not platform_user_id or platform_user_id.lower() in {'unknown', 'undefined', 'null'}:
        return {
            'status': 'INVALID_IDENTITY',
            'response': '无法读取真实的平台用户 ID，未返回猜测的身份信息。',
            'queryId': str(query_id),
        }

    result = await asyncio.to_thread(
        _post_json,
        f'{_runtime_url(plugin)}/v3/whoami',
        {'message': message, 'queryId': str(query_id)},
    )
    if not result.get('response'):
        result['response'] = WHOAMI_UNAVAILABLE_MESSAGE
    result.setdefault('status', 'SOURCE_UNAVAILABLE')
    result.setdefault('queryId', str(query_id))
    # Deliberately do not cache the result on the plugin object: /whoami is a
    # read-only identity inspection and must not create mutable plugin state.
    return result
