from __future__ import annotations

import logging
import re
from typing import Any

from components.intent import (
    is_cancel_request,
    is_confirm_request,
    is_list_request,
    parse_stop_intent,
)

try:
    from langbot_plugin.api.entities.builtin.provider import message as provider_message
except ImportError:  # pragma: no cover - outside LangBot
    provider_message = None

from components.vision import _content_text, _model_uuid, _parse_json

LOGGER = logging.getLogger('product-radar.intent')


def _deterministic_intent(text: str, has_images: bool) -> dict[str, Any] | None:
    normalized = text.strip().lower()
    if not normalized:
        return {'action': 'watch'} if has_images else None
    if is_list_request(text) or re.search(r'(?:我|当前|现在).{0,8}(?:在盯|监控|蹲).{0,8}(?:什么|哪些|哪几件)', text, re.IGNORECASE):
        return {'action': 'list'}
    if is_confirm_request(text):
        return {'action': 'confirm'}
    if is_cancel_request(text):
        return {'action': 'cancel'}
    stop = parse_stop_intent(text)
    if stop is not None:
        return stop
    if re.search(r'(?:刚才|刚刚|这个|这件|上面).{0,12}(?:不用了|不要了|不蹲了|别盯了|取消掉|停掉)', text, re.IGNORECASE):
        return {'action': 'stop'}
    return None


async def resolve_product_radar_intent(plugin: Any, text: str, has_images: bool) -> dict[str, Any] | None:
    """LLM intent boundary with deterministic fallback; never used by polling."""
    deterministic = _deterministic_intent(text, has_images)
    if deterministic is not None:
        return deterministic
    if provider_message is None:
        return {'action': 'watch'} if has_images else None
    model_uuid = await _model_uuid(plugin)
    if not model_uuid:
        return {'action': 'watch'} if has_images else None
    prompt = '''你是 Product Radar 的意图解析器，只输出 JSON，不回答用户问题，不调用工具。
识别 action：
- list：用户想查看当前监控，例如“我在盯哪些”“我都蹲了什么”
- confirm：用户确认开始监控
- cancel：用户取消待确认的监控预览
- stop：用户想停止/取消已经开始的监控，例如“刚才那件不要了”
- watch：用户想创建商品/卖家/图片相似监控
- none：与 Product Radar 无关
不要做最终商品匹配。只依据这条消息和是否带图片判断 intent。
输出格式：{"action":"list|confirm|cancel|stop|watch|none"}'''
    try:
        messages = [
            provider_message.Message(role='system', content='只输出合法 JSON。'),
            provider_message.Message(role='user', content=f'{prompt}\n消息：{text}\n带图片：{str(has_images).lower()}'),
        ]
        output = await plugin.invoke_llm(model_uuid, messages, funcs=[])
        parsed = _parse_json(_content_text(output))
        action = str(parsed.get('action') or '').strip().lower()
        if action in {'list', 'confirm', 'cancel', 'stop', 'watch', 'none'}:
            return {'action': action}
    except Exception as exc:  # pragma: no cover - provider integration behavior
        LOGGER.warning('intent extraction fallback: %s', type(exc).__name__)
    return {'action': 'watch'} if has_images else None
