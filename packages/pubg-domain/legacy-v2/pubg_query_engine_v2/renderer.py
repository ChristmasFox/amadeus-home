from __future__ import annotations

import math
import re
import unicodedata
from typing import Any


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _format_number(value: Any, digits: int = 0) -> str:
    number = _number(value)
    if number is None:
        return "—"
    if digits == 0:
        return f"{int(round(number)):,}"
    return f"{number:,.{digits}f}"


def _metric_label(metric: str) -> str:
    return {
        "matches": "场次",
        "kills": "击杀",
        "assists": "助攻",
        "damage": "伤害",
        "avg_damage": "场均伤害",
        "kd": "KD",
        "deaths": "死亡（排名代理）",
        "wins": "吃鸡",
        "top10": "前十",
        "rank": "平均排名",
        "dbnos": "倒地",
        "revives": "救援",
        "headshot_kills": "爆头击杀",
        "survival_time": "生存秒数",
        "longest_kill": "最长击杀",
    }.get(metric, metric)


def _format_metric(metric: str, value: Any) -> str:
    digits = 1 if metric == "kd" else 2 if metric in {"avg_damage", "rank"} else 0
    return f"{_metric_label(metric)} {_format_number(value, digits)}"


def _status_prefix(status: str) -> str:
    return {
        "PARTIAL": "⚠️ 当前数据部分可用，以下结果可能不完整。",
        "STALE": "⚠️ 当前使用了本地历史数据，数据源同步时间较旧。",
    }.get(status, "")


def _display_width(value: Any) -> int:
    width = 0
    for char in str(value):
        if unicodedata.combining(char):
            continue
        width += 2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1
    return width


def _fit_cell(value: Any, width: int, *, align: str = "left") -> str:
    text = str(value)
    if _display_width(text) > width:
        while text and _display_width(text + "…") > width:
            text = text[:-1]
        text = text + "…"
    padding = max(0, width - _display_width(text))
    if align == "right":
        return " " * padding + text
    return text + " " * padding


def _format_table(headers: list[str], rows: list[list[tuple[Any, str]]]) -> str:
    widths = [_display_width(header) for header in headers]
    for row in rows:
        for index, (value, _) in enumerate(row):
            widths[index] = max(widths[index], _display_width(value))
    header_line = "  ".join(_fit_cell(header, widths[index]) for index, header in enumerate(headers))
    separator = "  ".join("-" * width for width in widths)
    body = [
        "  ".join(_fit_cell(value, widths[index], align=align) for index, (value, align) in enumerate(row))
        for row in rows
    ]
    return "\n".join([header_line, separator, *body])


def _selector_label(query: dict[str, Any]) -> str:
    selector = query.get("selector", {}) if isinstance(query.get("selector"), dict) else {}
    if selector.get("type") == "time_range":
        start = str(selector.get("start", ""))
        end = str(selector.get("end", ""))
        start_date, start_time = start[:10], start[11:16]
        end_date, end_time = end[:10], end[11:16]
        if start_date and start_date == end_date:
            return f"{start_date} {start_time}～{end_time}"
        if start_time == "06:00" and end_time == "06:00" and start_date and end_date:
            return start_date
        if start_date and end_date:
            return f"{start_date} {start_time}～{end_date} {end_time}"
    label = selector.get("label") or selector.get("value")
    if label:
        text = str(label)
        for pattern, replacement in (
            (r".*?(最近\s*\d+\s*(?:把|局|场)).*", r"\1"),
            (r".*?(上周[一二三四五六日天]).*", r"\1"),
            (r".*?(大前天|前天|昨天|今日|今天|昨晚|今晚).*", r"\1"),
            (r".*?(\d{1,2}月\d{1,2}(?:号|日)?(?:晚上?|晚间|夜里)?(?:\d{1,2}(?:点|时)(?:以后)?)?).*", r"\1"),
        ):
            matched = re.match(pattern, text)
            if matched:
                return re.sub(r"号", "日", matched.group(1))
        return text if len(text) <= 18 else "当前范围"
    return "当前范围"


def _render_player_table(
    rows: list[dict[str, Any]],
    query: dict[str, Any],
    result: dict[str, Any],
    *,
    heading: str,
) -> list[str]:
    headers = ["排名", "玩家", "场次", "击杀", "KD", "伤害", "场均伤害", "吃鸡", "前十", "平均排名"]
    table_rows: list[list[tuple[Any, str]]] = []
    for index, row in enumerate(rows, 1):
        metrics = row.get("metrics", {}) if isinstance(row.get("metrics"), dict) else {}
        position = row.get("position") or index
        label = row.get("label") or row.get("key") or "未知玩家"
        table_rows.append(
            [
                (position, "right"),
                (label, "left"),
                (_format_number(metrics.get("matches")), "right"),
                (_format_number(metrics.get("kills")), "right"),
                (_format_number(metrics.get("kd"), 1), "right"),
                (_format_number(metrics.get("damage")), "right"),
                (_format_number(metrics.get("avg_damage"), 2), "right"),
                (_format_number(metrics.get("wins")), "right"),
                (_format_number(metrics.get("top10")), "right"),
                (_format_number(metrics.get("rank"), 2), "right"),
            ]
        )
    evidence = result.get("evidence", {}) if isinstance(result.get("evidence"), dict) else {}
    match_count = len(evidence.get("matchIds", []))
    people_count = len(rows)
    lines = [
        f"{heading}｜{_selector_label(query)}｜{people_count}人｜{match_count}场",
        "```",
        _format_table(headers, table_rows),
        "```",
    ]
    return lines


