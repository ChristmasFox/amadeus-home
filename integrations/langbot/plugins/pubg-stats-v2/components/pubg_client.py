from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

N8N_WEBHOOK_URL = 'http://n8n:5678/webhook/pubg-query-gateway-v2'
REQUEST_TIMEOUT_SECONDS = 180
UNAVAILABLE_MESSAGE = '暂时无法获取 PUBG 战绩，请稍后再试。'


def _session_context(session: Any) -> dict[str, str]:
    if session is None:
        return {}

    launcher_type = getattr(session, 'launcher_type', None)
    launcher_type = getattr(launcher_type, 'value', launcher_type)
    launcher_id = getattr(session, 'launcher_id', None)
    if launcher_type in (None, '') or launcher_id in (None, ''):
        return {}

    context_type = str(launcher_type)
    context_id = str(launcher_id)
    result = {
        'key': f'pubg-context:{context_type}:{context_id}',
        'type': context_type,
        'id': context_id,
    }

    for source_name, target_name in (
        ('sender_id', 'senderId'),
        ('bot_uuid', 'botUuid'),
        ('workspace_uuid', 'workspaceUuid'),
        ('instance_uuid', 'instanceUuid'),
    ):
        value = getattr(session, source_name, None)
        if value not in (None, ''):
            result[target_name] = str(value)

    return result


def fetch_pubg_stats(
    query: str = '今日战绩',
    query_plan: dict[str, Any] | None = None,
    session: Any = None,
    query_id: int | str | None = None,
) -> str:
    message = str(query or '今日战绩').strip() or '今日战绩'
    normalized_plan = query_plan if isinstance(query_plan, dict) else {}
    payload_data: dict[str, Any] = {
        'chatInput': message,
        'message': message,
        'user_message_text': message,
        'queryPlan': normalized_plan,
        'query_plan': normalized_plan,
        'context': _session_context(session),
    }
    if query_id is not None:
        payload_data['queryId'] = str(query_id)

    payload = json.dumps(
        payload_data,
        ensure_ascii=False,
    ).encode('utf-8')
    request = urllib.request.Request(
        N8N_WEBHOOK_URL,
        data=payload,
        headers={'Content-Type': 'application/json'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode('utf-8'))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return UNAVAILABLE_MESSAGE

    result = body.get('response') if isinstance(body, dict) else None
    return result if isinstance(result, str) and result.strip() else UNAVAILABLE_MESSAGE


def fetch_pubg_data(
    query: dict[str, Any],
    session: Any = None,
) -> dict[str, Any]:
    payload_data: dict[str, Any] = {
        'query': query,
        'queryId': query.get('queryId'),
        'sessionId': query.get('sessionId'),
        'context': _session_context(session),
    }
    payload = json.dumps(payload_data, ensure_ascii=False).encode('utf-8')
    request = urllib.request.Request(
        N8N_WEBHOOK_URL,
        data=payload,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode('utf-8'))
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return {
            'records': [],
            'coverage': {
                'status': 'SOURCE_UNAVAILABLE',
                'complete': False,
                'sourceUnavailable': True,
            },
            'source': {'store': 'n8n-data-table', 'error': 'query gateway unavailable'},
            'diagnostics': {'transportError': True},
        }
    if not isinstance(body, dict):
        return {
            'records': [],
            'coverage': {'status': 'SOURCE_UNAVAILABLE', 'complete': False, 'sourceUnavailable': True},
            'source': {'store': 'n8n-data-table', 'error': 'invalid query gateway response'},
        }
    return body
