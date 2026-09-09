from __future__ import annotations

"""Pure presentation helpers for the numbered Product Radar watch list."""

from typing import Any


def _interval_label(value: Any, default: int = 900) -> str:
    try:
        seconds = int(value or default)
    except (TypeError, ValueError):
        seconds = default
    return f'每 {seconds // 60} 分钟' if seconds % 60 == 0 else f'每 {seconds} 秒'


def watch_rows(result: dict[str, Any]) -> list[dict[str, Any]]:
    raw_rows = result.get('watches') if isinstance(result.get('watches'), list) else []
    return [row for row in raw_rows if isinstance(row, dict) and str(row.get('id') or '').strip()]


def watch_target_value(row: dict[str, Any]) -> str:
    target = row.get('target') if isinstance(row.get('target'), dict) else {}
    plan = row.get('searchPlan') if isinstance(row.get('searchPlan'), dict) else {}
    queries = plan.get('queries') if isinstance(plan.get('queries'), list) else []
    plan_value = '、'.join(str(item.get('query')) for item in queries if isinstance(item, dict) and item.get('query'))
    return str(
        target.get('sellerUrl')
        or target.get('productUrl')
        or target.get('sellerExternalId')
        or target.get('productExternalId')
        or target.get('searchQuery')
        or plan_value
        or row.get('id')
        or '未命名目标'
    )


def watch_line(row: dict[str, Any], ordinal: int) -> str:
    interval = row.get('intervalSeconds') or 0
    interval_value = _interval_label(interval, 0) if interval else '频率未知'
    return (
        f"{ordinal}号 · {row.get('source') or '未知平台'} / {row.get('type') or 'watch'} / "
        f"{'启用' if row.get('enabled') else '暂停'} / {interval_value}\n"
        f"   {watch_target_value(row)}"
    )


def watch_ids(rows: list[dict[str, Any]]) -> list[str]:
    return [str(row['id']) for row in rows if row.get('id')]


def delete_choice_buttons(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    buttons: list[dict[str, str]] = []
    for ordinal, row in enumerate(rows, start=1):
        watch_id = str(row.get('id') or '').strip()
        if watch_id:
            buttons.append({'text': f'取消{ordinal}号', 'callbackData': f'pr1:delete:{watch_id}'})
    return buttons


def format_watches(result: dict[str, Any]) -> str:
    rows = watch_rows(result)
    if not rows:
        return '目前没有正在监控的 Seller Watch、Product Watch 或 Similarity Watch。'
    lines = ['👀 当前监控']
    lines.extend(watch_line(row, ordinal) for ordinal, row in enumerate(rows, start=1))
    return '\n'.join(lines)


def format_delete_choices(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return '目前没有可以取消的监控。'
    return '\n'.join([
        '请选择要取消的监控：',
        '',
        *(watch_line(row, ordinal) for ordinal, row in enumerate(rows, start=1)),
        '',
        '也可以直接回复“取消1号”。',
    ])
