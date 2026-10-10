#!/usr/bin/env python3
"""Deterministic daily traffic fuse controller.

This module deliberately has no network, shell, or provider credentials.  A
small accounting adapter supplies samples as JSON and this controller keeps
calendar-day state, monotonic deltas, durable event keys, and a sanitized
snapshot.  Privileged shaping is delegated to :mod:`tc_helper`.
"""

from __future__ import annotations

import argparse
import grp
import json
import os
import re
import subprocess
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


SHANGHAI = ZoneInfo("Asia/Shanghai")
WARNING_BYTES = 40_000_000_000
CAP_BYTES = 50_000_000_000
CAP_RATE_BPS = 2_000_000
SCHEMA_VERSION = 1
VALID_STATES = {
    "INIT", "DEGRADED", "NORMAL", "WARNED", "PROTECTING", "CAPPED",
    "APPLY_FAILED", "RELEASING", "RELEASE_FAILED",
}
IFACE_RE = re.compile(r"^[A-Za-z0-9_.-]{1,15}$")


def parse_timestamp(value: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be an ISO string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def utc_timestamp(value: datetime | None = None) -> str:
    value = value or datetime.now(timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def local_day(value: datetime) -> str:
    return value.astimezone(SHANGHAI).date().isoformat()


def next_midnight(day: str) -> datetime:
    local = datetime.fromisoformat(day).replace(tzinfo=SHANGHAI) + timedelta(days=1)
    return local.astimezone(timezone.utc)


def split_delta_by_day(start: datetime, end: datetime, byte_delta: int) -> dict[str, int]:
    """Apportion an observed counter delta across Shanghai day boundaries.

    Proportional attribution is explicitly an estimate for a boundary-spanning
    poll interval. Callers keep the affected day in partial coverage.
    """
    if byte_delta <= 0:
        return {}
    if end <= start:
        return {local_day(end): byte_delta}
    seconds = (end - start).total_seconds()
    pieces: list[tuple[str, float]] = []
    cursor = start
    while cursor < end:
        day = local_day(cursor)
        next_day = next_midnight(day)
        boundary = min(end, next_day)
        pieces.append((day, (boundary - cursor).total_seconds()))
        cursor = boundary
    allocation: dict[str, int] = {}
    assigned = 0
    for index, (day, span) in enumerate(pieces):
        share = byte_delta - assigned if index == len(pieces) - 1 else int(byte_delta * span / seconds)
        allocation[day] = allocation.get(day, 0) + share
        assigned += share
    return allocation


def nonnegative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.isascii() and value.isdigit():
        parsed = int(value)
        return parsed if parsed >= 0 else None
    return None


@dataclass(frozen=True)
class TrafficSample:
    observed_at: datetime
    provider_counter: int | None = None
    provider_status: str = "unknown"
    provider_generation: str | None = None
    rx_bytes: int | None = None
    tx_bytes: int | None = None
    interface: str | None = None
    local_generation: str | None = None
    provider_sample_at: datetime | None = None

    @classmethod
    def from_mapping(cls, value: Any) -> "TrafficSample":
        if not isinstance(value, dict):
            raise ValueError("sample must be an object")
        observed = parse_timestamp(value.get("observedAt"))
        provider_status = value.get("providerStatus", "unknown")
        if provider_status not in {"ok", "stale", "error", "unknown"}:
            provider_status = "unknown"
        return cls(
            observed_at=observed,
            provider_counter=nonnegative_int(value.get("providerCounterBytes")),
            provider_status=provider_status,
            provider_generation=(value.get("providerGeneration") if isinstance(value.get("providerGeneration"), str) else None),
            provider_sample_at=parse_timestamp(value["providerSampleAt"]) if isinstance(value.get("providerSampleAt"), str) else observed,
            rx_bytes=nonnegative_int(value.get("rxBytes")),
            tx_bytes=nonnegative_int(value.get("txBytes")),
            interface=(value.get("interface") if isinstance(value.get("interface"), str) else None),
            local_generation=(value.get("localGeneration") if isinstance(value.get("localGeneration"), str) else None),
        )


class TrafficFuseStore:
    """SQLite state with atomic sample and event transitions."""

    def __init__(self, path: str | Path, *, local_calibrated: bool = False, calibration_version: str | None = None) -> None:
        self.path = Path(path)
        self.local_calibrated = local_calibrated
        self.calibration_version = calibration_version
        self.path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
        with self._connect() as db:
            self._create_schema(db)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def _connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA busy_timeout=5000")
        return db

    @staticmethod
    def _create_schema(db: sqlite3.Connection) -> None:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS day_state (
              day TEXT PRIMARY KEY,
              state TEXT NOT NULL,
              provider_bytes INTEGER NOT NULL DEFAULT 0,
              local_wan_bytes INTEGER NOT NULL DEFAULT 0,
              effective_bytes INTEGER,
              source_status TEXT NOT NULL DEFAULT 'unknown',
              coverage TEXT NOT NULL DEFAULT 'partial_coverage',
              provider_last_counter INTEGER,
              provider_generation TEXT,
              provider_last_sample_at TEXT,
              local_rx INTEGER,
              local_tx INTEGER,
              local_interface TEXT,
              local_generation TEXT,
              local_last_sample_at TEXT,
              first_sample_at TEXT,
              last_sample_at TEXT,
              protection_started_at TEXT,
              release_verified_at TEXT,
              calibration_version TEXT
            );
            CREATE TABLE IF NOT EXISTS samples (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              day TEXT NOT NULL,
              source TEXT NOT NULL,
              sampled_at TEXT NOT NULL,
              delta_bytes INTEGER NOT NULL,
              reset_detected INTEGER NOT NULL CHECK (reset_detected IN (0,1)),
              complete INTEGER NOT NULL CHECK (complete IN (0,1)),
              generation TEXT
            );
            CREATE TABLE IF NOT EXISTS source_cursor (
              singleton INTEGER PRIMARY KEY CHECK(singleton=1),
              provider_counter INTEGER,
              provider_generation TEXT,
              provider_sample_at TEXT,
              local_rx INTEGER,
              local_tx INTEGER,
              local_interface TEXT,
              local_generation TEXT,
              local_sample_at TEXT
            );
            INSERT OR IGNORE INTO source_cursor(singleton) VALUES (1);
            CREATE INDEX IF NOT EXISTS samples_day_idx ON samples(day, sampled_at);
            CREATE TABLE IF NOT EXISTS events (
              event_key TEXT PRIMARY KEY,
              day TEXT NOT NULL,
              event_type TEXT NOT NULL,
              severity TEXT NOT NULL,
              occurred_at TEXT NOT NULL,
              payload_json TEXT NOT NULL
            );
            INSERT OR IGNORE INTO metadata(key, value) VALUES ('schema_version', '1');
            """
        )

    def _ensure_day(self, db: sqlite3.Connection, day: str, observed_at: str) -> sqlite3.Row:
        db.execute(
            "INSERT OR IGNORE INTO day_state(day,state,calibration_version) VALUES(?,?,?)",
            (day, "INIT", self.calibration_version),
        )
        row = db.execute("SELECT * FROM day_state WHERE day=?", (day,)).fetchone()
        assert row is not None
        if row["first_sample_at"] is None:
            db.execute("UPDATE day_state SET first_sample_at=? WHERE day=?", (observed_at, day))
            row = db.execute("SELECT * FROM day_state WHERE day=?", (day,)).fetchone()
        return row

    @staticmethod
    def _event_payload(event_type: str, day: str, occurred_at: str, state: sqlite3.Row, source: str | None = None) -> dict[str, Any]:
        effective = state["effective_bytes"]
        payload: dict[str, Any] = {
            "eventKey": f"vps-daily-fuse:{day}:{event_type}",
            "eventType": event_type,
            "day": day,
            "observedBytes": effective,
            "warningThresholdBytes": WARNING_BYTES,
            "capThresholdBytes": CAP_BYTES,
            "remainingHeadroomBytes": max(CAP_BYTES - effective, 0) if isinstance(effective, int) else None,
            "coverage": state["coverage"],
            "sourceStatus": state["source_status"],
            "dataUpdatedAt": state["last_sample_at"],
        }
        if source:
            payload["triggerSource"] = source
        if event_type in {"engaged", "released"}:
            payload["rateBitsPerSecond"] = CAP_RATE_BPS if event_type == "engaged" else None
            payload["nextRecoveryAt"] = utc_timestamp(next_midnight(day)) if event_type == "engaged" else None
            payload["normalEgressRestored"] = event_type == "released"
        return payload

    def _insert_event(self, db: sqlite3.Connection, *, event_type: str, day: str, occurred_at: str, severity: str, state: sqlite3.Row, source: str | None = None) -> bool:
        payload = self._event_payload(event_type, day, occurred_at, state, source)
        cur = db.execute(
            "INSERT OR IGNORE INTO events(event_key,day,event_type,severity,occurred_at,payload_json) VALUES(?,?,?,?,?,?)",
            (payload["eventKey"], day, event_type, severity, occurred_at, json.dumps(payload, separators=(",", ":"))),
        )
        return cur.rowcount == 1

    def record_sample(self, sample: TrafficSample) -> dict[str, Any]:
        day = local_day(sample.observed_at)
        observed_at = utc_timestamp(sample.observed_at)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = self._ensure_day(db, day, observed_at)
            if row["last_sample_at"] and observed_at <= row["last_sample_at"]:
                return self.public_snapshot(day=day, db=db)
            cursor = db.execute("SELECT * FROM source_cursor WHERE singleton=1").fetchone()
            assert cursor is not None
            touched_days: set[str] = {day}

            def add_delta(source: str, allocation: dict[str, int], *, reset: bool, complete: bool, generation: str | None) -> None:
                crossed_day = len(allocation) > 1
                for bucket_day, amount in allocation.items():
                    touched_days.add(bucket_day)
                    bucket = self._ensure_day(db, bucket_day, observed_at)
                    column = "provider_bytes" if source == "provider" else "local_wan_bytes"
                    db.execute(f"UPDATE day_state SET {column}={column}+?,coverage='partial_coverage' WHERE day=?", (amount, bucket_day))
                    db.execute(
                        "INSERT INTO samples(day,source,sampled_at,delta_bytes,reset_detected,complete,generation) VALUES(?,?,?,?,?,?,?)",
                        (bucket_day, source, observed_at, amount, int(reset), int(complete and not crossed_day), generation),
                    )

            provider_fresh = False
            provider_recent = False
            provider_reset = False
            provider_boundary = False
            provider_observed = sample.provider_sample_at or sample.observed_at
            provider_observed_iso = utc_timestamp(provider_observed)
            provider_recent = (
                sample.provider_counter is not None
                and sample.provider_status == "ok"
                and timedelta(0) <= sample.observed_at - provider_observed <= timedelta(seconds=180)
            )
            provider_previous_at = parse_timestamp(cursor["provider_sample_at"]) if cursor["provider_sample_at"] else None
            if sample.provider_counter is not None and sample.provider_status == "ok" and (provider_previous_at is None or provider_observed > provider_previous_at):
                provider_fresh = True
                old_counter = cursor["provider_counter"]
                generation_changed = bool((sample.provider_generation is not None or cursor["provider_generation"] is not None) and sample.provider_generation != cursor["provider_generation"])
                provider_reset = old_counter is not None and (generation_changed or sample.provider_counter < old_counter)
                if old_counter is None:
                    provider_allocation: dict[str, int] = {}
                elif provider_reset:
                    provider_allocation = {local_day(provider_observed): sample.provider_counter}
                else:
                    provider_delta = sample.provider_counter - int(old_counter)
                    provider_allocation = split_delta_by_day(provider_previous_at or provider_observed, provider_observed, provider_delta)
                    provider_boundary = len(provider_allocation) > 1
                add_delta("provider", provider_allocation, reset=provider_reset, complete=not provider_reset and old_counter is not None, generation=sample.provider_generation)
                db.execute(
                    "UPDATE source_cursor SET provider_counter=?,provider_generation=?,provider_sample_at=? WHERE singleton=1",
                    (sample.provider_counter, sample.provider_generation, provider_observed_iso),
                )

            local_fresh = False
            local_reset = False
            local_boundary = False
            if sample.rx_bytes is not None and sample.tx_bytes is not None and sample.interface:
                local_fresh = True
                old_rx, old_tx = cursor["local_rx"], cursor["local_tx"]
                old_at = parse_timestamp(cursor["local_sample_at"]) if cursor["local_sample_at"] else None
                generation_changed = bool((sample.local_generation is not None or cursor["local_generation"] is not None) and sample.local_generation != cursor["local_generation"])
                local_reset = old_rx is not None and (sample.interface != cursor["local_interface"] or generation_changed or sample.rx_bytes < old_rx or sample.tx_bytes < old_tx)
                if old_rx is not None and not local_reset:
                    delta = (sample.rx_bytes - int(old_rx)) + (sample.tx_bytes - int(old_tx))
                    allocation = split_delta_by_day(old_at or sample.observed_at, sample.observed_at, delta)
                    local_boundary = len(allocation) > 1
                    add_delta("local_wan", allocation, reset=False, complete=old_at is not None, generation=sample.local_generation)
                elif local_reset:
                    add_delta("local_wan", {day: 0}, reset=True, complete=False, generation=sample.local_generation)
                db.execute(
                    "UPDATE source_cursor SET local_rx=?,local_tx=?,local_interface=?,local_generation=?,local_sample_at=? WHERE singleton=1",
                    (sample.rx_bytes, sample.tx_bytes, sample.interface, sample.local_generation, observed_at),
                )

            if provider_recent:
                source_status = "provider_confirmed"
            elif self.local_calibrated and local_fresh:
                source_status = "local_wan_estimate"
            elif sample.provider_status == "stale" or (sample.provider_status == "ok" and sample.provider_counter is not None):
                source_status = "stale"
            else:
                source_status = "unknown"
            boundary_uncertain = provider_boundary or local_boundary
            for bucket_day in sorted(touched_days):
                row = db.execute("SELECT * FROM day_state WHERE day=?", (bucket_day,)).fetchone()
                assert row is not None
                provider_bytes = int(row["provider_bytes"])
                local_bytes = int(row["local_wan_bytes"])
                if source_status == "unknown":
                    coverage = "unknown"
                else:
                    coverage = "partial_coverage" if provider_reset or local_reset or boundary_uncertain or row["first_sample_at"] is None else row["coverage"]
                candidates = [provider_bytes] if provider_recent or source_status == "stale" else []
                if self.local_calibrated:
                    candidates.append(local_bytes)
                effective = max(candidates) if candidates else None
                current_state = row["state"]
                if current_state not in VALID_STATES:
                    current_state = "DEGRADED"
                new_state = current_state
                if current_state not in {"CAPPED", "RELEASING", "RELEASE_FAILED"}:
                    if effective is None or (source_status == "stale" and not self.local_calibrated):
                        new_state = "DEGRADED"
                    elif effective >= CAP_BYTES:
                        new_state = "PROTECTING"
                    elif effective >= WARNING_BYTES:
                        new_state = "WARNED"
                    else:
                        new_state = "NORMAL"
                db.execute(
                    "UPDATE day_state SET state=?,effective_bytes=?,source_status=?,coverage=?,provider_last_counter=?,provider_generation=?,provider_last_sample_at=?,local_rx=?,local_tx=?,local_interface=?,local_generation=?,local_last_sample_at=?,last_sample_at=?,calibration_version=? WHERE day=?",
                    (new_state, effective, source_status, coverage, cursor["provider_counter"] if not provider_fresh else sample.provider_counter, cursor["provider_generation"] if not provider_fresh else sample.provider_generation, cursor["provider_sample_at"] if not provider_fresh else provider_observed_iso, sample.rx_bytes if local_fresh else row["local_rx"], sample.tx_bytes if local_fresh else row["local_tx"], sample.interface if local_fresh else row["local_interface"], sample.local_generation if local_fresh else row["local_generation"], observed_at if local_fresh else row["local_last_sample_at"], observed_at, self.calibration_version, bucket_day),
                )
                row = db.execute("SELECT * FROM day_state WHERE day=?", (bucket_day,)).fetchone()
                assert row is not None
                if effective is not None and effective >= WARNING_BYTES and effective < CAP_BYTES and current_state not in {"WARNED", "CAPPED", "PROTECTING", "APPLY_FAILED", "RELEASE_FAILED"}:
                    self._insert_event(db, event_type="warning", day=bucket_day, occurred_at=observed_at, severity="warning", state=row, source="provider" if source_status == "provider_confirmed" else "local_wan")
            cutoff = (sample.observed_at - timedelta(days=35)).date().isoformat()
            db.execute("DELETE FROM events WHERE day<?", (cutoff,))
            db.execute("DELETE FROM samples WHERE day<?", (cutoff,))
            db.execute("DELETE FROM day_state WHERE day<?", (cutoff,))
            db.commit()
            return self.public_snapshot(day=day)

    def apply_result(self, day: str, *, success: bool, observed_at: datetime | None = None, kernel_state: str = "unknown") -> dict[str, Any]:
        observed = utc_timestamp(observed_at)
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM day_state WHERE day=?", (day,)).fetchone()
            if row is None:
                raise ValueError(f"unknown day: {day}")
            if row["state"] not in {"PROTECTING", "APPLY_FAILED", "CAPPED"}:
                raise ValueError(f"day {day} is not protection-ready")
            new_state = "CAPPED" if success else "APPLY_FAILED"
            protection_started = row["protection_started_at"] or observed if success else row["protection_started_at"]
            db.execute("UPDATE day_state SET state=?,protection_started_at=? WHERE day=?", (new_state, protection_started, day))
            row = db.execute("SELECT * FROM day_state WHERE day=?", (day,)).fetchone()
            assert row is not None
            event_type = "engaged" if success else "apply-failed"
            self._insert_event(db, event_type=event_type, day=day, occurred_at=observed, severity="warning" if success else "error", state=row, source="tc-readback" if success else kernel_state)
            db.commit()
            return self.public_snapshot(day=day)

    def release(self, protected_day: str, *, success: bool, observed_at: datetime | None = None, kernel_state: str = "unknown") -> dict[str, Any]:
        observed = utc_timestamp(observed_at)
        new_day = local_day((observed_at or datetime.now(timezone.utc)))
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM day_state WHERE day=?", (protected_day,)).fetchone()
            if row is None:
                raise ValueError(f"unknown day: {protected_day}")
            protected = row["state"] in {"CAPPED", "RELEASING", "RELEASE_FAILED"}
            if not protected:
                db.execute("INSERT OR IGNORE INTO day_state(day,state,coverage,calibration_version) VALUES(?,?,?,?)", (new_day, "NORMAL", "partial_coverage", self.calibration_version))
                db.commit()
                result = self.public_snapshot(day=new_day)
                result["operationStatus"] = "not_required"
                return result
            db.execute("UPDATE day_state SET state=?,release_verified_at=? WHERE day=?", ("NORMAL" if success else "RELEASE_FAILED", observed if success else None, protected_day))
            row = db.execute("SELECT * FROM day_state WHERE day=?", (protected_day,)).fetchone()
            assert row is not None
            self._insert_event(db, event_type="released" if success else "release-failed", day=protected_day, occurred_at=observed, severity="success" if success else "error", state=row, source="tc-readback" if success else kernel_state)
            db.execute("INSERT OR IGNORE INTO day_state(day,state,coverage,calibration_version) VALUES(?,?,?,?)", (new_day, "NORMAL", "partial_coverage", self.calibration_version))
            db.commit()
            result = self.public_snapshot(day=new_day)
            result["operationStatus"] = "released" if success else "release_failed"
            return result

    def public_snapshot(self, *, day: str | None = None, db: sqlite3.Connection | None = None) -> dict[str, Any]:
        own_db = db is None
        db = db or self._connect()
        try:
            if day is None:
                day = local_day(datetime.now(timezone.utc))
            row = db.execute("SELECT * FROM day_state WHERE day=?", (day,)).fetchone()
            day_start = utc_timestamp(datetime.fromisoformat(day).replace(tzinfo=SHANGHAI).astimezone(timezone.utc))
            # A release event is keyed to the protected day but occurs at the
            # following day's midnight. Include events observed since this
            # day's boundary so the fixed probe can deliver that event once.
            events = db.execute("SELECT * FROM events WHERE day=? OR occurred_at>=? ORDER BY occurred_at,event_key LIMIT 64", (day, day_start)).fetchall()
            if row is None:
                return {"version": 1, "status": "unknown", "day": day, "state": "INIT", "events": []}
            return {
                "version": 1,
                "generatedAt": utc_timestamp(),
                "day": day,
                "state": row["state"],
                "coverage": row["coverage"],
                "sourceStatus": row["source_status"],
                "providerBytes": row["provider_bytes"],
                "localWanBytes": row["local_wan_bytes"],
                "effectiveBytes": row["effective_bytes"],
                "warningThresholdBytes": WARNING_BYTES,
                "capThresholdBytes": CAP_BYTES,
                "rateBitsPerSecond": CAP_RATE_BPS if row["state"] in {"CAPPED", "RELEASING", "RELEASE_FAILED"} else None,
                "protectionStartedAt": row["protection_started_at"],
                "nextRecoveryAt": utc_timestamp(next_midnight(day)) if row["state"] in {"CAPPED", "RELEASING", "RELEASE_FAILED"} else None,
                "lastSampleAt": row["last_sample_at"],
                "calibrationVersion": row["calibration_version"],
                "events": [json.loads(event["payload_json"]) | {"severity": event["severity"], "occurredAt": event["occurred_at"]} for event in events],
            }
        finally:
            if own_db:
                db.close()

    def latest_protected_day(self, before_day: str) -> str | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT day FROM day_state WHERE day<? AND state IN ('CAPPED','RELEASING','RELEASE_FAILED') ORDER BY day DESC LIMIT 1",
                (before_day,),
            ).fetchone()
            return str(row["day"]) if row else None


def sample_from_stdin() -> TrafficSample:
    value = json.load(sys.stdin)
    return TrafficSample.from_mapping(value)


def runtime_config(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("traffic-fuse config must be an object")
    interface = value.get("interface")
    if not isinstance(interface, str) or not IFACE_RE.fullmatch(interface):
        raise ValueError("traffic-fuse config has no fixed interface")
    return value


def fixed_runtime_sample(config: dict[str, Any]) -> TrafficSample:
    observed_at = datetime.now(timezone.utc)
    provider_counter = None
    provider_status = "unknown"
    provider_generation = None
    provider_sample_at = None
    snapshot_path = config.get("providerSnapshotPath", "/var/lib/amadeus-accounting/subscription-usage-public.json")
    if isinstance(snapshot_path, str):
        try:
            raw = json.loads(Path(snapshot_path).read_text(encoding="utf-8"))
            provider = raw.get("provider") if isinstance(raw, dict) else None
            source = raw.get("sources", {}).get("provider", {}) if isinstance(raw, dict) and isinstance(raw.get("sources"), dict) else {}
            counter = provider.get("lastCounterBytes") if isinstance(provider, dict) else None
            parsed_counter = nonnegative_int(counter)
            if parsed_counter is not None:
                provider_counter = parsed_counter
                provider_status = source.get("status") if source.get("status") in {"ok", "stale", "error", "unknown"} else "unknown"
                provider_generation = provider.get("resetAt") if isinstance(provider, dict) and isinstance(provider.get("resetAt"), str) else None
                if isinstance(provider.get("sampledAt"), str):
                    provider_sample_at = parse_timestamp(provider["sampledAt"])
        except (OSError, ValueError, TypeError):
            pass
    rx = tx = None
    try:
        iface = config["interface"]
        rx = nonnegative_int(Path(f"/sys/class/net/{iface}/statistics/rx_bytes").read_text().strip())
        tx = nonnegative_int(Path(f"/sys/class/net/{iface}/statistics/tx_bytes").read_text().strip())
    except (OSError, ValueError, TypeError):
        pass
    boot_id = None
    try:
        boot_id = Path("/proc/sys/kernel/random/boot_id").read_text(encoding="ascii").strip()
    except OSError:
        pass
    return TrafficSample(observed_at, provider_counter, provider_status, provider_generation, rx, tx, config["interface"], boot_id, provider_sample_at)


def write_public_snapshot(path: str, snapshot: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o640)
    try:
        snapshot_group = grp.getgrnam("amadeus-accounting-snapshot")
        os.chown(temporary, 0, snapshot_group.gr_gid)
    except (KeyError, PermissionError, OSError):
        # Installation must provision the fixed probe group.  A local dry-run
        # may not have that group; keep the restrictive root-owned fallback.
        pass
    os.replace(temporary, target)


def run_fixed_tick(config_path: str) -> dict[str, Any]:
    config = runtime_config(config_path)
    db_path = config.get("dbPath", "/var/lib/amadeus-traffic-fuse/state.sqlite3")
    local_calibrated = config.get("localCalibrated") is True
    store = TrafficFuseStore(db_path, local_calibrated=local_calibrated, calibration_version=config.get("calibrationVersion"))
    result = store.record_sample(fixed_runtime_sample(config))
    if result.get("state") == "PROTECTING" and config.get("autoApply") is True:
        helper = config.get("helperPath", "/usr/local/libexec/amadeus-vps-traffic-fuse/tc_helper.py")
        try:
            completed = subprocess.run([helper, "apply"], check=False, capture_output=True, text=True, timeout=45)
            result = store.apply_result(result["day"], success=completed.returncode == 0, kernel_state="tc-readback" if completed.returncode == 0 else "tc-apply-failed")
        except (OSError, subprocess.TimeoutExpired):
            result = store.apply_result(result["day"], success=False, kernel_state="tc-helper-unavailable")
    write_public_snapshot(config.get("publicSnapshotPath", "/var/lib/amadeus-traffic-fuse/public-snapshot.json"), result)
    return result


def run_fixed_release(config_path: str, protected_day: str) -> dict[str, Any]:
    config = runtime_config(config_path)
    store = TrafficFuseStore(config.get("dbPath", "/var/lib/amadeus-traffic-fuse/state.sqlite3"), local_calibrated=config.get("localCalibrated") is True, calibration_version=config.get("calibrationVersion"))
    if protected_day == "previous":
        current_day = local_day(datetime.now(timezone.utc))
        protected_day = store.latest_protected_day(current_day) or (datetime.fromisoformat(current_day) - timedelta(days=1)).date().isoformat()
    helper = config.get("helperPath", "/usr/local/libexec/amadeus-vps-traffic-fuse/tc_helper.py")
    success = False
    kernel_state = "tc-release-failed"
    try:
        completed = subprocess.run([helper, "release"], check=False, capture_output=True, text=True, timeout=45)
        success = completed.returncode == 0
        kernel_state = "tc-readback" if success else "tc-release-failed"
    except (OSError, subprocess.TimeoutExpired):
        kernel_state = "tc-helper-unavailable"
    result = store.release(protected_day, success=success, kernel_state=kernel_state)
    write_public_snapshot(config.get("publicSnapshotPath", "/var/lib/amadeus-traffic-fuse/public-snapshot.json"), result)
    return result


def run_fixed_apply(config_path: str, day: str) -> dict[str, Any]:
    config = runtime_config(config_path)
    store = TrafficFuseStore(config.get("dbPath", "/var/lib/amadeus-traffic-fuse/state.sqlite3"), local_calibrated=config.get("localCalibrated") is True, calibration_version=config.get("calibrationVersion"))
    helper = config.get("helperPath", "/usr/local/libexec/amadeus-vps-traffic-fuse/tc_helper.py")
    success = False
    kernel_state = "tc-apply-failed"
    try:
        completed = subprocess.run([helper, "apply"], check=False, capture_output=True, text=True, timeout=45)
        success = completed.returncode == 0
        kernel_state = "tc-readback" if success else "tc-apply-failed"
    except (OSError, subprocess.TimeoutExpired):
        kernel_state = "tc-helper-unavailable"
    result = store.apply_result(day, success=success, kernel_state=kernel_state)
    write_public_snapshot(config.get("publicSnapshotPath", "/var/lib/amadeus-traffic-fuse/public-snapshot.json"), result)
    return result


def cli(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Amadeus VPS daily traffic fuse")
    parser.add_argument("--db", default=os.environ.get("AMADEUS_TRAFFIC_FUSE_DB", "/var/lib/amadeus-traffic-fuse/state.sqlite3"))
    parser.add_argument("--local-calibrated", action="store_true", help="allow calibrated local-WAN guard to trigger protection")
    parser.add_argument("--calibration-version")
    parser.add_argument("--config", default="/etc/amadeus/traffic-fuse.json")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("sample", help="record one JSON sample from stdin")
    sub.add_parser("tick", help="read fixed provider/NIC paths and reconcile one sample")
    dry = sub.add_parser("dry-run", help="evaluate a sample in a temporary database")
    dry.add_argument("--json", action="store_true")
    apply = sub.add_parser("apply", help="record a verified shaper apply result")
    apply.add_argument("--day", required=True)
    apply.add_argument("--failed", action="store_true")
    apply.add_argument("--kernel-state", default="unknown")
    release = sub.add_parser("release", help="record a verified shaper release result")
    release.add_argument("--day", required=True, help="protected Shanghai calendar day or previous")
    release.add_argument("--failed", action="store_true")
    release.add_argument("--kernel-state", default="unknown")
    args = parser.parse_args(list(argv) if argv is not None else None)
    store = TrafficFuseStore(args.db, local_calibrated=args.local_calibrated, calibration_version=args.calibration_version)
    if args.command == "status":
        print(json.dumps(store.public_snapshot(), ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.command == "tick":
        try:
            print(json.dumps(run_fixed_tick(args.config), ensure_ascii=False, separators=(",", ":")))
            return 0
        except (OSError, ValueError, json.JSONDecodeError) as error:
            print(json.dumps({"status": "error", "code": "TICK_FAILED", "message": str(error)}, separators=(",", ":")))
            return 2
    if args.command == "sample":
        print(json.dumps(store.record_sample(sample_from_stdin()), ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.command == "dry-run":
        with tempfile.TemporaryDirectory(prefix="amadeus-traffic-fuse-") as directory:
            preview = TrafficFuseStore(Path(directory) / "state.sqlite3", local_calibrated=args.local_calibrated, calibration_version=args.calibration_version)
            result = preview.record_sample(sample_from_stdin())
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    if args.command == "apply":
        result = run_fixed_apply(args.config, args.day) if not args.failed and args.kernel_state == "unknown" else store.apply_result(args.day, success=not args.failed, kernel_state=args.kernel_state)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0 if result.get("state") == "CAPPED" else 2
    if args.command == "release":
        protected_day = args.day
        if protected_day == "previous":
            current_day = local_day(datetime.now(timezone.utc))
            protected_day = store.latest_protected_day(current_day) or (datetime.fromisoformat(current_day) - timedelta(days=1)).date().isoformat()
        if args.config and not args.failed and args.kernel_state == "unknown":
            result = run_fixed_release(args.config, protected_day)
        else:
            result = store.release(protected_day, success=not args.failed, kernel_state=args.kernel_state)
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0 if result.get("operationStatus") in {"released", "not_required"} else 2
    return 2


if __name__ == "__main__":
    raise SystemExit(cli())
