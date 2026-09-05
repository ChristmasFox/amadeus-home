from __future__ import annotations

import asyncio
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[2]
PLUGIN_ROOT = ROOT / "pubg-langbot-plugin"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(PLUGIN_ROOT))

from components import pubg_gateway
from pubg_query_engine_v2.context import context_key, context_storage_value, empty_context


class MemoryPlugin:
    def __init__(self) -> None:
        self.storage: dict[str, bytes] = {}

    async def get_workspace_storage(self, key: str) -> bytes:
        return self.storage.get(key, b"")

    async def set_workspace_storage(self, key: str, value: bytes) -> None:
        self.storage[key] = value

    async def get_llm_models(self) -> list[str]:
        return []

    def get_config(self) -> dict:
        return {}


class GatewayContractTests(unittest.TestCase):
    def test_cache_miss_path_must_call_data_layer(self):
        plugin = MemoryPlugin()
        calls: list[dict] = []

        def fake_fetch(query: dict) -> dict:
            calls.append(query)
            return {
                "records": [],
                "coverage": {"status": "COVERAGE_GAP", "complete": False},
                "source": {"store": "fixture", "syncTriggered": True, "syncStatus": "OK"},
            }

        with patch.object(pubg_gateway, "fetch_pubg_data", side_effect=fake_fetch):
            result = asyncio.run(
                pubg_gateway.run_pubg_query(
                    plugin,
                    text="昨天战绩怎么样？",
                    launcher_type="group",
                    launcher_id="g",
                    sender_id="a",
                    query_id="cache-miss",
                )
            )

        self.assertEqual(len(calls), 1)
        self.assertEqual(result["status"], "COVERAGE_GAP")
        self.assertEqual(result["source"]["syncTriggered"], True)

    def test_unsupported_capability_skips_data_layer(self):
        plugin = MemoryPlugin()
        with patch.object(pubg_gateway, "fetch_pubg_data") as fetch:
            result = asyncio.run(
                pubg_gateway.run_pubg_query(
                    plugin,
                    text="昨天用什么枪？",
                    launcher_type="group",
                    launcher_id="g",
                    sender_id="a",
                    query_id="unsupported",
                )
            )

        fetch.assert_not_called()
        self.assertEqual(result["status"], "UNSUPPORTED_CAPABILITY")
        self.assertTrue(result["source"]["syncTriggered"] is False)

    def test_sender_isolation_is_preserved_at_gateway_boundary(self):
        self.assertNotEqual(
            pubg_gateway.build_pubg_session_id(launcher_type="group", launcher_id="g", sender_id="a"),
            pubg_gateway.build_pubg_session_id(launcher_type="group", launcher_id="g", sender_id="b"),
        )

    def test_missing_result_set_skips_data_layer(self):
        plugin = MemoryPlugin()
        session_id = pubg_gateway.build_pubg_session_id(launcher_type="group", launcher_id="g", sender_id="a")
        context = empty_context(session_id)
        context.update(
            {
                "activeDomain": "pubg",
                "lastResultSetId": "rs_missing",
                "expiresAt": (datetime.now(ZoneInfo("Asia/Shanghai")) + timedelta(hours=1)).isoformat(),
            }
        )
        plugin.storage[context_key(session_id)] = context_storage_value(context)

        with patch.object(pubg_gateway, "fetch_pubg_data") as fetch:
            result = asyncio.run(
                pubg_gateway.run_pubg_query(
                    plugin,
                    text="哪一把伤害最高？",
                    launcher_type="group",
                    launcher_id="g",
                    sender_id="a",
                    query_id="missing-result-set",
                )
            )

        fetch.assert_not_called()
        self.assertEqual(result["status"], "INVALID_QUERY")
        self.assertEqual(result["data"]["code"], "RESULT_SET_NOT_FOUND")

    def test_expired_context_is_not_used_for_follow_up(self):
        plugin = MemoryPlugin()
        session_id = pubg_gateway.build_pubg_session_id(launcher_type="group", launcher_id="g", sender_id="a")
        context = empty_context(session_id)
        context.update(
            {
                "activeDomain": "pubg",
                "lastResultSetId": "rs_expired",
                "expiresAt": (datetime.now(ZoneInfo("Asia/Shanghai")) - timedelta(minutes=1)).isoformat(),
            }
        )
        plugin.storage[context_key(session_id)] = context_storage_value(context)

        loaded = asyncio.run(pubg_gateway.load_structured_context(plugin, session_id))

        self.assertIsNone(loaded["lastResultSetId"])
        self.assertIsNone(loaded["activeDomain"])


if __name__ == "__main__":
    unittest.main()
