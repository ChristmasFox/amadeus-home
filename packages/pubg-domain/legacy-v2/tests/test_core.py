from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pubg_query_engine_v2.context import (
    InMemoryContextStore,
    build_session_id,
    context_key,
    load_context,
    load_result_set,
    save_context,
    save_result_set,
)
from pubg_query_engine_v2.engine import DeterministicQueryEngine, build_result_set
from pubg_query_engine_v2.planner import (
    apply_context_resolver,
    build_query_from_text,
    is_pubg_query,
    parse_planner_output,
)
from pubg_query_engine_v2.renderer import render_result
from pubg_query_engine_v2.schema import QueryValidationError, validate_query
from pubg_query_engine_v2.time_resolver import resolve_query_selectors, resolve_text_selector


ZONE = ZoneInfo("Asia/Shanghai")
NOW = datetime(2026, 9, 1, 12, 0, tzinfo=ZONE)
EARLY_MORNING = datetime(2026, 9, 1, 2, 0, tzinfo=ZONE)
TEAM_IDS = [
    "account.29044012052444c0848d617ba100fe1e",
    "account.a22ea4bce333448e9cce807cebd7f4bf",
]


def player(account_id: str, name: str, rank: int, kills: int, damage: int) -> dict:
    return {
        "accountId": account_id,
        "playerName": name,
        "rank": rank,
        "kills": kills,
        "assists": 1,
        "damage": damage,
        "dbnos": 1,
        "revives": 1,
        "headshotKills": 0,
        "survivalTime": 900,
        "longestKill": 100,
    }


def match(match_id: str, created_at: str, first: tuple[int, int], second: tuple[int, int], competitive: bool = True) -> dict:
    return {
        "schemaVersion": 2,
        "matchId": match_id,
        "shard": "steam",
        "createdAt": created_at,
        "matchType": "competitive" if competitive else "arcade",
        "gameMode": "squad-fpp",
        "isCompetitive": competitive,
        "mapName": "Erangel",
        "duration": 1200,
        "patchVersion": "test",
        "players": [
            player(TEAM_IDS[0], "SG_LabmemNo007", first[0], first[1], first[1] * 100),
            player(TEAM_IDS[1], "SG_LabmemNo008", second[0], second[1], second[1] * 80),
        ],
    }


RECORDS = [
    match("m-0831-1", "2026-08-31T07:00:00+08:00", (2, 5), (2, 2)),
    match("m-0831-2", "2026-08-31T23:00:00+08:00", (1, 3), (1, 6)),
    match("m-0830-1", "2026-08-30T12:00:00+08:00", (3, 1), (3, 1)),
    match("m-0829-1", "2026-08-29T10:00:00+08:00", (1, 8), (1, 4)),
    match("m-0831-arcade", "2026-08-31T08:00:00+08:00", (1, 99), (1, 99), competitive=False),
]


def query(text: str, *, context: dict | None = None, query_id: str = "q_test") -> dict:
    return build_query_from_text(text, session_id="session-a", query_id=query_id, context=context, now=NOW, subject={"type": "team", "ids": TEAM_IDS})


