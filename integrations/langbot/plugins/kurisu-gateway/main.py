from langbot_plugin.api.definition.plugin import BasePlugin


class KurisuGatewayPlugin(BasePlugin):
    async def initialize(self) -> None:
        await super().initialize()
