from __future__ import annotations

import json
from typing import Any

from components.pubg_client import UNAVAILABLE_MESSAGE
from components.pubg_gateway import run_pubg_query
from langbot_plugin.api.definition.components.tool.tool import Tool
from langbot_plugin.api.entities.builtin.provider import session as provider_session


class GetPubgDailyStatsTool(Tool):
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
        query_plan = {
            key: params.get(key)
            for key in (
                'operation',
                'metrics',
                'period_hint',
                'mode',
                'group_by',
                'ranking',
            )
            if params.get(key) not in (None, '', [])
        }
        nested_plan = params.get('queryPlan') or params.get('query_plan')
        if isinstance(nested_plan, dict):
            query_plan = {**nested_plan, **query_plan}

        try:
            result = await run_pubg_query(
                self.plugin,
                text=str(query),
                launcher_type=session.launcher_type,
                launcher_id=session.launcher_id,
                sender_id=session.sender_id,
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
