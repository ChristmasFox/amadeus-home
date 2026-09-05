from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class PubgStatsV3Plugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