def _render_match_row(row: dict[str, Any], metric: str | None = None) -> list[str]:
    match_id = row.get("matchId") or row.get("label") or "未知比赛"
    created_at = row.get("createdAt") or "未知时间"
    map_name = row.get("map") or "未知地图"
    mode = row.get("mode") or "未知模式"
    metrics = row.get("metrics", {})
    title = f"{match_id}｜{created_at}｜{map_name}｜{mode}"
    if metric:
        title += f"｜{_format_metric(metric, metrics.get(metric))}"
    lines = [title]
    players = row.get("players", [])
    if players:
        player_parts = []
        for player in players:
            name = player.get("displayName") or player.get("playerName") or player.get("accountId")
            player_parts.append(
                f"{name}（击杀 {_format_number(player.get('kills'))}，伤害 {_format_number(player.get('damage'))}，排名 {_format_number(player.get('rank'))}）"
            )
        lines.append("  " + "；".join(player_parts))
    return lines


def render_result(query: dict[str, Any], result: dict[str, Any]) -> str:
    status = str(result.get("status", "INVALID_QUERY"))
    data = result.get("data") if isinstance(result.get("data"), dict) else {}
    if status == "UNSUPPORTED_CAPABILITY":
        capability = data.get("capability") or result.get("coverage", {}).get("unsupportedCapability") or query.get("reference", {}).get("unsupportedCapability") or "该项"
        return f"当前还没有 {capability} 数据能力（需要 weapon/telemetry 等数据源），不会根据上下文猜测。"
    if status == "INVALID_QUERY":
        errors = data.get("errors") or ["查询结构不合法"]
        return "查询无法执行：" + "；".join(str(error) for error in errors[:3])
    if status == "UNKNOWN_PLAYER":
        ids = ", ".join(str(item) for item in data.get("playerIds", []))
        return f"找不到指定的 PUBG 玩家：{ids}。"
    if status == "SOURCE_UNAVAILABLE":
        return "PUBG 数据源当前不可用，且本地数据不足以可靠回答；这不是“没有比赛”。"
    if status == "COVERAGE_GAP":
        return "当前本地数据覆盖不足，无法确认这个时间范围是否没有比赛；系统没有把缓存未命中当成零场。"

    lines: list[str] = []
    prefix = _status_prefix(status)
    if prefix:
        lines.append(prefix)
    operation = data.get("operation", query.get("operation"))
    if operation == "rank":
        metric = data.get("metric") or query.get("orderBy", {}).get("metric")
        rows = data.get("rows", [])
        if not rows:
            lines.append("当前范围内没有可排名的比赛数据。" if data.get("groupBy") == "match" else "当前范围内没有可排名的玩家数据。")
        elif data.get("groupBy") == "match":
            lines.append(f"按 {_metric_label(metric)} 排名（单局）：")
            for index, row in enumerate(rows, 1):
                rendered = _render_match_row(row, metric)
                lines.append(f"{index}. " + rendered[0])
                lines.extend(rendered[1:])
        elif data.get("groupBy") == "player":
            lines.extend(_render_player_table(rows, query, result, heading=f"按 {_metric_label(metric)} 排名"))
        else:
            lines.append(f"按 {_metric_label(metric)} 排名：")
            for index, row in enumerate(rows, 1):
                label = row.get("label") or row.get("key") or "未知"
                lines.append(f"{index}. {label}｜{_format_metric(metric, row.get('metrics', {}).get(metric))}")
    elif operation == "compare":
        lines.append("周期对比：")
        for segment in data.get("segments", []):
            summary = segment.get("summary", {})
            values = "｜".join(_format_metric(metric, summary.get(metric)) for metric in query.get("metrics", []))
            lines.append(f"{segment.get('label', '周期')}：{values}")
        delta = data.get("delta", {})
        if delta:
            lines.append("前一段 − 后一段：" + "｜".join(_format_metric(metric, delta.get(metric)) for metric in query.get("metrics", []) if metric in delta))
    elif operation == "trend":
        lines.append("趋势（日维度）：")
        for row in data.get("rows", []):
            label = row.get("key") or row.get("label") or "未知日期"
            values = "｜".join(_format_metric(metric, row.get("metrics", {}).get(metric)) for metric in query.get("metrics", []))
            lines.append(f"{label}：{values}")
        direction = data.get("direction", {})
        if direction:
            lines.append("趋势判断：" + "｜".join(f"{_metric_label(metric)} {direction_value}" for metric, direction_value in direction.items()))
    elif operation == "list":
        rows = data.get("rows", [])
        lines.append(f"比赛列表（{len(rows)} 场）：")
        for row in rows:
            lines.extend(_render_match_row(row))
    else:
        summary = data.get("summary", {})
        if not summary and data.get("rows"):
            summary = data["rows"][0].get("metrics", {})
        if data.get("groupBy") == "player":
            rows = data.get("rows", [])
            if rows:
                lines.extend(_render_player_table(rows, query, result, heading="PUBG 战绩（按 KD 降序）"))
            else:
                lines.append("当前范围内没有可展示的玩家数据。")
        else:
            lines.append("PUBG 战绩：")
            lines.append("｜".join(_format_metric(metric, summary.get(metric)) for metric in query.get("metrics", []) if metric in summary))
    if status == "NO_MATCHES":
        lines.append("当前范围内确认没有竞技比赛（数据覆盖完整）。")
    return "\n".join(line for line in lines if line)