class TimeResolverTests(unittest.TestCase):
    def test_business_day_and_relative_dates(self):
        self.assertEqual(resolve_text_selector("今天", NOW)["start"], "2026-09-01T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("昨天", NOW)["start"], "2026-08-31T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("前天", NOW)["start"], "2026-08-30T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("大前天战绩", NOW)["start"], "2026-08-29T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("3天前战绩", NOW)["start"], "2026-08-29T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("上周六", NOW)["start"], "2026-08-29T06:00:00+08:00")

    def test_date_and_clock(self):
        resolved = resolve_text_selector("8月20号晚上10点以后", NOW)
        self.assertEqual(resolved["start"], "2026-08-20T22:00:00+08:00")
        self.assertEqual(resolved["end"], "2026-08-21T06:00:00+08:00")
        self.assertEqual(resolve_text_selector("8月20日晚10点以后", NOW)["start"], "2026-08-20T22:00:00+08:00")
        self.assertEqual(resolve_text_selector("昨晚", NOW)["start"], "2026-08-31T18:00:00+08:00")
        self.assertEqual(
            resolve_text_selector("昨晚", EARLY_MORNING)["start"],
            "2026-08-31T18:00:00+08:00",
        )
        self.assertEqual(
            resolve_text_selector("昨晚", EARLY_MORNING)["end"],
            "2026-09-01T06:00:00+08:00",
        )
        self.assertEqual(resolve_text_selector("晚上10点以后", NOW)["start"], "2026-09-01T22:00:00+08:00")
        self.assertEqual(resolve_text_selector("8/20", NOW)["start"], "2026-08-20T06:00:00+08:00")

    def test_recent_days_and_query_resolution(self):
        resolved = resolve_text_selector("最近7天", NOW)
        self.assertEqual(resolved["type"], "recent_days")
        self.assertEqual(resolve_query_selectors(query("最近7天"), NOW)["selector"]["start"], "2026-08-26T06:00:00+08:00")
        past = query("过去7天战绩")
        self.assertEqual(past["selector"], {"type": "recent_days", "count": 7, "label": "过去7天"})
        self.assertEqual(resolve_query_selectors(past, NOW)["selector"]["start"], "2026-08-26T06:00:00+08:00")
        self.assertEqual(query("昨晚")["selector"]["type"], "relative_period")
        self.assertEqual(query("晚上10点以后")["selector"]["type"], "relative_period")


class PlannerAndSchemaTests(unittest.TestCase):
    def test_default_report_uses_four_player_team_and_kd_order(self):
        planned = query("查询小队四人战绩")
        self.assertEqual(planned["subject"]["type"], "team")
        self.assertEqual(len(planned["subject"]["ids"]), 4)
        self.assertEqual(planned["groupBy"], "player")
        self.assertEqual(planned["orderBy"], {"metric": "kd", "direction": "desc"})
        self.assertEqual(planned["subject"]["ids"][0], "account.29044012052444c0848d617ba100fe1e")

    def test_explicit_player_overrides_default_team(self):
        planned = query("SG_LabmemNo007 昨天战绩")
        self.assertEqual(planned["subject"], {"type": "player", "ids": [TEAM_IDS[0]]})
        self.assertEqual(planned["groupBy"], "player")

    def test_match_and_player_semantics(self):
        match_query = query("昨天哪一把伤害最高？")
        self.assertEqual(match_query["operation"], "rank")
        self.assertEqual(match_query["groupBy"], "match")
        self.assertEqual(match_query["orderBy"], {"metric": "damage", "direction": "desc"})
        short_match_query = query("最近20场哪把杀人最多？")
        self.assertEqual(short_match_query["operation"], "rank")
        self.assertEqual(short_match_query["groupBy"], "match")
        self.assertEqual(short_match_query["orderBy"], {"metric": "kills", "direction": "desc"})
        player_query = query("最近20场表现最好的是谁？")
        self.assertEqual(player_query["operation"], "rank")
        self.assertEqual(player_query["groupBy"], "player")

    def test_context_resolver_uses_previous_result_set_for_match_follow_up(self):
        previous = query("昨天战绩怎么样？", query_id="q_previous")
        context = {
            "activeDomain": "pubg",
            "lastResultSetId": "rs_previous",
            "lastSelectors": previous["selector"],
        }
        follow_up = query("哪把伤害最高？", context=context, query_id="q_follow_up")
        resolved = apply_context_resolver(follow_up, text="哪把伤害最高？", context=context)
        self.assertEqual(resolved["selector"], {"type": "result_set", "resultSetId": "rs_previous", "label": "上一次结果集"})
        self.assertEqual(resolved["groupBy"], "match")
        self.assertEqual(resolved["operation"], "rank")

    def test_context_subject_is_carried_to_pronoun_follow_up(self):
        context = {
            "activeDomain": "pubg",
            "subject": {"type": "player", "ids": [TEAM_IDS[0]]},
        }
        follow_up = build_query_from_text("他呢？", session_id="session-a", query_id="q_subject_follow_up", context=context, now=NOW)
        self.assertEqual(follow_up["subject"], {"type": "player", "ids": TEAM_IDS[:1]})

    def test_context_resolver_builds_two_segment_compare(self):
        previous = query("昨天战绩怎么样？", query_id="q_previous")
        context = {"activeDomain": "pubg", "lastSelectors": previous["selector"]}
        follow_up = query("跟前天比呢？", context=context, query_id="q_compare")
        resolved = apply_context_resolver(follow_up, text="跟前天比呢？", context=context)
        self.assertEqual(resolved["operation"], "compare")
        self.assertEqual(len(resolved["segments"]), 2)
        self.assertEqual(resolved["segments"][0]["selector"], previous["selector"])

    def test_compare_and_trend(self):
        compare = query("昨天 vs 前天怎么样？")
        self.assertEqual(compare["operation"], "compare")
        self.assertEqual(len(compare["segments"]), 2)
        trend = query("最近7天状态是不是变好了？")
        self.assertEqual(trend["operation"], "trend")
        self.assertEqual(trend["groupBy"], "day")

    def test_unsupported_capability_is_not_a_metric(self):
        unsupported = query("昨天哪把用什么枪？")
        self.assertEqual(unsupported["reference"]["unsupportedCapability"], "weapon")
        self.assertNotIn("weapon", unsupported["metrics"])

    def test_strict_json_validation(self):
        validate_query(query("今天战绩"))
        with self.assertRaises(QueryValidationError):
            parse_planner_output("not-json")
        with self.assertRaises(QueryValidationError):
            validate_query({"version": 1})

    def test_domain_detection_and_followup(self):
        self.assertTrue(is_pubg_query("查询今日战绩"))
        self.assertFalse(is_pubg_query("今天上海天气"))
        self.assertTrue(is_pubg_query("哪一把？", {"activeDomain": "pubg"}))


class DeterministicEngineTests(unittest.TestCase):
    def setUp(self):
        self.engine = DeterministicQueryEngine()
        self.coverage = {"status": "OK", "complete": True, "knownPlayerIds": TEAM_IDS}
        self.source = {"store": "fixture", "syncTriggered": False}

    def test_match_level_rank(self):
        result = self.engine.execute(query("昨天哪一把伤害最高？"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["data"]["groupBy"], "match")
        self.assertEqual(result["data"]["rows"][0]["matchId"], "m-0831-2")
        self.assertIn("createdAt", result["data"]["rows"][0])
        self.assertIn("players", result["data"]["rows"][0])

    def test_team_outcome_metrics_count_once_per_match(self):
        result = self.engine.execute(query("昨天小队总计战绩怎么样？"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        summary = result["data"]["summary"]
        self.assertEqual(summary["matches"], 2)
        self.assertEqual(summary["wins"], 1)
        self.assertEqual(summary["top10"], 2)

    def test_player_rank_and_last_n(self):
        result = self.engine.execute(query("最近20场表现最好的是谁？"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        self.assertEqual(result["data"]["groupBy"], "player")
        self.assertEqual(result["data"]["rows"][0]["label"], "SG_LabmemNo007")

    def test_default_report_contains_all_four_players(self):
        result = self.engine.execute(query("查询昨天小队四人战绩"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        self.assertEqual(result["status"], "OK")
        self.assertEqual(result["data"]["groupBy"], "player")
        self.assertEqual(
            [row["label"] for row in result["data"]["rows"]],
            ["SG_LabmemNo007", "SG_LabmemNo008", "SG_LabmemNo004", "kim_kkl"],
        )

    def test_default_report_renderer_is_aligned_comparison_table(self):
        planned = query("查询昨天小队四人战绩")
        result = self.engine.execute(planned, RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        rendered = render_result(planned, result)
        self.assertIn("PUBG 战绩（按 KD 降序）", rendered)
        self.assertIn("排名", rendered)
        self.assertIn("KD", rendered)
        self.assertIn("SG_LabmemNo007", rendered)
        self.assertIn("SG_LabmemNo008", rendered)
        self.assertIn("SG_LabmemNo004", rendered)
        self.assertIn("kim_kkl", rendered)
        self.assertLess(rendered.index("SG_LabmemNo007"), rendered.index("SG_LabmemNo008"))

    def test_kd_display_uses_exactly_one_decimal(self):
        planned = query("查询昨天小队四人战绩")
        result = self.engine.execute(planned, RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        rendered = render_result(planned, result)
        self.assertRegex(rendered, r"KD")
        self.assertIn("8.0", rendered)
        self.assertNotRegex(rendered, r"KD[^\n]*\d+\.\d{2}")

    def test_compare_and_trend_are_deterministic(self):
        compare = self.engine.execute(query("昨天 vs 前天怎么样？"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        self.assertEqual(compare["data"]["operation"], "compare")
        self.assertEqual(len(compare["data"]["segments"]), 2)
        trend = self.engine.execute(query("最近7天状态是不是变好了？"), RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        self.assertEqual(trend["data"]["operation"], "trend")
        self.assertIn("direction", trend["data"])

    def test_result_set_followup(self):
        first_query = query("昨天战绩怎么样？", query_id="q_first")
        first = self.engine.execute(first_query, RECORDS, coverage=self.coverage, source=self.source, now=NOW)
        result_set = build_result_set(first_query, first, now=NOW)
        follow_context = {"activeDomain": "pubg", "lastResultSetId": result_set["id"], "lastSelectors": first_query["selector"]}
        follow_query = query("哪一把伤害最高？", context=follow_context, query_id="q_follow")
        self.assertEqual(follow_query["selector"]["type"], "result_set")
        second = self.engine.execute(follow_query, RECORDS, coverage=self.coverage, source=self.source, result_sets={result_set["id"]: result_set}, now=NOW)
        self.assertEqual(second["data"]["groupBy"], "match")
        self.assertEqual(second["evidence"]["matchIds"], ["m-0831-2", "m-0831-1"])

    def test_missing_result_set_is_not_no_matches(self):
        follow_up = query("哪一把伤害最高？", query_id="q_missing_result_set")
        follow_up["selector"] = {
            "type": "result_set",
            "resultSetId": "rs_missing",
            "label": "上一次结果集",
        }
        follow_up["reference"] = {"resultSetId": "rs_missing"}
        result = self.engine.execute(
            follow_up,
            RECORDS,
            coverage=self.coverage,
            source=self.source,
            result_sets={},
            now=NOW,
        )
        self.assertEqual(result["status"], "INVALID_QUERY")
        self.assertEqual(result["data"]["code"], "RESULT_SET_NOT_FOUND")

    def test_status_semantics(self):
        no_matches = self.engine.execute(query("8月20号战绩"), [], coverage={"status": "OK", "complete": True}, now=NOW)
        self.assertEqual(no_matches["status"], "NO_MATCHES")
        gap = self.engine.execute(query("8月20号战绩"), [], coverage={"complete": False}, now=NOW)
        self.assertEqual(gap["status"], "COVERAGE_GAP")
        unavailable = self.engine.execute(query("8月20号战绩"), [], coverage={"sourceUnavailable": True}, now=NOW)
        self.assertEqual(unavailable["status"], "SOURCE_UNAVAILABLE")
        partial = self.engine.execute(query("昨天战绩"), RECORDS, coverage={"status": "PARTIAL", "complete": False, "failedMatchIds": ["m-x"]}, now=NOW)
        self.assertEqual(partial["status"], "PARTIAL")
        stale = self.engine.execute(query("昨天战绩"), RECORDS, coverage={"status": "SOURCE_UNAVAILABLE", "complete": False}, now=NOW)
        self.assertEqual(stale["status"], "STALE")
        unavailable_with_no_local = self.engine.execute(query("昨天战绩"), [], coverage={"status": "SOURCE_UNAVAILABLE", "complete": False}, now=NOW)
        self.assertEqual(unavailable_with_no_local["status"], "SOURCE_UNAVAILABLE")
        unsupported = self.engine.execute(query("昨天用什么枪？"), RECORDS, coverage=self.coverage, now=NOW)
        self.assertEqual(unsupported["status"], "UNSUPPORTED_CAPABILITY")

    def test_renderer_does_not_answer_from_missing_data(self):
        result = self.engine.execute(query("8月20号战绩"), [], coverage={"complete": False}, now=NOW)
        rendered = render_result(query("8月20号战绩"), result)
        self.assertIn("覆盖不足", rendered)


class ContextTests(unittest.TestCase):
    def test_session_identity_includes_sender(self):
        first = build_session_id(platform="kook", launcher_type="group", launcher_id="g", sender_id="a")
        second = build_session_id(platform="kook", launcher_type="group", launcher_id="g", sender_id="b")
        self.assertNotEqual(first, second)
        self.assertIn("a", first)

    def test_context_and_result_set_storage(self):
        store = InMemoryContextStore()
        session = build_session_id(platform="kook", launcher_type="group", launcher_id="g", sender_id="a")
        current_query = query("昨天战绩")
        current_query["sessionId"] = session
        saved = save_context(store, session_id=session, query=current_query, result_set_id="rs_1", now=NOW)
        self.assertEqual(load_context(store, session, NOW)["lastResultSetId"], "rs_1")
        result_set = {"id": "rs_1", "sessionId": session, "expiresAt": "2026-09-02T00:00:00+08:00"}
        save_result_set(store, session_id=session, result_set=result_set)
        self.assertEqual(load_result_set(store, session_id=session, result_set_id="rs_1", now=NOW)["id"], "rs_1")
        other = build_session_id(platform="kook", launcher_type="group", launcher_id="g", sender_id="b")
        self.assertIsNone(load_context(store, other, NOW).get("lastResultSetId"))


if __name__ == "__main__":
    unittest.main()
