from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

TIMEZONE = "Asia/Shanghai"
ZONE = ZoneInfo(TIMEZONE)
BUSINESS_DAY_START = time(6, 0)


class TimeResolutionError(ValueError):
    pass


@dataclass(frozen=True)
class ResolvedRange:
    start: datetime
    end: datetime
    label: str

    def as_selector(self) -> dict[str, Any]:
        return {
            "type": "time_range",
            "start": self.start.isoformat(timespec="seconds"),
            "end": self.end.isoformat(timespec="seconds"),
            "label": self.label,
        }


def _as_local(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(ZONE)
    if value.tzinfo is None:
        return value.replace(tzinfo=ZONE)
    return value.astimezone(ZONE)


def _at(day: date, hour: int = 6, minute: int = 0) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=ZONE)


def _business_date(now: datetime) -> date:
    local = _as_local(now)
    if local.time() < BUSINESS_DAY_START:
        return local.date() - timedelta(days=1)
    return local.date()


def _business_range(day: date, label: str | None = None) -> ResolvedRange:
    return ResolvedRange(_at(day), _at(day + timedelta(days=1)), label or day.isoformat())


def _week_monday(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def _valid_date(year: int, month: int, day: int) -> date | None:
    try:
        if day < 1 or day > _days_in_month(year, month):
            return None
        return date(year, month, day)
    except (TypeError, ValueError):
        return None


def _resolve_date(year: int | None, month: int, day: int, reference: date) -> date:
    candidate_year = year or reference.year
    resolved = _valid_date(candidate_year, month, day)
    if resolved is None:
        raise TimeResolutionError(f"无效日期：{candidate_year}-{month}-{day}")
    if year is None and resolved > reference:
        previous_year = candidate_year - 1
        previous = _valid_date(previous_year, month, day)
        if previous is not None:
            resolved = previous
    return resolved


def _parse_date_tokens(text: str, reference: date) -> list[tuple[int, date]]:
    tokens: list[tuple[int, date]] = []
    occupied: list[tuple[int, int]] = []
    patterns = (
        re.compile(r"(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?"),
        re.compile(r"(?:(\d{4})\s*[/-]\s*)?(\d{1,2})\s*[/-]\s*(\d{1,2})"),
    )
    for pattern in patterns:
        for match in pattern.finditer(text):
            if any(match.start() < end and match.end() > start for start, end in occupied):
                continue
            year = int(match.group(1)) if match.group(1) else None
            month = int(match.group(2))
            day = int(match.group(3))
            resolved = _resolve_date(year, month, day, reference)
            tokens.append((match.start(), resolved))
            occupied.append((match.start(), match.end()))
    return sorted(tokens, key=lambda item: item[0])


def _parse_clock(text: str) -> tuple[int, int] | None:
    match = re.search(
        r"(?:(晚上?|晚间|夜里|夜间)\s*)?(\d{1,2})(?:(?::(\d{2}))|(?:\s*(?:点|时)(?:\s*(\d{1,2}))?))",
        text,
    )
    if not match:
        return None
    prefix = match.group(1)
    hour = int(match.group(2))
    minute = int(match.group(3) or match.group(4) or 0)
    if prefix and 1 <= hour < 12:
        hour += 12
    if hour > 23 or minute > 59:
        raise TimeResolutionError("无效时间")
    return hour, minute


def _after_clock(text: str) -> tuple[int, int] | None:
    if not re.search(r"(?:以后|之后|开始|起)", text):
        return None
    return _parse_clock(text)


def _parse_weekday(text: str, reference: date) -> date | None:
    match = re.search(r"(上周|上星期|本周|本星期|这周|星期|周)([一二三四五六日天0-6])", text)
    if not match:
        return None
    day_token = match.group(2)
    weekday = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}.get(day_token)
    if weekday is None:
        weekday = int(day_token)
        weekday = 6 if weekday == 0 else weekday - 1
    current_monday = _week_monday(reference)
    prefix = match.group(1)
    if prefix.startswith("上"):
        return current_monday - timedelta(days=7 - weekday)
    return current_monday + timedelta(days=weekday)


