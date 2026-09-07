from __future__ import annotations

from typing import Any

from components.intent import is_list_request, parse_watch_intent
from components.platform.bridge import callback_parts, event_text, platform_name, reply, source_object, value
from components.radar_client import create_watch, list_watches, preview_watch
from langbot_plugin.api.definition.components.common.event_listener import EventListener
from langbot_plugin.api.entities import context as event_context_module
from langbot_plugin.api.entities import events


def _format_price(value: Any) -> str:
    if not isinstance(value, dict):
        return '未知'
    amount = value.get('amount')
    currency = str(value.get('currency') or '')
    if not isinstance(amount, (int, float)):
        return '未知'
    return f"₩{amount:,.0f}" if currency.upper() == 'KRW' else f"{currency} {amount:,.2f}".strip()


def _proposal_summary(preview: dict[str, Any], proposal: dict[str, Any], token: str) -> tuple[str, list[dict[str, str]]]:
    source_name = str(preview.get('sourceDisplayName') or proposal.get('source') or '')
    if proposal.get('type') == 'seller':
        seller = preview.get('seller') if isinstance(preview.get('seller'), dict) else {}
        keywords = proposal.get('rules', {}).get('keywords', []) if isinstance(proposal.get('rules'), dict) else []
        text = '\n'.join([
            '👀 准备监控',
            '',
            f'平台：{source_name}',
            '类型：卖家监控',
            f"卖家：{seller.get('name') or seller.get('externalId') or proposal.get('target', {}).get('sellerExternalId')}",
            f"关键词：{'、'.join(keywords) if keywords else '不限关键词'}",
            '',
            f'如果平台没有按钮，请回复：确认监控 {token}',
        ])
    else:
        product = preview.get('product') if isinstance(preview.get('product'), dict) else {}
        text = '\n'.join([
            '👀 准备监控',
            '',
            f'平台：{source_name}',
            '类型：商品监控',
            f"商品：{product.get('title') or proposal.get('target', {}).get('productExternalId')}",
            f"当前价格：{_format_price(product.get('price'))}",
            '',
            '监控：',
            '✓ 价格',
            '✓ 商品状态',
            '',
            f'如果平台没有按钮，请回复：确认监控 {token}',
        ])
    return text, [
        {'text': '开始监控', 'callbackData': f'pr1:confirm:{token}'},
        {'text': '取消', 'callbackData': f'pr1:cancel:{token}'},
    ]


def _format_watches(result: dict[str, Any]) -> str:
    rows = result.get('watches') if isinstance(result.get('watches'), list) else []
    if not rows:
        return '目前没有正在监控的 Seller Watch 或 Product Watch。'
    lines = ['👀 当前监控']
    for row in rows:
        if not isinstance(row, dict):
            continue
        target = row.get('target') if isinstance(row.get('target'), dict) else {}
        target_value = target.get('sellerUrl') or target.get('productUrl') or target.get('sellerExternalId') or target.get('productExternalId') or ''
        lines.append(f"- {row.get('source')} / {row.get('type')} / {'启用' if row.get('enabled') else '暂停'}\n  {target_value}")
    return '\n'.join(lines)


class ProductRadarListener(EventListener):
    async def initialize(self) -> None:
        await super().initialize()
        for event_name in ('PersonNormalMessageReceived', 'GroupNormalMessageReceived', 'CallbackQueryReceived', 'TelegramCallbackQueryReceived'):
            event_type = getattr(events, event_name, None)
            if event_type is not None:
                @self.handler(event_type)
                async def handle(event_context: event_context_module.EventContext) -> None:
                    await self._handle(event_context)

    async def _handle(self, event_context: event_context_module.EventContext) -> None:
        event = event_context.event
        callback_id, callback_data = callback_parts(event)
        text = event_text(event).strip()
        plugin_state = getattr(self.plugin, 'pending_product_radar', {})
        if callback_data and callback_data.startswith('pr1:'):
            callback_parts_list = callback_data.split(':', 2)
            if len(callback_parts_list) != 3 or callback_parts_list[1] not in {'confirm', 'cancel'} or not callback_parts_list[2]:
                reply(event_context, '无效或已过期的监控确认。')
                event_context.prevent_default()
                event_context.prevent_postorder()
                return
            if platform_name(event) == 'telegram':
                acknowledge = getattr(event_context, 'answer_callback_query', None)
                if callable(acknowledge):
                    result = acknowledge(text='正在处理商品监控…')
                    if hasattr(result, '__await__'):
                        await result
            _, action, token = callback_parts_list
            await self._confirm_or_cancel(event_context, action, token, plugin_state)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return

        if text.startswith('确认监控 '):
            await self._confirm_or_cancel(event_context, 'confirm', text.split(' ', 1)[1].strip(), plugin_state)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        if text.startswith('取消监控 '):
            await self._confirm_or_cancel(event_context, 'cancel', text.split(' ', 1)[1].strip(), plugin_state)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        if is_list_request(text):
            try:
                reply(event_context, _format_watches(await list_watches(self.plugin)))
            except Exception:
                reply(event_context, '暂时无法读取 Product Radar 监控，请稍后再试。')
            event_context.prevent_default()
            event_context.prevent_postorder()
            return

        proposal = parse_watch_intent(text)
        if proposal is None:
            return
        try:
            preview = await preview_watch(self.plugin, proposal)
            token = f'{len(plugin_state):x}{id(proposal):x}'[-20:]
            plugin_state[token] = proposal
            setattr(self.plugin, 'pending_product_radar', plugin_state)
            summary, buttons = _proposal_summary(preview, proposal, token)
            reply(event_context, summary, buttons)
        except Exception as error:
            reply(event_context, f'暂时无法读取这个 Bunjang 目标：{error}')
        event_context.prevent_default()
        event_context.prevent_postorder()

    async def _confirm_or_cancel(self, event_context: Any, action: str, token: str, state: dict[str, Any]) -> None:
        proposal = state.get(token)
        if proposal is None:
            reply(event_context, '这个监控确认已过期，请重新发送商品或卖家 URL。')
            return
        state.pop(token, None)
        if action == 'cancel':
            reply(event_context, '已取消，不会创建监控。')
            return
        try:
            result = await create_watch(self.plugin, proposal)
            watch = result.get('watch') if isinstance(result, dict) else {}
            reply(event_context, f"✅ 已开始监控\n\n类型：{proposal.get('type')}\nWatch ID：{watch.get('id') if isinstance(watch, dict) else ''}")
        except Exception as error:
            reply(event_context, f'创建监控失败：{error}')
