from __future__ import annotations

from langbot_plugin.api.definition.components.common.event_listener import EventListener
from langbot_plugin.api.entities import context as event_context_module
from langbot_plugin.api.entities import events
from langbot_plugin.api.entities.builtin.platform import message as platform_message

from components.pubg_gateway import is_pubg_message, load_structured_context, run_pubg_query


class PubgQueryGatewayListener(EventListener):
    async def initialize(self) -> None:
        await super().initialize()

        @self.handler(events.PersonNormalMessageReceived)
        async def handle_person(event_context: event_context_module.EventContext) -> None:
            await self._handle(event_context)

        @self.handler(events.GroupNormalMessageReceived)
        async def handle_group(event_context: event_context_module.EventContext) -> None:
            await self._handle(event_context)

    async def _handle(self, event_context: event_context_module.EventContext) -> None:
        event = event_context.event
        text = str(getattr(event, "text_message", "") or "").strip()
        session_id = __import__("components.pubg_gateway", fromlist=["build_pubg_session_id"]).build_pubg_session_id(
            launcher_type=event.launcher_type,
            launcher_id=event.launcher_id,
            sender_id=event.sender_id,
        )
        structured_context = await load_structured_context(self.plugin, session_id)
        if not is_pubg_message(text, structured_context):
            return
        result = await run_pubg_query(
            self.plugin,
            text=text,
            launcher_type=event.launcher_type,
            launcher_id=event.launcher_id,
            sender_id=event.sender_id,
            query_id=event_context.query_id,
        )
        event.reply_message_chain = platform_message.MessageChain(
            [platform_message.Plain(text=str(result.get("response") or "暂时无法生成 PUBG 查询结果。"))]
        )
        event_context.prevent_default()
        event_context.prevent_postorder()
