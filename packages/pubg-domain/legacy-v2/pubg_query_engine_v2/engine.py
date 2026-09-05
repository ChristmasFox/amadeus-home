from __future__ import annotations

import copy
import json
import math
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from .capabilities import CAPABILITY_REGISTRY
from .schema import QueryValidationError, validate_query
from .time_resolver import resolve_query_selectors, resolve_selector

ZONE = ZoneInfo("Asia/Shanghai")


def _number(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _integer(value: Any, default: int = 0) -> int:
    return int(round(_number(value, default)))


def _first(mapping: dict[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]
    return default


def _parse_timestamp(value: Any) -> int:
    if isinstance(value, (int, float)):
        number = int(value)
        return number if number > 10_000_000_000 else number * 1000
    if not value:
        return 0
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return 0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _iso_from_timestamp(timestamp: int, fallback: Any = None) -> str | None:
    if timestamp:
        return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).astimezone(ZONE).isoformat(timespec="seconds")
    if fallback:
        return str(fallback)
    return None


def normalize_player(raw: dict[str, Any]) -> dict[str, Any]:
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else raw
    rank_value = _first(stats, "rank", "winPlace", "win_place")
    rank = _integer(rank_value, 0) if rank_value not in (None, "") else None
    explicit_deaths = _first(stats, "deaths", "death", "died")
    if explicit_deaths is None:
        deaths = 1 if rank is not None and rank > 1 else 0
        death_semantics = "placement_proxy"
    else:
        deaths = _integer(explicit_deaths)
        death_semantics = "source_field"
    account_id = str(_first(raw, "accountId", "account_id", "id", default="")).strip()
    player_name = str(_first(raw, "playerName", "name", "displayName", default=account_id or "未知玩家"))
    return {
        "accountId": account_id,
        "playerName": player_name,
        "displayName": str(_first(raw, "displayName", "playerName", "name", default=player_name)),
        "rank": rank,
        "kills": _integer(_first(stats, "kills", "kill", default=0)),
        "assists": _integer(_first(stats, "assists", "assist", default=0)),
        "damage": _number(_first(stats, "damage", "damageDealt", "damage_dealt", default=0)),
        "dbnos": _integer(_first(stats, "dbnos", "DBNOs", "knockdowns", "knockdownsCount", default=0)),
        "revives": _integer(_first(stats, "revives", "revive", default=0)),
        "headshotKills": _integer(_first(stats, "headshotKills", "headshot_kills", default=0)),
        "survivalTime": _number(_first(stats, "survivalTime", "timeSurvived", "time_survived", default=0)),
        "longestKill": _number(_first(stats, "longestKill", "longest_kill", default=0)),
        "deaths": deaths,
        "deathSemantics": death_semantics,
    }


def normalize_match(raw: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    timestamp = _parse_timestamp(_first(raw, "timestamp", "createdAt", "created_at", default=0))
    created_at = _first(raw, "createdAt", "created_at") or _iso_from_timestamp(timestamp)
    players_raw = _first(raw, "players", "participants", "playerStats", default=[])
    if not isinstance(players_raw, list):
        players_raw = []
    players = [normalize_player(player) for player in players_raw if isinstance(player, dict)]
    match_id = str(_first(raw, "matchId", "match_id", "id", default="")).strip()
    game_mode = str(_first(raw, "gameMode", "game_mode", "mode", default=""))
    match_type = str(_first(raw, "matchType", "match_type", default="competitive"))
    is_competitive = bool(_first(raw, "isCompetitive", "is_competitive", default=game_mode not in {"arcade", "tdm", "normal"}))
    if match_type.lower() in {"arcade", "tdm", "normal", "bot"}:
        is_competitive = False
    return {
        "schemaVersion": int(_number(raw.get("schemaVersion", 2), 2)),
        "matchId": match_id,
        "shard": str(_first(raw, "shard", default="steam")),
        "createdAt": created_at,
        "timestamp": timestamp,
        "matchType": match_type,
        "gameMode": game_mode,
        "isCompetitive": is_competitive,
        "mapName": str(_first(raw, "mapName", "map", "map_name", default="未知地图")),
        "duration": _integer(_first(raw, "duration", "durationSeconds", default=0)),
        "patchVersion": str(_first(raw, "patchVersion", "patch_version", default="")),
        "players": players,
    }


def records_from_store_rows(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        payload = row.get("payload", row)
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                continue
        if not isinstance(payload, dict):
            continue
        record = normalize_match(payload)
        if not record.get("matchId"):
            continue
        if record["matchId"] in seen:
            continue
        seen.add(record["matchId"])
        records.append(record)
    return records


def _local_datetime(timestamp: int) -> datetime:
    if not timestamp:
        return datetime.fromtimestamp(0, tz=ZONE)
    return datetime.fromtimestamp(timestamp / 1000, tz=timezone.utc).astimezone(ZONE)


def _business_day_label(timestamp: int) -> str:
    local = _local_datetime(timestamp)
    day = local.date() if local.hour >= 6 else local.date() - timedelta(days=1)
    return day.isoformat()


def _metric_value(player: dict[str, Any], metric: str) -> float:
    if metric == "avg_damage":
        return _number(player.get("damage"))
    if metric == "kd":
        kills = _number(player.get("kills"))
        deaths = _number(player.get("deaths"))
        return kills / deaths if deaths else kills
    if metric == "matches":
        return 1
    if metric == "wins":
        explicit = player.get("wins")
        return _number(explicit) if explicit is not None else 1 if player.get("rank") == 1 else 0
    if metric == "top10":
        explicit = player.get("top10")
        return _number(explicit) if explicit is not None else 1 if player.get("rank") is not None and player.get("rank") <= 10 else 0
    field_map = {
        "damage": "damage",
        "kills": "kills",
        "assists": "assists",
        "deaths": "deaths",
        "rank": "rank",
        "dbnos": "dbnos",
        "revives": "revives",
        "headshot_kills": "headshotKills",
        "survival_time": "survivalTime",
        "longest_kill": "longestKill",
    }
    field = field_map.get(metric, metric)
    value = player.get(field)
    return _number(value) if value is not None else 0


def _safe_round(value: Any, digits: int = 2) -> int | float | None:
    if value is None:
        return None
    number = _number(value)
    if not math.isfinite(number):
        return None
    rounded = round(number, digits)
    return int(rounded) if float(rounded).is_integer() else rounded


class DeterministicQueryEngine:
    def __init__(self, *, timezone_name: str = "Asia/Shanghai") -> None:
        self.zone = ZoneInfo(timezone_name)

    def execute(
        self,
        query: dict[str, Any],
        records: Iterable[dict[str, Any]],
        *,
        coverage: dict[str, Any] | None = None,
        source: dict[str, Any] | None = None,
        result_sets: dict[str, dict[str, Any]] | None = None,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        try:
            validate_query(query)
        except QueryValidationError as exc:
            return self._status_result(query, "INVALID_QUERY", {"errors": exc.errors}, coverage, source)
        unsupported = query.get("reference", {}).get("unsupportedCapability")
        if unsupported:
            return self._status_result(
                query,
                "UNSUPPORTED_CAPABILITY",
                {"capability": unsupported, "supported": CAPABILITY_REGISTRY["supported_metrics"]},
                coverage,
                source,
            )
        referenced_selectors = [query.get("selector", {})]
        referenced_selectors.extend(
            segment.get("selector", {})
            for segment in query.get("segments", [])
            if isinstance(segment, dict)
        )
        available_result_sets = result_sets or {}
        for selector in referenced_selectors:
            if not isinstance(selector, dict) or selector.get("type") != "result_set":
                continue
            result_set_id = str(selector.get("resultSetId") or "")
            if result_set_id not in available_result_sets:
                return self._status_result(
                    query,
                    "INVALID_QUERY",
                    {
                        "code": "RESULT_SET_NOT_FOUND",
                        "resultSetId": result_set_id,
                        "errors": [f"ResultSet 不存在或已过期：{result_set_id}"],
                    },
                    coverage,
                    source,
                )
        resolved = resolve_query_selectors(query, now)
        normalized_records = [normalize_match(record) for record in records or []]
        normalized_records = [record for record in normalized_records if record.get("matchId")]
        subject = query.get("subject", {})
        subject_ids = {str(item) for item in subject.get("ids", [])}
        if subject.get("type") in {"player", "players"} and coverage and coverage.get("knownPlayerIds"):
            known = {str(item) for item in coverage["knownPlayerIds"]}
            unknown = sorted(subject_ids - known)
            if unknown:
                return self._status_result(query, "UNKNOWN_PLAYER", {"playerIds": unknown}, coverage, source)
        selected = self._select_matches(
            normalized_records,
            resolved.get("selector", {}),
            subject_ids,
            result_sets or {},
        )
        status = self._data_status(selected, coverage or {})
        if status in {"SOURCE_UNAVAILABLE", "COVERAGE_GAP"} and not selected:
            return self._status_result(query, status, {"rows": [], "matchIds": []}, coverage, source)
        if query["operation"] == "compare":
            data = self._compare(resolved, normalized_records, subject_ids, result_sets or {}, coverage or {})
        elif query["operation"] == "trend":
            data = self._trend(resolved, normalized_records, subject_ids, result_sets or {}, coverage or {})
        else:
            data = self._single_operation(resolved, selected, query["operation"])
        match_ids = self._evidence_match_ids(data, selected)
        player_ids = sorted({
            str(player.get("accountId"))
            for record in selected
            for player in record.get("players", [])
            if player.get("accountId") in subject_ids or not subject_ids
        })
        if not selected and status == "OK":
            status = "NO_MATCHES"
        if status == "OK" and (coverage or {}).get("status") in {"STALE", "PARTIAL"}:
            status = (coverage or {}).get("status")
        return {
            "status": status,
            "data": data,
            "coverage": copy.deepcopy(coverage or {}),
            "source": copy.deepcopy(source or {}),
            "evidence": {
                "matchIds": match_ids,
                "playerIds": player_ids,
                "recordCount": len(selected),
                "calculation": "deterministic_query_engine",
            },
            "queryId": query.get("queryId"),
            "sessionId": query.get("sessionId"),
        }

    def _status_result(
        self,
        query: dict[str, Any],
        status: str,
        data: dict[str, Any],
        coverage: dict[str, Any] | None,
        source: dict[str, Any] | None,
    ) -> dict[str, Any]:
        return {
            "status": status,
            "data": data,
            "coverage": copy.deepcopy(coverage or {}),
            "source": copy.deepcopy(source or {}),
            "evidence": {"matchIds": [], "playerIds": [], "recordCount": 0, "calculation": "none"},
            "queryId": query.get("queryId"),
            "sessionId": query.get("sessionId"),
        }

    def _data_status(self, selected: list[dict[str, Any]], coverage: dict[str, Any]) -> str:
        explicit = str(coverage.get("status", "")).upper()
        if explicit in {"SOURCE_UNAVAILABLE", "COVERAGE_GAP", "PARTIAL", "STALE", "OK", "NO_MATCHES"}:
            if explicit == "SOURCE_UNAVAILABLE" and selected:
                return "STALE"
            if explicit == "NO_MATCHES" and selected:
                return "OK"
            return explicit
        if coverage.get("sourceUnavailable"):
            return "STALE" if selected else "SOURCE_UNAVAILABLE"
        if coverage.get("complete") is False:
            return "PARTIAL" if selected else "COVERAGE_GAP"
        if coverage.get("failedMatchIds") and selected:
            return "PARTIAL"
        if coverage.get("failedMatchIds") and not selected:
            return "COVERAGE_GAP"
        return "OK"

    def _subject_players(self, record: dict[str, Any], subject_ids: set[str]) -> list[dict[str, Any]]:
        players = record.get("players", [])
        if not subject_ids:
            return [player for player in players if isinstance(player, dict)]
        return [player for player in players if str(player.get("accountId")) in subject_ids]

    def _select_matches(
        self,
        records: list[dict[str, Any]],
        selector: dict[str, Any],
        subject_ids: set[str],
        result_sets: dict[str, dict[str, Any]],
    ) -> list[dict[str, Any]]:
        competitive = [record for record in records if record.get("isCompetitive", True)]
        participating = [record for record in competitive if self._subject_players(record, subject_ids)]
        selector_type = selector.get("type")
        if selector_type == "result_set":
            result_set = result_sets.get(str(selector.get("resultSetId")))
            ids = set(str(item) for item in (result_set or {}).get("matchIds", []))
            if result_set is None:
                return []
            return [record for record in participating if record.get("matchId") in ids]
        if selector_type == "time_range":
            start = self._timestamp(selector.get("start"))
            end = self._timestamp(selector.get("end"))
            return [record for record in participating if start <= int(record.get("timestamp", 0)) < end]
        if selector_type == "last_n_matches":
            ordered = sorted(participating, key=lambda record: (int(record.get("timestamp", 0)), str(record.get("matchId"))), reverse=True)
            offset = max(0, _integer(selector.get("offset", 0)))
            count = max(0, _integer(selector.get("count", 0)))
            return ordered[offset : offset + count]
        if selector_type == "recent_days":
            return participating
        if selector_type == "relative_period":
            resolved = resolve_selector(selector)
            return self._select_matches(records, resolved, subject_ids, result_sets)
        return participating

    def _timestamp(self, value: Any) -> int:
        return _parse_timestamp(value)

    def _single_operation(self, query: dict[str, Any], selected: list[dict[str, Any]], operation: str) -> dict[str, Any]:
        group_by = query.get("groupBy", "team")
        rows = self._group(selected, query.get("subject", {}), group_by)
        if operation == "rank":
            order = query.get("orderBy", {})
            metric = order.get("metric") or (query.get("metrics") or ["kills"])[0]
            direction = order.get("direction", "desc")
            rows.sort(key=lambda row: self._sort_value(row.get("metrics", {}).get(metric), direction), reverse=True)
            limit = query.get("limit") or len(rows)
            rows = rows[:limit]
            for index, row in enumerate(rows, 1):
                row["position"] = index
            return {"operation": "rank", "groupBy": group_by, "metric": metric, "direction": direction, "rows": rows, "summary": rows[0] if rows else None}
        if operation == "list":
            rows.sort(key=lambda row: int(row.get("timestamp", 0)), reverse=True)
            limit = query.get("limit") or 20
            return {"operation": "list", "groupBy": group_by, "rows": rows[:limit], "summary": {"matches": len(rows)}}
        order_by = query.get("orderBy", {}) if isinstance(query.get("orderBy"), dict) else {}
        report_metric = order_by.get("metric")
        if report_metric:
            direction = order_by.get("direction", "desc")
            if direction == "asc":
                rows.sort(
                    key=lambda row: (
                        _number(row.get("metrics", {}).get(report_metric), math.inf),
                        str(row.get("label", "")),
                    )
                )
            else:
                rows.sort(
                    key=lambda row: (
                        -_number(row.get("metrics", {}).get(report_metric), -math.inf),
                        str(row.get("label", "")),
                    )
                )
        else:
            rows.sort(key=lambda row: (str(row.get("label", "")), str(row.get("matchId", ""))))
        summary = rows[0].get("metrics", {}) if group_by == "team" and rows else self._summary_for_rows(rows, query.get("metrics", []))
        return {"operation": "report", "groupBy": group_by, "rows": rows, "summary": summary}

    def _sort_value(self, value: Any, direction: str) -> tuple[int, float]:
        number = _number(value, -math.inf if direction == "desc" else math.inf)
        if direction == "asc":
            return (0, -number if math.isfinite(number) else -math.inf)
        return (0, number if math.isfinite(number) else -math.inf)

    def _group(self, selected: list[dict[str, Any]], subject: dict[str, Any], group_by: str) -> list[dict[str, Any]]:
        subject_ids = {str(item) for item in subject.get("ids", [])}
        if group_by == "match":
            return [self._aggregate_match(record, self._subject_players(record, subject_ids)) for record in selected]
        buckets: dict[str, list[tuple[dict[str, Any], list[dict[str, Any]]]]] = defaultdict(list)
        for record in selected:
            players = self._subject_players(record, subject_ids)
            if not players:
                continue
            if group_by == "player":
                for player in players:
                    key = str(player.get("accountId") or player.get("playerName"))
                    buckets[key].append((record, [player]))
            elif group_by == "day":
                buckets[_business_day_label(int(record.get("timestamp", 0)))].append((record, players))
            else:
                buckets["team"].append((record, players))
        rows: list[dict[str, Any]] = []
        for key, values in buckets.items():
            rows.append(self._aggregate_bucket(key, values, group_by))
        if group_by == "player" and selected and subject.get("type") == "team":
            aliases = subject.get("aliases", {}) if isinstance(subject.get("aliases"), dict) else {}
            labels_by_id = {str(account_id): str(label) for label, account_id in aliases.items()}
            existing_ids = set(buckets)
            for account_id in subject_ids - existing_ids:
                rows.append(self._empty_player_row(account_id, labels_by_id.get(account_id, account_id)))
        return rows

    def _empty_player_row(self, account_id: str, label: str) -> dict[str, Any]:
        return {
            "label": label,
            "key": account_id,
            "timestamp": None,
            "metrics": {
                "matches": 0,
                "kills": 0,
                "assists": 0,
                "damage": 0,
                "avg_damage": 0,
                "kd": 0,
                "deaths": 0,
                "wins": 0,
                "top10": 0,
                "rank": None,
                "dbnos": 0,
                "revives": 0,
                "headshot_kills": 0,
                "survival_time": 0,
                "longest_kill": 0,
            },
        }

    def _aggregate_match(self, record: dict[str, Any], players: list[dict[str, Any]]) -> dict[str, Any]:
        metrics = self._aggregate_metrics([(record, players)], match_level=True)
        return {
            "label": str(record.get("matchId")),
            "matchId": record.get("matchId"),
            "timestamp": record.get("timestamp", 0),
            "createdAt": record.get("createdAt"),
            "map": record.get("mapName"),
            "mode": record.get("gameMode"),
            "duration": record.get("duration", 0),
            "patchVersion": record.get("patchVersion"),
            "players": copy.deepcopy(players),
            "metrics": metrics,
        }

    def _aggregate_bucket(
        self,
        key: str,
        values: list[tuple[dict[str, Any], list[dict[str, Any]]]],
        group_by: str,
    ) -> dict[str, Any]:
        metrics = self._aggregate_metrics(values)
        first_record = values[0][0]
        player_name = ""
        if group_by == "player":
            player_name = values[0][1][0].get("displayName") or values[0][1][0].get("playerName") or key
        return {
            "label": player_name or key,
            "key": key,
            "timestamp": first_record.get("timestamp", 0) if group_by == "day" else None,
            "metrics": metrics,
        }

    def _aggregate_metrics(
        self,
        values: list[tuple[dict[str, Any], list[dict[str, Any]]]],
        *,
        match_level: bool = False,
    ) -> dict[str, Any]:
        match_ids = {str(record.get("matchId")) for record, _ in values if record.get("matchId")}
        all_players = [player for _, players in values for player in players]
        result: dict[str, Any] = {"matches": len(match_ids)}
        sum_fields = ("kills", "assists", "damage", "deaths", "dbnos", "revives", "headshotKills", "survivalTime")
        for field in sum_fields:
            total = sum(_number(player.get(field)) for player in all_players)
            result[self._metric_from_field(field)] = _safe_round(total)
        record_ranks = []
        for record, players in values:
            ranks = [_number(player.get("rank")) for player in players if player.get("rank") not in (None, "", 0)]
            if ranks:
                record_ranks.append(min(ranks))
        if match_level:
            result["rank"] = _safe_round(min(record_ranks) if record_ranks else None)
        else:
            result["rank"] = _safe_round(sum(record_ranks) / len(record_ranks) if record_ranks else None)
        wins = sum(1 for rank in record_ranks if rank == 1)
        top10 = sum(1 for rank in record_ranks if rank <= 10)
        result["wins"] = wins
        result["top10"] = top10
        result["longest_kill"] = _safe_round(max((_number(player.get("longestKill")) for player in all_players), default=0))
        result["avg_damage"] = _safe_round(_number(result.get("damage")) / len(match_ids) if match_ids else 0)
        deaths = _number(result.get("deaths"))
        kills = _number(result.get("kills"))
        result["kd"] = _safe_round(kills / deaths if deaths else kills)
        return result

    @staticmethod
    def _metric_from_field(field: str) -> str:
        return {
            "headshotKills": "headshot_kills",
            "survivalTime": "survival_time",
        }.get(field, field)

    def _summary_for_rows(self, rows: list[dict[str, Any]], metrics: list[str]) -> dict[str, Any]:
        summary: dict[str, Any] = {"matches": len(rows)}
        for metric in metrics:
            values = [row.get("metrics", {}).get(metric) for row in rows]
            numeric = [_number(value) for value in values if value is not None]
            if metric in {"rank", "avg_damage", "kd"}:
                summary[metric] = _safe_round(sum(numeric) / len(numeric) if numeric else 0)
            elif metric == "longest_kill":
                summary[metric] = _safe_round(max(numeric, default=0))
            else:
                summary[metric] = _safe_round(sum(numeric))
        return summary

    def _compare(
        self,
        query: dict[str, Any],
        records: list[dict[str, Any]],
        subject_ids: set[str],
        result_sets: dict[str, dict[str, Any]],
        coverage: dict[str, Any],
    ) -> dict[str, Any]:
        segments: list[dict[str, Any]] = []
        for segment in query.get("segments", []):
            selected = self._select_matches(records, segment.get("selector", {}), subject_ids, result_sets)
            rows = self._group(selected, query.get("subject", {}), query.get("groupBy", "team"))
            summary = rows[0].get("metrics", {}) if query.get("groupBy") == "team" and rows else self._summary_for_rows(rows, query.get("metrics", []))
            segments.append({"label": segment.get("label"), "selector": segment.get("selector"), "rows": rows, "summary": summary, "matchIds": [record.get("matchId") for record in selected]})
        delta: dict[str, Any] = {}
        if len(segments) == 2:
            left = segments[0].get("summary", {})
            right = segments[1].get("summary", {})
            for metric in query.get("metrics", []):
                if left.get(metric) is not None and right.get(metric) is not None:
                    delta[metric] = _safe_round(_number(left.get(metric)) - _number(right.get(metric)))
        return {"operation": "compare", "groupBy": query.get("groupBy"), "segments": segments, "delta": delta}

    def _trend(
        self,
        query: dict[str, Any],
        records: list[dict[str, Any]],
        subject_ids: set[str],
        result_sets: dict[str, dict[str, Any]],
        coverage: dict[str, Any],
    ) -> dict[str, Any]:
        selected = self._select_matches(records, query.get("selector", {}), subject_ids, result_sets)
        rows = self._group(selected, query.get("subject", {}), "day")
        rows.sort(key=lambda row: str(row.get("key", "")))
        changes: dict[str, Any] = {}
        direction: dict[str, str] = {}
        first = rows[0].get("metrics", {}) if rows else {}
        last = rows[-1].get("metrics", {}) if rows else {}
        for metric in query.get("metrics", []):
            if first.get(metric) is None or last.get(metric) is None:
                continue
            change = _safe_round(_number(last.get(metric)) - _number(first.get(metric)))
            changes[metric] = change
            direction[metric] = "up" if change > 0 else "down" if change < 0 else "stable"
        return {"operation": "trend", "groupBy": "day", "rows": rows, "change": changes, "direction": direction}

    def _evidence_match_ids(self, data: dict[str, Any], selected: list[dict[str, Any]]) -> list[str]:
        ids: list[str] = []
        if isinstance(data, dict):
            for row in data.get("rows", []):
                if isinstance(row, dict) and row.get("matchId"):
                    ids.append(str(row["matchId"]))
        for record in selected:
            if record.get("matchId"):
                ids.append(str(record["matchId"]))
        for segment in data.get("segments", []) if isinstance(data, dict) else []:
            ids.extend(str(item) for item in segment.get("matchIds", []) if item)
        return list(dict.fromkeys(ids))


def build_result_set(
    query: dict[str, Any],
    result: dict[str, Any],
    *,
    now: datetime | None = None,
    ttl: timedelta = timedelta(hours=12),
) -> dict[str, Any]:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    result_set_id = f"rs_{uuid.uuid4().hex[:20]}"
    evidence = result.get("evidence", {})
    data = result.get("data", {})
    rows = data.get("rows", []) if isinstance(data, dict) else []
    compact_rows = copy.deepcopy(rows)
    if isinstance(data, dict) and data.get("segments"):
        compact_rows = copy.deepcopy(data.get("segments"))
    return {
        "id": result_set_id,
        "queryId": query.get("queryId"),
        "sessionId": query.get("sessionId"),
        "query": copy.deepcopy(query),
        "matchIds": list(evidence.get("matchIds", [])),
        "playerIds": list(evidence.get("playerIds", [])),
        "rows": compact_rows,
        "summary": copy.deepcopy(data.get("summary", {})) if isinstance(data, dict) else {},
        "status": result.get("status"),
        "createdAt": current.isoformat(timespec="seconds"),
        "expiresAt": (current + ttl).isoformat(timespec="seconds"),
    }