def _night_date(now: datetime, reference: date) -> date:
    local = _as_local(now)
    return reference if local.time() < BUSINESS_DAY_START else reference - timedelta(days=1)


def _resolve_relative(value: str, now: datetime) -> ResolvedRange:
    local = _as_local(now)
    business_day = _business_date(local)
    normalized = re.sub(r"\s+", "", str(value).lower())
    if normalized in {"今晚", "tonight"}:
        return ResolvedRange(
            datetime.combine(business_day, time(18, 0), tzinfo=ZONE),
            _at(business_day + timedelta(days=1)),
            str(value),
        )
    aliases = {
        "today": 0,
        "今天": 0,
        "今日": 0,
        "yesterday": 1,
        "昨天": 1,
        "昨日": 1,
        "前天": 2,
        "daybeforeyesterday": 2,
        "大前天": 3,
    }
    if normalized in aliases:
        offset = aliases[normalized]
        return _business_range(business_day - timedelta(days=offset), str(value))

    match = re.fullmatch(r"(?:n[_-]?days?[_-]?ago|days?[_-]?ago[:：]?)(\d+)", normalized)
    if match:
        return _business_range(business_day - timedelta(days=int(match.group(1))), str(value))
    match = re.fullmatch(r"(\d+)天前", normalized)
    if match:
        return _business_range(business_day - timedelta(days=int(match.group(1))), str(value))

    if normalized in {"本周", "这周", "thisweek"}:
        monday = _week_monday(business_day)
        return ResolvedRange(_at(monday), _at(monday + timedelta(days=7)), str(value))
    if normalized in {"上周", "lastweek"}:
        monday = _week_monday(business_day) - timedelta(days=7)
        return ResolvedRange(_at(monday), _at(monday + timedelta(days=7)), str(value))

    recent = re.fullmatch(r"(?:最近|近|last|past)(\d+)(?:天|日|days?)", normalized)
    if recent:
        count = int(recent.group(1))
        if count < 1 or count > 366:
            raise TimeResolutionError("最近天数必须在 1 到 366 之间")
        return ResolvedRange(
            _at(business_day - timedelta(days=count - 1)),
            _at(business_day + timedelta(days=1)),
            str(value),
        )

    if normalized.startswith("date:"):
        try:
            target = date.fromisoformat(normalized[5:])
        except ValueError as exc:
            raise TimeResolutionError("date selector 无效") from exc
        return _business_range(target, str(value))

    raise TimeResolutionError(f"无法解析相对时间：{value}")


