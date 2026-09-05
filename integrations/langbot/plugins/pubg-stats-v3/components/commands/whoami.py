from __future__ import annotations

from collections.abc import AsyncGenerator

from components.platform.registry import normalize_session_message
from components.pubg_v3_client import WHOAMI_UNAVAILABLE_MESSAGE, run_whoami
from langbot_plugin.api.definition.components.command.command import Command
from langbot_plugin.api.entities.builtin.command.context import CommandReturn, ExecuteContext


class WhoAmICommand(Command):
    async def initialize(self) -> None:
        await super().initialize()

        @self.subcommand(
            name='',
            help='查看当前平台身份（只读）',
            usage='/whoami',
        )
        async def whoami(
            _command: WhoAmICommand,
            context: ExecuteContext,
        ) -> AsyncGenerator[CommandReturn, None]:
            try:
                message = normalize_session_message(context.session, text='/whoami', query_id=context.query_id)
                result = await run_whoami(
                    _command.plugin,
                    message=message,
                    query_id=context.query_id,
                )
            except Exception:
                yield CommandReturn(text=WHOAMI_UNAVAILABLE_MESSAGE)
                return
            yield CommandReturn(text=str(result.get('response') or WHOAMI_UNAVAILABLE_MESSAGE))
