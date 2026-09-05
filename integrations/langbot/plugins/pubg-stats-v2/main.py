from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class PubgStatsPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
