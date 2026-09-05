from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from langbot_plugin.api.definition.components.tool.tool import Tool
from langbot_plugin.api.entities.builtin.provider import session as provider_session


class KookApiError(RuntimeError):
    pass


class KookGroupMembersTool(Tool):
    api_base = "https://www.kookapp.cn/api/v3"
    token_file = "/run/langbot-secrets/kook-bot-token"

    def _read_token(self) -> str:
        token_path = os.environ.get("KOOK_BOT_TOKEN_FILE", self.token_file)
        try:
            token = open(token_path, encoding="utf-8").read().strip()
        except OSError as exc:
            raise KookApiError("KOOK 机器人密钥文件不可用") from exc
        if not token:
            raise KookApiError("KOOK 机器人密钥为空")
        return token

    async def _get(self, endpoint: str, params: dict[str, str]) -> dict[str, Any]:
        token = self._read_token()
        query = urllib.parse.urlencode(params)
        url = f"{self.api_base}/{endpoint}?{query}"

        def request() -> dict[str, Any]:
            http_request = urllib.request.Request(
                url,
                headers={"Authorization": f"Bot {token}", "Accept": "application/json"},
            )
            try:
                with urllib.request.urlopen(http_request, timeout=12) as response:
                    payload = response.read(8 * 1024 * 1024)
            except urllib.error.HTTPError as exc:
                raise KookApiError(f"KOOK API 返回 HTTP {exc.code}") from exc
            except urllib.error.URLError as exc:
                raise KookApiError("KOOK API 连接失败") from exc

            try:
                result = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise KookApiError("KOOK API 返回了无效数据") from exc
            if not isinstance(result, dict) or result.get("code") != 0:
                message = result.get("message", "未知错误") if isinstance(result, dict) else "未知错误"
                raise KookApiError(f"KOOK API 请求失败：{message}")
            data = result.get("data")
            if not isinstance(data, dict):
                raise KookApiError("KOOK API 返回数据格式异常")
            return data

        return await asyncio.to_thread(request)

    async def call(
        self,
        params: dict[str, Any],
        session: provider_session.Session,
        query_id: int,
    ) -> str:
        launcher_type = getattr(session.launcher_type, "value", session.launcher_type)
        if launcher_type != "group":
            return "这个工具只能在 KOOK 服务器频道中使用。"

        channel_id = str(session.launcher_id).strip()
        if not channel_id:
            return "无法确定当前 KOOK 频道。"

        try:
            channel = await self._get("channel/view", {"channel_id": channel_id})
            guild_id = str(channel.get("guild_id", "")).strip()
            if not guild_id:
                return "无法从当前 KOOK 频道确定服务器。"

            guild = await self._get("guild/view", {"guild_id": guild_id})
            members_data = await self._get(
                "guild/user-list",
                {"guild_id": guild_id, "limit": "50", "offset": "0"},
            )
        except KookApiError as exc:
            return str(exc)

        members = members_data.get("items", [])
        if not isinstance(members, list):
            return "KOOK API 返回的成员列表格式异常。"

        try:
            max_members = int(params.get("max_members", 200))
        except (TypeError, ValueError):
            max_members = 200
        max_members = max(1, min(max_members, 500))

        total = members_data.get("user_count", members_data.get("meta", {}).get("total", len(members)))
        online_count = members_data.get("online_count")
        lines = [
            f"服务器：{guild.get('name', guild_id)}",
            f"当前频道：{channel.get('name', channel_id)}",
            f"成员总数：{total}" + (f"，在线：{online_count}" if online_count is not None else ""),
        ]

        for index, member in enumerate(members[:max_members], 1):
            if not isinstance(member, dict):
                continue
            member_id = str(member.get("id", "未知"))
            display_name = member.get("nickname") or member.get("username") or member_id
            status = "在线" if member.get("online") else "离线"
            bot_label = "，机器人" if member.get("bot") else ""
            identify_num = member.get("identify_num")
            handle = f"{display_name}#{identify_num}" if identify_num else str(display_name)
            lines.append(f"{index}. {handle}（ID：{member_id}，{status}{bot_label}）")

        if len(members) > max_members:
            lines.append(f"已限制显示前 {max_members} 名成员；可用 max_members 调高至最多 500。")
        return "\n".join(lines)
