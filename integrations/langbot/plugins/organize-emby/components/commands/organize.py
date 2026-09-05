from __future__ import annotations

import asyncio
import json
import os
import urllib.error
import urllib.request
from collections.abc import AsyncGenerator
from typing import Any

from langbot_plugin.api.definition.components.command.command import Command
from langbot_plugin.api.entities.builtin.command.context import CommandReturn, ExecuteContext


N8N_BASE_URL = os.environ.get("ORGANIZE_N8N_BASE_URL", "http://n8n:5678").rstrip("/")
N8N_TIMEOUT_SECONDS = 45
PENDING_PREVIEWS: dict[str, dict[str, Any]] = {}


def build_session_key(workspace_uuid: str | None, session: Any) -> str:
    launcher_type = getattr(session.launcher_type, "value", str(session.launcher_type))
    return ":".join(
        str(value or "")
        for value in (
            workspace_uuid or "",
            session.bot_uuid or "",
            launcher_type,
            session.launcher_id,
            session.sender_id,
        )
    )


def session_key(context: ExecuteContext) -> str:
    return build_session_key(context.workspace_uuid, context.session)


def session_key_from_session(session: Any) -> str:
    return build_session_key(getattr(session, "workspace_uuid", None), session)


def post_json(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{N8N_BASE_URL}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=N8N_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(body)
        except json.JSONDecodeError:
            detail = {}
        raise RuntimeError(detail.get("reason") or detail.get("message") or f"n8n HTTP {exc.code}") from exc
    except (OSError, TimeoutError) as exc:
        raise RuntimeError("n8n 整理服务暂时不可用") from exc
    try:
        result = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("n8n 返回了无法解析的结果") from exc
    if not isinstance(result, dict):
        raise RuntimeError("n8n 返回格式错误")
    return result


def scan_text(response: dict[str, Any]) -> str:
    return str(response.get("message") or "📁 没有找到可整理的文件夹。")


def preview_text(response: dict[str, Any]) -> str:
    text = str(response.get("preview_text") or "")
    if response.get("success") is False and response.get("reason"):
        if text:
            return f"{text}\n\n❌ {response['reason']}"
        return f"❌ 无法生成整理 Preview\n\n{response['reason']}"
    return text or "❌ Adapter 没有返回 Preview。"


def execute_text(response: dict[str, Any]) -> str:
    if response.get("success"):
        return str(response.get("message") or "✅ 整理完成")
    return f"❌ 整理未完成\n\n{response.get('reason') or '未知错误'}"


class OrganizeCommand(Command):
    def __init__(self):
        super().__init__()
        self._pending = PENDING_PREVIEWS

    async def initialize(self) -> None:
        await super().initialize()

        @self.subcommand(
            name="*",
            help="扫描、预览并整理一个明确选择的电视剧文件夹",
            usage="/organize [编号|文件夹名|确认|取消]",
        )
        async def organize(_command: OrganizeCommand, context: ExecuteContext) -> AsyncGenerator[CommandReturn, None]:
            try:
                async for result in self._handle(context):
                    yield result
            except Exception as exc:
                yield CommandReturn(text=f"❌ 整理服务暂时不可用\n\n{exc}")

    async def _handle(self, context: ExecuteContext) -> AsyncGenerator[CommandReturn, None]:
        key = session_key(context)
        arguments = [argument for argument in context.crt_params if argument.strip()]
        action = arguments[0].casefold() if arguments else "list"

        if action in {"list", "列表", "scan", "扫描"}:
            response = await asyncio.to_thread(post_json, "/webhook/organize-scan", {"session_key": key})
            yield CommandReturn(text=scan_text(response))
            return

        if action in {"confirm", "确认", "execute", "执行"}:
            pending = self._pending.get(key)
            if not pending:
                yield CommandReturn(text="ℹ️ 当前会话没有待执行的 Preview，请先发送 /organize 并选择文件夹。")
                return
            response = await asyncio.to_thread(
                post_json,
                "/webhook/organize-execute",
                {
                    "preview_id": pending["preview_id"],
                    "session_key": key,
                    "confirm": True,
                },
            )
            if response.get("success"):
                self._pending.pop(key, None)
            yield CommandReturn(text=execute_text(response))
            return

        if action in {"cancel", "取消", "abort"}:
            self._pending.pop(key, None)
            yield CommandReturn(text="已取消当前整理 Preview，未修改任何媒体文件。")
            return

        payload: dict[str, Any] = {"session_key": key}
        if len(arguments) == 1 and arguments[0].isdigit():
            payload["candidate_index"] = int(arguments[0])
        else:
            payload["source_name"] = " ".join(arguments)
        response = await asyncio.to_thread(post_json, "/webhook/organize-preview", payload)
        if response.get("success") and response.get("can_execute") and response.get("preview_id"):
            self._pending[key] = {
                "preview_id": response["preview_id"],
                "expires_at": response.get("expires_at"),
            }
        else:
            self._pending.pop(key, None)
        yield CommandReturn(text=preview_text(response))
