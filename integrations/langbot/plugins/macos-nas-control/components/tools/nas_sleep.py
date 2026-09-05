from __future__ import annotations

from langbot_plugin.api.definition.components.tool.tool import Tool
from components.tools.nas_status import run_remote


class NasSleepTool(Tool):
    async def call(self, params, session, query_id) -> str:
        return await run_remote("nas.sleep")
