from __future__ import annotations

import uuid
from typing import Any

from components.command_adapter import explicit_watch_id, watch_create_payload, watch_patch_payload
from components.context import (
    active_watch,
    clear_active_watch,
    context_key,
    load_context,
    record_command,
    set_active_watch,
    set_pending,
)
from components.intent_planner import resolve_product_radar_command
from components.platform.bridge import platform_name, reply
from components.platform.normalized import NormalizedBotMessage, normalize_event_message
from components.radar_client import (
    create_watch,
    delete_watch,
    get_watch,
    list_watches,
    patch_watch,
    preview_watch,
)
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


def _interval_label(value: Any, default: int = 900) -> str:
    try:
        seconds = int(value or default)
    except (TypeError, ValueError):
        seconds = default
    return f'每 {seconds // 60} 分钟' if seconds % 60 == 0 else f'每 {seconds} 秒'


def _proposal_summary(preview: dict[str, Any], proposal: dict[str, Any], token: str) -> tuple[str, list[dict[str, str]]]:
    source_name = str(preview.get('sourceDisplayName') or proposal.get('source') or '')
    interval_seconds = int(proposal.get('intervalSeconds') or (900 if proposal.get('type') == 'similarity' else 120))
    interval_label = _interval_label(interval_seconds)
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
        similarity = preview.get('similarity') if isinstance(preview.get('similarity'), dict) else {}
        threshold = similarity.get('threshold')
        try:
            threshold_label = f'{float(threshold) * 100:.0f}%'
        except (TypeError, ValueError):
            threshold_label = '60%'
        matcher = str(similarity.get('provider') or 'Sharp perceptual')
        text_lines = [
            '🎯 准备监控', '', f'平台：{source_name}',
            '你的条件：', *(f'• {line}' for line in user_lines[:8] or ['未提供明确硬条件']),
            '', '系统识别：', *(f'• {line}' for line in vision_lines[:8] or ['• 将使用图片和更宽泛的类别搜索']),
            '', '搜索范围：', *(f'• {line}' for line in plan_lines[:4] or [f'• {target_query}']),
            '', f'检查频率：{interval_label}', f'图片匹配器：{matcher}', f'图片匹配阈值：{threshold_label}',
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
        plan = row.get('searchPlan') if isinstance(row.get('searchPlan'), dict) else {}
        queries = plan.get('queries') if isinstance(plan.get('queries'), list) else []
        plan_value = '、'.join(str(item.get('query')) for item in queries if isinstance(item, dict) and item.get('query'))
        target_value = target.get('sellerUrl') or target.get('productUrl') or target.get('sellerExternalId') or target.get('productExternalId') or target.get('searchQuery') or plan_value or row.get('id') or ''
        interval = row.get('intervalSeconds') or 0
        lines.append(f"- {row.get('source')} / {row.get('type')} / {'启用' if row.get('enabled') else '暂停'} / {_interval_label(interval, 0) if interval else '频率未知'}\n  {target_value}")
    return '\n'.join(lines)


def _watch_id_from_command(command: dict[str, Any], context: dict[str, Any] | None, rows: list[dict[str, Any]] | None = None) -> str | None:
    direct = explicit_watch_id(command)
    if direct:
        return direct
    current = active_watch(context)
    if current and current.get('id'):
        return str(current['id'])
    entities = command.get('entities') if isinstance(command.get('entities'), dict) else {}
    targets = [entities.get('sellerUrl'), entities.get('productUrl')]
    if rows:
        matches: list[str] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            target = row.get('target') if isinstance(row.get('target'), dict) else {}
            if any(value and value in {target.get('sellerUrl'), target.get('productUrl')} for value in targets):
                if row.get('id'):
                    matches.append(str(row['id']))
        if len(matches) == 1:
            return matches[0]
    return None


def _clarification(command: dict[str, Any]) -> str:
    return str(command.get('clarificationQuestion') or '我还不能唯一确定你的意思，请补充要操作的商品或监控。')


def _prevent(event_context: Any) -> None:
    event_context.prevent_default()
    event_context.prevent_postorder()


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
        message = normalize_event_message(event, query_id=event_context.query_id)
        key = context_key(message)
        context = load_context(self.plugin, message)
        pending = getattr(self.plugin, 'pending_product_radar', {})
        pending_context = getattr(self.plugin, 'pending_product_radar_context', {})
        watch_context = getattr(self.plugin, 'product_radar_watch_context', {})
        callback_data = str((message.get('callback') or {}).get('data') or '')

        callback_prefix = callback_data.split(':', 1)[0] if callback_data else ''
        if callback_prefix == 'pr1':
            parts = callback_data.split(':', 2)
            if len(parts) != 3 or parts[1] not in {'confirm', 'cancel'} or not parts[2]:
                reply(event_context, '无效或已过期的监控确认。')
                _prevent(event_context)
                return
            if platform_name(event) == 'telegram':
                acknowledge = getattr(event_context, 'answer_callback_query', None)
                if callable(acknowledge):
                    result = acknowledge(text='正在处理商品监控…')
                    if hasattr(result, '__await__'):
                        await result
            await self._confirm_or_cancel(event_context, parts[1], parts[2], pending, pending_context, watch_context, message, key)
            _prevent(event_context)
            return

        command = await resolve_product_radar_command(self.plugin, message=message, context=context)
        if command is None or command.get('domain') != 'product_radar':
            return
        record_command(self.plugin, message, command)
        control = command.get('control')
        if control in {'confirm', 'cancel'}:
            token = explicit_watch_id(command)
            if token not in pending or pending_context.get(token) != key:
                token = self._latest_pending_token(pending, pending_context, key)
            if token is None:
                reply(event_context, '目前没有对应的待确认监控。')
            else:
                await self._confirm_or_cancel(event_context, str(control), token, pending, pending_context, watch_context, message, key)
            _prevent(event_context)
            return
        if command.get('needsClarification'):
            reply(event_context, _clarification(command))
            _prevent(event_context)
            return

        intent = str(command.get('intent') or '')
        if intent == 'list_watches':
            try:
                reply(event_context, _format_watches(await list_watches(self.plugin)))
            except Exception:
                reply(event_context, '暂时无法读取 Product Radar 监控，请稍后再试。')
            _prevent(event_context)
            return
        if intent == 'create_watch':
            await self._create_proposal(event_context, message, command, pending, pending_context, key)
            _prevent(event_context)
            return
        await self._handle_watch_operation(event_context, message, context, command, watch_context)
        _prevent(event_context)

    async def _create_proposal(
        self,
        event_context: Any,
        message: NormalizedBotMessage,
        command: dict[str, Any],
        pending: dict[str, dict],
        pending_context: dict[str, str],
        key: str,
    ) -> None:
        proposal = watch_create_payload(command, message)
        if proposal is None:
            reply(event_context, _clarification(command))
            return
        try:
            preview = await preview_watch(self.plugin, proposal)
            token = uuid.uuid4().hex[:16]
            pending[token] = proposal
            pending_context[token] = key
            setattr(self.plugin, 'pending_product_radar', pending)
            setattr(self.plugin, 'pending_product_radar_context', pending_context)
            set_pending(self.plugin, message, token)
            summary, buttons = _proposal_summary(preview, proposal, token)
            reply(event_context, summary, buttons)
        except Exception as error:
            reply(event_context, f'暂时无法读取这个 Bunjang 目标：{error}')

    @staticmethod
    def _latest_pending_token(pending: dict[str, dict], pending_context: dict[str, str], key: str) -> str | None:
        # No global/singleton fallback: another member in the same group must
        # never inherit a different sender's pending proposal.
        candidates = [token for token in pending if pending_context.get(token) == key]
        return candidates[-1] if candidates else None

    async def _confirm_or_cancel(
        self,
        event_context: Any,
        action: str,
        token: str,
        pending: dict[str, dict],
        pending_context: dict[str, str],
        watch_context: dict[str, str],
        message: NormalizedBotMessage,
        key: str,
    ) -> None:
        proposal = pending.get(token)
        if proposal is None or pending_context.get(token) != key:
            reply(event_context, '这个监控确认已过期，或不属于当前会话。')
            return
        if action == 'cancel':
            pending.pop(token, None)
            pending_context.pop(token, None)
            set_pending(self.plugin, message, None)
            reply(event_context, '已取消，不会创建监控。')
            return
        try:
            result = await create_watch(self.plugin, proposal)
            watch = result.get('watch') if isinstance(result, dict) else {}
            watch_id = watch.get('id') if isinstance(watch, dict) else ''
            if watch_id:
                watch_context[str(watch_id)] = key
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                set_active_watch(self.plugin, message, watch)
            pending.pop(token, None)
            pending_context.pop(token, None)
            set_pending(self.plugin, message, None)
            interval = proposal.get('intervalSeconds') or (900 if proposal.get('type') == 'similarity' else 120)
            reply(event_context, f"✅ 已开始监控\n\n类型：{proposal.get('type')}\n频率：{_interval_label(interval)}\nWatch ID：{watch_id}")
        except Exception as error:
            # Keep the proposal so the user can retry after a transient sensor/API failure.
            reply(event_context, f'创建监控失败：{error}')

    async def _handle_watch_operation(
        self,
        event_context: Any,
        message: NormalizedBotMessage,
        context: dict[str, Any] | None,
        command: dict[str, Any],
        watch_context: dict[str, str],
    ) -> None:
        intent = str(command.get('intent') or '')
        rows: list[dict[str, Any]] = []
        if not active_watch(context) or not explicit_watch_id(command):
            try:
                listed = await list_watches(self.plugin)
                rows = [row for row in listed.get('watches', []) if isinstance(row, dict)]
            except Exception:
                rows = []
        watch_id = _watch_id_from_command(command, context, rows)
        if watch_id is None:
            reply(event_context, _clarification(command))
            return
        try:
            if intent == 'get_watch':
                watch = await get_watch(self.plugin, watch_id)
                reply(event_context, self._format_watch_detail(watch))
                return
            if intent == 'update_watch':
                current = await get_watch(self.plugin, watch_id)
                patch = watch_patch_payload(command, current)
                if not patch:
                    reply(event_context, _clarification(command))
                    return
                updated = await patch_watch(self.plugin, watch_id, patch)
                set_active_watch(self.plugin, message, updated)
                watch_context[watch_id] = context_key(message)
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                reply(event_context, f'✅ 已更新监控\n\nWatch ID：{watch_id}')
                return
            if intent in {'pause_watch', 'resume_watch'}:
                enabled = intent == 'resume_watch'
                updated = await patch_watch(self.plugin, watch_id, {'enabled': enabled})
                set_active_watch(self.plugin, message, updated)
                watch_context[watch_id] = context_key(message)
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                reply(event_context, f"{'▶️ 已恢复' if enabled else '⏸️ 已暂停'}监控\n\nWatch ID：{watch_id}")
                return
            if intent == 'delete_watch':
                await delete_watch(self.plugin, watch_id)
                watch_context.pop(watch_id, None)
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                clear_active_watch(self.plugin, message)
                reply(event_context, f'⏹️ 已删除监控\n\nWatch ID：{watch_id}')
                return
            reply(event_context, _clarification(command))
        except Exception as error:
            reply(event_context, f'Product Radar 操作失败：{error}')

    @staticmethod
    def _format_watch_detail(watch: Any) -> str:
        if not isinstance(watch, dict):
            return '找不到这个监控。'
        target = watch.get('target') if isinstance(watch.get('target'), dict) else {}
        label = target.get('sellerUrl') or target.get('productUrl') or target.get('searchQuery') or watch.get('id')
        enabled = '启用' if watch.get('enabled') else '暂停'
        return '\n'.join([
            '👀 监控详情',
            '',
            f"Watch ID：{watch.get('id')}",
            f"类型：{watch.get('type')}",
            f"平台：{watch.get('source')}",
            f'状态：{enabled}',
            f"频率：{_interval_label(watch.get('intervalSeconds'))}",
            f'目标：{label}',
        ])
