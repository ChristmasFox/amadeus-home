from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class OrganizeEmbyPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
