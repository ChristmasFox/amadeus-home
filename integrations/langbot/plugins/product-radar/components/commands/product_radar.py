from __future__ import annotations

from collections.abc import AsyncGenerator

from components.radar_client import list_watches
from langbot_plugin.api.definition.components.command.command import Command
from langbot_plugin.api.entities.builtin.command.context import CommandReturn, ExecuteContext


class ProductRadarCommand(Command):
    async def initialize(self) -> None:
        await super().initialize()

        @self.subcommand(name='', help='查看当前 Product Radar 监控', usage='/watches')
        async def watches(_command: ProductRadarCommand, _context: ExecuteContext) -> AsyncGenerator[CommandReturn, None]:
            try:
                result = await list_watches(_command.plugin)
                rows = result.get('watches') if isinstance(result, dict) else []
                if not rows:
                    yield CommandReturn(text='目前没有正在监控的 Seller Watch 或 Product Watch。')
                    return
                lines = ['👀 当前监控']
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    lines.append(f"- {row.get('source', '?')} / {row.get('type', '?')} / {row.get('id', '?')} / {'启用' if row.get('enabled') else '暂停'}")
                yield CommandReturn(text='\n'.join(lines))
            except Exception:
                yield CommandReturn(text='暂时无法读取 Product Radar 监控，请稍后再试。')
