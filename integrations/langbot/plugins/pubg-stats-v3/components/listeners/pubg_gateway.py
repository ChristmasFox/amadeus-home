from __future__ import annotations

from typing import Any

from langbot_plugin.api.definition.components.common.event_listener import EventListener
from langbot_plugin.api.entities import context as event_context_module
from langbot_plugin.api.entities import events

from components.platform.kook import KookAdapter
from components.platform.registry import normalize_event_message
from components.platform.telegram import TelegramAdapter
from components.platform.whatsapp import WhatsAppAdapter
from components.pubg_v3_client import classify_pubg_message, run_pubg_callback, run_pubg_query


class PubgQueryGatewayV3Listener(EventListener):
    async def initialize(self) -> None:
        await super().initialize()

        @self.handler(events.PersonNormalMessageReceived)
        async def handle_person(event_context: event_context_module.EventContext) -> None:
            await self._handle(event_context)

        @self.handler(events.GroupNormalMessageReceived)
        async def handle_group(event_context: event_context_module.EventContext) -> None:
            await self._handle(event_context)

        for event_name in ('CallbackQueryReceived', 'TelegramCallbackQueryReceived'):
            callback_event = getattr(events, event_name, None)
            if callback_event is not None:
                @self.handler(callback_event)
                async def handle_callback(event_context: event_context_module.EventContext) -> None:
                    await self._handle(event_context)

    async def _handle(self, event_context: event_context_module.EventContext) -> None:
        event = event_context.event
        message = normalize_event_message(event, query_id=event_context.query_id)
        if message.get('platform') == 'telegram':
            adapter = TelegramAdapter()
        elif message.get('platform') == 'whatsapp':
            adapter = WhatsAppAdapter()
        else:
            adapter = KookAdapter()
        if message.get('callback', {}).get('data'):
            if isinstance(adapter, TelegramAdapter):
                await adapter.acknowledge_callback(event_context, '正在读取这场比赛的战斗记录…')
            # The host callback handler ACKs before enqueueing this query. Keep
            # the resume inside the event so reply_message_chain is serialized
            # back to LangBot after the deterministic review completes.
            await self._resume_callback(event_context, adapter, message)
            event_context.prevent_default()
            event_context.prevent_postorder()
            return
        route = await classify_pubg_message(
            self.plugin,
            message=message,
        )
        if route.get('route') != 'mandatory':
            return
        result = await run_pubg_query(
            self.plugin,
            message=message,
            query_id=event_context.query_id,
        )
        adapter.reply_response(event_context, result)
        event_context.prevent_default()
        event_context.prevent_postorder()

    async def _resume_callback(self, event_context: event_context_module.EventContext, adapter: Any, message: Any) -> None:
        result = await run_pubg_callback(self.plugin, message=message, query_id=event_context.query_id)
        adapter.reply_response(event_context, result)
