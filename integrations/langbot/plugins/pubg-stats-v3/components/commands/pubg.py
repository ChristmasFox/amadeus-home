from __future__ import annotations

from collections.abc import AsyncGenerator

from components.platform.registry import normalize_session_message
from components.pubg_v3_client import UNAVAILABLE_MESSAGE, run_pubg_query
from langbot_plugin.api.definition.components.command.command import Command
from langbot_plugin.api.entities.builtin.command.context import CommandReturn, ExecuteContext


class PubgCommandV3(Command):
    async def initialize(self) -> None:
        await super().initialize()

        @self.subcommand(
            name='',
            help='查询 PUBG 今日战绩（06:00 周期）',
            usage='/pubg',
        )
        async def pubg(
            _command: PubgCommandV3,
            context: ExecuteContext,
        ) -> AsyncGenerator[CommandReturn, None]:
            try:
                message = normalize_session_message(context.session, text='查询今日战绩', query_id=context.query_id)
                result = await run_pubg_query(
                    _command.plugin,
                    message=message,
                    query_id=context.query_id,
                )
            except Exception:
                yield CommandReturn(text=UNAVAILABLE_MESSAGE)
                return
            yield CommandReturn(text=str(result.get('response') or UNAVAILABLE_MESSAGE))
