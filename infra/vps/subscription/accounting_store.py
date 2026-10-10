#!/usr/bin/env python3
"""Protected SQLite state and sanitized accounting snapshots for Amadeus Gateway.

Credential-bearing account rows stay in the runtime database.  Every public
snapshot is assembled from an explicit allowlist and never includes bearer
tokens, HY2 secrets, or VLESS UUIDs.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Iterator, Mapping


LABMEM_IDS = tuple(f"Labmem{i:03d}" for i in range(1, 6))
M204_ID = "M204-Net-Core"
MANAGED_ACCOUNT_IDS = (*LABMEM_IDS, M204_ID)
LEGACY_ID = "legacy"
INITIAL_ACCOUNT_IDS = (*LABMEM_IDS, LEGACY_ID)
ACCOUNT_IDS = (*MANAGED_ACCOUNT_IDS, LEGACY_ID)
PROTOCOLS = ("hy2", "vless")
AUTH_IDS = {LEGACY_ID: "legacy-hy2", **{account_id: account_id for account_id in MANAGED_ACCOUNT_IDS}}
VLESS_EMAILS = {LEGACY_ID: "legacy-vless", **{account_id: f"{account_id}.vless" for account_id in MANAGED_ACCOUNT_IDS}}
ACCOUNTING_SCHEMA_VERSION = 5


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _integer(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and value.isascii() and value.isdigit():
        parsed = int(value)
    else:
        return None
    return parsed if parsed >= 0 else None


@dataclass(frozen=True)
class LegacyCredentials:
    subscription_token: str
    hy2_secret: str
    vless_uuid: str


class AccountingStore:
    """Small stdlib-only store. Callers must not log returned credential rows."""

    def __init__(self, path: str | Path, *, stale_after_seconds: int = 180) -> None:
        self.path = Path(path)
        self.stale_after_seconds = max(60, stale_after_seconds)
        self.path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        old_umask = os.umask(0o077)
        try:
            with self._connect() as db:
                self._create_schema(db)
        finally:
            os.umask(old_umask)
        os.chmod(self.path, 0o600)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=5000")
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _create_schema(db: sqlite3.Connection) -> None:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS schema_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS accounts (
              account_id TEXT PRIMARY KEY,
              enabled INTEGER NOT NULL CHECK (enabled IN (0,1)),
              subscription_token TEXT NOT NULL UNIQUE,
              hy2_secret TEXT NOT NULL UNIQUE,
              vless_uuid TEXT NOT NULL UNIQUE,
              is_legacy INTEGER NOT NULL CHECK (is_legacy IN (0,1)),
              created_at TEXT NOT NULL,
              disabled_at TEXT
            );
            CREATE TABLE IF NOT EXISTS source_state (
              source TEXT PRIMARY KEY,
              status TEXT NOT NULL CHECK (status IN ('ok','error')),
              checked_at TEXT NOT NULL,
              last_success_at TEXT,
              error_code TEXT,
              generation TEXT,
              last_error_at TEXT
            );
            CREATE TABLE IF NOT EXISTS counter_state (
              account_id TEXT NOT NULL REFERENCES accounts(account_id),
              protocol TEXT NOT NULL CHECK (protocol IN ('hy2','vless')),
              upload_raw INTEGER NOT NULL CHECK (upload_raw >= 0),
              download_raw INTEGER NOT NULL CHECK (download_raw >= 0),
              cumulative_upload_bytes INTEGER NOT NULL CHECK (cumulative_upload_bytes >= 0),
              cumulative_download_bytes INTEGER NOT NULL CHECK (cumulative_download_bytes >= 0),
              generation TEXT,
              sampled_at TEXT NOT NULL,
              baseline_sampled_at TEXT,
              PRIMARY KEY (account_id, protocol)
            );
            CREATE TABLE IF NOT EXISTS traffic_deltas (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              account_id TEXT NOT NULL REFERENCES accounts(account_id),
              protocol TEXT NOT NULL CHECK (protocol IN ('hy2','vless')),
              interval_start_at TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              upload_bytes INTEGER NOT NULL CHECK (upload_bytes >= 0),
              download_bytes INTEGER NOT NULL CHECK (download_bytes >= 0),
              counter_reset INTEGER NOT NULL CHECK (counter_reset IN (0,1))
            );
            CREATE INDEX IF NOT EXISTS traffic_deltas_sampled_at_idx
              ON traffic_deltas(sampled_at);
            CREATE TABLE IF NOT EXISTS online_state (
              account_id TEXT NOT NULL REFERENCES accounts(account_id),
              protocol TEXT NOT NULL CHECK (protocol IN ('hy2','vless')),
              instances INTEGER NOT NULL CHECK (instances >= 0),
              sampled_at TEXT NOT NULL,
              PRIMARY KEY (account_id, protocol)
            );
            CREATE TABLE IF NOT EXISTS provider_state (
              singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
              counter_at_start INTEGER,
              last_counter INTEGER,
              delta_since_start INTEGER NOT NULL DEFAULT 0,
              total_bytes INTEGER,
              reset_at TEXT,
              last_sample_at TEXT,
              generation TEXT
            );
            INSERT OR IGNORE INTO provider_state(singleton) VALUES (1);
            CREATE TABLE IF NOT EXISTS provider_deltas (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              interval_start_at TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              bytes INTEGER NOT NULL CHECK (bytes >= 0),
              counter_reset INTEGER NOT NULL CHECK (counter_reset IN (0,1))
            );
            CREATE INDEX IF NOT EXISTS provider_deltas_sampled_at_idx
              ON provider_deltas(sampled_at);
            CREATE TABLE IF NOT EXISTS reality_fallback_state (
              singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
              upload_raw INTEGER NOT NULL CHECK (upload_raw >= 0),
              download_raw INTEGER NOT NULL CHECK (download_raw >= 0),
              cumulative_upload_bytes INTEGER NOT NULL CHECK (cumulative_upload_bytes >= 0),
              cumulative_download_bytes INTEGER NOT NULL CHECK (cumulative_download_bytes >= 0),
              generation TEXT,
              sampled_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reality_fallback_deltas (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              sampled_at TEXT NOT NULL,
              upload_bytes INTEGER NOT NULL CHECK (upload_bytes >= 0),
              download_bytes INTEGER NOT NULL CHECK (download_bytes >= 0),
              counter_reset INTEGER NOT NULL CHECK (counter_reset IN (0,1))
            );
            CREATE INDEX IF NOT EXISTS reality_fallback_deltas_sampled_at_idx
              ON reality_fallback_deltas(sampled_at);
            CREATE TABLE IF NOT EXISTS security_event_buckets (
              bucket_start TEXT NOT NULL,
              event_kind TEXT NOT NULL CHECK (event_kind IN ('hy2_auth_failure','hy2_auth_rate_limited')),
              event_count INTEGER NOT NULL CHECK (event_count >= 0),
              PRIMARY KEY (bucket_start,event_kind)
            );
            CREATE TABLE IF NOT EXISTS security_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
            INSERT OR IGNORE INTO schema_meta(key, value)
              VALUES ('schema_version', '1');
            """
        )
        source_columns = {row["name"] for row in db.execute("PRAGMA table_info(source_state)").fetchall()}
        if "last_error_at" not in source_columns:
            db.execute("ALTER TABLE source_state ADD COLUMN last_error_at TEXT")
        counter_columns = {row["name"] for row in db.execute("PRAGMA table_info(counter_state)").fetchall()}
        if "baseline_sampled_at" not in counter_columns:
            db.execute("ALTER TABLE counter_state ADD COLUMN baseline_sampled_at TEXT")
        db.execute(
            "INSERT INTO schema_meta(key,value) VALUES('schema_version',?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (str(ACCOUNTING_SCHEMA_VERSION),),
        )

    def record_reality_fallback_sample(
        self, *, upload: int, download: int, generation: str | None, sampled_at: str,
    ) -> None:
        """Persist sanitized inbound totals and reset-safe deltas, never destinations."""
        parsed_upload, parsed_download = _integer(upload), _integer(download)
        sqlite_max = (1 << 63) - 1
        if parsed_upload is None or parsed_download is None or parsed_upload > sqlite_max or parsed_download > sqlite_max:
            raise ValueError("Reality fallback counters are invalid")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT * FROM reality_fallback_state WHERE singleton=1").fetchone()
            reset = False
            if previous is None:
                upload_delta, download_delta = parsed_upload, parsed_download
            else:
                generation_changed = bool(
                    (generation is not None or previous["generation"] is not None)
                    and generation != previous["generation"]
                )
                reset = generation_changed or parsed_upload < previous["upload_raw"] or parsed_download < previous["download_raw"]
                upload_delta = parsed_upload if reset else parsed_upload - previous["upload_raw"]
                download_delta = parsed_download if reset else parsed_download - previous["download_raw"]
            cumulative_upload = (int(previous["cumulative_upload_bytes"]) if previous else 0) + upload_delta
            cumulative_download = (int(previous["cumulative_download_bytes"]) if previous else 0) + download_delta
            db.execute(
                "INSERT INTO reality_fallback_state VALUES (1,?,?,?,?,?,?) "
                "ON CONFLICT(singleton) DO UPDATE SET upload_raw=excluded.upload_raw,"
                "download_raw=excluded.download_raw,cumulative_upload_bytes=excluded.cumulative_upload_bytes,"
                "cumulative_download_bytes=excluded.cumulative_download_bytes,generation=excluded.generation,"
                "sampled_at=excluded.sampled_at",
                (parsed_upload, parsed_download, cumulative_upload, cumulative_download, generation, sampled_at),
            )
            db.execute(
                "INSERT INTO reality_fallback_deltas(sampled_at,upload_bytes,download_bytes,counter_reset) "
                "VALUES (?,?,?,?)",
                (sampled_at, upload_delta, download_delta, int(reset)),
            )
            cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(timespec="seconds").replace("+00:00", "Z")
            db.execute("DELETE FROM reality_fallback_deltas WHERE sampled_at < ?", (cutoff,))
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation,last_error_at) "
                "VALUES ('reality_fallback','ok',?,?,NULL,?,NULL) ON CONFLICT(source) DO UPDATE SET "
                "status='ok',checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,"
                "error_code=NULL,generation=excluded.generation",
                (sampled_at, sampled_at, generation),
            )
            db.commit()

    def record_security_event(self, event_kind: str, sampled_at: str) -> None:
        """Persist minute-bucket aggregates only; source addresses and auth values never enter SQLite."""
        if event_kind not in {"hy2_auth_failure", "hy2_auth_rate_limited"}:
            raise ValueError("security event kind is invalid")
        parsed = _parse_time(sampled_at)
        if parsed is None:
            raise ValueError("security event timestamp is invalid")
        bucket = parsed.replace(second=0, microsecond=0).isoformat(timespec="seconds").replace("+00:00", "Z")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO security_event_buckets(bucket_start,event_kind,event_count) VALUES (?,?,1) "
                "ON CONFLICT(bucket_start,event_kind) DO UPDATE SET event_count=event_count+1",
                (bucket, event_kind),
            )
            if event_kind == "hy2_auth_failure":
                db.execute(
                    "INSERT INTO security_meta(key,value) VALUES ('last_hy2_auth_failure_at',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (parsed.isoformat(timespec="seconds").replace("+00:00", "Z"),),
                )
            cutoff = (parsed - timedelta(days=3)).isoformat(timespec="seconds").replace("+00:00", "Z")
            db.execute("DELETE FROM security_event_buckets WHERE bucket_start < ?", (cutoff,))
            db.commit()

    @staticmethod
    def _security_signals(snapshot: dict[str, object], thresholds: Mapping[str, int]) -> list[dict[str, object]]:
        signals: list[dict[str, object]] = []
        security = snapshot.get("security") if isinstance(snapshot.get("security"), dict) else {}
        auth = security.get("hysteriaAuth") if isinstance(security, dict) and isinstance(security.get("hysteriaAuth"), dict) else {}
        failure_threshold = max(1, int(thresholds.get("hy2AuthFailThreshold", 60)))
        failures = auth.get("authFailuresLimiterWindow") if isinstance(auth, dict) else None
        if isinstance(failures, int) and failures >= failure_threshold:
            signals.append({"code": "hy2_auth_failures", "value": failures, "threshold": failure_threshold})
        limited = auth.get("authRateLimitedLimiterWindow") if isinstance(auth, dict) else None
        if isinstance(limited, int) and limited > 0:
            signals.append({"code": "hy2_auth_rate_limited", "value": limited, "threshold": 1})

        fallback = security.get("realityFallback") if isinstance(security, dict) and isinstance(security.get("realityFallback"), dict) else {}
        fallback_threshold = max(0, int(thresholds.get("realityFallbackAlertBytes", 1024)))
        fallback_window = fallback.get("windowTotalBytes") if isinstance(fallback, dict) else None
        if isinstance(fallback_window, int) and fallback_window > fallback_threshold:
            signals.append({"code": "reality_fallback_traffic", "value": fallback_window, "threshold": fallback_threshold})

        report = snapshot.get("reportWindow") if isinstance(snapshot.get("reportWindow"), dict) else {}
        accounts = snapshot.get("accounts") if isinstance(snapshot.get("accounts"), list) else []
        complete = bool(accounts) and all(isinstance(row, dict) and row.get("windowComplete") is True for row in accounts)
        windows = [row.get("windowBytes") for row in accounts if isinstance(row, dict)]
        if complete and windows and all(isinstance(value, int) and value >= 0 for value in windows):
            total = sum(windows)
            minimum = max(0, int(thresholds.get("accountDominantMinWindowBytes", 1 << 30)))
            share_threshold = min(100, max(1, int(thresholds.get("accountDominantSharePercent", 85))))
            top = report.get("topAccount") if isinstance(report, dict) and isinstance(report.get("topAccount"), dict) else None
            if top and total >= minimum and total > 0:
                top_bytes = top.get("windowBytes")
                account_id = top.get("accountId")
                share = (int(top_bytes) * 100) // total if isinstance(top_bytes, int) and account_id in MANAGED_ACCOUNT_IDS else 0
                if share >= share_threshold:
                    signals.append({
                        "code": "account_dominant_window",
                        "accountId": account_id,
                        "sharePercent": share,
                        "thresholdPercent": share_threshold,
                        "windowBytes": int(top_bytes),
                    })
        return signals

    def health(self) -> bool:
        with self._connect() as db:
            return db.execute("PRAGMA quick_check").fetchone()[0] == "ok"

    def initialize_accounts(self, legacy: LegacyCredentials, *, created_at: str | None = None) -> list[str]:
        """Create the imported legacy + five Labmem identities once; never rotate on rerun."""
        if not legacy.subscription_token or not legacy.hy2_secret:
            raise ValueError("legacy credentials are incomplete")
        try:
            uuid.UUID(legacy.vless_uuid)
        except (ValueError, AttributeError) as error:
            raise ValueError("legacy VLESS identity is invalid") from error
        if not all(c.isalnum() or c in "._~-" for c in legacy.subscription_token):
            raise ValueError("legacy subscription identity is invalid")
        timestamp = created_at or utc_now()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT account_id FROM accounts ORDER BY account_id").fetchall()
            existing = {row["account_id"] for row in rows}
            if existing:
                if existing not in (set(INITIAL_ACCOUNT_IDS), set(ACCOUNT_IDS)):
                    db.rollback()
                    raise RuntimeError("account store is partially initialized; refusing credential regeneration")
                legacy_row = db.execute(
                    "SELECT subscription_token,hy2_secret,vless_uuid,is_legacy FROM accounts WHERE account_id=?",
                    (LEGACY_ID,),
                ).fetchone()
                same_legacy = bool(
                    legacy_row
                    and legacy_row["is_legacy"] == 1
                    and hmac.compare_digest(legacy_row["subscription_token"], legacy.subscription_token)
                    and hmac.compare_digest(legacy_row["hy2_secret"], legacy.hy2_secret)
                    and hmac.compare_digest(legacy_row["vless_uuid"], legacy.vless_uuid)
                )
                db.rollback()
                if not same_legacy:
                    raise RuntimeError("legacy identity differs from protected account-store state")
                return list(LABMEM_IDS)

            db.execute(
                "INSERT INTO accounts VALUES (?,?,?,?,?,?,?,NULL)",
                (LEGACY_ID, 1, legacy.subscription_token, legacy.hy2_secret, legacy.vless_uuid, 1, timestamp),
            )
            used_tokens = {legacy.subscription_token}
            used_hy2 = {legacy.hy2_secret}
            used_uuid = {legacy.vless_uuid.lower()}
            for account_id in LABMEM_IDS:
                token = _unique_secret(used_tokens)
                hy2 = _unique_secret(used_hy2)
                client_uuid = str(uuid.uuid4())
                while client_uuid.lower() in used_uuid:
                    client_uuid = str(uuid.uuid4())
                used_uuid.add(client_uuid.lower())
                db.execute(
                    "INSERT INTO accounts VALUES (?,?,?,?,?,?,?,NULL)",
                    (account_id, 1, token, hy2, client_uuid, 0, timestamp),
                )
            db.commit()
        os.chmod(self.path, 0o600)
        return list(LABMEM_IDS)

    def provision_m204(self, *, created_at: str | None = None) -> bool:
        """Create the dedicated Mac mini identity once; reruns never rotate credentials."""
        timestamp = created_at or utc_now()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            rows = db.execute("SELECT account_id FROM accounts ORDER BY account_id").fetchall()
            existing = {row["account_id"] for row in rows}
            if existing == set(ACCOUNT_IDS):
                account = db.execute(
                    "SELECT enabled,is_legacy FROM accounts WHERE account_id=?", (M204_ID,),
                ).fetchone()
                db.rollback()
                if not account or account["is_legacy"] != 0 or account["enabled"] != 1:
                    raise RuntimeError("M204-Net-Core is retired or has an invalid account record")
                return False
            if existing != set(INITIAL_ACCOUNT_IDS):
                db.rollback()
                raise RuntimeError("account store is not at the expected pre-M204 state")
            used_tokens = {row[0] for row in db.execute("SELECT subscription_token FROM accounts")}
            used_hy2 = {row[0] for row in db.execute("SELECT hy2_secret FROM accounts")}
            used_uuids = {str(row[0]).lower() for row in db.execute("SELECT vless_uuid FROM accounts")}
            token = _unique_secret(used_tokens)
            hy2_secret = _unique_secret(used_hy2)
            client_uuid = str(uuid.uuid4())
            while client_uuid.lower() in used_uuids:
                client_uuid = str(uuid.uuid4())
            db.execute(
                "INSERT INTO accounts VALUES (?,?,?,?,?,?,?,NULL)",
                (M204_ID, 1, token, hy2_secret, client_uuid, 0, timestamp),
            )
            db.commit()
        os.chmod(self.path, 0o600)
        return True

    def disable_legacy(self, *, disabled_at: str | None = None) -> bool:
        """Revoke and replace every live legacy secret while retaining usage history."""
        timestamp = disabled_at or utc_now()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT enabled,is_legacy FROM accounts WHERE account_id=?", (LEGACY_ID,),
            ).fetchone()
            if not row or row["is_legacy"] != 1:
                db.rollback()
                raise RuntimeError("legacy identity is unavailable")
            if row["enabled"] == 0:
                db.rollback()
                return False
            used_tokens = {item[0] for item in db.execute("SELECT subscription_token FROM accounts")}
            used_hy2 = {item[0] for item in db.execute("SELECT hy2_secret FROM accounts")}
            used_uuids = {str(item[0]).lower() for item in db.execute("SELECT vless_uuid FROM accounts")}
            token = _unique_secret(used_tokens)
            hy2_secret = _unique_secret(used_hy2)
            client_uuid = str(uuid.uuid4())
            while client_uuid.lower() in used_uuids:
                client_uuid = str(uuid.uuid4())
            db.execute(
                "UPDATE accounts SET enabled=0,subscription_token=?,hy2_secret=?,vless_uuid=?,disabled_at=? "
                "WHERE account_id=?",
                (token, hy2_secret, client_uuid, timestamp, LEGACY_ID),
            )
            db.commit()
        return True

    def account_records_for_runtime(self) -> list[dict[str, str | int | None]]:
        """Internal credential-bearing records. Never serialize or log this result."""
        with self._connect() as db:
            rows = db.execute(
                "SELECT account_id,enabled,subscription_token,hy2_secret,vless_uuid,is_legacy,created_at,disabled_at "
                "FROM accounts ORDER BY is_legacy,account_id"
            ).fetchall()
        return [dict(row) for row in rows]

    def auth_account_id(self, candidate: str) -> str | None:
        if not isinstance(candidate, str) or not candidate or len(candidate) > 512:
            return None
        match: str | None = None
        with self._connect() as db:
            rows = db.execute(
                "SELECT account_id,hy2_secret FROM accounts WHERE enabled=1 ORDER BY account_id"
            ).fetchall()
        for row in rows:
            equal = hmac.compare_digest(row["hy2_secret"], candidate)
            if equal:
                match = row["account_id"]
        return match

    def mark_source_success(self, source: str, sampled_at: str, *, generation: str | None = None) -> None:
        with self._connect() as db:
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation) "
                "VALUES (?, 'ok', ?, ?, NULL, ?) "
                "ON CONFLICT(source) DO UPDATE SET status='ok',checked_at=excluded.checked_at,"
                "last_success_at=excluded.last_success_at,error_code=NULL,generation=excluded.generation",
                (source, sampled_at, sampled_at, generation),
            )

    def mark_source_error(self, source: str, sampled_at: str, error_code: str) -> None:
        safe_code = error_code if error_code in {"unreachable", "invalid_response", "timeout", "unavailable", "unsupported_version"} else "unavailable"
        with self._connect() as db:
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation,last_error_at) "
                "VALUES (?, 'error', ?, NULL, ?, NULL, ?) "
                "ON CONFLICT(source) DO UPDATE SET status='error',checked_at=excluded.checked_at,"
                "error_code=excluded.error_code,last_error_at=excluded.last_error_at",
                (source, sampled_at, safe_code, sampled_at),
            )

    def migrate_hysteria_direction_to_client_perspective(self) -> bool:
        """Swap previously stored HY2 directions once after correcting tx/rx mapping."""
        migration_key = "hysteria_direction_client_perspective_v1"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT value FROM schema_meta WHERE key=?", (migration_key,)).fetchone()
            if existing:
                db.rollback()
                return False
            db.execute(
                "UPDATE counter_state SET upload_raw=download_raw,download_raw=upload_raw,"
                "cumulative_upload_bytes=cumulative_download_bytes,"
                "cumulative_download_bytes=cumulative_upload_bytes WHERE protocol='hy2'"
            )
            db.execute(
                "UPDATE traffic_deltas SET upload_bytes=download_bytes,download_bytes=upload_bytes "
                "WHERE protocol='hy2'"
            )
            db.execute(
                "INSERT INTO schema_meta(key,value) VALUES (?,?)",
                (migration_key, utc_now()),
            )
            db.commit()
        return True

    def backfill_legacy_vless_t0_baseline(self, *, expected_upload: int, expected_download: int) -> bool:
        """Close a verified missing T0 sample without claiming pre-T0 legacy usage."""
        upload, download = _integer(expected_upload), _integer(expected_download)
        if upload is None or download is None:
            raise ValueError("expected VLESS counters are invalid")
        migration_key = "legacy_vless_t0_baseline_v1"
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM schema_meta WHERE key=?", (migration_key,)).fetchone():
                db.rollback()
                return False
            started = db.execute(
                "SELECT value FROM schema_meta WHERE key='accounting_started_at'"
            ).fetchone()
            state = db.execute(
                "SELECT * FROM counter_state WHERE account_id=? AND protocol='vless'",
                (LEGACY_ID,),
            ).fetchone()
            source = db.execute(
                "SELECT status,last_success_at,last_error_at FROM source_state WHERE source='xray'"
            ).fetchone()
            if not started or not state or not source or source["status"] != "ok" or not source["last_success_at"]:
                db.rollback()
                raise RuntimeError("legacy VLESS T0 baseline evidence is incomplete")
            start_at = started["value"]
            last_error = _parse_time(source["last_error_at"])
            start_time = _parse_time(start_at)
            if last_error is not None and start_time is not None and last_error >= start_time:
                db.rollback()
                raise RuntimeError("legacy VLESS source had an error after T0")
            if (
                state["baseline_sampled_at"] is not None
                or int(state["upload_raw"]) != upload
                or int(state["download_raw"]) != download
                or int(state["cumulative_upload_bytes"]) != 0
                or int(state["cumulative_download_bytes"]) != 0
            ):
                db.rollback()
                raise RuntimeError("legacy VLESS raw counters no longer match the reviewed T0 evidence")
            deltas = db.execute(
                "SELECT COALESCE(SUM(upload_bytes+download_bytes),0) FROM traffic_deltas "
                "WHERE account_id=? AND protocol='vless' AND sampled_at>=?",
                (LEGACY_ID, start_at),
            ).fetchone()[0]
            if int(deltas or 0) != 0:
                db.rollback()
                raise RuntimeError("legacy VLESS has traffic deltas after T0")
            db.execute(
                "UPDATE counter_state SET baseline_sampled_at=? WHERE account_id=? AND protocol='vless'",
                (start_at, LEGACY_ID),
            )
            db.execute(
                "INSERT INTO schema_meta(key,value) VALUES (?,?)",
                (migration_key, utc_now()),
            )
            db.commit()
        return True

    def record_provider_sample(
        self,
        *,
        counter_bytes: int,
        total_bytes: int,
        reset_at: str | None,
        sampled_at: str,
        generation: str | None = None,
    ) -> bool:
        """Persist KiwiVM counters and return True when this sample establishes T0."""
        parsed_counter, parsed_total = _integer(counter_bytes), _integer(total_bytes)
        if parsed_counter is None or parsed_total is None or parsed_total <= 0:
            raise ValueError("provider counters are invalid")
        counter_bytes, total_bytes = parsed_counter, parsed_total
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT * FROM provider_state WHERE singleton=1").fetchone()
            started = previous["counter_at_start"] is None
            reset_changed = False
            reset_seen = False
            if started:
                counter_at_start = counter_bytes
                last_counter = counter_bytes
                delta = 0
                delta_since_start = 0
                db.execute(
                    "INSERT INTO schema_meta(key,value) VALUES('accounting_started_at',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (sampled_at,),
                )
                db.execute(
                    "INSERT INTO schema_meta(key,value) VALUES('provider_counter_at_start',?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (str(counter_bytes),),
                )
            else:
                counter_at_start = previous["counter_at_start"]
                last_counter = previous["last_counter"]
                reset_changed = bool(reset_at and previous["reset_at"] and reset_at != previous["reset_at"])
                reset_seen = last_counter is not None and counter_bytes < last_counter
                delta = counter_bytes if reset_changed or reset_seen else max(counter_bytes - (last_counter or 0), 0)
                delta_since_start = int(previous["delta_since_start"] or 0) + delta
            interval_start = previous["last_sample_at"] if previous and previous["last_sample_at"] else sampled_at
            db.execute(
                "UPDATE provider_state SET counter_at_start=?,last_counter=?,delta_since_start=?,total_bytes=?,"
                "reset_at=?,last_sample_at=?,generation=? WHERE singleton=1",
                (counter_at_start, counter_bytes, delta_since_start, total_bytes, reset_at, sampled_at, generation),
            )
            db.execute(
                "INSERT INTO provider_deltas(interval_start_at,sampled_at,bytes,counter_reset) VALUES (?,?,?,?)",
                (interval_start, sampled_at, delta, int(reset_changed or reset_seen)),
            )
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation) "
                "VALUES ('provider','ok',?,?,NULL,?) ON CONFLICT(source) DO UPDATE SET status='ok',"
                "checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,error_code=NULL,"
                "generation=excluded.generation",
                (sampled_at, sampled_at, generation),
            )
            cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(timespec="seconds").replace("+00:00", "Z")
            db.execute("DELETE FROM provider_deltas WHERE sampled_at < ?", (cutoff,))
            db.commit()
        return started

    def record_counter_sample(
        self,
        *,
        source: str,
        protocol: str,
        counters: Mapping[str, tuple[int, int]],
        generation: str | None,
        sampled_at: str,
        baseline: bool = False,
    ) -> None:
        if protocol not in PROTOCOLS or source not in {"hysteria_traffic", "xray"}:
            raise ValueError("counter source is invalid")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            started_row = db.execute(
                "SELECT value FROM schema_meta WHERE key='accounting_started_at'"
            ).fetchone()
            monitoring_started_at = str(started_row["value"]) if started_row else None
            account_created_row = db.execute(
                "SELECT created_at FROM accounts WHERE account_id=?", (M204_ID,),
            ).fetchone()
            m204_started_at = str(account_created_row["created_at"]) if account_created_row else None
            for account_id, values in counters.items():
                if account_id not in ACCOUNT_IDS or not isinstance(values, tuple) or len(values) != 2:
                    continue
                upload, download = _integer(values[0]), _integer(values[1])
                if upload is None or download is None:
                    continue
                previous = db.execute(
                    "SELECT * FROM counter_state WHERE account_id=? AND protocol=?",
                    (account_id, protocol),
                ).fetchone()
                counter_reset = False
                if baseline:
                    upload_delta = download_delta = 0
                    interval_start = sampled_at
                elif previous is None:
                    # These credentials did not exist before their start time,
                    # so their first absolute counter value is attributable.
                    if account_id == M204_ID and m204_started_at:
                        upload_delta, download_delta = upload, download
                        interval_start = m204_started_at
                    elif account_id in LABMEM_IDS and monitoring_started_at:
                        upload_delta, download_delta = upload, download
                        interval_start = monitoring_started_at
                    else:
                        upload_delta = download_delta = 0
                        interval_start = sampled_at
                else:
                    generation_changed = bool(
                        (generation is not None or previous["generation"] is not None)
                        and generation != previous["generation"]
                    )
                    counter_reset = generation_changed or upload < previous["upload_raw"] or download < previous["download_raw"]
                    upload_delta = upload if counter_reset else upload - previous["upload_raw"]
                    download_delta = download if counter_reset else download - previous["download_raw"]
                    interval_start = previous["sampled_at"]
                if baseline:
                    baseline_sampled_at = sampled_at
                elif previous is None:
                    baseline_sampled_at = m204_started_at if account_id == M204_ID else (
                        monitoring_started_at if account_id in LABMEM_IDS and monitoring_started_at else None
                    )
                else:
                    baseline_sampled_at = previous["baseline_sampled_at"]
                cumulative_upload = (int(previous["cumulative_upload_bytes"]) if previous else 0) + upload_delta
                cumulative_download = (int(previous["cumulative_download_bytes"]) if previous else 0) + download_delta
                db.execute(
                    "INSERT INTO counter_state(account_id,protocol,upload_raw,download_raw,cumulative_upload_bytes,"
                    "cumulative_download_bytes,generation,sampled_at,baseline_sampled_at) VALUES (?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(account_id,protocol) DO UPDATE SET upload_raw=excluded.upload_raw,"
                    "download_raw=excluded.download_raw,cumulative_upload_bytes=excluded.cumulative_upload_bytes,"
                    "cumulative_download_bytes=excluded.cumulative_download_bytes,generation=excluded.generation,"
                    "sampled_at=excluded.sampled_at,baseline_sampled_at=excluded.baseline_sampled_at",
                    (
                        account_id, protocol, upload, download, cumulative_upload, cumulative_download,
                        generation, sampled_at, baseline_sampled_at,
                    ),
                )
                if not baseline:
                    db.execute(
                        "INSERT INTO traffic_deltas(account_id,protocol,interval_start_at,sampled_at,upload_bytes,"
                        "download_bytes,counter_reset) VALUES (?,?,?,?,?,?,?)",
                        (account_id, protocol, interval_start, sampled_at, upload_delta, download_delta, int(counter_reset)),
                    )
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation) "
                "VALUES (?, 'ok', ?, ?, NULL, ?) ON CONFLICT(source) DO UPDATE SET status='ok',"
                "checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,error_code=NULL,"
                "generation=excluded.generation",
                (source, sampled_at, sampled_at, generation),
            )
            # The user-facing report window is 12 hours. Keep three days of
            # bounded detail for retries and clock skew; lifetime totals are
            # already in counter_state and do not need old delta rows.
            cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(timespec="seconds").replace("+00:00", "Z")
            db.execute("DELETE FROM traffic_deltas WHERE sampled_at < ?", (cutoff,))
            db.commit()

    def record_online_sample(
        self, values: Mapping[str, int], sampled_at: str, *, protocol: str, source: str,
    ) -> None:
        """Persist bounded protocol online counts without retaining source IPs."""
        if protocol not in PROTOCOLS or source not in {"hysteria_online", "xray_online"}:
            raise ValueError("online sample source or protocol is invalid")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            account_ids = [row[0] for row in db.execute("SELECT account_id FROM accounts").fetchall()]
            for account_id in account_ids:
                count = values.get(account_id, 0)
                parsed = _integer(count)
                if parsed is None:
                    continue
                db.execute(
                    "INSERT INTO online_state VALUES (?, ?, ?, ?) ON CONFLICT(account_id,protocol) "
                    "DO UPDATE SET instances=excluded.instances,sampled_at=excluded.sampled_at",
                    (account_id, protocol, parsed, sampled_at),
                )
            db.execute(
                "INSERT INTO source_state(source,status,checked_at,last_success_at,error_code,generation) "
                "VALUES (?, 'ok', ?, ?, NULL, NULL) ON CONFLICT(source) DO UPDATE SET status='ok',"
                "checked_at=excluded.checked_at,last_success_at=excluded.last_success_at,error_code=NULL",
                (source, sampled_at, sampled_at),
            )
            db.commit()

    def _current_source_state(self, db: sqlite3.Connection, now: datetime) -> dict[str, dict[str, object]]:
        result: dict[str, dict[str, object]] = {}
        for row in db.execute("SELECT * FROM source_state ORDER BY source").fetchall():
            checked = _parse_time(row["checked_at"])
            last_success = _parse_time(row["last_success_at"])
            stale = not checked or (now - checked).total_seconds() > self.stale_after_seconds
            status = "ok" if row["status"] == "ok" and not stale else "stale" if last_success else "error"
            if row["status"] == "error" and last_success:
                status = "stale" if (now - last_success).total_seconds() > self.stale_after_seconds else "error"
            result[row["source"]] = {
                "status": status,
                "checkedAt": row["checked_at"],
                "lastSuccessfulAt": row["last_success_at"],
                "lastErrorAt": row["last_error_at"],
                "errorCode": row["error_code"] if row["status"] == "error" else None,
                "generation": row["generation"],
            }
        return result

    def public_snapshot(
        self, *, now: datetime | None = None, window_seconds: int = 12 * 60 * 60,
        auth_security: Mapping[str, object] | None = None,
        security_thresholds: Mapping[str, int] | None = None,
    ) -> dict[str, object]:
        current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        generated_at = current.isoformat(timespec="seconds").replace("+00:00", "Z")
        cutoff_dt = current - timedelta(seconds=max(60, window_seconds))
        cutoff = cutoff_dt.isoformat(timespec="seconds").replace("+00:00", "Z")
        with self._connect() as db:
            accounts = db.execute("SELECT account_id,enabled,is_legacy,created_at FROM accounts ORDER BY is_legacy,account_id").fetchall()
            states = {
                (row["account_id"], row["protocol"]): row
                for row in db.execute("SELECT * FROM counter_state").fetchall()
            }
            online = {
                (row["account_id"], row["protocol"]): row
                for row in db.execute("SELECT * FROM online_state").fetchall()
            }
            sources = self._current_source_state(db, current)
            meta = {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM schema_meta").fetchall()}
            provider = db.execute("SELECT * FROM provider_state WHERE singleton=1").fetchone()
            provider_window = db.execute(
                "SELECT COALESCE(SUM(bytes),0) AS bytes,COUNT(*) AS samples,MIN(interval_start_at) AS interval_start "
                "FROM provider_deltas WHERE sampled_at >= ?",
                (cutoff,),
            ).fetchone()
            fallback_state = db.execute("SELECT * FROM reality_fallback_state WHERE singleton=1").fetchone()
            fallback_window = db.execute(
                "SELECT SUM(upload_bytes) AS upload,SUM(download_bytes) AS download "
                "FROM reality_fallback_deltas WHERE sampled_at >= ?",
                (cutoff,),
            ).fetchone()
            security_event_rows = db.execute(
                "SELECT event_kind,SUM(event_count) AS event_count FROM security_event_buckets "
                "WHERE bucket_start >= ? GROUP BY event_kind",
                (cutoff,),
            ).fetchall()
            security_meta = {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM security_meta").fetchall()}
            window_rows = db.execute(
                "SELECT account_id,protocol,SUM(upload_bytes+download_bytes) AS total,"
                "SUM(upload_bytes) AS upload,SUM(download_bytes) AS download,COUNT(*) AS samples "
                "FROM traffic_deltas WHERE sampled_at >= ? GROUP BY account_id,protocol",
                (cutoff,),
            ).fetchall()
        window_by_account = {(row["account_id"], row["protocol"]): row for row in window_rows}
        started_at = meta.get("accounting_started_at")
        started_dt = _parse_time(started_at)
        account_created_at = {str(row["account_id"]): str(row["created_at"]) for row in accounts}

        def account_started_at(account_id: str) -> str | None:
            if account_id == M204_ID:
                return account_created_at.get(account_id)
            return started_at

        def account_started_dt(account_id: str) -> datetime | None:
            return _parse_time(account_started_at(account_id))

        def source_clean_since(source: str, boundary: datetime | None) -> bool:
            state = sources.get(source)
            if not boundary or not state or state.get("status") != "ok":
                return False
            last_error = _parse_time(str(state["lastErrorAt"])) if state.get("lastErrorAt") else None
            return last_error is None or last_error < boundary

        def counter_baseline_covers(account_id: str, row: sqlite3.Row | None, boundary: datetime | None) -> bool:
            if boundary is None:
                return False
            if row is None:
                # Fresh managed identities have no attributable traffic before
                # their creation; a missing row is zero only while collection is healthy.
                return account_id in MANAGED_ACCOUNT_IDS
            baseline_at = _parse_time(row["baseline_sampled_at"])
            return baseline_at is not None and baseline_at <= boundary

        account_results: dict[str, dict[str, object]] = {}
        protocol_totals: dict[str, dict[str, object]] = {}
        for protocol in PROTOCOLS:
            known = [states[(account_id, protocol)] for account_id in MANAGED_ACCOUNT_IDS if (account_id, protocol) in states]
            source_name = "hysteria_traffic" if protocol == "hy2" else "xray"
            observed_accounts = sum(
                counter_baseline_covers(account_id, states.get((account_id, protocol)), account_started_dt(account_id))
                for account_id in MANAGED_ACCOUNT_IDS
            )
            baseline_complete = all(
                counter_baseline_covers(account_id, states.get((account_id, protocol)), account_started_dt(account_id))
                and source_clean_since(source_name, account_started_dt(account_id))
                for account_id in MANAGED_ACCOUNT_IDS
            )
            protocol_totals[protocol] = {
                "knownBytes": sum(int(row["cumulative_upload_bytes"]) + int(row["cumulative_download_bytes"]) for row in known),
                "observedAccounts": observed_accounts,
                "complete": baseline_complete,
                "source": sources.get(source_name, {"status": "unknown"}),
            }
        for account_row in accounts:
            account_id = account_row["account_id"]
            account_start_at = account_started_at(account_id)
            account_start = account_started_dt(account_id)
            protocols: dict[str, object] = {}
            known_totals: list[int] = []
            complete_protocols = True
            recent_totals: list[int] = []
            recent_complete = True
            for protocol in PROTOCOLS:
                counter = states.get((account_id, protocol))
                source_name = "hysteria_traffic" if protocol == "hy2" else "xray"
                counter_status = sources.get(source_name, {"status": "error", "checkedAt": None, "lastSuccessfulAt": None})
                total_coverage = counter_baseline_covers(account_id, counter, account_start)
                total_source_clean = source_clean_since(source_name, account_start)
                if not total_coverage or not total_source_clean:
                    complete_protocols = False
                window_boundary = max(cutoff_dt, account_start) if account_start else None
                window_source_clean = source_clean_since(source_name, window_boundary)
                window_coverage = counter_baseline_covers(account_id, counter, window_boundary)
                if not window_coverage or not window_source_clean:
                    recent_complete = False
                window_row = window_by_account.get((account_id, protocol))
                if counter is None and account_id in MANAGED_ACCOUNT_IDS and total_coverage and total_source_clean:
                    upload_bytes = download_bytes = total_bytes = 0
                    observed_at = account_start_at
                    known_totals.append(0)
                elif counter is None or not total_coverage:
                    upload_bytes = download_bytes = total_bytes = observed_at = None
                    complete_protocols = False
                    if counter is not None:
                        known_totals.append(int(counter["cumulative_upload_bytes"]) + int(counter["cumulative_download_bytes"]))
                else:
                    upload_bytes = int(counter["cumulative_upload_bytes"])
                    download_bytes = int(counter["cumulative_download_bytes"])
                    total_bytes = upload_bytes + download_bytes
                    observed_at = counter["sampled_at"]
                    known_totals.append(total_bytes)
                if window_row is None and account_id in MANAGED_ACCOUNT_IDS and window_coverage and window_source_clean:
                    window_total = 0
                    recent_totals.append(0)
                elif window_row is None or not window_coverage or not window_source_clean:
                    window_total = None
                    recent_complete = False
                else:
                    window_total = int(window_row["total"] or 0)
                    recent_totals.append(window_total)
                online_row = online.get((account_id, protocol))
                online_source_name = "hysteria_online" if protocol == "hy2" else "xray_online"
                online_source = sources.get(online_source_name, {"status": "unknown"})
                protocol_online = int(online_row["instances"]) if online_row else None
                online_status = online_source.get("status", "unknown") if online_row else "unknown"
                protocols[protocol] = {
                    "uploadBytes": upload_bytes,
                    "downloadBytes": download_bytes,
                    "totalBytes": total_bytes,
                    "lastCounterSampleAt": observed_at,
                    "status": counter_status.get("status", "unknown") if total_coverage else "unknown",
                    "onlineCount": protocol_online,
                    "onlineCountKind": "client_instances" if protocol == "hy2" else "unique_source_ips",
                    "onlineStatus": online_status,
                    "onlineSampledAt": online_row["sampled_at"] if online_row else None,
                    "windowBytes": window_total,
                    "windowSampleCount": int(window_row["samples"]) if window_row else 0,
                }
            account_results[account_id] = {
                "accountId": account_id,
                "enabled": bool(account_row["enabled"]),
                "monitoringStartedAt": account_start_at,
                "protocols": protocols,
                "totalMonitoredBytes": sum(known_totals) if complete_protocols else None,
                "knownMonitoredBytes": sum(known_totals),
                "totalsComplete": complete_protocols,
                "windowBytes": sum(recent_totals) if recent_complete else None,
                "windowComplete": recent_complete,
            }
        monitored_known = sum(
            int(row["cumulative_upload_bytes"]) + int(row["cumulative_download_bytes"])
            for (account_id, _), row in states.items() if account_id in MANAGED_ACCOUNT_IDS
        )
        proxy_accounted_complete = (
            all(
                counter_baseline_covers(account_id, states.get((account_id, protocol)), account_started_dt(account_id))
                and source_clean_since("hysteria_traffic" if protocol == "hy2" else "xray", account_started_dt(account_id))
                for account_id in MANAGED_ACCOUNT_IDS for protocol in PROTOCOLS
            )
        )
        proxy_accounted = monitored_known if proxy_accounted_complete else None
        provider_started = provider["counter_at_start"] is not None
        provider_delta = int(provider["delta_since_start"]) if provider_started else None
        provider_window_samples = int(provider_window["samples"] or 0)
        provider_window_complete = bool(
            provider_started
            and provider_window_samples > 0
            and _parse_time(provider_window["interval_start"]) is not None
            and _parse_time(provider_window["interval_start"]) <= cutoff_dt
            and source_clean_since("provider", cutoff_dt)
        )
        provider_window_bytes = int(provider_window["bytes"] or 0) if provider_window_complete else None
        active_window_complete = all(
            account_results.get(account_id, {}).get("windowComplete") is True
            for account_id in MANAGED_ACCOUNT_IDS
        )
        active_window_bytes = (
            sum(int(account_results[account_id]["windowBytes"]) for account_id in MANAGED_ACCOUNT_IDS)
            if active_window_complete else None
        )
        legacy_result = account_results.get(LEGACY_ID) or {}
        legacy_window_complete = legacy_result.get("windowComplete") is True
        legacy_window_bytes = int(legacy_result["windowBytes"]) if legacy_window_complete and isinstance(legacy_result.get("windowBytes"), int) else None
        other_service_window_bytes = (
            provider_window_bytes - active_window_bytes
            if provider_window_bytes is not None and active_window_bytes is not None and provider_window_bytes >= active_window_bytes
            else None
        )
        other_service_window_status = "uncalibrated" if other_service_window_bytes is not None else "unknown"
        fallback_source = sources.get("reality_fallback", {"status": "unknown", "checkedAt": None, "lastSuccessfulAt": None})
        fallback_window_clean = source_clean_since("reality_fallback", cutoff_dt)
        fallback_window_upload = int(fallback_window["upload"] or 0) if fallback_window_clean else None
        fallback_window_download = int(fallback_window["download"] or 0) if fallback_window_clean else None
        event_counts = {str(row["event_kind"]): int(row["event_count"] or 0) for row in security_event_rows}
        tracker = auth_security if isinstance(auth_security, Mapping) else {}

        def tracker_count(name: str) -> int | None:
            value = tracker.get(name)
            return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= (1 << 53) - 1 else None

        limiter_mode = tracker.get("limiterMode") if tracker.get("limiterMode") in {"telemetry", "enforce"} else "unknown"
        last_failure_at = security_meta.get("last_hy2_auth_failure_at")
        tracker_last_failure = tracker.get("lastFailureAt")
        if isinstance(tracker_last_failure, str) and (_parse_time(tracker_last_failure) or datetime.min.replace(tzinfo=timezone.utc)) > (_parse_time(last_failure_at) or datetime.min.replace(tzinfo=timezone.utc)):
            last_failure_at = tracker_last_failure
        security = {
            "realityFallback": {
                "uplinkBytes": int(fallback_state["cumulative_upload_bytes"]) if fallback_state else None,
                "downlinkBytes": int(fallback_state["cumulative_download_bytes"]) if fallback_state else None,
                "totalBytes": int(fallback_state["cumulative_upload_bytes"]) + int(fallback_state["cumulative_download_bytes"]) if fallback_state else None,
                "windowUplinkBytes": fallback_window_upload,
                "windowDownlinkBytes": fallback_window_download,
                "windowTotalBytes": fallback_window_upload + fallback_window_download if fallback_window_upload is not None and fallback_window_download is not None else None,
                "lastCounterSampleAt": fallback_state["sampled_at"] if fallback_state else None,
                "status": fallback_source.get("status", "unknown"),
                "checkedAt": fallback_source.get("checkedAt"),
                "lastSuccessfulAt": fallback_source.get("lastSuccessfulAt"),
            },
            "hysteriaAuth": {
                "status": "ok" if auth_security is not None else "unknown",
                "windowSeconds": max(60, window_seconds),
                "authFailuresWindow": event_counts.get("hy2_auth_failure", 0),
                "authRateLimitedWindow": event_counts.get("hy2_auth_rate_limited", 0),
                "limiterMode": limiter_mode,
                "limiterWindowSeconds": tracker_count("limiterWindowSeconds"),
                "limiterWindowCoverageSeconds": tracker_count("limiterWindowCoverageSeconds"),
                "authFailuresLimiterWindow": tracker_count("authFailuresLimiterWindow"),
                "authRateLimitedLimiterWindow": tracker_count("authRateLimitedLimiterWindow"),
                "uniqueFailureSourcesWindowApproximate": tracker_count("uniqueFailureSourcesWindowApproximate"),
                "uniqueFailureSourcesWindowSeconds": tracker_count("uniqueFailureSourcesWindowSeconds"),
                "trackingCapacityReached": tracker.get("trackingCapacityReached") is True,
                "processStartedAt": tracker.get("processStartedAt") if isinstance(tracker.get("processStartedAt"), str) else None,
                "lastFailureAt": last_failure_at,
            },
        }
        all_window_complete = all(account_results.get(account_id, {}).get("windowComplete") for account_id in MANAGED_ACCOUNT_IDS)
        top_account = None
        if all_window_complete:
            ranked = sorted(
                ((int(account_results[a]["windowBytes"]), a) for a in MANAGED_ACCOUNT_IDS),
                key=lambda item: (-item[0], item[1]),
            )
            if ranked:
                top_account = {"accountId": ranked[0][1], "windowBytes": ranked[0][0]}
        common = {
            "generatedAt": generated_at,
            "monitoringStartedAt": started_at,
            "accounts": [account_results[a] for a in MANAGED_ACCOUNT_IDS if a in account_results],
            "legacy": account_results.get(LEGACY_ID),
            "protocolTotals": protocol_totals,
            "knownProxyAccountedBytes": monitored_known,
            "proxyAccountedBytes": proxy_accounted,
            "proxyAccountedComplete": proxy_accounted_complete,
            "sources": sources,
            "reportWindow": {
                "seconds": max(60, window_seconds),
                "startAt": cutoff,
                "endAt": generated_at,
                "providerBytes": provider_window_bytes,
                "providerComplete": provider_window_complete,
                "providerSampleCount": provider_window_samples,
                "subscriptionBytes": active_window_bytes,
                "subscriptionComplete": active_window_complete,
                "legacyBytes": legacy_window_bytes,
                "legacyComplete": legacy_window_complete,
                "otherServiceBytes": other_service_window_bytes,
                "otherServiceStatus": other_service_window_status,
                "otherServiceBasis": "provider_window_minus_active_subscription_window",
                "topAccount": top_account,
            },
            "provider": {
                "baselineCounterBytes": int(provider["counter_at_start"]) if provider_started else None,
                "lastCounterBytes": int(provider["last_counter"]) if provider["last_counter"] is not None else None,
                "deltaSinceMonitoringStartBytes": provider_delta,
                "totalBytes": int(provider["total_bytes"]) if provider["total_bytes"] is not None else None,
                "resetAt": provider["reset_at"],
                "sampledAt": provider["last_sample_at"],
            },
            "reconciliation": {
                "status": "uncalibrated",
                "providerDeltaBytes": provider_delta,
                "proxyAccountedBytes": proxy_accounted,
                "gapBytes": None,
            },
            "security": security,
        }
        # Construct only documented usage/security facts; account records never include secrets.
        common["security"]["signals"] = self._security_signals(common, security_thresholds or {})
        return common

    def write_public_snapshot(
        self, path: str | Path, *, group_id: int | None = None,
        auth_security: Mapping[str, object] | None = None,
        security_thresholds: Mapping[str, int] | None = None,
    ) -> dict[str, object]:
        target = Path(path)
        target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        snapshot = self.public_snapshot(auth_security=auth_security, security_thresholds=security_thresholds)
        encoded = (json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", suffix=".tmp", dir=target.parent)
        try:
            os.fchmod(descriptor, 0o640)
            if group_id is not None:
                os.fchown(descriptor, -1, group_id)
            stream = os.fdopen(descriptor, "wb", closefd=True)
            descriptor = -1
            with stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_name, target)
            os.chmod(target, 0o640)
            if group_id is not None:
                os.chown(target, -1, group_id)
            directory_fd = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            try:
                os.unlink(temporary_name)
            except FileNotFoundError:
                pass
        return snapshot


def _unique_secret(existing: set[str]) -> str:
    while True:
        candidate = secrets.token_urlsafe(32)
        if candidate not in existing:
            existing.add(candidate)
            return candidate


def parse_hysteria_legacy_password(text: str) -> str:
    """Read only the existing password-auth value; callers never print it."""
    def strip_yaml_comment(raw: str) -> str:
        quote: str | None = None
        escaped = False
        for index, char in enumerate(raw):
            if escaped:
                escaped = False
                continue
            if quote == '"' and char == "\\":
                escaped = True
                continue
            if quote:
                if char == quote:
                    quote = None
                continue
            if char in ('"', "'"):
                quote = char
            elif char == "#" and (index == 0 or raw[index - 1].isspace()):
                return raw[:index]
        return raw

    in_auth = False
    auth_indent = -1
    auth_type: str | None = None
    password: str | None = None
    for raw in text.splitlines():
        line = strip_yaml_comment(raw).rstrip()
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()
        if indent == 0:
            in_auth = stripped == "auth:"
            auth_indent = indent if in_auth else -1
            continue
        if not in_auth or indent <= auth_indent or ":" not in stripped:
            continue
        key, value = stripped.split(":", 1)
        value = value.strip().strip("\"'")
        if key.strip() == "type":
            auth_type = value
        elif key.strip() == "password":
            password = value
    if auth_type != "password" or not password:
        raise ValueError("legacy Hysteria password-auth identity was not found")
    return password


def parse_xray_legacy_uuid(text: str, *, port: int = 2053) -> str:
    try:
        config = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("legacy Xray config is invalid") from error
    matches: list[str] = []
    for inbound in config.get("inbounds", []):
        if inbound.get("protocol") != "vless" or int(inbound.get("port", -1)) != port:
            continue
        matches.extend(
            item.get("id", "") for item in inbound.get("settings", {}).get("clients", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        )
    if len(matches) != 1:
        raise ValueError("legacy Xray client identity is ambiguous")
    try:
        return str(uuid.UUID(matches[0]))
    except ValueError as error:
        raise ValueError("legacy Xray client identity is invalid") from error


def collect_active_subscription_token(caddyfile: str, subscription_root: str | Path) -> str:
    """Extract the one currently matched token without exposing it to callers' output."""
    import re

    files = r"(?:qx\.conf|server\.snippet|clash\.yaml|shadowrocket\.txt)"
    found = set(re.findall(r"/([A-Za-z0-9._~-]+)/" + files, caddyfile))
    if len(found) != 1:
        raise ValueError("active legacy subscription path is not unique")
    token = next(iter(found))
    directory = Path(subscription_root) / token
    allowed = ("qx.conf", "server.snippet", "clash.yaml", "shadowrocket.txt")
    if not directory.is_dir() or not all((directory / name).is_file() for name in allowed):
        raise ValueError("active legacy subscription directory is incomplete")
    return token


def recent_window_start(sampled_at: str, seconds: int = 12 * 60 * 60) -> str:
    parsed = _parse_time(sampled_at)
    if parsed is None:
        raise ValueError("sample time is invalid")
    return (parsed - timedelta(seconds=seconds)).isoformat(timespec="seconds").replace("+00:00", "Z")


def account_ids(records: Iterable[Mapping[str, object]]) -> tuple[str, ...]:
    return tuple(str(record["account_id"]) for record in records)
