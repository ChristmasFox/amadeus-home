from __future__ import annotations

from collections.abc import AsyncGenerator

from components.pubg_client import UNAVAILABLE_MESSAGE
from components.pubg_gateway import run_pubg_query
from langbot_plugin.api.definition.components.command.command import Command
from langbot_plugin.api.entities.builtin.command.context import CommandReturn, ExecuteContext


class PubgCommand(Command):
    async def initialize(self) -> None:
        await super().initialize()

        @self.subcommand(
            name='',
            help='查询 PUBG 今日战绩（06:00 周期）',
            usage='/pubg',
        )
        async def pubg(
            _command: PubgCommand,
            context: ExecuteContext,
        ) -> AsyncGenerator[CommandReturn, None]:
            try:
                result = await run_pubg_query(
                    _command.plugin,
                    text='查询今日战绩',
                    launcher_type=context.session.launcher_type,
                    launcher_id=context.session.launcher_id,
                    sender_id=context.session.sender_id,
                    query_id=context.query_id,
                )
            except Exception:
                yield CommandReturn(text=UNAVAILABLE_MESSAGE)
                return

            yield CommandReturn(text=str(result.get('response') or UNAVAILABLE_MESSAGE))
