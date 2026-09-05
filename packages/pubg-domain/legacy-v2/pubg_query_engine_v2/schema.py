from __future__ import annotations

import copy
import re
from typing import Any

from .capabilities import CAPABILITY_REGISTRY

QUERY_VERSION = 1
OPERATIONS = set(CAPABILITY_REGISTRY["supported_operations"])
SELECTOR_TYPES = set(CAPABILITY_REGISTRY["supported_selectors"])
GROUPS = set(CAPABILITY_REGISTRY["supported_groups"])
METRICS = set(CAPABILITY_REGISTRY["supported_metrics"])
SUBJECT_TYPES = {"team", "player", "players"}


class QueryValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def _is_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _validate_selector(selector: Any, path: str, errors: list[str]) -> None:
    if not isinstance(selector, dict):
        errors.append(f"{path} must be an object")
        return
    selector_type = selector.get("type")
    if selector_type not in SELECTOR_TYPES:
        errors.append(f"{path}.type must be one of {sorted(SELECTOR_TYPES)}")
        return
    if selector_type == "time_range":
        for key in ("start", "end"):
            if not _is_string(selector.get(key)):
                errors.append(f"{path}.{key} is required")
        if selector.get("start") and selector.get("end") and str(selector["start"]) >= str(selector["end"]):
            errors.append(f"{path}.start must be before {path}.end")
    elif selector_type == "last_n_matches":
        count = selector.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1 or count > 1000:
            errors.append(f"{path}.count must be an integer from 1 to 1000")
    elif selector_type == "recent_days":
        count = selector.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 1 or count > 366:
            errors.append(f"{path}.count must be an integer from 1 to 366")
    elif selector_type == "relative_period":
        if not _is_string(selector.get("value")):
            errors.append(f"{path}.value is required")
    elif selector_type == "result_set":
        if not _is_string(selector.get("resultSetId")):
            errors.append(f"{path}.resultSetId is required")


def _validate_segment(segment: Any, path: str, errors: list[str]) -> None:
    if not isinstance(segment, dict):
        errors.append(f"{path} must be an object")
        return
    if not _is_string(segment.get("label")):
        errors.append(f"{path}.label is required")
    _validate_selector(segment.get("selector"), f"{path}.selector", errors)


def validate_query(query: dict[str, Any], *, raise_error: bool = True) -> dict[str, Any]:
    errors: list[str] = []
    if not isinstance(query, dict):
        raise QueryValidationError(["query must be an object"])
    required = (
        "version",
        "domain",
        "queryId",
        "sessionId",
        "subject",
        "operation",
        "selector",
        "segments",
        "groupBy",
        "metrics",
        "filters",
        "orderBy",
        "limit",
        "reference",
        "presentation",
    )
    for key in required:
        if key not in query:
            errors.append(f"missing required field: {key}")
    if query.get("version") != QUERY_VERSION:
        errors.append("version must be 1")
    if query.get("domain") != "pubg":
        errors.append("domain must be pubg")
    for key in ("queryId", "sessionId"):
        if not _is_string(query.get(key)):
            errors.append(f"{key} must be a non-empty string")
    subject = query.get("subject")
    if not isinstance(subject, dict):
        errors.append("subject must be an object")
    else:
        if subject.get("type") not in SUBJECT_TYPES:
            errors.append("subject.type must be team, player, or players")
        if not isinstance(subject.get("ids"), list):
            errors.append("subject.ids must be an array")
        elif subject.get("type") != "team" and not subject["ids"]:
            errors.append("subject.ids cannot be empty for player subjects")
        elif any(not _is_string(item) for item in subject.get("ids", [])):
            errors.append("subject.ids must contain non-empty strings")
    operation = query.get("operation")
    if operation not in OPERATIONS:
        errors.append(f"operation must be one of {sorted(OPERATIONS)}")
    _validate_selector(query.get("selector"), "selector", errors)
    segments = query.get("segments")
    if not isinstance(segments, list):
        errors.append("segments must be an array")
        segments = []
    for index, segment in enumerate(segments):
        _validate_segment(segment, f"segments[{index}]", errors)
    if operation == "compare" and len(segments) != 2:
        errors.append("compare requires exactly two segments")
    if operation != "compare" and segments:
        errors.append("segments are only valid for compare")
    if query.get("groupBy") not in GROUPS:
        errors.append(f"groupBy must be one of {sorted(GROUPS)}")
    metrics = query.get("metrics")
    if not isinstance(metrics, list) or not metrics:
        errors.append("metrics must be a non-empty array")
    else:
        for metric in metrics:
            if metric not in METRICS:
                errors.append(f"unsupported metric: {metric}")
    if not isinstance(query.get("filters"), dict):
        errors.append("filters must be an object")
    if not isinstance(query.get("orderBy"), dict):
        errors.append("orderBy must be an object")
    limit = query.get("limit")
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 1000):
        errors.append("limit must be null or an integer from 1 to 1000")
    if not isinstance(query.get("reference"), dict):
        errors.append("reference must be an object")
    if not isinstance(query.get("presentation"), dict):
        errors.append("presentation must be an object")
    if operation == "rank":
        metric = query.get("orderBy", {}).get("metric") if isinstance(query.get("orderBy"), dict) else None
        if metric not in METRICS:
            errors.append("rank requires orderBy.metric")
        direction = query.get("orderBy", {}).get("direction") if isinstance(query.get("orderBy"), dict) else None
        if direction not in {"asc", "desc"}:
            errors.append("rank requires orderBy.direction asc or desc")
    if errors and raise_error:
        raise QueryValidationError(errors)
    result = copy.deepcopy(query)
    result.setdefault("queryId", "")
    return result


def query_template(
    *,
    query_id: str,
    session_id: str,
    subject: dict[str, Any],
    operation: str,
    selector: dict[str, Any],
    group_by: str,
    metrics: list[str],
    segments: list[dict[str, Any]] | None = None,
    filters: dict[str, Any] | None = None,
    order_by: dict[str, Any] | None = None,
    limit: int | None = None,
    reference: dict[str, Any] | None = None,
    presentation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    query = {
        "version": QUERY_VERSION,
        "domain": "pubg",
        "queryId": query_id,
        "sessionId": session_id,
        "subject": subject,
        "operation": operation,
        "selector": selector,
        "segments": segments or [],
        "groupBy": group_by,
        "metrics": list(dict.fromkeys(metrics)),
        "filters": filters or {"mode": "competitive"},
        "orderBy": order_by or {},
        "limit": limit,
        "reference": reference or {},
        "presentation": presentation or {},
    }
    return query


def normalize_alias(value: str) -> str:
    return re.sub(r"\s+", "", str(value).strip().lower())
