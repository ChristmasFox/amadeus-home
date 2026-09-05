from __future__ import annotations

import os

import asyncssh
from langbot_plugin.api.definition.components.tool.tool import Tool


async def run_remote(command: str) -> str:
    async with asyncssh.connect(
        os.environ.get("MAC_CONTROL_HOST", "host.docker.internal"),
        username=os.environ.get("MAC_CONTROL_USER", "blacksidev"),
        client_keys=[os.environ.get("MAC_CONTROL_KEY", "/run/langbot-ssh/id_ed25519")],
        known_hosts=None,
        login_timeout=8,
    ) as connection:
        result = await connection.run(command, check=False, timeout=15)
        if result.exit_status != 0:
            raise RuntimeError(result.stderr.strip() or "remote command failed")
        return result.stdout.strip()


class NasStatusTool(Tool):
    async def call(self, params, session, query_id) -> str:
        return await run_remote("nas.status")
