#!/usr/bin/env python3

from __future__ import annotations

import grp
import io
import json
import os
import pwd
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import accounting_cli
from accounting_cli import (
    generate_stats_secret,
    render_hysteria_candidate,
    render_caddy_matcher,
    render_new_accounts,
    _retire_legacy,
    render_subscription_files,
    render_xray_candidate,
)
from accounting_service import AuthFailureTracker, AccountingHTTPServer, ServiceConfig, SourceFailure, XRAY_USER_STATS_PATTERN, _counter_integer, _request_shutdown, parse_hysteria_client_addr, parse_hysteria_online, parse_hysteria_traffic, parse_xray_fallback_stats, parse_xray_online, parse_xray_online_version, parse_xray_stats, xray_online_not_found_is_zero
from accounting_store import (
    ACCOUNT_IDS,
    INITIAL_ACCOUNT_IDS,
    LABMEM_IDS,
    MANAGED_ACCOUNT_IDS,
    M204_ID,
    AccountingStore,
    LegacyCredentials,
    collect_active_subscription_token,
    parse_hysteria_legacy_password,
    parse_xray_legacy_uuid,
)


LEGACY = LegacyCredentials(
    subscription_token="legacy-token-test",
    hy2_secret="legacy-hy2-test-secret",
    vless_uuid="00000000-0000-4000-8000-000000000001",
)
NOW = "2026-10-08T04:00:00Z"


class AccountingStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = AccountingStore(self.root / "subscription-accounts.sqlite")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_initialization_creates_five_unique_identities_and_never_rotates_on_rerun(self) -> None:
        self.assertEqual(self.store.initialize_accounts(LEGACY, created_at=NOW), list(LABMEM_IDS))
        first = self.store.account_records_for_runtime()
        self.assertEqual({row["account_id"] for row in first}, set(INITIAL_ACCOUNT_IDS))
        self.assertEqual(sum(int(row["is_legacy"]) for row in first), 1)
        for field in ("subscription_token", "hy2_secret", "vless_uuid"):
            self.assertEqual(len({str(row[field]) for row in first}), 6)
        self.store.initialize_accounts(LEGACY, created_at="2026-10-09T00:00:00Z")
        second = self.store.account_records_for_runtime()
        self.assertEqual(first, second)
        self.assertEqual(os.stat(self.store.path).st_mode & 0o777, 0o600)

    def test_schema_v2_database_migrates_baseline_coverage_field(self) -> None:
        old_path = self.root / "schema-v2.sqlite"
        with sqlite3.connect(old_path) as db:
            db.executescript(
                """
                CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                INSERT INTO schema_meta(key,value) VALUES ('schema_version','2');
                CREATE TABLE counter_state (
                  account_id TEXT NOT NULL,
                  protocol TEXT NOT NULL,
                  upload_raw INTEGER NOT NULL,
                  download_raw INTEGER NOT NULL,
                  cumulative_upload_bytes INTEGER NOT NULL,
                  cumulative_download_bytes INTEGER NOT NULL,
                  generation TEXT,
                  sampled_at TEXT NOT NULL,
                  PRIMARY KEY (account_id, protocol)
                );
                """
            )
        migrated = AccountingStore(old_path)
        with migrated._connect() as db:
            columns = {row["name"] for row in db.execute("PRAGMA table_info(counter_state)").fetchall()}
            version = db.execute("SELECT value FROM schema_meta WHERE key='schema_version'").fetchone()[0]
        self.assertIn("baseline_sampled_at", columns)
        self.assertEqual(version, "4")

    def test_m204_identity_is_created_once_and_legacy_hy2_auth_is_revoked(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.assertTrue(self.store.provision_m204(created_at="2026-10-08T04:01:00Z"))
        first = {row["account_id"]: row for row in self.store.account_records_for_runtime()}
        self.assertFalse(self.store.provision_m204(created_at="2026-10-09T00:00:00Z"))
        second = {row["account_id"]: row for row in self.store.account_records_for_runtime()}
        self.assertEqual(first[M204_ID], second[M204_ID])
        self.assertEqual(self.store.auth_account_id(LEGACY.hy2_secret), "legacy")
        self.assertEqual(self.store.auth_account_id(str(first[M204_ID]["hy2_secret"])), M204_ID)
        self.assertTrue(self.store.disable_legacy(disabled_at="2026-10-08T04:02:00Z"))
        self.assertFalse(self.store.disable_legacy(disabled_at="2026-10-08T04:03:00Z"))
        self.assertIsNone(self.store.auth_account_id(LEGACY.hy2_secret))
        records = {row["account_id"]: row for row in self.store.account_records_for_runtime()}
        self.assertEqual(set(records), set(ACCOUNT_IDS))
        for field in ("subscription_token", "hy2_secret", "vless_uuid"):
            self.assertNotEqual(records["legacy"][field], getattr(LEGACY, field))

    def test_m204_counter_attribution_starts_at_account_creation(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(counter_bytes=90, total_bytes=1000, reset_at=None, sampled_at=NOW)
        m204_start = "2026-10-08T04:01:00Z"
        self.store.provision_m204(created_at=m204_start)
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={M204_ID: (12, 30)},
            generation="hy2-1", sampled_at="2026-10-08T04:02:00Z",
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 3, tzinfo=timezone.utc))
        m204 = next(row for row in snapshot["accounts"] if row["accountId"] == M204_ID)
        self.assertEqual(m204["monitoringStartedAt"], m204_start)
        self.assertEqual(m204["protocols"]["hy2"]["totalBytes"], 42)
        self.assertEqual(m204["protocols"]["hy2"]["windowBytes"], 42)

    def test_partial_store_refuses_to_generate_replacement_credentials(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        with self.store._connect() as db:
            db.execute("DELETE FROM accounts WHERE account_id='Labmem005'")
        with self.assertRaisesRegex(RuntimeError, "partially initialized"):
            self.store.initialize_accounts(LEGACY, created_at=NOW)

    def test_auth_lookup_is_exact_and_unknown_secret_fails_closed(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        records = self.store.account_records_for_runtime()
        labmem = next(row for row in records if row["account_id"] == "Labmem003")
        self.assertEqual(self.store.auth_account_id(str(labmem["hy2_secret"])), "Labmem003")
        self.assertIsNone(self.store.auth_account_id(str(labmem["hy2_secret"]) + "x"))
        self.assertIsNone(self.store.auth_account_id(""))

    def test_reality_fallback_counters_persist_safe_reset_deltas_without_account_attribution(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.provision_m204(created_at=NOW)
        self.store.disable_legacy(disabled_at="2026-10-08T04:01:00Z")
        self.store.record_reality_fallback_sample(upload=10, download=20, generation="xray-a", sampled_at=NOW)
        self.store.record_reality_fallback_sample(
            upload=5, download=7, generation="xray-b", sampled_at="2026-10-08T04:01:00Z",
        )
        with self.store._connect() as db:
            deltas = db.execute("SELECT upload_bytes,download_bytes,counter_reset FROM reality_fallback_deltas ORDER BY id").fetchall()
        self.assertEqual([(row["upload_bytes"], row["download_bytes"], row["counter_reset"]) for row in deltas], [(10, 20, 0), (5, 7, 1)])
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 2, tzinfo=timezone.utc), window_seconds=3600)
        fallback = snapshot["security"]["realityFallback"]
        self.assertEqual(fallback["totalBytes"], 42)
        self.assertEqual(fallback["windowTotalBytes"], 42)
        self.assertEqual(fallback["status"], "ok")
        with self.store._connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM traffic_deltas").fetchone()[0], 0)

    def test_security_event_store_keeps_only_minute_aggregates(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.provision_m204(created_at=NOW)
        self.store.record_security_event("hy2_auth_failure", "2026-10-08T04:01:39Z")
        self.store.record_security_event("hy2_auth_failure", "2026-10-08T04:01:52Z")
        self.store.record_security_event("hy2_auth_rate_limited", "2026-10-08T04:02:02Z")
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 3, tzinfo=timezone.utc))
        auth = snapshot["security"]["hysteriaAuth"]
        self.assertEqual(auth["authFailuresWindow"], 2)
        self.assertEqual(auth["authRateLimitedWindow"], 1)
        self.assertIsNone(auth["uniqueFailureSourcesWindowApproximate"])
        with self.store._connect() as db:
            rows = db.execute("SELECT bucket_start,event_kind,event_count FROM security_event_buckets ORDER BY bucket_start,event_kind").fetchall()
        self.assertEqual([(row["event_kind"], row["event_count"]) for row in rows], [("hy2_auth_failure", 2), ("hy2_auth_rate_limited", 1)])

    def test_provider_and_protocol_counter_resets_add_new_generation_without_negative_deltas(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.assertTrue(self.store.record_provider_sample(
            counter_bytes=100, total_bytes=1000, reset_at="2026-10-17T00:00:00Z", sampled_at=NOW,
        ))
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"legacy": (15, 20), "Labmem001": (4, 6)},
            generation="hy2-1", sampled_at=NOW, baseline=True,
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (7, 9)},
            generation="xray-1", sampled_at=NOW, baseline=True,
        )
        self.store.record_provider_sample(
            counter_bytes=130, total_bytes=1000, reset_at="2026-10-17T00:00:00Z", sampled_at="2026-10-08T04:01:00Z",
        )
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"legacy": (25, 31), "Labmem001": (14, 16)},
            generation="hy2-1", sampled_at="2026-10-08T04:01:00Z",
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (12, 20)},
            generation="xray-1", sampled_at="2026-10-08T04:01:00Z",
        )
        self.store.record_provider_sample(
            counter_bytes=15, total_bytes=1000, reset_at="2026-11-17T00:00:00Z", sampled_at="2026-11-01T00:00:00Z",
        )
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"legacy": (3, 5)},
            generation="hy2-2", sampled_at="2026-11-01T00:00:00Z",
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 11, 1, tzinfo=timezone.utc))
        legacy = snapshot["legacy"]
        self.assertEqual(legacy["protocols"]["hy2"]["uploadBytes"], 13)
        self.assertEqual(legacy["protocols"]["hy2"]["downloadBytes"], 16)
        self.assertEqual(legacy["protocols"]["vless"]["uploadBytes"], 5)
        self.assertEqual(legacy["protocols"]["vless"]["downloadBytes"], 11)
        self.assertEqual(snapshot["provider"]["deltaSinceMonitoringStartBytes"], 45)
        self.assertEqual(snapshot["reconciliation"]["status"], "uncalibrated")
        self.assertIsNone(snapshot["reconciliation"]["gapBytes"])

    def test_hysteria_direction_migration_swaps_stored_totals_and_deltas_once(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(
            counter_bytes=100, total_bytes=1000, reset_at="2026-10-17T00:00:00Z", sampled_at=NOW,
        )
        # These tuples reflect the old reversed tx/rx interpretation.
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"Labmem001": (12, 90)},
            generation="hy2-1", sampled_at=NOW, baseline=True,
        )
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"Labmem001": (32, 100)},
            generation="hy2-1", sampled_at="2026-10-08T04:01:00Z",
        )
        self.assertTrue(self.store.migrate_hysteria_direction_to_client_perspective())
        self.assertFalse(self.store.migrate_hysteria_direction_to_client_perspective())
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 2, tzinfo=timezone.utc))
        account = next(row for row in snapshot["accounts"] if row["accountId"] == "Labmem001")
        protocol = account["protocols"]["hy2"]
        self.assertEqual((protocol["uploadBytes"], protocol["downloadBytes"]), (10, 20))
        with self.store._connect() as db:
            row = db.execute(
                "SELECT upload_raw,download_raw FROM counter_state WHERE account_id='Labmem001' AND protocol='hy2'"
            ).fetchone()
            delta = db.execute(
                "SELECT upload_bytes,download_bytes FROM traffic_deltas WHERE protocol='hy2'"
            ).fetchone()
        self.assertEqual(tuple(row), (100, 32))
        self.assertEqual(tuple(delta), (10, 20))

    def test_legacy_vless_t0_backfill_only_accepts_the_reviewed_zero_delta_state(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(
            counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW,
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (814, 4320)},
            generation="xray-1", sampled_at="2026-10-08T04:01:00Z",
        )
        self.assertTrue(self.store.backfill_legacy_vless_t0_baseline(
            expected_upload=814, expected_download=4320,
        ))
        self.assertFalse(self.store.backfill_legacy_vless_t0_baseline(
            expected_upload=814, expected_download=4320,
        ))
        with self.store._connect() as db:
            state = db.execute(
                "SELECT cumulative_upload_bytes,cumulative_download_bytes,baseline_sampled_at "
                "FROM counter_state WHERE account_id='legacy' AND protocol='vless'"
            ).fetchone()
            marker = db.execute(
                "SELECT value FROM schema_meta WHERE key='legacy_vless_t0_baseline_v1'"
            ).fetchone()
        self.assertEqual(tuple(state), (0, 0, NOW))
        self.assertIsNotNone(marker)

    def test_legacy_vless_t0_backfill_refuses_changed_raw_counters(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(
            counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW,
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (814, 4320)},
            generation="xray-1", sampled_at="2026-10-08T04:01:00Z",
        )
        with self.assertRaisesRegex(RuntimeError, "no longer match"):
            self.store.backfill_legacy_vless_t0_baseline(
                expected_upload=813, expected_download=4320,
            )

    def test_fractional_counters_are_rejected_instead_of_truncated(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        with self.assertRaisesRegex(ValueError, "provider counters are invalid"):
            self.store.record_provider_sample(counter_bytes=2.5, total_bytes=1000, reset_at=None, sampled_at=NOW)  # type: ignore[arg-type]
        with self.assertRaisesRegex(SourceFailure, "invalid_response"):
            _counter_integer(2.5)
        self.assertEqual(_counter_integer("123"), 123)

    def test_missing_fresh_labmem_counter_rows_are_zero_but_legacy_stays_unknown(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(counter_bytes=90, total_bytes=1000, reset_at=None, sampled_at=NOW)
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"Labmem002": (2, 3)},
            generation="hy2-1", sampled_at=NOW,
        )
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"Labmem002": (7, 8)},
            generation="hy2-1", sampled_at="2026-10-08T04:01:00Z",
        )
        records = self.store.account_records_for_runtime()
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        account = next(row for row in snapshot["accounts"] if row["accountId"] == "Labmem001")
        self.assertEqual(account["protocols"]["hy2"]["totalBytes"], 0)
        self.assertEqual(account["protocols"]["hy2"]["uploadBytes"], 0)
        legacy = snapshot["legacy"]
        self.assertIsNone(legacy["protocols"]["hy2"]["totalBytes"])
        self.assertIsNone(snapshot["proxyAccountedBytes"])
        self.assertEqual(snapshot["knownProxyAccountedBytes"], 15)
        self.assertFalse(snapshot["proxyAccountedComplete"])
        encoded = json.dumps(snapshot)
        for record in records:
            for field in ("subscription_token", "hy2_secret", "vless_uuid"):
                self.assertNotIn(str(record[field]), encoded)
        output = self.root / "subscription-usage-public.json"
        self.store.write_public_snapshot(output)
        self.assertEqual(os.stat(output).st_mode & 0o777, 0o640)

    def test_fresh_labmem_absence_counts_as_zero_when_all_traffic_sources_are_healthy(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.provision_m204(created_at=NOW)
        self.store.record_provider_sample(counter_bytes=90, total_bytes=1000, reset_at=None, sampled_at=NOW)
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"legacy": (0, 0)},
            generation="hy2-1", sampled_at=NOW, baseline=True,
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (0, 0)},
            generation="xray-1", sampled_at=NOW, baseline=True,
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        self.assertTrue(snapshot["proxyAccountedComplete"])
        self.assertEqual(snapshot["proxyAccountedBytes"], 0)
        self.assertEqual(snapshot["protocolTotals"]["hy2"]["observedAccounts"], 6)
        for account in snapshot["accounts"]:
            self.assertEqual(account["totalMonitoredBytes"], 0)
            self.assertTrue(account["totalsComplete"])

    def test_online_snapshot_distinguishes_hy2_instances_from_vless_source_ips(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_online_sample({"Labmem003": 2}, NOW, protocol="hy2", source="hysteria_online")
        self.store.record_online_sample({"Labmem003": 1}, NOW, protocol="vless", source="xray_online")
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        account = next(row for row in snapshot["accounts"] if row["accountId"] == "Labmem003")
        self.assertEqual(account["protocols"]["hy2"]["onlineCount"], 2)
        self.assertEqual(account["protocols"]["hy2"]["onlineCountKind"], "client_instances")
        self.assertEqual(account["protocols"]["hy2"]["onlineStatus"], "ok")
        self.assertEqual(account["protocols"]["vless"]["onlineCount"], 1)
        self.assertEqual(account["protocols"]["vless"]["onlineCountKind"], "unique_source_ips")
        self.assertEqual(account["protocols"]["vless"]["onlineStatus"], "ok")

    def test_first_counter_observation_is_a_baseline_not_pre_t0_usage(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW)
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (300, 500)},
            generation="xray-1", sampled_at=NOW, baseline=False,
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        legacy = snapshot["legacy"]
        self.assertIsNone(legacy["protocols"]["vless"]["totalBytes"])
        self.assertEqual(legacy["protocols"]["vless"]["status"], "unknown")
        self.assertIsNone(legacy["protocols"]["vless"]["windowBytes"])
        self.assertFalse(snapshot["protocolTotals"]["vless"]["complete"])

    def test_first_labmem_counter_observed_after_t0_counts_from_fresh_identity(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW)
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={},
            generation="hy2-1", sampled_at=NOW,
        )
        self.store.record_counter_sample(
            source="hysteria_traffic", protocol="hy2", counters={"Labmem001": (12, 30)},
            generation="hy2-1", sampled_at="2026-10-08T04:01:00Z",
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        labmem = next(row for row in snapshot["accounts"] if row["accountId"] == "Labmem001")
        self.assertEqual(labmem["protocols"]["hy2"]["uploadBytes"], 12)
        self.assertEqual(labmem["protocols"]["hy2"]["downloadBytes"], 30)
        self.assertEqual(labmem["protocols"]["hy2"]["windowBytes"], 42)
        self.assertEqual(snapshot["knownProxyAccountedBytes"], 42)
        self.assertFalse(snapshot["protocolTotals"]["hy2"]["complete"])

    def test_late_legacy_counter_baseline_cannot_claim_t0_total(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.record_provider_sample(counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW)
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={},
            generation="xray-1", sampled_at=NOW,
        )
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters={"legacy": (300, 500)},
            generation="xray-1", sampled_at="2026-10-08T04:01:00Z",
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 1, tzinfo=timezone.utc))
        self.assertIsNone(snapshot["legacy"]["protocols"]["vless"]["totalBytes"])
        self.assertFalse(snapshot["protocolTotals"]["vless"]["complete"])
        self.assertIsNone(snapshot["proxyAccountedBytes"])

    def test_recovered_source_retains_gap_and_does_not_claim_complete_totals(self) -> None:
        self.store.initialize_accounts(LEGACY, created_at=NOW)
        self.store.provision_m204(created_at=NOW)
        self.store.record_provider_sample(counter_bytes=100, total_bytes=1000, reset_at=None, sampled_at=NOW)
        initial = {account_id: (10, 20) for account_id in ACCOUNT_IDS}
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters=initial,
            generation="xray-1", sampled_at=NOW, baseline=True,
        )
        self.store.mark_source_error("xray", "2026-10-08T04:01:00Z", "unreachable")
        recovered = {account_id: (15, 30) for account_id in ACCOUNT_IDS}
        self.store.record_counter_sample(
            source="xray", protocol="vless", counters=recovered,
            generation="xray-1", sampled_at="2026-10-08T04:02:00Z",
        )
        snapshot = self.store.public_snapshot(now=datetime(2026, 10, 8, 4, 3, tzinfo=timezone.utc))
        self.assertEqual(snapshot["sources"]["xray"]["status"], "ok")
        self.assertEqual(snapshot["sources"]["xray"]["lastErrorAt"], "2026-10-08T04:01:00Z")
        self.assertFalse(snapshot["protocolTotals"]["vless"]["complete"])
        self.assertIsNone(snapshot["legacy"]["totalMonitoredBytes"])
        self.assertFalse(snapshot["legacy"]["windowComplete"])


