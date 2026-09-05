from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from typing import Any

from .capabilities import CAPABILITY_REGISTRY, METRIC_ALIASES, UNSUPPORTED_ALIASES
from .schema import QueryValidationError, query_template, validate_query
from .time_resolver import resolve_text_selector


DEFAULT_TEAM = {
    "type": "team",
    "ids": [
        "account.29044012052444c0848d617ba100fe1e",
        "account.a22ea4bce333448e9cce807cebd7f4bf",
        "account.45ad53f453db4c4bbff2b4cf00b131d6",
        "account.84c0d223534f42b1922c070a52c3c6ce",
    ],
    "aliases": {
        "SG_LabmemNo007": "account.29044012052444c0848d617ba100fe1e",
        "SG_LabmemNo008": "account.a22ea4bce333448e9cce807cebd7f4bf",
        "SG_LabmemNo004": "account.45ad53f453db4c4bbff2b4cf00b131d6",
        "kim_kkl": "account.84c0d223534f42b1922c070a52c3c6ce",
    },
    "label": "【范德林德帮】",
}

DEFAULT_REPORT_METRICS = [
    "matches",
    "kills",
    "kd",
    "damage",
    "avg_damage",
    "rank",
    "assists",
    "wins",
    "top10",
]


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:20]}"


def planner_prompt(
    *,
    user_text: str,
    now: datetime,
    timezone: str,
    context: dict[str, Any] | None = None,
    capabilities: dict[str, Any] | None = None,
) -> str:
    registry = capabilities or CAPABILITY_REGISTRY
    context_view = {
        "activeDomain": (context or {}).get("activeDomain"),
        "lastQuery": (context or {}).get("lastQuery"),
        "lastResultSetId": (context or {}).get("lastResultSetId"),
        "lastSelectors": (context or {}).get("lastSelectors"),
        "references": (context or {}).get("references", {}),
    }
    return "\n".join(
        [
            "你是 PUBG Query Planner。你只能输出一个 JSON 查询计划，不能回答用户，不能调用 API，不能计算统计。",
            f"当前时间：{now.isoformat(timespec='seconds')}；时区：{timezone}；战绩日从每天 06:00 开始。",
            "必须严格使用 version=1、domain=pubg 的 Canonical Query Schema。",
            "支持 operation：report、rank、compare、trend、list；支持 groupBy：player、match、day、team。",
            "支持 selector：time_range、last_n_matches、recent_days、relative_period、result_set。",
            "如果请求武器、枪械、telemetry、赛季或生涯数据，在 reference.unsupportedCapability 写入对应能力，不要编造 metric。",
            "rank 必须把比较维度写入 groupBy，把指标写入 orderBy.metric，并设置 direction；不要用 ranking 字符串替代。",
            "‘哪一把/哪一局/哪场’必须 groupBy=match；‘谁/哪个玩家’必须 groupBy=player。",
            "compare 必须使用两个 segments，每个 segment 有 label 和 selector；不要把两个周期塞到一个 selector。",
            "selector 中的自然语言只放在 relative_period.value，绝不要自行计算 Unix timestamp。",
            "当前结构化上下文（只用于解析指代，不是事实数据）：",
            json.dumps(context_view, ensure_ascii=False, separators=(",", ":")),
            "能力注册表：",
            json.dumps(registry, ensure_ascii=False, separators=(",", ":")),
            "用户问题：",
            user_text,
            "只输出 JSON，不要 Markdown，不要解释。",
        ]
    )


def _message_content(message: Any) -> str:
    if message is None:
        return ""
    if isinstance(message, str):
        return message
    if isinstance(message, dict):
        return _message_content(message.get("content"))
    if isinstance(message, list):
        return "".join(_message_content(item) for item in message)
    text = getattr(message, "content", None)
    if text is not None:
        return _message_content(text)
    return str(message)


def parse_planner_output(output: Any) -> dict[str, Any]:
    text = _message_content(output).strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except (TypeError, json.JSONDecodeError) as exc:
        raise QueryValidationError(["Planner 输出不是合法 JSON"]) from exc
    if not isinstance(parsed, dict):
        raise QueryValidationError(["Planner 输出必须是 JSON object"])
    return validate_query(parsed)


