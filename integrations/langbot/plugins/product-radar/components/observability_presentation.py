from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def format_duration(value: Any) -> str:
    """Render a non-negative duration without exposing raw seconds to users."""
    try:
        seconds = max(0, int(value or 0))
    except (TypeError, ValueError):
        seconds = 0

    units = (("天", 86_400), ("小时", 3_600), ("分钟", 60), ("秒", 1))
    parts: list[str] = []
    for label, size in units:
        amount, seconds = divmod(seconds, size)
        if amount or (label == "秒" and not parts):
            parts.append(f"{amount}{label}")
    return " ".join(parts)


def format_relative_time(value: Any, *, now: datetime | None = None, empty: str) -> str:
    if not value:
        return empty
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return str(value)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    delta_seconds = int((moment - reference).total_seconds())
    suffix = "后" if delta_seconds > 0 else "前"
    return f"{format_duration(abs(delta_seconds))}{suffix}"


def _target_label(watch: dict[str, Any]) -> str:
    target = watch.get("target") if isinstance(watch.get("target"), dict) else {}
    return str(target.get("productUrl") or target.get("searchQuery") or watch.get("id") or "当前监控")


def _score_label(value: Any) -> str:
    return f"{float(value) * 100:.1f}%" if isinstance(value, (int, float)) else "暂无"


def format_observability(result: dict[str, Any], *, stats: bool, now: datetime | None = None) -> str:
    """Present one Watch's status and cumulative telemetry in one user-facing view."""
    watch = result.get("watch") if isinstance(result.get("watch"), dict) else {}
    runtime = result.get("runtime") if isinstance(result.get("runtime"), dict) else {}
    usage = result.get("usage") if isinstance(result.get("usage"), dict) else {}
    feeds = result.get("feeds") if isinstance(result.get("feeds"), list) else []
    status = str(result.get("status") or runtime.get("status") or "UNKNOWN")
    heading = "📊 监控统计" if stats else "👀 监控情况"

    lines = [
        heading,
        "",
        f"目标：{_target_label(watch)}",
        f"类型：{watch.get('type') or '未知'}",
        f"状态：{status}",
        f"运行时长：{format_duration(result.get('runningForSeconds'))}",
        f"上次检查：{format_relative_time(result.get('lastRunAt'), now=now, empty='尚未检查')}",
        f"下次检查：{format_relative_time(result.get('nextRunAt'), now=now, empty='待调度')}",
        "",
        "检查统计",
        f"• 检查：{runtime.get('feedRuns', 0)} 次（成功 {runtime.get('successfulRuns', 0)}，失败 {runtime.get('failedRuns', 0)}）",
        f"• 新商品：{runtime.get('newListings', 0)}，候选处理：{runtime.get('candidatesProcessed', 0)}",
        f"• 图片对比：{runtime.get('imageComparisons', 0)}，达到阈值：{runtime.get('aboveThreshold', 0)}",
        *([] if watch.get('type') != 'similarity' else [
            f"• FashionSigLIP：调用 {runtime.get('imageModelCalls', 0)} 次，处理图片 {runtime.get('imageModelImagesProcessed', 0)} 张，缓存命中 {runtime.get('imageModelCacheHits', 0)} 张",
        ]),
        f"• 最高相似度：{_score_label(runtime.get('bestScore'))}",
        f"• 已发送通知：{runtime.get('notificationsSent', 0)}",
        f"• Token：{usage.get('totalTokens', 0)}（调用 {usage.get('calls', 0)} 次）",
    ]
    if feeds:
        lines.extend(("", "数据源"))
        for item in feeds:
            if not isinstance(item, dict):
                continue
            feed_label = str(item.get("query") or item.get("id") or "未命名搜索")
            summary = (
                f"• {feed_label}：{item.get('state') or 'UNKNOWN'}"
                f"（检查 {item.get('runCount', 0)}，成功 {item.get('successCount', 0)}，失败 {item.get('failureCount', 0)}）"
            )
            if item.get("lastError"):
                summary += f"\n  原因：{item.get('lastError')}"
            lines.append(summary)
    if runtime.get("lastError"):
        lines.append(f"\n最近错误：{runtime.get('lastError')}")
    return "\n".join(lines)
