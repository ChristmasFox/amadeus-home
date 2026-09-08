from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

try:
    from langbot_plugin.api.entities.builtin.provider import message as provider_message
except ImportError:  # pragma: no cover - exercised only outside LangBot
    provider_message = None

LOGGER = logging.getLogger('product-radar.vision')
# Current LangBot model registry UUID for GPT-5.6 Luna; configurable via plugin config/env.
KNOWN_VISION_MODEL = '581087d4-5793-4116-9aa1-d82e08ec6849'


def _config(plugin: Any, key: str, env_key: str) -> str:
    try:
        configured = str((plugin.get_config() or {}).get(key) or '').strip()
    except Exception:
        configured = ''
    return configured or os.environ.get(env_key, '').strip()


async def _model_uuid(plugin: Any) -> str | None:
    configured = _config(plugin, 'vision_model_uuid', 'PRODUCT_RADAR_VISION_MODEL_UUID')
    try:
        models = await plugin.get_llm_models()
    except Exception:
        models = []
    if configured and (not models or configured in models):
        return configured
    if KNOWN_VISION_MODEL in models:
        return KNOWN_VISION_MODEL
    return str(models[0]) if models else configured or KNOWN_VISION_MODEL


def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        for key in ('content', 'text', 'message', 'output'):
            if key in value:
                text = _content_text(value[key])
                if text:
                    return text
    if isinstance(value, list):
        return ''.join(_content_text(item) for item in value)
    return str(value or '')


def _parse_json(value: str) -> dict[str, Any]:
    text = value.strip()
    fenced = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        text = fenced.group(1)
    else:
        start, end = text.find('{'), text.rfind('}')
        if start >= 0 and end > start:
            text = text[start:end + 1]
    parsed = json.loads(text)
    return parsed if isinstance(parsed, dict) else {}


def _image_block(source: dict[str, str]) -> dict[str, Any] | None:
    if source.get('referenceImageBase64'):
        value = source['referenceImageBase64']
        if not value.startswith('data:'):
            value = f'data:image/jpeg;base64,{value}'
        return {'type': 'image_url', 'image_url': {'url': value}}
    if source.get('referenceImageUrl'):
        return {'type': 'image_url', 'image_url': {'url': source['referenceImageUrl']}}
    return None


async def analyze_target_profile(plugin: Any, images: list[dict[str, str]], user_text: str) -> dict[str, Any] | None:
    model_uuid = await _model_uuid(plugin)
    if not model_uuid or provider_message is None:
        return None
    prompt = '''你是商品搜索理解器。只输出 JSON，不要解释，不要做最终同款判定。
从用户文字和商品图片中提取用于长期二手商品搜索的 TargetProfile。用户明确提供的品牌、型号、季节、价格、必须/不要条件优先于图片推断，不能被图片推断覆盖。
字段：brand, modelName, season, category, subcategory, colors[], materials[], features[], detectedText[], size, minPrice, maxPrice, includeKeywords[], excludeKeywords[], explicitSearchTerms[], confidence。
视觉字段属于 soft hint；明确“必须/只要/不要”和明确品牌/型号/季节/价格属于 hard constraint。没有把握的字段省略或给低 confidence。
'''
    content: list[dict[str, Any]] = [{'type': 'text', 'text': f'{prompt}\n用户文字：{user_text or "（无）"}'}]
    for source in images:
        block = _image_block(source)
        if block:
            content.append(block)
    try:
        messages = [
            provider_message.Message(role='system', content='只输出合法 JSON。'),
            provider_message.Message(role='user', content=content),
        ]
        output = await plugin.invoke_llm(model_uuid, messages, funcs=[])
        profile = _parse_json(_content_text(output))
        profile['provider'] = 'langbot-vision'
        return profile
    except Exception as exc:  # pragma: no cover - provider behavior is integration-specific
        LOGGER.warning('target profile extraction fallback: %s', type(exc).__name__)
        return None
