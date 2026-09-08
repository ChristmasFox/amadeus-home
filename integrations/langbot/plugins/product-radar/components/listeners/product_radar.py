from __future__ import annotations

from typing import Any

from components.intent import (
    is_cancel_request,
    is_confirm_request,
    is_list_request,
    parse_similarity_watch_intent,
    parse_stop_intent,
    parse_watch_intent,
)
from components.platform.bridge import attachment_sources, callback_parts, conversation_key, event_text, platform_name, reply
from components.radar_client import create_watch, list_watches, patch_watch, preview_watch
from components.vision import analyze_target_profile
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
    interval_seconds = int(proposal.get('intervalSeconds') or (900 if proposal.get('type') == 'similarity' else 120))
    interval_label = f'每 {interval_seconds // 60} 分钟' if interval_seconds % 60 == 0 else f'每 {interval_seconds} 秒'
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
            f'频率：{interval_label}',
            '',
            f'如果平台没有按钮，请回复：确认监控 {token}',
        ])
    elif proposal.get('type') == 'product':
        product = preview.get('product') if isinstance(preview.get('product'), dict) else {}
        text = '\n'.join([
            '👀 准备监控',
            '',
            f'平台：{source_name}',
            '类型：商品监控',
            f"商品：{product.get('title') or proposal.get('target', {}).get('productExternalId')}",
            f"当前价格：{_format_price(product.get('price'))}",
            f'频率：{interval_label}',
            '',
            '监控：',
            '✓ 价格',
            '✓ 商品状态',
            '',
            f'如果平台没有按钮，请回复：确认监控 {token}',
        ])
    else:
        target = proposal.get('target') if isinstance(proposal.get('target'), dict) else {}
        profile = preview.get('targetProfile') if isinstance(preview.get('targetProfile'), dict) else {}
        plan = preview.get('searchPlan') if isinstance(preview.get('searchPlan'), dict) else {}
        queries = plan.get('queries') if isinstance(plan.get('queries'), list) else []
        hard = profile.get('hardConstraints') if isinstance(profile.get('hardConstraints'), list) else []
        soft = profile.get('softHints') if isinstance(profile.get('softHints'), list) else []
        user_lines = [str(item.get('value')) for item in hard if isinstance(item, dict) and item.get('source') == 'user' and item.get('value')]
        vision_lines = [f"{item.get('field')}：{item.get('value')}" for item in soft if isinstance(item, dict) and item.get('source') in {'vision', 'ocr'} and item.get('value')]
        plan_lines = [str(item.get('query')) for item in queries if isinstance(item, dict) and item.get('query')]
        target_query = target.get('searchQuery') or '由 TargetProfile 生成'
        text_lines = [
            '🎯 准备监控', '', f'平台：{source_name}',
            '你的条件：', *(f'• {line}' for line in user_lines[:8] or ['未提供明确硬条件']),
            '', '系统识别：', *(f'• {line}' for line in vision_lines[:8] or ['• 将使用图片和更宽泛的类别搜索']),
            '', '搜索范围：', *(f'• {line}' for line in plan_lines[:4] or [f'• {target_query}']),
            '', f'检查频率：{interval_label}', '图片匹配阈值：60%',
            '', '初始 baseline 不会发送通知。', '', f'如果平台没有按钮，请回复：确认监控 {token}',
        ]
        text = '\n'.join(text_lines)
    return text, [
        {'text': '开始监控', 'callbackData': f'pr1:confirm:{token}'},
        {'text': '取消', 'callbackData': f'pr1:cancel:{token}'},
    ]


