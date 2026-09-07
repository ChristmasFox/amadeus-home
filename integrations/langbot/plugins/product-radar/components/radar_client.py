from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Any

DEFAULT_RADAR_URL = 'http://product-radar:5315'


def _config(plugin: Any, key: str, env_key: str, default: str = '') -> str:
    try:
        configured = str((plugin.get_config() or {}).get(key) or '').strip()
    except Exception:
        configured = ''
    return configured or os.environ.get(env_key, '').strip() or default


def _url(plugin: Any, path: str) -> str:
    return f"{_config(plugin, 'radar_url', 'PRODUCT_RADAR_URL', DEFAULT_RADAR_URL).rstrip('/')}{path}"


def _request(plugin: Any, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
    headers = {'Accept': 'application/json'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    api_key = _config(plugin, 'radar_api_key', 'PRODUCT_RADAR_API_KEY')
    if api_key:
        headers['X-Product-Radar-Key'] = api_key
    request = urllib.request.Request(_url(plugin, path), data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            value = json.loads(response.read().decode('utf-8'))
            return value if isinstance(value, dict) else {'data': value}
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode('utf-8'))
        except (OSError, ValueError, json.JSONDecodeError):
            detail = {}
        raise RuntimeError(str(detail.get('message') or f'Product Radar HTTP {error.code}')) from error
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError(f'Product Radar unavailable: {type(error).__name__}') from error


async def preview_watch(plugin: Any, proposal: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_request, plugin, 'POST', '/api/watches/preview', proposal)


async def create_watch(plugin: Any, proposal: dict[str, Any]) -> dict[str, Any]:
    return await asyncio.to_thread(_request, plugin, 'POST', '/api/watches', proposal)


async def list_watches(plugin: Any) -> dict[str, Any]:
    return await asyncio.to_thread(_request, plugin, 'GET', '/api/watches')
