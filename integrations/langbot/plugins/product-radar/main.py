from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class ProductRadarPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
        self.pending_product_radar: dict[str, dict] = {}
        self.pending_product_radar_context: dict[str, str] = {}
        self.product_radar_watch_context: dict[str, str] = {}
