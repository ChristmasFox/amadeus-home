from __future__ import annotations

import uuid
from typing import Any

from components.command_adapter import explicit_watch_id, explicit_watch_ordinal, watch_create_payload, watch_patch_payload
from components.context import (
    active_watch,
    clear_active_watch,
    context_key,
    load_context,
    record_command,
    set_active_watch,
    set_pending,
    set_watch_list,
    watch_list_ids as context_watch_list_ids,
)
from components.intent_planner import apply_active_watch_context, resolve_product_radar_command
from components.platform.bridge import platform_name, reply
from components.platform.normalized import NormalizedBotMessage, normalize_event_message
from components.radar_client import (
    create_watch,
    delete_watch,
    bind_watch_context,
    clear_watch_context,
    get_watch_context,
    get_watch_observability,
    get_watch,
    list_watches,
    patch_watch,
    preview_watch,
    record_usage,
)
from components.watch_presentation import (
    delete_choice_buttons as _delete_choice_buttons,
    format_delete_choices as _format_delete_choices,
    format_watches as _format_watches,
    watch_ids as _watch_ids,
    watch_rows as _watch_rows,
    watch_target_value as _watch_target_value,
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


def _remember_watch_list(plugin: Any, message: NormalizedBotMessage, rows: list[dict[str, Any]]) -> list[str]:
    ids = _watch_ids(rows)
    lists = getattr(plugin, 'product_radar_watch_lists', {})
    if not isinstance(lists, dict):
        lists = {}
    lists[context_key(message)] = ids
    setattr(plugin, 'product_radar_watch_lists', lists)
    set_watch_list(plugin, message, ids)
    return ids


def _watch_id_from_command(
    command: dict[str, Any],
    context: dict[str, Any] | None,
    rows: list[dict[str, Any]] | None = None,
    watch_context: dict[str, str] | None = None,
    owner_key: str | None = None,
    displayed_watch_ids: list[str] | None = None,
) -> str | None:
    direct = explicit_watch_id(command)
    if direct:
        return direct
    ordinal = explicit_watch_ordinal(command)
    if ordinal:
        ordered_ids = displayed_watch_ids or []
        if ordered_ids:
            candidate = ordered_ids[ordinal - 1] if ordinal <= len(ordered_ids) else None
            if candidate and (not rows or any(str(row.get('id')) == candidate for row in rows)):
                return candidate
            return None
        if rows and ordinal <= len(rows):
            candidate = rows[ordinal - 1].get('id')
            if candidate:
                return str(candidate)
        return None
    current = active_watch(context)
    if current and current.get('id'):
        return str(current['id'])
    if watch_context and owner_key:
        owned = [watch_id for watch_id, key in watch_context.items() if key == owner_key]
        if len(owned) == 1:
            return owned[0]
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
        active = [row for row in rows if row.get('enabled')]
        similarity = [row for row in active if row.get('type') == 'similarity']
        # A reload loses the in-memory context.  A sole active similarity
        # Watch is still an ownership-safe fallback; never guess among two
        # similarity Watches or stop a Product Watch implicitly.
        if len(similarity) == 1:
            return str(similarity[0].get('id')) if similarity[0].get('id') else None
        if len(active) == 1 and active[0].get('id'):
            return str(active[0]['id'])
    return None


def _clarification(command: dict[str, Any]) -> str:
    return str(command.get('clarificationQuestion') or '我还不能唯一确定你的意思，请补充要操作的商品或监控。')


async def _record_command_usage(plugin: Any, command: dict[str, Any], watch_id: str | None) -> None:
    usage = command.get('_usage')
    if not isinstance(usage, dict) or not watch_id:
        return
    try:
        await record_usage(plugin, {'watchId': watch_id, **usage})
    except Exception:
        # Usage accounting must never block the requested Watch operation.
        return


def _format_observability(result: dict[str, Any], *, stats: bool) -> str:
    watch = result.get('watch') if isinstance(result.get('watch'), dict) else {}
    runtime = result.get('runtime') if isinstance(result.get('runtime'), dict) else {}
    usage = result.get('usage') if isinstance(result.get('usage'), dict) else {}
    feeds = result.get('feeds') if isinstance(result.get('feeds'), list) else []
    status = str(result.get('status') or runtime.get('status') or 'UNKNOWN')
    label = watch.get('target', {}).get('productUrl') if isinstance(watch.get('target'), dict) else None
    label = label or watch.get('target', {}).get('searchQuery') if isinstance(watch.get('target'), dict) else None
    label = label or watch.get('id') or '当前监控'
    if not stats:
        lines = [
            '👀 监控状态', '', f'目标：{label}', f'状态：{status}',
            f"运行：{result.get('runningForSeconds', 0)} 秒",
            f"上次检查：{result.get('lastRunAt') or '尚未检查'}",
            f"下次检查：{result.get('nextRunAt') or '待调度'}",
        ]
        if feeds:
            feed_labels = []
            for item in feeds:
                if not isinstance(item, dict):
                    continue
                label = f"{item.get('query', item.get('id'))}={item.get('state')}"
                if item.get('lastError'):
                    label += f"（{item.get('lastError')}）"
                feed_labels.append(label)
            if feed_labels:
                lines.append('Feed：' + '、'.join(feed_labels))
        if runtime.get('lastError'):
            lines.append(f"最近错误：{runtime.get('lastError')}")
        return '\n'.join(lines)
    lines = [
        '📊 监控统计', '', f'目标：{label}', f'状态：{status}',
        f"检查：{runtime.get('feedRuns', 0)} 次，成功 {runtime.get('successfulRuns', 0)}，失败 {runtime.get('failedRuns', 0)}",
        f"新商品：{runtime.get('newListings', 0)}，候选：{runtime.get('candidatesProcessed', 0)}",
        f"图片比较：{runtime.get('imageComparisons', 0)}，达到阈值：{runtime.get('aboveThreshold', 0)}",
        f"最高相似度：{float(runtime['bestScore']) * 100:.1f}%" if isinstance(runtime.get('bestScore'), (int, float)) else '最高相似度：暂无',
        f"已发送通知：{runtime.get('notificationsSent', 0)}",
        f"Token：{usage.get('totalTokens', 0)}（调用 {usage.get('calls', 0)} 次）",
    ]
    if runtime.get('lastError'):
        lines.append(f"最近错误：{runtime.get('lastError')}")
    return '\n'.join(lines)


def _prevent(event_context: Any) -> None:
    event_context.prevent_default()
    event_context.prevent_postorder()


async def _restore_persisted_active_watch(plugin: Any, message: NormalizedBotMessage, context: dict[str, Any] | None) -> dict[str, Any] | None:
    if active_watch(context) is not None or (isinstance(context, dict) and context.get('pendingProposalToken')):
        return context
    try:
        watch_id = await get_watch_context(plugin, context_key(message))
        if not watch_id:
            return context
        watch = await get_watch(plugin, watch_id)
        if isinstance(watch, dict):
            set_active_watch(plugin, message, watch)
            return load_context(plugin, message)
    except Exception:
        return context
    return context


async def _remember_watch(plugin: Any, message: NormalizedBotMessage, watch_id: str, watch: Any = None) -> dict[str, Any] | None:
    value = watch
    if not isinstance(value, dict):
        try:
            value = await get_watch(plugin, watch_id)
        except Exception:
            return None
    if not isinstance(value, dict):
        return None
    set_active_watch(plugin, message, value)
    try:
        await bind_watch_context(plugin, context_key(message), watch_id)
    except Exception:
        pass
    return value


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
            if len(parts) != 3 or parts[1] not in {'confirm', 'cancel', 'delete'} or not parts[2]:
                reply(event_context, '无效或已过期的监控操作。')
                _prevent(event_context)
                return
            if parts[1] == 'delete':
                displayed = getattr(self.plugin, 'product_radar_watch_lists', {})
                displayed_ids = displayed.get(key, []) if isinstance(displayed, dict) else []
                if parts[2] not in displayed_ids:
                    reply(event_context, '这个取消按钮已过期，请先重新查看当前监控。')
                    _prevent(event_context)
                    return
            if platform_name(event) == 'telegram':
                acknowledge = getattr(event_context, 'answer_callback_query', None)
                if callable(acknowledge):
                    result = acknowledge(text='正在处理商品监控…')
                    if hasattr(result, '__await__'):
                        await result
            if parts[1] == 'delete':
                await self._handle_watch_operation(
                    event_context,
                    message,
                    context,
                    {
                        'domain': 'product_radar',
                        'intent': 'delete_watch',
                        'entities': {'watchId': parts[2]},
                        'constraints': {},
                    },
                    watch_context,
                )
            else:
                await self._confirm_or_cancel(event_context, parts[1], parts[2], pending, pending_context, watch_context, message, key)
            _prevent(event_context)
            return

        command = await resolve_product_radar_command(self.plugin, message=message, context=context)
        if command is None or command.get('domain') != 'product_radar':
            return
        if not active_watch(context) and not (isinstance(context, dict) and context.get('pendingProposalToken')):
            restored = await _restore_persisted_active_watch(self.plugin, message, context)
            if active_watch(restored) is not None:
                context = restored
                command = apply_active_watch_context(command, context)
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
        if command.get('selectionRequired'):
            try:
                listed = await list_watches(self.plugin)
                rows = _watch_rows(listed)
                _remember_watch_list(self.plugin, message, rows)
                reply(event_context, _format_delete_choices(rows), _delete_choice_buttons(rows))
            except Exception:
                reply(event_context, '暂时无法读取当前监控，请稍后再试。')
            _prevent(event_context)
            return
        if command.get('needsClarification'):
            reply(event_context, _clarification(command))
            _prevent(event_context)
            return

        intent = str(command.get('intent') or '')
        if intent == 'list_watches':
            try:
                listed = await list_watches(self.plugin)
                rows = _watch_rows(listed)
                _remember_watch_list(self.plugin, message, rows)
                reply(event_context, _format_watches(listed))
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
            usage = command.get('_usage')
            if isinstance(usage, dict):
                proposal['_productRadarUsage'] = usage
            preview_payload = {key: value for key, value in proposal.items() if key != '_productRadarUsage'}
            preview = await preview_watch(self.plugin, preview_payload)
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
            usage = proposal.pop('_productRadarUsage', None)
            result = await create_watch(self.plugin, proposal)
            watch = result.get('watch') if isinstance(result, dict) else {}
            watch_id = watch.get('id') if isinstance(watch, dict) else ''
            if watch_id:
                watch_context[str(watch_id)] = key
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                set_active_watch(self.plugin, message, watch)
                try:
                    await bind_watch_context(self.plugin, key, str(watch_id))
                except Exception:
                    pass
            pending.pop(token, None)
            pending_context.pop(token, None)
            set_pending(self.plugin, message, None)
            interval = proposal.get('intervalSeconds') or (900 if proposal.get('type') == 'similarity' else 120)
            reply(event_context, f"✅ 已开始监控\n\n类型：{proposal.get('type')}\n频率：{_interval_label(interval)}\nWatch ID：{watch_id}")
            if isinstance(usage, dict) and watch_id:
                await _record_command_usage(self.plugin, {'_usage': usage}, str(watch_id))
        except Exception as error:
            # Keep the proposal so the user can retry after a transient sensor/API failure.
            reply(event_context, f'创建监控失败：{error}')

    async def _handle_watch_overview(
        self,
        event_context: Any,
        message: NormalizedBotMessage,
        rows: list[dict[str, Any]],
        *,
        stats: bool,
    ) -> None:
        _remember_watch_list(self.plugin, message, rows)
        sections: list[str] = []
        for ordinal, row in enumerate(rows, start=1):
            watch_id = str(row.get('id') or '')
            try:
                observation = await get_watch_observability(
                    self.plugin,
                    watch_id,
                    'stats' if stats else 'status',
                )
                body = _format_observability(observation, stats=stats)
                body_lines = body.splitlines()
                if body_lines and body_lines[0] in {'👀 监控状态', '📊 监控统计'}:
                    body = '\n'.join(body_lines[2:])
                sections.append(f'{ordinal}号 · {_watch_target_value(row)}\n{body}')
            except Exception:
                sections.append(f'{ordinal}号 · {_watch_target_value(row)}\n状态：暂时无法读取')
        heading = '📊 当前监控统计' if stats else '👀 当前监控情况'
        reply(event_context, f'{heading}\n\n' + '\n\n'.join(sections))

    async def _handle_watch_operation(
        self,
        event_context: Any,
        message: NormalizedBotMessage,
        context: dict[str, Any] | None,
        command: dict[str, Any],
        watch_context: dict[str, str],
    ) -> None:
        intent = str(command.get('intent') or '')
        if command.get('selectionRequired'):
            try:
                listed = await list_watches(self.plugin)
                rows = _watch_rows(listed)
                _remember_watch_list(self.plugin, message, rows)
                reply(event_context, _format_delete_choices(rows), _delete_choice_buttons(rows))
            except Exception:
                reply(event_context, '暂时无法读取当前监控，请稍后再试。')
            return
        rows: list[dict[str, Any]] = []
        if not active_watch(context) or not explicit_watch_id(command):
            try:
                listed = await list_watches(self.plugin)
                rows = _watch_rows(listed)
            except Exception:
                rows = []
        displayed = getattr(self.plugin, 'product_radar_watch_lists', {})
        displayed_ids = displayed.get(context_key(message), []) if isinstance(displayed, dict) else []
        if not displayed_ids:
            displayed_ids = context_watch_list_ids(context)
        entities = command.get('entities') if isinstance(command.get('entities'), dict) else {}
        has_target_reference = bool(
            explicit_watch_id(command)
            or explicit_watch_ordinal(command)
            or entities.get('sellerUrl')
            or entities.get('productUrl')
            or active_watch(context)
        )
        owned_watch_ids = [
            watch_id for watch_id, owner in watch_context.items()
            if owner == context_key(message)
        ]
        if intent in {'get_watch_status', 'get_watch_stats'} and not has_target_reference and len(owned_watch_ids) != 1:
            if len(rows) > 1:
                await self._handle_watch_overview(
                    event_context,
                    message,
                    rows,
                    stats=intent == 'get_watch_stats',
                )
                return
            if len(rows) == 1 and rows[0].get('id'):
                watch_id = str(rows[0]['id'])
            else:
                reply(event_context, '目前没有可以查询状态的监控。')
                return
        else:
            watch_id = _watch_id_from_command(
                command,
                context,
                rows,
                watch_context,
                context_key(message),
                displayed_ids,
            )
        if watch_id is None:
            if intent == 'delete_watch':
                _remember_watch_list(self.plugin, message, rows)
                reply(event_context, _format_delete_choices(rows), _delete_choice_buttons(rows))
                return
            reply(event_context, _clarification(command))
            return
        try:
            if intent == 'get_watch':
                watch = await get_watch(self.plugin, watch_id)
                await _remember_watch(self.plugin, message, watch_id, watch)
                reply(event_context, self._format_watch_detail(watch))
                await _record_command_usage(self.plugin, command, watch_id)
                return
            if intent in {'get_watch_status', 'get_watch_stats'}:
                observation = await get_watch_observability(self.plugin, watch_id, 'stats' if intent == 'get_watch_stats' else 'status')
                await _remember_watch(self.plugin, message, watch_id, observation.get('watch') if isinstance(observation, dict) else None)
                reply(event_context, _format_observability(observation, stats=intent == 'get_watch_stats'))
                await _record_command_usage(self.plugin, command, watch_id)
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
                try:
                    await bind_watch_context(self.plugin, context_key(message), watch_id)
                except Exception:
                    pass
                reply(event_context, f'✅ 已更新监控\n\nWatch ID：{watch_id}')
                await _record_command_usage(self.plugin, command, watch_id)
                return
            if intent in {'pause_watch', 'resume_watch'}:
                enabled = intent == 'resume_watch'
                updated = await patch_watch(self.plugin, watch_id, {'enabled': enabled})
                set_active_watch(self.plugin, message, updated)
                watch_context[watch_id] = context_key(message)
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                try:
                    await bind_watch_context(self.plugin, context_key(message), watch_id)
                except Exception:
                    pass
                reply(event_context, f"{'▶️ 已恢复' if enabled else '⏸️ 已暂停'}监控\n\nWatch ID：{watch_id}")
                await _record_command_usage(self.plugin, command, watch_id)
                return
            if intent == 'delete_watch':
                await delete_watch(self.plugin, watch_id)
                watch_context.pop(watch_id, None)
                setattr(self.plugin, 'product_radar_watch_context', watch_context)
                clear_active_watch(self.plugin, message)
                try:
                    await clear_watch_context(self.plugin, context_key(message))
                except Exception:
                    pass
                confirmation = f'⏹️ 已删除监控\n\nWatch ID：{watch_id}'
                try:
                    listed = await list_watches(self.plugin)
                    rows = _watch_rows(listed)
                    _remember_watch_list(self.plugin, message, rows)
                    reply(event_context, f'{confirmation}\n\n{_format_watches(listed)}')
                except Exception:
                    reply(event_context, confirmation)
                await _record_command_usage(self.plugin, command, watch_id)
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
