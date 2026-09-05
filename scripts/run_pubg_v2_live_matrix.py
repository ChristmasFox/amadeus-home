#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ROOT = ROOT / "integrations" / "langbot" / "plugins" / "pubg-stats-v2"
DOMAIN_ROOT = ROOT / "packages" / "pubg-domain" / "legacy-v2"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(PLUGIN_ROOT))
sys.path.insert(0, str(DOMAIN_ROOT))

from components import pubg_client
from components.pubg_gateway import run_pubg_query


class MemoryPlugin:
    def __init__(self) -> None:
        self.storage: dict[str, bytes] = {}

    async def get_workspace_storage(self, key: str) -> bytes:
        return self.storage.get(key, b"")

    async def set_workspace_storage(self, key: str, value: bytes) -> None:
        self.storage[key] = value

    async def get_llm_models(self) -> list[str]:
        return []

    def get_config(self) -> dict[str, Any]:
        return {}


CASES = [
    ("A", "查询今日战绩", "matrix-a"),
    ("B", "昨天战绩怎么样？", "matrix-a"),
    ("C", "前天呢？", "matrix-a"),
    ("D", "上周六战绩怎么样？", "matrix-a"),
    ("E", "8月20号战绩", "matrix-a"),
    ("F", "8月20号晚上10点以后怎么样？", "matrix-a"),
    ("G", "昨天哪一把伤害最高？", "matrix-a"),
    ("H", "最近20场哪一把杀人最多？", "matrix-a"),
    ("I", "最近20场表现最好的是谁？", "matrix-a"),
    ("J", "昨天 vs 前天怎么样？", "matrix-a"),
    ("K1", "昨天战绩怎么样？", "matrix-k"),
    ("K2", "哪一把伤害最高？", "matrix-k"),
    ("L1", "昨天怎么样？", "matrix-l"),
    ("L2", "跟前天比呢？", "matrix-l"),
    ("M", "最近7天状态是不是变好了？", "matrix-a"),
    ("S", "昨天用什么枪？", "matrix-a"),
]


async def run(url: str) -> int:
    pubg_client.N8N_WEBHOOK_URL = url
    plugin = MemoryPlugin()
    for label, text, sender_id in CASES:
        result = await run_pubg_query(
            plugin,
            text=text,
            launcher_type="group",
            launcher_id="pubg-v2-live-matrix",
            sender_id=sender_id,
            query_id=f"live-matrix-{label}",
        )
        query = result.get("query") or {}
        print(
            json.dumps(
                {
                    "case": label,
                    "text": text,
                    "status": result.get("status"),
                    "operation": query.get("operation"),
                    "selector": query.get("selector"),
                    "segmentCount": len(query.get("segments") or []),
                    "groupBy": query.get("groupBy"),
                    "metric": (query.get("orderBy") or {}).get("metric"),
                    "resultSetId": result.get("resultSetId"),
                    "evidenceMatchCount": len((result.get("evidence") or {}).get("matchIds") or []),
                    "source": result.get("source"),
                    "responseHead": str(result.get("response") or "").splitlines()[:2],
                },
                ensure_ascii=False,
            )
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PUBG Query Engine v2 live matrix against n8n.")
    parser.add_argument(
        "--url",
        default="http://127.0.0.1:5679/webhook/pubg-query-gateway-v2",
        help="Query Gateway webhook URL",
    )
    args = parser.parse_args()
    return asyncio.run(run(args.url))


if __name__ == "__main__":
    raise SystemExit(main())
