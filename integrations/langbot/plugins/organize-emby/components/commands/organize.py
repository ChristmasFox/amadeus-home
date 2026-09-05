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
HOMEHUB_AUTH_URL = os.environ.get("HOMEHUB_AUTH_URL", "http://pubg-query-engine-v3:5310").rstrip("/")
N8N_TIMEOUT_SECONDS = 45
AUTH_TIMEOUT_SECONDS = 10
PENDING_PREVIEWS: dict[str, dict[str, Any]] = {}


def _session_value(session: Any, key: str, default: Any = None) -> Any:
    if isinstance(session, dict):
        return session.get(key, default)
    return getattr(session, key, default)


def platform_for_session(session: Any) -> str:
    value = _session_value(session, "platform", _session_value(session, "platform_name", "kook"))
    normalized = str(getattr(value, "value", value) or "").strip().casefold()
    aliases = {
        "kook": "kook", "kook-bot": "kook", "ko": "kook",
        "telegram": "telegram", "telegram-bot": "telegram", "tg": "telegram",
    }
    platform = aliases.get(normalized)
    if platform is None:
        raise RuntimeError("无法确认当前平台身份，拒绝执行媒体整理")
    return platform


def platform_user_id(session: Any) -> str:
    value = _session_value(session, "platform_user_id", _session_value(session, "sender_id", ""))
    user_id = str(value or "").strip()
    if not user_id or user_id.casefold() in {"unknown", "undefined", "null"}:
        raise RuntimeError("平台事件缺少真实 user ID，拒绝执行媒体整理")
    return user_id


def chat_id(session: Any) -> str:
    value = _session_value(session, "chat_id", _session_value(session, "launcher_id", ""))
    result = str(value or "").strip()
    if not result or result.casefold() in {"unknown", "undefined", "null"}:
        raise RuntimeError("平台事件缺少真实 chat ID，拒绝执行媒体整理")
    return result


def chat_type(session: Any) -> str:
    value = _session_value(session, "chat_type", _session_value(session, "launcher_type", "group"))
    normalized = str(getattr(value, "value", value) or "").strip().casefold()
    return "private" if normalized in {"private", "person", "direct", "dm", "user"} else "group"


def authorization_payload(
    session: Any,
    *,
    action: str,
    confirmed: bool,
    target: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "platform": platform_for_session(session),
        "senderId": platform_user_id(session),
        "launcherId": chat_id(session),
        "launcherType": chat_type(session),
        "serviceId": "emby",
        "action": action,
        "confirmed": confirmed,
    }
    if target:
        payload["target"] = target
    return payload


def authorize_session(
    session: Any,
    *,
    action: str,
    confirmed: bool,
    target: str | None = None,
) -> dict[str, Any]:
    """Ask the shared HomeHub AuthorizationCore and fail closed on transport errors."""
    payload = json.dumps(
        authorization_payload(session, action=action, confirmed=confirmed, target=target),
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{HOMEHUB_AUTH_URL}/homehub/authorize",
        data=payload,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=AUTH_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HomeHub Authorization HTTP {exc.code}: {detail[:300]}") from exc
    except (OSError, TimeoutError) as exc:
        raise RuntimeError("HomeHub Authorization service unavailable，已拒绝媒体整理") from exc
    try:
        result = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("HomeHub Authorization 返回格式错误，已拒绝媒体整理") from exc
    if not isinstance(result, dict):
        raise RuntimeError("HomeHub Authorization 返回格式错误，已拒绝媒体整理")
    return result


def denial_text(decision: dict[str, Any]) -> str:
    return str(decision.get("reason") or "当前身份未获授权，已拒绝媒体整理")


def build_session_key(workspace_uuid: str | None, session: Any) -> str:
    launcher_type = getattr(session.launcher_type, "value", str(session.launcher_type))
    return ":".join(
        str(value or "")
        for value in (
            workspace_uuid or "",
            session.bot_uuid or "",
            platform_for_session(session),
            launcher_type,
            session.launcher_id,
            platform_user_id(session),
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
            try:
                decision = await asyncio.to_thread(
                    authorize_session,
                    context.session,
                    action="organize_media",
                    confirmed=True,
                )
            except Exception as exc:
                yield CommandReturn(text=f"❌ {exc}")
                return
            if decision.get("authorized") is not True:
                yield CommandReturn(text=f"❌ {denial_text(decision)}")
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

        target = " ".join(arguments) if arguments else None
        try:
            decision = await asyncio.to_thread(
                authorize_session,
                context.session,
                action="organize_media",
                confirmed=False,
                target=target,
            )
        except Exception as exc:
            yield CommandReturn(text=f"❌ {exc}")
            return
        if decision.get("authorized") is not True and decision.get("requiresConfirmation") is not True:
            yield CommandReturn(text=f"❌ {denial_text(decision)}")
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
                "action_id": str(response["preview_id"]),
                "platform": platform_for_session(context.session),
                "chat_id": chat_id(context.session),
                "platform_user_id": platform_user_id(context.session),
                "expires_at": response.get("expires_at"),
            }
        else:
            self._pending.pop(key, None)
        yield CommandReturn(text=preview_text(response))
