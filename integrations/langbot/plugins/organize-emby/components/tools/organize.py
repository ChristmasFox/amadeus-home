from __future__ import annotations

import asyncio
from typing import Any

from components.commands.organize import (
    PENDING_PREVIEWS,
    authorize_session,
    chat_id,
    denial_text,
    execute_text,
    platform_for_session,
    platform_user_id,
    post_json,
    preview_text,
    scan_text,
    session_key_from_session,
)
from langbot_plugin.api.definition.components.tool.tool import Tool
from langbot_plugin.api.entities.builtin.provider import session as provider_session


class OrganizeMediaTool(Tool):
    async def call(
        self,
        params: dict[str, Any],
        session: provider_session.Session,
        query_id: int,
    ) -> str:
        del query_id
        key = session_key_from_session(session)
        action = str(params.get("action") or "").strip().lower()

        if action in {"scan", "list"}:
            try:
                response = await asyncio.to_thread(
                    post_json,
                    "/webhook/organize-scan",
                    {"session_key": key},
                )
            except Exception as exc:
                return f"❌ 整理服务暂时不可用\n\n{exc}"
            return scan_text(response)

        if action in {"preview", "analyze"}:
            source_name = str(params.get("source_name") or "").strip()
            candidate_index = params.get("candidate_index")
            if not source_name and candidate_index is None:
                return "请提供要预览的文件夹名称或候选编号。"

            try:
                decision = await asyncio.to_thread(
                    authorize_session,
                    session,
                    action="organize_media",
                    confirmed=False,
                    target=source_name or None,
                )
            except Exception as exc:
                return f"❌ {exc}"
            if decision.get("authorized") is not True and decision.get("requiresConfirmation") is not True:
                return f"❌ {denial_text(decision)}"

            payload: dict[str, Any] = {"session_key": key}
            if candidate_index is not None and str(candidate_index).strip() != "":
                try:
                    payload["candidate_index"] = int(candidate_index)
                except (TypeError, ValueError):
                    return "❌ 候选编号必须是整数。"
            else:
                payload["source_name"] = source_name

            try:
                response = await asyncio.to_thread(
                    post_json,
                    "/webhook/organize-preview",
                    payload,
                )
            except Exception as exc:
                return f"❌ 整理服务暂时不可用\n\n{exc}"

            if response.get("success") and response.get("can_execute") and response.get("preview_id"):
                PENDING_PREVIEWS[key] = {
                    "preview_id": response["preview_id"],
                    "action_id": str(response["preview_id"]),
                    "platform": platform_for_session(session),
                    "chat_id": chat_id(session),
                    "platform_user_id": platform_user_id(session),
                    "expires_at": response.get("expires_at"),
                }
            else:
                PENDING_PREVIEWS.pop(key, None)
            return preview_text(response)

        if action in {"execute", "confirm"}:
            if params.get("confirm") is not True:
                return "⚠️ 整理执行需要用户明确确认；请先查看 Preview，再明确回复“确认执行”。"

            pending = PENDING_PREVIEWS.get(key)
            if not pending:
                return "ℹ️ 当前会话没有待执行的 Preview，请先请求整理预览。"
            try:
                decision = await asyncio.to_thread(
                    authorize_session,
                    session,
                    action="organize_media",
                    confirmed=True,
                )
            except Exception as exc:
                return f"❌ {exc}"
            if decision.get("authorized") is not True:
                return f"❌ {denial_text(decision)}"
            if pending.get("platform") != platform_for_session(session) \
                    or pending.get("chat_id") != chat_id(session) \
                    or pending.get("platform_user_id") != platform_user_id(session):
                return "❌ 此 Preview 绑定到其他用户或会话，当前用户无权确认。"

            try:
                response = await asyncio.to_thread(
                    post_json,
                    "/webhook/organize-execute",
                    {
                        "preview_id": pending["preview_id"],
                        "session_key": key,
                        "confirm": True,
                    },
                )
            except Exception as exc:
                return f"❌ 整理服务暂时不可用\n\n{exc}"

            if response.get("success"):
                PENDING_PREVIEWS.pop(key, None)
            return execute_text(response)

        if action in {"cancel", "abort"}:
            PENDING_PREVIEWS.pop(key, None)
            return "已取消当前整理 Preview，未修改任何媒体文件。"

        return "❌ action 必须是 scan、preview、execute 或 cancel。"