class ParserAndAuthTests(unittest.TestCase):
    def test_collector_enable_flag_accepts_auth_only_preflight_mode(self) -> None:
        with patch.dict(os.environ, {"ACCOUNTING_COLLECTOR_ENABLED": "false"}, clear=False):
            config = ServiceConfig.from_env()
        self.assertFalse(config.collector_enabled)
        with patch.dict(os.environ, {"ACCOUNTING_COLLECTOR_ENABLED": "true"}, clear=False):
            config = ServiceConfig.from_env()
        self.assertTrue(config.collector_enabled)

    def test_xray_statsquery_empty_output_preserves_unknown_account_counters(self) -> None:
        self.assertEqual(parse_xray_stats({}), {})
        with self.assertRaises(SourceFailure):
            parse_xray_stats({"unexpected": []})

    def test_accounting_cli_defaults_to_dry_run_without_creating_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "hysteria-stats-secret"
            stdout = io.StringIO()
            with patch.object(sys, "argv", [
                "accounting_cli.py", "generate-stats-secret", "--output", str(output_path),
            ]):
                with patch("sys.stdout", stdout):
                    from accounting_cli import main
                    self.assertEqual(main(), 0)
            self.assertFalse(output_path.exists())
            self.assertIn("PLAN_GENERATE_STATS_SECRET=no_changes; APPLY_REQUIRED=1", stdout.getvalue())

    def test_account_retirement_cli_commands_default_to_dry_run(self) -> None:
        common = [
            "--db", "/tmp/m204-dry-run.sqlite",
            "--subscription-root", "/tmp/m204-dry-run-subscriptions",
            "--caddy-fragment", "/tmp/m204-dry-run.caddy",
            "--xray-source", "/tmp/m204-dry-run-xray.json",
            "--xray-output", "/tmp/m204-dry-run-candidate.json",
        ]
        for command in ("provision-m204", "retire-legacy"):
            args = ["accounting_cli.py", command, *common]
            if command == "provision-m204":
                args.extend([
                    "--vless-server", "vless.example.com", "--hy2-server", "hy2.example.com",
                    "--hy2-sni", "hy2.example.com", "--reality-server-name", "www.example.com",
                    "--reality-public-key", "public-key-placeholder", "--reality-short-id", "0011223344556677",
                ])
            stdout = io.StringIO()
            with patch.object(sys, "argv", args), patch("sys.stdout", stdout):
                from accounting_cli import main
                self.assertEqual(main(), 0)
            self.assertIn("APPLY_REQUIRED=1", stdout.getvalue())

    def test_accounting_cli_writes_secret_only_with_apply_and_never_prints_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / "hysteria-stats-secret"
            stdout = io.StringIO()
            with patch.object(sys, "argv", [
                "accounting_cli.py", "generate-stats-secret", "--output", str(output_path),
                "--service-group", grp.getgrgid(os.getgid()).gr_name, "--apply",
            ]):
                with patch("sys.stdout", stdout):
                    from accounting_cli import main
                    self.assertEqual(main(), 0)
            secret = output_path.read_text(encoding="utf-8").strip()
            self.assertTrue(secret)
            self.assertEqual(os.stat(output_path).st_mode & 0o777, 0o640)
            self.assertNotIn(secret, stdout.getvalue())

    def test_accounting_credentials_default_to_the_isolated_configuration_directory(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = ServiceConfig.from_env()
        self.assertEqual(config.kiwivm_credentials_file, "/etc/amadeus-accounting/kiwivm-credentials.json")
        self.assertEqual(config.hy2_stats_secret_file, "/etc/amadeus-accounting/hysteria-stats-secret")

    def test_shutdown_uses_a_separate_thread_for_http_server(self) -> None:
        stop = threading.Event()
        calls: list[int] = []

        class FakeServer:
            def shutdown(self) -> None:
                calls.append(threading.get_ident())

        caller_thread = threading.get_ident()
        worker = _request_shutdown(FakeServer(), stop)  # type: ignore[arg-type]
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive())
        self.assertTrue(stop.is_set())
        self.assertEqual(len(calls), 1)
        self.assertNotEqual(calls[0], caller_thread)

    def test_protocol_parsers_map_direction_and_ignore_unknown_ids(self) -> None:
        self.assertEqual(XRAY_USER_STATS_PATTERN, "user>>>")
        self.assertEqual(parse_hysteria_traffic({"legacy-hy2": {"tx": 90, "rx": 12}, "Labmem001": {"tx": 8, "rx": 3}, "M204-Net-Core": {"tx": 1, "rx": 2}, "other": {"tx": 100, "rx": 100}}), {
            "legacy": (90, 12), "Labmem001": (8, 3), M204_ID: (1, 2),
        })
        self.assertEqual(parse_hysteria_online({"Labmem001": 2, "legacy-hy2": 1, "bad": 9}), {"Labmem001": 2, "legacy": 1})
        stats = {"stat": [
            {"name": "user>>>legacy-vless>>>traffic>>>uplink", "value": "14"},
            {"name": "user>>>legacy-vless>>>traffic>>>downlink", "value": "25"},
            {"name": "user>>>Labmem005.vless>>>traffic>>>uplink", "value": "5"},
            {"name": "user>>>Labmem005.vless>>>traffic>>>downlink", "value": "11"},
            {"name": "user>>>M204-Net-Core.vless>>>traffic>>>uplink", "value": "2"},
            {"name": "user>>>M204-Net-Core.vless>>>traffic>>>downlink", "value": "3"},
            {"name": "user>>>Labmem004.vless>>>traffic>>>uplink", "value": 1.5},
            {"name": "user>>>Labmem004.vless>>>traffic>>>downlink", "value": 8},
            {"name": "user>>>unknown>>>traffic>>>uplink", "value": "400"},
        ]}
        self.assertEqual(parse_xray_stats(stats), {"legacy": (14, 25), "Labmem005": (5, 11), M204_ID: (2, 3)})
        self.assertEqual(parse_xray_stats({"stat": [{"name": "user>>>Labmem001.vless>>>traffic>>>uplink", "value": "1"}]}), {})
        self.assertEqual(parse_xray_fallback_stats({"stat": [
            {"name": "inbound>>>reality-fallback-gate>>>traffic>>>uplink", "value": "31"},
            {"name": "inbound>>>reality-fallback-gate>>>traffic>>>downlink", "value": 47},
            {"name": "inbound>>>vless-reality-in>>>traffic>>>uplink", "value": 999},
        ]}), (31, 47))
        with self.assertRaisesRegex(SourceFailure, "unavailable"):
            parse_xray_fallback_stats({"stat": []})
        self.assertEqual(parse_hysteria_client_addr("203.0.113.7:44321"), "203.0.113.7")
        self.assertEqual(parse_hysteria_client_addr("[2001:db8::1]:44321"), "2001:db8::1")
        for malformed in ("127.0.0.1", "2001:db8::1:443", "[not-an-ip]:443", "203.0.113.1:0", "203.0.113.1:abc"):
            self.assertIsNone(parse_hysteria_client_addr(malformed))
        self.assertEqual(parse_xray_online({"stat": {"name": "user>>>Labmem001.vless>>>online", "value": 2}}, "Labmem001"), 2)
        self.assertEqual(parse_xray_online({"stat": {"name": "user>>>M204-Net-Core.vless>>>online", "value": 1}}, M204_ID), 1)
        self.assertEqual(parse_xray_online({"stat": {"name": "user>>>Labmem001.vless>>>online"}}, "Labmem001"), 0)
        self.assertEqual(parse_xray_online_version("Xray 26.6.27 (Xray, Penetrates Everything.)"), (26, 6, 27))
        self.assertEqual(parse_xray_online_version("Xray 26.9.30 (Xray, Penetrates Everything.)"), (26, 9, 30))
        with self.assertRaisesRegex(SourceFailure, "unsupported_version"):
            parse_xray_online_version("Xray 26.3.27 (Xray, Penetrates Everything.)")
        self.assertTrue(xray_online_not_found_is_zero(
            "failed to get stats: rpc error: code = NotFound desc = user>>>Labmem001.vless>>>online not found.",
            "Labmem001",
        ))
        self.assertFalse(xray_online_not_found_is_zero(
            "failed to get stats: rpc error: code = Unavailable desc = offline", "Labmem001"
        ))
        with self.assertRaisesRegex(SourceFailure, "invalid_response"):
            parse_xray_online({"stat": {"name": "user>>>other>>>online", "value": 99}}, "Labmem001")
        with self.assertRaisesRegex(SourceFailure, "invalid_response"):
            parse_xray_online({"stat": {"name": "user>>>Labmem001.vless>>>online", "value": 1.5}}, "Labmem001")

    def test_legacy_import_parsers_read_values_without_printing_or_changing_them(self) -> None:
        self.assertEqual(parse_hysteria_legacy_password('auth:\n  type: password\n  password: "legacy#value"\n'), "legacy#value")
        self.assertEqual(parse_xray_legacy_uuid('{"inbounds":[{"protocol":"vless","port":2053,"settings":{"clients":[{"id":"00000000-0000-4000-8000-000000000001"}]}}]}'), LEGACY.vless_uuid)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / LEGACY.subscription_token).mkdir()
            for name in ("qx.conf", "server.snippet", "clash.yaml", "shadowrocket.txt"):
                (root / LEGACY.subscription_token / name).write_text("existing\n")
            caddy = "@subscription path /legacy-token-test/qx.conf /legacy-token-test/server.snippet /legacy-token-test/clash.yaml /legacy-token-test/shadowrocket.txt"
            self.assertEqual(collect_active_subscription_token(caddy, root), LEGACY.subscription_token)

    def test_service_refuses_non_loopback_xray_stats_target(self) -> None:
        with patch.dict(os.environ, {"XRAY_STATS_SERVER": "198.51.100.9:10085"}, clear=True):
            with self.assertRaisesRegex(ValueError, "loopback"):
                ServiceConfig.from_env()
        with patch.dict(os.environ, {"XRAY_STATS_SERVER": "[::1]:10085"}, clear=True):
            config = ServiceConfig.from_env()
            self.assertEqual(config.xray_stats_server, "[::1]:10085")
            self.assertEqual(config.snapshot_group, "amadeus-accounting-snapshot")
            self.assertEqual(config.db_path, "/var/lib/amadeus-accounting/subscription-accounts.sqlite")
            self.assertEqual(config.snapshot_path, "/var/lib/amadeus-accounting/subscription-usage-public.json")

    def test_security_configuration_is_explicit_bounded_and_telemetry_first(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = ServiceConfig.from_env()
        self.assertEqual(config.hy2_auth_fail_mode, "telemetry")
        self.assertEqual(config.hy2_auth_fail_window_seconds, 900)
        self.assertEqual(config.hy2_auth_fail_threshold, 120)
        self.assertEqual(config.hy2_auth_fail_cooldown_seconds, 300)
        self.assertEqual(config.hy2_auth_fail_max_tracked_sources, 4096)
        self.assertEqual(config.reality_fallback_alert_bytes, 1024)
        with patch.dict(os.environ, {"HY2_AUTH_FAIL_MODE": "block-all"}, clear=True):
            with self.assertRaisesRegex(ValueError, "HY2_AUTH_FAIL_MODE"):
                ServiceConfig.from_env()
        with patch.dict(os.environ, {"HY2_AUTH_FAIL_THRESHOLD": "0"}, clear=True):
            with self.assertRaisesRegex(ValueError, "HY2_AUTH_FAIL_THRESHOLD"):
                ServiceConfig.from_env()

    def test_auth_failure_tracker_bounds_sources_expires_and_enforces_only_in_enforce_mode(self) -> None:
        clock = [100.0]
        tracker = AuthFailureTracker(
            window_seconds=30, threshold=2, cooldown_seconds=10, max_tracked_sources=2,
            mode="enforce", clock=lambda: clock[0],
        )
        tracker.record_failure("192.0.2.1", at=NOW)
        tracker.record_failure("192.0.2.1", at=NOW)
        self.assertTrue(tracker.reject_rate_limited("192.0.2.1"))
        tracker.record_failure("192.0.2.2", at=NOW)
        tracker.record_failure("192.0.2.3", at=NOW)
        snapshot = tracker.snapshot()
        self.assertEqual(snapshot["authFailuresLimiterWindow"], 4)
        self.assertEqual(snapshot["authRateLimitedLimiterWindow"], 1)
        self.assertLessEqual(snapshot["uniqueFailureSourcesWindowApproximate"], 2)
        self.assertTrue(snapshot["trackingCapacityReached"])
        self.assertNotIn("192.0.2.1", json.dumps(snapshot))
        clock[0] += 31
        self.assertEqual(tracker.snapshot()["authFailuresLimiterWindow"], 0)
        self.assertEqual(tracker.snapshot()["uniqueFailureSourcesWindowApproximate"], 0)

        telemetry = AuthFailureTracker(window_seconds=30, threshold=1, mode="telemetry", clock=lambda: clock[0])
        telemetry.record_failure("192.0.2.4", at=NOW)
        self.assertFalse(telemetry.reject_rate_limited("192.0.2.4"))
        self.assertEqual(telemetry.snapshot()["authRateLimitedLimiterWindow"], 0)

    def test_http_auth_endpoint_returns_stable_ids_and_does_not_echo_unknown_auth(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = AccountingStore(Path(directory) / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            store.provision_m204(created_at=NOW)
            store.disable_legacy(disabled_at="2026-10-08T04:02:00Z")
            records = store.account_records_for_runtime()
            account = next(row for row in records if row["account_id"] == "Labmem004")
            m204 = next(row for row in records if row["account_id"] == M204_ID)
            server = AccountingHTTPServer(("127.0.0.1", 0), store)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                body = json.dumps({"auth": account["hy2_secret"], "addr": "203.0.113.1:1", "tx": 1}).encode()
                request = Request(f"http://127.0.0.1:{server.server_port}/auth", data=body, headers={"Content-Type": "application/json"})
                with urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"ok": True, "id": "Labmem004"})
                request = Request(f"http://127.0.0.1:{server.server_port}/auth", data=json.dumps({"auth": m204["hy2_secret"], "addr": "[2001:db8::1]:2", "tx": 0}).encode(), headers={"Content-Type": "application/json"})
                with urlopen(request, timeout=2) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(json.loads(response.read()), {"ok": True, "id": "M204-Net-Core"})
                bad_secret = "unknown-auth-never-echo-this"
                request = Request(f"http://127.0.0.1:{server.server_port}/auth", data=json.dumps({"auth": bad_secret, "addr": "203.0.113.55:7", "tx": 1}).encode(), headers={"Content-Type": "application/json"})
                with self.assertRaises(HTTPError) as error:
                    urlopen(request, timeout=2)
                response_body = error.exception.read().decode()
                self.assertEqual(error.exception.code, 403)
                self.assertNotIn(bad_secret, response_body)
                self.assertEqual(response_body, '{"ok":false}')
                request = Request(f"http://127.0.0.1:{server.server_port}/auth", data=json.dumps({"auth": LEGACY.hy2_secret, "addr": "203.0.113.55:7", "tx": 1}).encode(), headers={"Content-Type": "application/json"})
                with self.assertRaises(HTTPError) as error:
                    urlopen(request, timeout=2)
                self.assertEqual(error.exception.code, 403)
                self.assertEqual(error.exception.read().decode(), response_body)
                malformed = Request(f"http://127.0.0.1:{server.server_port}/auth", data=json.dumps({"auth": bad_secret, "addr": "not-an-ip", "tx": -1}).encode(), headers={"Content-Type": "application/json"})
                with self.assertRaises(HTTPError) as error:
                    urlopen(malformed, timeout=2)
                self.assertEqual(error.exception.code, 403)
                self.assertEqual(error.exception.read().decode(), response_body)
                tracker_snapshot = server.auth_failure_tracker.snapshot()
                self.assertEqual(tracker_snapshot["authFailuresLimiterWindow"], 2)
                snapshot_text = json.dumps(store.public_snapshot(auth_security=tracker_snapshot))
                self.assertNotIn(bad_secret, snapshot_text)
                self.assertNotIn(LEGACY.hy2_secret, snapshot_text)
                self.assertNotIn(str(account["hy2_secret"]), snapshot_text)
                self.assertNotIn(str(m204["hy2_secret"]), snapshot_text)
                self.assertNotIn("203.0.113.55", snapshot_text)
                self.assertNotIn("2001:db8::1", snapshot_text)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_http_auth_enforcement_throttles_only_the_failed_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = AccountingStore(Path(directory) / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            store.provision_m204(created_at=NOW)
            store.disable_legacy(disabled_at="2026-10-08T04:02:00Z")
            account = next(row for row in store.account_records_for_runtime() if row["account_id"] == "Labmem002")
            tracker = AuthFailureTracker(window_seconds=60, threshold=1, cooldown_seconds=60, mode="enforce")
            server = AccountingHTTPServer(("127.0.0.1", 0), store, auth_tracker=tracker)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()

            def request_auth(secret: str, address: str) -> tuple[int, str]:
                body = json.dumps({"auth": secret, "addr": address, "tx": 1}).encode()
                request = Request(f"http://127.0.0.1:{server.server_port}/auth", data=body, headers={"Content-Type": "application/json"})
                try:
                    with urlopen(request, timeout=2) as response:
                        return response.status, response.read().decode()
                except HTTPError as error:
                    return error.code, error.read().decode()

            try:
                self.assertEqual(request_auth("bad-secret", "203.0.113.21:1000"), (403, '{"ok":false}'))
                # A correct credential from the same blocked source receives the identical generic response.
                self.assertEqual(request_auth(str(account["hy2_secret"]), "203.0.113.21:1001"), (403, '{"ok":false}'))
                # The same valid credential remains usable from a different source.
                self.assertEqual(request_auth(str(account["hy2_secret"]), "203.0.113.22:1000"), (200, '{"ok":true,"id":"Labmem002"}'))
                snapshot = tracker.snapshot()
                self.assertEqual(snapshot["authFailuresLimiterWindow"], 1)
                self.assertEqual(snapshot["authRateLimitedLimiterWindow"], 1)
                self.assertEqual(snapshot["limiterMode"], "enforce")
                self.assertNotIn("203.0.113.", json.dumps(store.public_snapshot(auth_security=snapshot)))
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


class SubscriptionRenderingTests(unittest.TestCase):
    def test_retire_legacy_command_removes_old_route_files_and_rotates_all_old_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = AccountingStore(root / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            store.provision_m204(created_at=NOW)
            records = {row["account_id"]: row for row in store.account_records_for_runtime()}
            subscriptions = root / "subscriptions"
            old_directory = subscriptions / str(records["legacy"]["subscription_token"])
            old_directory.mkdir(parents=True)
            for name in ("qx.conf", "server.snippet", "clash.yaml", "shadowrocket.txt"):
                (old_directory / name).write_text("legacy key material\n")
            source = root / "xray.json"
            source.write_text(json.dumps({
                "inbounds": [{
                    "port": 2053, "protocol": "vless",
                    "settings": {"clients": [
                        {"id": LEGACY.vless_uuid, "email": "legacy-vless", "level": 0, "flow": "xtls-rprx-vision"},
                        {"id": records["Labmem001"]["vless_uuid"], "email": "Labmem001.vless", "level": 0, "flow": "xtls-rprx-vision"},
                    ]},
                    "streamSettings": {
                        "network": "tcp", "security": "reality",
                        "realitySettings": {
                            "dest": "www.example.com:443", "serverNames": ["www.example.com"],
                            "privateKey": "private-placeholder", "shortIds": ["0011223344556677"],
                        },
                    },
                }],
                "outbounds": [{"protocol": "freedom"}],
            }))
            args = SimpleNamespace(
                db=str(store.path), subscription_root=str(subscriptions),
                caddy_fragment=str(root / "subscription.caddy"),
                xray_source=str(source), xray_output=str(root / "retired-xray.json"),
                xray_group="xray", caddy_group="caddy",
                service_user=pwd.getpwuid(os.getuid()).pw_name,
            )
            with patch.object(accounting_cli.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=os.getgid())):
                with patch("sys.stdout", io.StringIO()):
                    _retire_legacy(args)
            self.assertFalse(old_directory.exists())
            matcher = (root / "subscription.caddy").read_text()
            self.assertNotIn(str(records["legacy"]["subscription_token"]), matcher)
            retired_config = json.loads((root / "retired-xray.json").read_text())
            self.assertNotIn(LEGACY.vless_uuid, json.dumps(retired_config))
            after = {row["account_id"]: row for row in store.account_records_for_runtime()}["legacy"]
            self.assertEqual(after["enabled"], 0)
            self.assertIsNone(store.auth_account_id(LEGACY.hy2_secret))
            for field in ("subscription_token", "hy2_secret", "vless_uuid"):
                self.assertNotEqual(after[field], getattr(LEGACY, field))

    def test_rendered_credentials_stay_within_each_account_and_legacy_files_are_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = AccountingStore(root / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            store.provision_m204(created_at=NOW)
            records = store.account_records_for_runtime()
            config = {
                "vless_server": "203.0.113.10",
                "hy2_server": "sub.example.com",
                "hy2_sni": "sub.example.com",
                "reality_server_name": "www.apple.com",
                "reality_public_key": "public-key-placeholder",
                "reality_short_id": "0011223344556677",
            }
            legacy = next(row for row in records if row["account_id"] == "legacy")
            legacy_dir = root / "subscriptions" / str(legacy["subscription_token"])
            legacy_dir.mkdir(parents=True)
            (legacy_dir / "qx.conf").write_text("legacy unchanged\n")
            legacy_before = (legacy_dir / "qx.conf").read_bytes()
            fragment = root / "subscription-accounts.caddy"
            render_new_accounts(store=store, subscription_root=root / "subscriptions", caddy_fragment=fragment, config=config)
            self.assertEqual((legacy_dir / "qx.conf").read_bytes(), legacy_before)
            for account_id in MANAGED_ACCOUNT_IDS:
                record = next(row for row in records if row["account_id"] == account_id)
                directory_path = root / "subscriptions" / str(record["subscription_token"])
                self.assertEqual({path.name for path in directory_path.iterdir()}, {"qx.conf", "server.snippet", "clash.yaml", "shadowrocket.txt"})
                contents = "\n".join(path.read_text() for path in directory_path.iterdir())
                self.assertIn(str(record["hy2_secret"]), contents)
                self.assertIn(str(record["vless_uuid"]), contents)
                self.assertNotIn(LEGACY.hy2_secret, contents)
                self.assertNotIn(LEGACY.vless_uuid, contents)
                for other in records:
                    if other["account_id"] in (account_id, "legacy"):
                        continue
                    self.assertNotIn(str(other["hy2_secret"]), contents)
                    self.assertNotIn(str(other["vless_uuid"]), contents)
                self.assertEqual(os.stat(directory_path).st_mode & 0o777, 0o750)
                self.assertTrue(all(os.stat(path).st_mode & 0o777 == 0o640 for path in directory_path.iterdir()))
            matcher = fragment.read_text()
            path_line = next(line for line in matcher.splitlines() if line.startswith("@subscription path "))
            self.assertEqual(len(path_line.split()) - 2, len(ACCOUNT_IDS) * 4)
            self.assertIn("reverse_proxy 127.0.0.1:8787", matcher)
            self.assertNotIn("file_server", matcher)
            retired_records = [dict(row, enabled=0) if row["account_id"] == "legacy" else dict(row) for row in records]
            retired_matcher = render_caddy_matcher(retired_records)
            self.assertNotIn(str(legacy["subscription_token"]), retired_matcher)
            retired_path_line = next(line for line in retired_matcher.splitlines() if line.startswith("@subscription path "))
            self.assertEqual(len(retired_path_line.split()) - 2, len(MANAGED_ACCOUNT_IDS) * 4)

    def test_format_policy_keeps_qx_vless_clash_hy2_and_shadowrocket_both(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = AccountingStore(Path(directory) / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            record = next(row for row in store.account_records_for_runtime() if row["account_id"] == "Labmem002")
            files = render_subscription_files(record, {
                "vless_server": "203.0.113.10", "hy2_server": "sub.example.com", "hy2_sni": "sub.example.com",
                "reality_server_name": "www.apple.com", "reality_public_key": "public-key-placeholder", "reality_short_id": "0011223344556677",
            })
            self.assertIn(str(record["vless_uuid"]), files["qx.conf"])
            self.assertEqual(files["qx.conf"], files["server.snippet"])
            self.assertIn(str(record["hy2_secret"]), files["clash.yaml"])
            self.assertNotIn(str(record["vless_uuid"]), files["clash.yaml"])
            self.assertIn(str(record["hy2_secret"]), files["shadowrocket.txt"])
            self.assertIn(str(record["vless_uuid"]), files["shadowrocket.txt"])

    def test_hysteria_candidate_preserves_listener_and_replaces_only_auth_and_stats(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "config.yaml"
            output = root / "candidate.yaml"
            secret_file = root / "stats-secret"
            secret = "test-stats-secret-do-not-print"
            source.write_text(
                'listen: :2053\n\n'
                'tls:\n  cert: /etc/caddy/domain.crt\n  key: /etc/caddy/domain.key\n'
                'auth:\n  type: password\n  password: "legacy-hy2-test-secret"\n'
                'masquerade:\n  type: proxy\n  proxy:\n    url: https://example.com\n',
                encoding="utf-8",
            )
            secret_file.write_text(secret + "\n", encoding="utf-8")
            render_hysteria_candidate(source, output, secret_file)
            rendered = output.read_text(encoding="utf-8")
            self.assertIn("listen: :2053", rendered)
            self.assertIn("cert: /etc/caddy/domain.crt", rendered)
            self.assertNotIn("https://example.com", rendered)
            self.assertIn('type: string', rendered)
            self.assertIn('content: "Not Found"', rendered)
            self.assertIn("statusCode: 404", rendered)
            self.assertIn("url: http://127.0.0.1:18796/auth", rendered)
            self.assertIn('listen: "127.0.0.1:19999"', rendered)
            self.assertIn(json.dumps(secret), rendered)
            self.assertNotIn("listenHTTP:", rendered)
            second_output = root / "candidate-rerun.yaml"
            render_hysteria_candidate(output, second_output, secret_file)
            self.assertEqual(second_output.read_text(encoding="utf-8"), rendered)
            self.assertIn('password: "legacy-hy2-test-secret"', source.read_text(encoding="utf-8"))
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o640)

    def test_hysteria_renderer_preserves_absent_and_local_masquerade(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            secret_file = root / "stats-secret"
            secret_file.write_text("test-stats-secret\n", encoding="utf-8")
            base = 'listen: :2053\nauth:\n  type: password\n  password: "legacy-hy2-test-secret"\n'
            for label, masquerade in (
                ("absent", ""),
                ("file", "masquerade:\n  type: file\n  file:\n    dir: /var/lib/hysteria/masquerade\n"),
                ("string", "masquerade:\n  type: string\n  string:\n    content: local response\n"),
            ):
                source = root / f"{label}.yaml"
                output = root / f"{label}-candidate.yaml"
                source.write_text(base + masquerade, encoding="utf-8")
                render_hysteria_candidate(source, output, secret_file)
                rendered = output.read_text(encoding="utf-8")
                if label == "absent":
                    self.assertNotIn("masquerade:", rendered)
                else:
                    self.assertIn(masquerade, rendered)
                self.assertNotIn("listenHTTP:", rendered)

    def test_stats_secret_is_created_once_with_service_group_read_permission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "stats-secret"
            generate_stats_secret(path, group_id=os.getgid())
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o640)
            self.assertGreaterEqual(len(path.read_text(encoding="utf-8").strip()), 40)
            with self.assertRaises(FileExistsError):
                generate_stats_secret(path, group_id=os.getgid())

    def test_xray_candidate_preserves_legacy_listener_material_and_adds_stable_account_emails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = AccountingStore(root / "accounts.sqlite")
            store.initialize_accounts(LEGACY, created_at=NOW)
            store.provision_m204(created_at=NOW)
            store.disable_legacy(disabled_at="2026-10-08T04:01:00Z")
            active = next(row for row in store.account_records_for_runtime() if row["account_id"] == "Labmem001")
            source = root / "xray.json"
            output = root / "candidate.json"
            source_config = {
                "log": {"loglevel": "warning"},
                "inbounds": [{
                    "listen": "0.0.0.0", "port": 2053, "protocol": "vless",
                    "settings": {"clients": [
                        {"id": LEGACY.vless_uuid, "email": "legacy-vless", "level": 0, "flow": "xtls-rprx-vision"},
                        {"id": active["vless_uuid"], "email": "Labmem001.vless", "level": 0, "flow": "xtls-rprx-vision"},
                    ], "decryption": "none"},
                    "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {"target": "www.example.com:443", "dest": "www.example.com:443", "privateKey": "private-placeholder", "serverNames": ["www.example.com"], "shortIds": ["0011223344556677"]}},
                    "sniffing": {"enabled": True},
                }],
                "outbounds": [{"protocol": "freedom"}, {"protocol": "blackhole"}],
                "routing": {"rules": [{"type": "field", "outboundTag": "direct"}]},
            }
            source.write_text(json.dumps(source_config), encoding="utf-8")
            render_xray_candidate(source, output, store)
            candidate = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(candidate["inbounds"][0]["listen"], "0.0.0.0")
            reality = candidate["inbounds"][0]["streamSettings"]["realitySettings"]
            self.assertEqual(reality["target"], "127.0.0.1:24431")
            self.assertEqual(reality["dest"], "127.0.0.1:24431")
            self.assertEqual(reality["privateKey"], "private-placeholder")
            self.assertEqual(reality["serverNames"], ["www.example.com"])
            self.assertEqual(reality["shortIds"], ["0011223344556677"])
            self.assertEqual(len(candidate["inbounds"]), 2)
            gate = candidate["inbounds"][1]
            self.assertEqual(gate["tag"], "reality-fallback-gate")
            self.assertEqual(gate["listen"], "127.0.0.1")
            self.assertEqual(gate["port"], 24431)
            self.assertEqual(gate["protocol"], "dokodemo-door")
            self.assertEqual(gate["settings"], {"address": "www.example.com", "port": 443, "network": "tcp"})
            self.assertTrue(gate["sniffing"]["routeOnly"])
            self.assertEqual(gate["sniffing"]["destOverride"], ["tls"])
            self.assertEqual(candidate["outbounds"], source_config["outbounds"])
            self.assertEqual(candidate["routing"]["rules"][:2], [
                {"type": "field", "inboundTag": ["reality-fallback-gate"], "domain": ["full:www.example.com"], "outboundTag": "direct", "ruleTag": "reality-fallback-allow-exact-sni"},
                {"type": "field", "inboundTag": ["reality-fallback-gate"], "outboundTag": "block", "ruleTag": "reality-fallback-block-other"},
            ])
            self.assertEqual(candidate["routing"]["rules"][2:], source_config["routing"]["rules"])
            clients = candidate["inbounds"][0]["settings"]["clients"]
            by_email = {client["email"]: client for client in clients}
            self.assertEqual(set(by_email), {f"{account_id}.vless" for account_id in MANAGED_ACCOUNT_IDS})
            self.assertNotIn(LEGACY.vless_uuid, json.dumps(clients))
            self.assertEqual(len({client["id"] for client in clients}), 6)
            self.assertTrue(candidate["policy"]["levels"]["0"]["statsUserUplink"])
            self.assertTrue(candidate["policy"]["levels"]["0"]["statsUserDownlink"])
            self.assertTrue(candidate["policy"]["levels"]["0"]["statsUserOnline"])
            self.assertTrue(candidate["policy"]["system"]["statsInboundUplink"])
            self.assertTrue(candidate["policy"]["system"]["statsInboundDownlink"])
            self.assertEqual(candidate["api"], {"tag": "api", "listen": "127.0.0.1:10085", "services": ["StatsService"]})
            render_xray_candidate(output, root / "candidate-rerun.json", store)
            rerun = json.loads((root / "candidate-rerun.json").read_text(encoding="utf-8"))
            self.assertEqual(rerun, candidate)
            conflicting_config = json.loads(json.dumps(source_config))
            conflicting_config["inbounds"][0]["streamSettings"]["realitySettings"]["target"] = "other.example.com:443"
            conflicting_source = root / "xray-conflicting.json"
            conflicting_source.write_text(json.dumps(conflicting_config), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "target and dest conflict"):
                render_xray_candidate(conflicting_source, root / "candidate-conflicting.json", store)
            future_records = [dict(row, enabled=0) if row["account_id"] == "legacy" else dict(row) for row in store.account_records_for_runtime()]
            render_xray_candidate(output, root / "candidate-retired.json", store, records=future_records)
            retired_clients = json.loads((root / "candidate-retired.json").read_text(encoding="utf-8"))["inbounds"][0]["settings"]["clients"]
            self.assertEqual(len(retired_clients), len(MANAGED_ACCOUNT_IDS))
            self.assertNotIn(LEGACY.vless_uuid, json.dumps(retired_clients))


if __name__ == "__main__":
    unittest.main()
