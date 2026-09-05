from __future__ import annotations

from typing import Any

from components.platform.registry import normalize_session_message
from components.pubg_v3_client import UNAVAILABLE_MESSAGE, run_pubg_query
from langbot_plugin.api.definition.components.tool.tool import Tool
from langbot_plugin.api.entities.builtin.provider import session as provider_session


class GetPubgStatsV3Tool(Tool):
    last_result: dict[str, Any] | None = None

    def get_last_result(self) -> dict[str, Any] | None:
        return self.last_result

    async def call(
        self,
        params: dict[str, Any],
        session: provider_session.Session,
        query_id: int,
    ) -> str:
        query = params.get('query') or params.get('question') or '今日战绩'
        try:
            message = normalize_session_message(session, text=str(query), query_id=query_id)
            result = await run_pubg_query(
                self.plugin,
                message=message,
                query_id=query_id,
                provided_plan=params.get('queryPlan') or params.get('query_plan'),
            )
            self.last_result = result
            return str(result.get('response') or UNAVAILABLE_MESSAGE)
        except Exception:
            self.last_result = {
                'status': 'SOURCE_UNAVAILABLE',
                'response': UNAVAILABLE_MESSAGE,
                'queryId': str(query_id),
            }
            return UNAVAILABLE_MESSAGE
