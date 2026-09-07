from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class ProductRadarPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
        self.pending_product_radar: dict[str, dict] = {}