def resolve_text_selector(text: str, now: datetime | None = None) -> dict[str, Any]:
    local_now = _as_local(now)
    business_day = _business_date(local_now)
    value = str(text or "").strip()
    if not value:
        return _business_range(business_day, "今天").as_selector()

    if re.search(r"最近\s*\d+\s*(?:把|局|场|场次|matches?)", value, re.IGNORECASE):
        match = re.search(r"最近\s*(\d+)", value, re.IGNORECASE)
        count = int(match.group(1))
        return {"type": "last_n_matches", "count": count, "label": f"最近{count}场"}

    recent_day_match = re.search(r"(?:最近|近)\s*(\d+)\s*(?:天|日)", value)
    if recent_day_match:
        return {
            "type": "recent_days",
            "count": int(recent_day_match.group(1)),
            "label": recent_day_match.group(0),
        }

    clock_after = _after_clock(value)
    date_tokens = _parse_date_tokens(value, business_day)
    if date_tokens:
        if len(date_tokens) >= 2 and re.search(r"(?:到|至|至今|[-~—])", value):
            start_day = date_tokens[0][1]
            end_day = date_tokens[1][1]
            if end_day < start_day:
                end_day = end_day.replace(year=end_day.year + 1)
            return ResolvedRange(_at(start_day), _at(end_day + timedelta(days=1)), value).as_selector()
        target = date_tokens[0][1]
        if clock_after:
            start = datetime.combine(target, time(*clock_after), tzinfo=ZONE)
            end = _at(target + timedelta(days=1))
            return ResolvedRange(start, end, value).as_selector()
        return _business_range(target, value).as_selector()

    weekday = _parse_weekday(value, business_day)
    if weekday is not None:
        if "上周" in value or "上星期" in value:
            label = value
        else:
            label = value
        return _business_range(weekday, label).as_selector()

    if re.search(r"昨晚|昨天晚上|昨天夜里", value):
        target = _night_date(local_now, business_day)
        start_hour = clock_after[0] if clock_after else 18
        start_minute = clock_after[1] if clock_after else 0
        return ResolvedRange(
            datetime.combine(target, time(start_hour, start_minute), tzinfo=ZONE),
            _at(target + timedelta(days=1)),
            value,
        ).as_selector()

    if clock_after:
        start = datetime.combine(business_day, time(*clock_after), tzinfo=ZONE)
        return ResolvedRange(start, _at(business_day + timedelta(days=1)), value).as_selector()

    if re.search(r"今晚|tonight", value, re.IGNORECASE):
        return ResolvedRange(
            datetime.combine(business_day, time(18, 0), tzinfo=ZONE),
            _at(business_day + timedelta(days=1)),
            value,
        ).as_selector()
    if re.search(r"今天|今日|today", value, re.IGNORECASE):
        return _business_range(business_day, value).as_selector()
    if re.search(r"昨天|昨日|yesterday", value, re.IGNORECASE):
        return _business_range(business_day - timedelta(days=1), value).as_selector()
    if re.search(r"大前天", value):
        return _business_range(business_day - timedelta(days=3), value).as_selector()
    if re.search(r"前天|day\s*before", value, re.IGNORECASE):
        return _business_range(business_day - timedelta(days=2), value).as_selector()
    days_ago = re.search(r"(\d+)\s*天前", value)
    if days_ago:
        return _resolve_relative(f"{days_ago.group(1)}天前", local_now).as_selector()
    if re.search(r"过去\s*\d+\s*天|最近\s*\d+\s*天", value):
        match = re.search(r"(\d+)", value)
        return _resolve_relative(f"最近{match.group(1)}天", local_now).as_selector()
    if re.search(r"本周|这周|上周", value):
        return _resolve_relative("上周" if "上周" in value else "本周", local_now).as_selector()

    raise TimeResolutionError(f"无法从文本解析时间范围：{text}")


def resolve_selector(selector: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    if not isinstance(selector, dict):
        raise TimeResolutionError("selector 必须是对象")
    selector_type = selector.get("type")
    if selector_type == "relative_period":
        value = str(selector.get("value", ""))
        try:
            result = _resolve_relative(value, _as_local(now)).as_selector()
        except TimeResolutionError:
            result = resolve_text_selector(value, _as_local(now))
        for key in ("label", "after"):
            if key in selector:
                result[key] = selector[key]
        return result
    if selector_type == "recent_days":
        count = int(selector.get("count", 0))
        return _resolve_relative(f"最近{count}天", _as_local(now)).as_selector()
    if selector_type == "time_range":
        start = _parse_iso(selector.get("start"))
        end = _parse_iso(selector.get("end"))
        if end <= start:
            raise TimeResolutionError("time_range 的 end 必须晚于 start")
        return {**selector, "start": start.isoformat(timespec="seconds"), "end": end.isoformat(timespec="seconds")}
    if selector_type in {"last_n_matches", "result_set"}:
        return dict(selector)
    raise TimeResolutionError(f"不支持的 selector 类型：{selector_type}")


def _parse_iso(value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise TimeResolutionError("时间边界必须是 ISO8601 字符串")
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise TimeResolutionError(f"无效 ISO8601 时间：{value}") from exc
    return _as_local(parsed)


def resolve_query_selectors(query: dict[str, Any], now: datetime | None = None) -> dict[str, Any]:
    resolved = dict(query)
    resolved["selector"] = resolve_selector(query.get("selector", {}), now)
    if query.get("segments"):
        resolved["segments"] = [
            {**segment, "selector": resolve_selector(segment.get("selector", {}), now)}
            for segment in query["segments"]
        ]
    return resolved
