from __future__ import annotations

from langbot_plugin.api.definition.plugin import BasePlugin


class ProductRadarPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
        # Pending proposals and conversational references are indexed by the
        # normalized Product Radar context key.  The key includes platform,
        # chat, sender, and domain; these maps must never be treated as global
        # conversation state.
        self.product_radar_contexts: dict[str, dict] = {}
        self.pending_product_radar: dict[str, dict] = {}
        self.pending_product_radar_context: dict[str, str] = {}
        self.product_radar_watch_context: dict[str, str] = {}