def is_pubg_query(text: str, context: dict[str, Any] | None = None) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    if (context or {}).get("activeDomain") == "pubg":
        if re.search(r"^(那|它|他|她|他们|刚才|前面|上面|继续|然后|跟|和|比|哪把|哪一把|哪局|哪一局|哪场|昨天呢|前天呢|那场)", value):
            return True
        if len(value) <= 18 and not re.search(r"(?:天气|新闻|电影|音乐|几点|地址)", value):
            return True
    return bool(
        re.search(
            r"PUBG|绝地求生|吃鸡|战绩|击杀|杀人|伤害|助攻|倒地|救援|KD|KDA|排名|场次|哪把|哪一把|哪局|哪一局|哪场|枪械|武器|telemetry",
            value,
            re.IGNORECASE,
        )
    )


def _match_metric(text: str) -> str | None:
    for alias, metric in sorted(METRIC_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        if alias.lower() in text.lower():
            return metric
    return None


def _unsupported_capability(text: str) -> str | None:
    for alias, capability in sorted(UNSUPPORTED_ALIASES.items(), key=lambda item: len(item[0]), reverse=True):
        if alias.lower() in text.lower():
            return capability
    return None


def _subject_for_text(text: str, subject: dict[str, Any] | None) -> dict[str, Any]:
    base = subject or DEFAULT_TEAM
    aliases = base.get("aliases", {}) if isinstance(base, dict) else {}
    for alias, account_id in aliases.items():
        if alias.lower() in text.lower():
            return {"type": "player", "ids": [account_id]}
    result = {"type": base.get("type", "team"), "ids": list(base.get("ids", []))}
    if result["type"] == "team":
        result["aliases"] = dict(DEFAULT_TEAM.get("aliases", {}))
        result["label"] = DEFAULT_TEAM.get("label")
    return result


def _last_n_selector(text: str) -> dict[str, Any] | None:
    match = re.search(r"最近\s*(\d+)\s*(?:把|局|场|场次|局比赛|matches?)", text, re.IGNORECASE)
    if match:
        return {"type": "last_n_matches", "count": int(match.group(1)), "label": f"最近{match.group(1)}场"}
    match = re.search(r"之前\s*(\d+)\s*(?:把|局|场|场次|matches?)", text, re.IGNORECASE)
    if match:
        return {
            "type": "last_n_matches",
            "count": int(match.group(1)),
            "offset": int(match.group(1)),
            "label": f"之前{match.group(1)}场",
        }
    return None


def _selector_for_text(text: str, now: datetime, context: dict[str, Any] | None) -> dict[str, Any]:
    last_n = _last_n_selector(text)
    if last_n:
        return last_n
    if re.search(r"(?:最近|过去|近)\s*\d+\s*(?:天|日)", text):
        match = re.search(r"(?:最近|过去|近)\s*(\d+)\s*(?:天|日)", text)
        return {"type": "recent_days", "count": int(match.group(1)), "label": match.group(0)}
    if re.search(
        r"昨天|昨日|前天|大前天|今天|今日|今晚|昨晚|昨天晚上|昨天夜里|本周|上周|"
        r"\d{1,4}\s*[年/月号日/-]|(?:晚上?|晚间|夜里|夜间)\s*\d{1,2}(?::\d{2}|\s*(?:点|时))",
        text,
        re.IGNORECASE,
    ):
        return {"type": "relative_period", "value": text}
    last_selector = (context or {}).get("lastSelectors")
    if last_selector and re.search(r"(?:刚才|上面|前面|昨天呢|前天呢|那场|哪把|哪一把|哪局|哪一局|哪场|它|他|她|他们|继续|然后)", text):
        return dict(last_selector)
    return {"type": "relative_period", "value": "今天"}


def _subject_from_context(context: dict[str, Any] | None) -> dict[str, Any] | None:
    subject = (context or {}).get("subject")
    if not isinstance(subject, dict):
        return None
    subject_type = subject.get("type")
    ids = subject.get("ids")
    if subject_type not in {"team", "player", "players"} or not isinstance(ids, list):
        return None
    if subject_type != "team" and not ids:
        return None
    return {"type": subject_type, "ids": [str(item) for item in ids]}


def _compare_segments(text: str, context: dict[str, Any] | None) -> list[dict[str, Any]]:
    if re.search(r"昨天.*(?:和|跟|与|vs|VS|对比|比较).*(?:前天)|前天.*(?:和|跟|与|vs|VS|对比|比较).*(?:昨天)", text):
        return [
            {"label": "昨天", "selector": {"type": "relative_period", "value": "昨天"}},
            {"label": "前天", "selector": {"type": "relative_period", "value": "前天"}},
        ]
    if re.search(r"最近\s*\d+\s*(?:把|局|场).*(?:之前|前)\s*\d+\s*(?:把|局|场)", text):
        matches = re.findall(r"(最近|之前|前)\s*(\d+)\s*(?:把|局|场)", text)
        segments = []
        for prefix, count_text in matches[:2]:
            count = int(count_text)
            offset = count if prefix != "最近" else 0
            segments.append(
                {
                    "label": f"{prefix}{count}场",
                    "selector": {"type": "last_n_matches", "count": count, "offset": offset},
                }
            )
        if len(segments) == 2:
            return segments
    if "前天" in text and re.search(r"跟|和|与|比", text):
        previous = (context or {}).get("lastSelectors")
        if previous:
            return [
                {"label": "上一次查询范围", "selector": dict(previous)},
                {"label": "前天", "selector": {"type": "relative_period", "value": "前天"}},
            ]
        return [
            {"label": "昨天", "selector": {"type": "relative_period", "value": "昨天"}},
            {"label": "前天", "selector": {"type": "relative_period", "value": "前天"}},
        ]
    previous = (context or {}).get("lastSelectors")
    if previous:
        return [
            {"label": "上一次查询范围", "selector": dict(previous)},
            {"label": "前一周期", "selector": {"type": "relative_period", "value": "前天"}},
        ]
    return [
        {"label": "昨天", "selector": {"type": "relative_period", "value": "昨天"}},
        {"label": "前天", "selector": {"type": "relative_period", "value": "前天"}},
    ]


def build_query_from_text(
    text: str,
    *,
    session_id: str,
    query_id: str | None = None,
    context: dict[str, Any] | None = None,
    now: datetime | None = None,
    subject: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = now or datetime.now().astimezone()
    text = str(text or "").strip()
    query_id = query_id or _new_id("q")
    chosen_subject = _subject_for_text(text, subject)
    contextual_subject = _subject_from_context(context)
    explicit_subject_alias = re.search(r"(?:SG_LabmemNo007|SG_LabmemNo008|SG_LabmemNo004|kim_kkl)", text, re.IGNORECASE)
    default_subject_ids = {str(item) for item in DEFAULT_TEAM.get("ids", [])}
    if contextual_subject and not explicit_subject_alias and chosen_subject.get("type") == "team" and set(chosen_subject.get("ids", [])) == default_subject_ids:
        chosen_subject = contextual_subject
    unsupported = _unsupported_capability(text)
    metric = _match_metric(text)
    asks_individual = bool(re.search(r"分别|各自|每人|每个人|四个人|所有人|队友|玩家们", text))
    asks_match = bool(re.search(r"哪把|哪一把|哪局|哪一局|哪场|单局|比赛中|那场", text))
    asks_player = bool(re.search(r"谁|哪个玩家|玩家", text))
    asks_compare = bool(re.search(r"对比|比较|跟.*比|和.*比|vs|VS", text))
    asks_trend = bool(re.search(r"趋势|变好|变差|状态|进步|退步|最近几天", text))
    asks_list = bool(re.search(r"列出|列表|比赛清单|有哪些比赛", text))

    if asks_compare:
        operation = "compare"
    elif asks_trend:
        operation = "trend"
    elif asks_list:
        operation = "list"
    elif asks_match or metric and re.search(r"最高|最多|最低|最少|最好", text) or re.search(r"表现最好|最强|最菜|最稳", text):
        operation = "rank"
    else:
        operation = "report"

    if operation == "trend":
        group_by = "day"
    elif asks_match:
        group_by = "match"
    elif asks_individual or asks_player:
        group_by = "player"
    elif operation == "rank" and re.search(r"谁|玩家", text):
        group_by = "player"
    else:
        group_by = "team"

    if metric is None:
        if operation == "rank":
            metric = "damage" if re.search(r"伤害|高伤", text) else "kills" if re.search(r"杀|击杀", text) else "kd"
        elif operation == "trend":
            metric = "kd"
    if operation == "rank" and metric == "rank":
        direction = "asc"
    else:
        direction = "desc"

    if operation == "trend":
        metrics = ["kd", "avg_damage", "kills", "damage"]
        selector: dict[str, Any] = {"type": "recent_days", "count": 7, "label": "最近7天"}
    elif operation == "compare":
        metrics = [metric or "kd", "avg_damage", "kills", "damage"]
        selector = _selector_for_text(text, now, context)
    elif operation == "rank":
        metrics = [metric or "kills"]
        selector = _selector_for_text(text, now, context)
    elif operation == "list":
        metrics = ["matches", "kills", "damage", "rank"]
        selector = _selector_for_text(text, now, context)
    else:
        metrics = ["matches", "kills", "assists", "damage", "avg_damage", "kd", "wins", "top10", "rank"]
        selector = _selector_for_text(text, now, context)

    reference: dict[str, Any] = {}
    if unsupported:
        reference["unsupportedCapability"] = unsupported
    result_set_id = (context or {}).get("lastResultSetId")
    if result_set_id and asks_match and not re.search(r"昨天|前天|今天|上周|最近|\d+月|\d+[-/]\d+", text):
        selector = {"type": "result_set", "resultSetId": str(result_set_id), "label": "上一次结果集"}
        reference["resultSetId"] = str(result_set_id)

    limit = None
    top_match = re.search(r"(?:前|top\s*)(\d+)", text, re.IGNORECASE)
    if top_match:
        limit = int(top_match.group(1))
    elif operation == "rank":
        limit = 1
    elif operation == "list":
        limit = 20

    query = query_template(
        query_id=query_id,
        session_id=session_id,
        subject=chosen_subject,
        operation=operation,
        selector=selector,
        segments=_compare_segments(text, context) if operation == "compare" else [],
        group_by=group_by,
        metrics=metrics,
        filters={"mode": "competitive"},
        order_by={"metric": metric, "direction": direction} if operation == "rank" else {},
        limit=limit,
        reference=reference,
        presentation={"userText": text, "language": "zh-Hans"},
    )
    return apply_default_query_semantics(query, text=text, context=context)


def _explicit_player_subject(text: str) -> dict[str, Any] | None:
    value = str(text or "").casefold()
    for alias, account_id in DEFAULT_TEAM.get("aliases", {}).items():
        if alias.casefold() in value:
            return {"type": "player", "ids": [account_id]}
    return None


def _references_context_subject(text: str) -> bool:
    value = re.sub(r"[\s?？!！。,.，、]+", "", str(text or "").strip())
    if not value:
        return False
    if value in {"今天", "今日", "昨天", "昨日", "前天", "昨晚", "今晚", "刚才", "上次"}:
        return True
    if len(value) <= 18 and re.search(r"呢$|^(?:那|他|她|这个|那个|这位|那位|刚才|前面|上面|继续|然后|跟|和|与|比)", value):
        return True
    return bool(re.search(r"^(?:哪把|哪一把|哪局|哪一局|哪场|那场)", value))


def _explicit_team_aggregate(text: str) -> bool:
    return bool(re.search(r"总计|合计|总览|整体汇总|全队平均|小队总|团队总|队伍总", str(text or "")))


def apply_default_query_semantics(
    query: dict[str, Any],
    *,
    text: str,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved = json.loads(json.dumps(query, ensure_ascii=False))
    explicit_subject = _explicit_player_subject(text)
    contextual_subject = _subject_from_context(context)
    if explicit_subject:
        resolved["subject"] = explicit_subject
    elif contextual_subject and _references_context_subject(text):
        resolved["subject"] = contextual_subject
    else:
        resolved["subject"] = {
            "type": "team",
            "ids": list(DEFAULT_TEAM["ids"]),
            "aliases": dict(DEFAULT_TEAM["aliases"]),
            "label": DEFAULT_TEAM["label"],
        }

    operation = resolved.get("operation")
    asks_match = bool(re.search(r"哪把|哪一把|哪局|哪一局|哪场|单局|比赛中|那场", str(text or "")))
    asks_player = bool(re.search(r"谁|哪个玩家|玩家|队友", str(text or "")))
    if operation == "report" and not _explicit_team_aggregate(text):
        resolved["groupBy"] = "player"
        resolved["metrics"] = list(dict.fromkeys(DEFAULT_REPORT_METRICS + list(resolved.get("metrics", []))))
        resolved["orderBy"] = {"metric": "kd", "direction": "desc"}
    elif resolved.get("subject", {}).get("type") == "player" and resolved.get("groupBy") == "team":
        resolved["groupBy"] = "player"

    if operation == "rank":
        if asks_match:
            resolved["groupBy"] = "match"
        elif asks_player or resolved.get("groupBy") not in {"player", "match"}:
            resolved["groupBy"] = "player"
        order_by = resolved.get("orderBy") if isinstance(resolved.get("orderBy"), dict) else {}
        metric = order_by.get("metric") or _match_metric(text) or "kd"
        resolved["orderBy"] = {
            "metric": metric,
            "direction": "asc" if metric == "rank" else "desc",
        }
    return resolved


def apply_context_resolver(
    query: dict[str, Any],
    *,
    text: str,
    context: dict[str, Any] | None,
) -> dict[str, Any]:
    resolved = json.loads(json.dumps(query, ensure_ascii=False))
    context = context or {}
    last_result_set_id = context.get("lastResultSetId")
    has_explicit_selector = bool(
        re.search(r"昨天|昨日|前天|大前天|今天|今日|上周|本周|最近\s*\d+|\d{1,4}\s*[年/月号日/-]", text, re.IGNORECASE)
    )
    if last_result_set_id and not has_explicit_selector and re.search(r"哪把|哪一把|哪局|哪一局|哪场|那场|刚才哪", text):
        metric = _match_metric(text) or resolved.get("orderBy", {}).get("metric") or "damage"
        resolved["operation"] = "rank"
        resolved["groupBy"] = "match"
        resolved["metrics"] = [metric]
        resolved["orderBy"] = {"metric": metric, "direction": "asc" if metric == "rank" else "desc"}
        resolved["limit"] = 1
        resolved["selector"] = {"type": "result_set", "resultSetId": str(last_result_set_id), "label": "上一次结果集"}
        resolved.setdefault("reference", {})["resultSetId"] = str(last_result_set_id)
    if resolved.get("operation") != "compare" and "前天" in text and re.search(r"跟|和|与|比", text) and context.get("lastSelectors"):
        resolved["operation"] = "compare"
        resolved["groupBy"] = resolved.get("groupBy") if resolved.get("groupBy") in {"team", "player"} else "team"
        resolved["segments"] = [
            {"label": "上一次查询范围", "selector": context["lastSelectors"]},
            {"label": "前天", "selector": {"type": "relative_period", "value": "前天"}},
        ]
        resolved["selector"] = context["lastSelectors"]
        if not resolved.get("metrics"):
            resolved["metrics"] = ["kd", "avg_damage", "kills", "damage"]
    return resolved


def repair_or_fallback(
    output: Any,
    *,
    text: str,
    session_id: str,
    query_id: str,
    context: dict[str, Any] | None = None,
    now: datetime | None = None,
    subject: dict[str, Any] | None = None,
) -> dict[str, Any]:
    try:
        parsed = parse_planner_output(output)
        if parsed.get("queryId") != query_id:
            parsed["queryId"] = query_id
        if parsed.get("sessionId") != session_id:
            parsed["sessionId"] = session_id
        return validate_query(parsed)
    except (ValueError, TypeError, KeyError):
        return build_query_from_text(
            text,
            session_id=session_id,
            query_id=query_id,
            context=context,
            now=now,
            subject=subject,
        )