def _format_watches(result: dict[str, Any]) -> str:
    rows = result.get('watches') if isinstance(result.get('watches'), list) else []
    if not rows:
        return '目前没有正在监控的 Seller Watch、Product Watch 或 Similarity Watch。'
    lines = ['👀 当前监控']
    for row in rows:
        if not isinstance(row, dict):
            continue
        target = row.get('target') if isinstance(row.get('target'), dict) else {}
        target_value = target.get('sellerUrl') or target.get('productUrl') or target.get('sellerExternalId') or target.get('productExternalId') or ''
        interval = int(row.get('intervalSeconds') or 0)
        frequency = f'，每 {interval // 60} 分钟' if interval and interval % 60 == 0 else ''
        lines.append(f"- {row.get('source')} / {row.get('type')} / {'启用' if row.get('enabled') else '暂停'}{frequency}\n  {target_value}")
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
        _callback_id, callback_data = callback_parts(event)
        text = event_text(event).strip()
        pending = getattr(self.plugin, 'pending_product_radar', {})
        pending_context = getattr(self.plugin, 'pending_product_radar_context', {})
        watch_context = getattr(self.plugin, 'product_radar_watch_context', {})
        context = conversation_key(event)

        if callback_data and callback_data.startswith('pr1:'):
            parts = callback_data.split(':', 2)
            if len(parts) != 3 or parts[1] not in {'confirm', 'cancel'} or not parts[2]:
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
            await self._confirm_or_cancel(event_context, parts[1], parts[2], pending, pending_context, watch_context, context)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return

        if text.lower().startswith('确认监控 ') or text.lower().startswith('开始监控 '):
            token = text.split(None, 1)[1].strip()
            await self._confirm_or_cancel(event_context, 'confirm', token, pending, pending_context, watch_context, context)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        if is_confirm_request(text):
            token = self._latest_pending_token(pending, pending_context, context)
            if token is None:
                reply(event_context, '目前没有待确认的监控。请先发送商品或卖家 URL。')
            else:
                await self._confirm_or_cancel(event_context, 'confirm', token, pending, pending_context, watch_context, context)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        if text.lower().startswith('取消监控 ') or text.lower().startswith('取消 '):
            token = text.split(None, 1)[1].strip()
            await self._confirm_or_cancel(event_context, 'cancel', token, pending, pending_context, watch_context, context)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        if is_cancel_request(text):
            token = self._latest_pending_token(pending, pending_context, context)
            if token is None:
                reply(event_context, '目前没有待取消的监控确认。')
            else:
                await self._confirm_or_cancel(event_context, 'cancel', token, pending, pending_context, watch_context, context)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return

        stop = parse_stop_intent(text)
        if stop is not None:
            await self._stop_watch(event_context, stop.get('url'), context, watch_context)
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

        images = attachment_sources(event)
        proposal = parse_similarity_watch_intent(text, images)
        if proposal is None:
            proposal = parse_watch_intent(text)
        if proposal is None:
            return
        try:
            if proposal.get('type') == 'similarity' and images:
                vision_profile = await analyze_target_profile(self.plugin, images, text)
                if vision_profile:
                    target = proposal.get('target') if isinstance(proposal.get('target'), dict) else {}
                    target['visionProfile'] = vision_profile
                    proposal['target'] = target
            preview = await preview_watch(self.plugin, proposal)
            token = f'{len(pending):x}{id(proposal):x}'[-20:]
            pending[token] = proposal
            pending_context[token] = context
            setattr(self.plugin, 'pending_product_radar', pending)
            setattr(self.plugin, 'pending_product_radar_context', pending_context)
            summary, buttons = _proposal_summary(preview, proposal, token)
            reply(event_context, summary, buttons)
        except Exception as error:
            reply(event_context, f'暂时无法读取这个 Bunjang 目标：{error}')
        event_context.prevent_default()
        event_context.prevent_postorder()

    @staticmethod
    def _latest_pending_token(pending: dict[str, dict], pending_context: dict[str, str], context: str) -> str | None:
        candidates = [token for token in pending if pending_context.get(token) == context]
        if not candidates and len(pending) == 1:
            candidates = list(pending)
        return candidates[-1] if candidates else None

    async def _confirm_or_cancel(
        self,
        event_context: Any,
        action: str,
        token: str,
        pending: dict[str, dict],
        pending_context: dict[str, str],
        watch_context: dict[str, str],
        context: str,
    ) -> None:
        proposal = pending.get(token)
        if proposal is None:
            reply(event_context, '这个监控确认已过期，请重新发送商品或卖家 URL。')
            return
        if action == 'cancel':
            pending.pop(token, None)
            pending_context.pop(token, None)
            reply(event_context, '已取消，不会创建监控。')
            return
        try:
            result = await create_watch(self.plugin, proposal)
            watch = result.get('watch') if isinstance(result, dict) else {}
            watch_id = watch.get('id') if isinstance(watch, dict) else ''
            if watch_id:
                watch_context[str(watch_id)] = context
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
            pending.pop(token, None)
            pending_context.pop(token, None)
            interval = int(proposal.get('intervalSeconds') or 120)
            reply(event_context, f"✅ 已开始监控\n\n类型：{proposal.get('type')}\n频率：每 {interval // 60} 分钟\nWatch ID：{watch_id}")
        except Exception as error:
            # Keep the proposal so the user can retry after a transient sensor/API failure.
            reply(event_context, f'创建监控失败：{error}')

    async def _stop_watch(self, event_context: Any, target_url: str | None, context: str, watch_context: dict[str, str]) -> None:
        try:
            result = await list_watches(self.plugin)
            rows = result.get('watches') if isinstance(result.get('watches'), list) else []
            enabled = [row for row in rows if isinstance(row, dict) and row.get('enabled')]
            matches = []
            if target_url:
                target_url = target_url.rstrip('.,，。！？!）)]}')
                for row in enabled:
                    target = row.get('target') if isinstance(row.get('target'), dict) else {}
                    if target_url in {target.get('sellerUrl'), target.get('productUrl')}:
                        matches.append(row)
            else:
                matches = [row for row in enabled if watch_context.get(str(row.get('id'))) == context]
                if not matches and len(enabled) == 1:
                    matches = enabled
            if not matches:
                reply(event_context, '没有找到这个会话对应的启用监控。')
                return
            stopped = []
            failures = []
            for row in matches:
                watch_id = str(row.get('id'))
                try:
                    await patch_watch(self.plugin, watch_id, {'enabled': False})
                    watch_context.pop(watch_id, None)
                    stopped.append(watch_id)
                except Exception as error:
                    failures.append(f'{watch_id}: {error}')
            setattr(self.plugin, 'product_radar_watch_context', watch_context)
            if stopped:
                reply(event_context, f"⏹️ 已停止监控\n\nWatch ID：{', '.join(stopped)}" + (f"\n\n失败：{'；'.join(failures)}" if failures else ''))
            else:
                reply(event_context, f"停止监控失败：{'；'.join(failures)}")
        except Exception as error:
            reply(event_context, f'读取监控失败：{error}')
