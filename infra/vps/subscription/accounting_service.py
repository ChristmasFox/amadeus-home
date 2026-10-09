#!/usr/bin/env python3
"""Loopback HY2 auth endpoint and bounded traffic collector for Amadeus Gateway."""

from __future__ import annotations

import grp
import ipaddress
import json
import logging
import os
import re
import signal
import stat
import subprocess
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Mapping
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from accounting_store import ACCOUNT_IDS, AUTH_IDS, LEGACY_ID, VLESS_EMAILS, AccountingStore, utc_now


MAX_AUTH_BODY_BYTES = 4096
MAX_PROVIDER_BODY_BYTES = 1_000_000
MAX_STATS_BODY_BYTES = 2_000_000
MIN_XRAY_ONLINE_VERSION = (26, 6, 27)
XRAY_USER_STATS_PATTERN = "user>>>"
XRAY_FALLBACK_STATS_PATTERN = "inbound>>>reality-fallback-gate>>>traffic>>>"
FALLBACK_INBOUND_TAG = "reality-fallback-gate"
SOURCE_NAMES = ("provider", "hysteria_traffic", "hysteria_online", "xray", "xray_online", "reality_fallback")
EMAIL_TO_ACCOUNT = {value: key for key, value in VLESS_EMAILS.items()}
HY2_ID_TO_ACCOUNT = {"legacy-hy2": LEGACY_ID, **{account_id: account_id for account_id in ACCOUNT_IDS if account_id != LEGACY_ID}}
COUNTER_PATTERN = re.compile(r"^user>>>([^>]+)>>>traffic>>>(uplink|downlink)$")
FALLBACK_COUNTER_PATTERN = re.compile(r"^inbound>>>reality-fallback-gate>>>traffic>>>(uplink|downlink)$")


class SourceFailure(RuntimeError):
    def __init__(self, code: str) -> None:
        self.code = code if code in {"unreachable", "invalid_response", "timeout", "unavailable", "unsupported_version"} else "unavailable"
        super().__init__(self.code)


def _counter_integer(value: object) -> int:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        return int(value)
    raise SourceFailure("invalid_response")


def _loopback_url(value: str, label: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password:
        raise ValueError(f"{label} must use a loopback HTTP endpoint")
    if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError(f"{label} endpoint is invalid")
    return value.rstrip("/")


def _loopback_host_port(value: str, label: str) -> str:
    if value.startswith("["):
        close = value.find("]")
        if close < 0 or value[close + 1:close + 2] != ":":
            raise ValueError(f"{label} endpoint is invalid")
        host, raw_port = value[1:close], value[close + 2:]
    else:
        host, separator, raw_port = value.rpartition(":")
        if not separator or ":" in host:
            raise ValueError(f"{label} endpoint is invalid")
    try:
        port = int(raw_port)
    except ValueError as error:
        raise ValueError(f"{label} endpoint is invalid") from error
    if not 1 <= port <= 65535:
        raise ValueError(f"{label} endpoint is invalid")
    if host.lower() != "localhost":
        try:
            if not ipaddress.ip_address(host).is_loopback:
                raise ValueError(f"{label} must use loopback")
        except ValueError as error:
            raise ValueError(f"{label} must use loopback") from error
    return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"


def _require_protected_file(path: str | Path, label: str) -> None:
    try:
        info = Path(path).stat()
    except OSError as error:
        raise SourceFailure("unavailable") from error
    mode = stat.S_IMODE(info.st_mode)
    if not stat.S_ISREG(info.st_mode) or mode & 0o037:
        raise SourceFailure("unavailable")


def _read_json(url: str, *, headers: Mapping[str, str] | None = None, data: bytes | None = None, limit: int, timeout: float) -> object:
    request = Request(url, data=data, headers=dict(headers or {}), method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = response.read(limit + 1)
    except TimeoutError as error:
        raise SourceFailure("timeout") from error
    except (OSError, URLError) as error:
        raise SourceFailure("unreachable") from error
    if len(payload) > limit:
        raise SourceFailure("invalid_response")
    try:
        return json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceFailure("invalid_response") from error


def parse_hysteria_traffic(payload: object) -> dict[str, tuple[int, int]]:
    if not isinstance(payload, dict):
        raise SourceFailure("invalid_response")
    counters: dict[str, tuple[int, int]] = {}
    for client_id, item in payload.items():
        account_id = HY2_ID_TO_ACCOUNT.get(client_id) if isinstance(client_id, str) else None
        if account_id is None or not isinstance(item, dict):
            continue
        tx, rx = item.get("tx"), item.get("rx")
        # Hysteria Traffic Stats tx/rx follow the client's perspective: tx is
        # uploaded by the client and rx is downloaded by the client.
        if isinstance(tx, bool) or isinstance(rx, bool) or not isinstance(tx, int) or not isinstance(rx, int) or tx < 0 or rx < 0:
            continue
        counters[account_id] = (tx, rx)
    return counters


def parse_hysteria_online(payload: object) -> dict[str, int]:
    if not isinstance(payload, dict):
        raise SourceFailure("invalid_response")
    values: dict[str, int] = {}
    for client_id, count in payload.items():
        account_id = HY2_ID_TO_ACCOUNT.get(client_id) if isinstance(client_id, str) else None
        if account_id is None or isinstance(count, bool) or not isinstance(count, int) or count < 0:
            continue
        values[account_id] = count
    return values


def parse_xray_stats(payload: object) -> dict[str, tuple[int, int]]:
    if isinstance(payload, dict) and not payload:
        # Xray CLI emits {} when StatsService has no user counters yet.
        return {}
    if not isinstance(payload, dict) or not isinstance(payload.get("stat"), list):
        raise SourceFailure("invalid_response")
    observed: dict[str, dict[str, int]] = {}
    for item in payload["stat"]:
        if not isinstance(item, dict):
            continue
        match = COUNTER_PATTERN.fullmatch(str(item.get("name", "")))
        if not match:
            continue
        account_id = EMAIL_TO_ACCOUNT.get(match.group(1))
        value = item.get("value")
        if account_id is None or isinstance(value, bool):
            continue
        if isinstance(value, int):
            counter = value
        elif isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
            counter = int(value)
        else:
            continue
        if counter < 0:
            continue
        observed.setdefault(account_id, {})[match.group(2)] = counter
    # Missing directional counters stay unknown. Do not manufacture a zero.
    return {
        account_id: (values["uplink"], values["downlink"])
        for account_id, values in observed.items()
        if "uplink" in values and "downlink" in values
    }


def parse_xray_fallback_stats(payload: object) -> tuple[int, int]:
    """Return only the fixed Reality gate's byte counters; never parse destinations."""
    if not isinstance(payload, dict) or not isinstance(payload.get("stat"), list):
        raise SourceFailure("invalid_response")
    counters: dict[str, int] = {}
    for item in payload["stat"]:
        if not isinstance(item, dict):
            continue
        match = FALLBACK_COUNTER_PATTERN.fullmatch(str(item.get("name", "")))
        if not match:
            continue
        try:
            value = _counter_integer(item.get("value"))
        except SourceFailure:
            continue
        counters[match.group(1)] = value
    if set(counters) != {"uplink", "downlink"}:
        raise SourceFailure("unavailable")
    return counters["uplink"], counters["downlink"]


def parse_hysteria_client_addr(value: object) -> str | None:
    """Normalize the official Hysteria addr field without retaining its source port."""
    if not isinstance(value, str) or len(value) > 128 or "\x00" in value:
        return None
    if value.startswith("["):
        close = value.find("]")
        if close <= 1 or value[close + 1:close + 2] != ":":
            return None
        raw_ip, raw_port = value[1:close], value[close + 2:]
    else:
        raw_ip, separator, raw_port = value.rpartition(":")
        if not separator or not raw_ip or ":" in raw_ip:
            return None
    if not raw_port.isascii() or not raw_port.isdigit():
        return None
    port = int(raw_port)
    if not 1 <= port <= 65535 or "%" in raw_ip:
        return None
    try:
        return ipaddress.ip_address(raw_ip).compressed
    except ValueError:
        return None


@dataclass
class _FailureSource:
    attempts: deque[float]
    last_seen: float
    blocked_until: float = 0.0


class AuthFailureTracker:
    """Bounded in-memory limiter state plus sanitized rolling counters."""

    def __init__(
        self, *, window_seconds: int = 900, threshold: int = 120,
        cooldown_seconds: int = 300, max_tracked_sources: int = 4096,
        mode: str = "telemetry", clock=time.monotonic,
    ) -> None:
        if not 1 <= window_seconds <= 86400 or not 1 <= threshold <= 1_000_000:
            raise ValueError("HY2 auth failure window or threshold is invalid")
        if not 1 <= cooldown_seconds <= 86400 or not 1 <= max_tracked_sources <= 65536:
            raise ValueError("HY2 auth cooldown or tracker capacity is invalid")
        if mode not in {"telemetry", "enforce"}:
            raise ValueError("HY2 auth limiter mode is invalid")
        self.window_seconds = window_seconds
        self.threshold = threshold
        self.cooldown_seconds = cooldown_seconds
        self.max_tracked_sources = max_tracked_sources
        self.mode = mode
        self._clock = clock
        self._started = clock()
        self._started_at = utc_now()
        self._lock = threading.Lock()
        self._sources: OrderedDict[str, _FailureSource] = OrderedDict()
        self._buckets: dict[int, list[int]] = {}
        self._last_failure_at: str | None = None
        self._capacity_reached = False

    def _purge_locked(self, now: float) -> None:
        cutoff = now - self.window_seconds
        for second in tuple(self._buckets):
            if second < int(cutoff):
                del self._buckets[second]
        for address, state in tuple(self._sources.items()):
            while state.attempts and state.attempts[0] <= cutoff:
                state.attempts.popleft()
            if not state.attempts and state.blocked_until <= now:
                del self._sources[address]

    def _bucket_locked(self, now: float) -> list[int]:
        return self._buckets.setdefault(int(now), [0, 0])

    def reject_rate_limited(self, client_ip: str) -> bool:
        now = self._clock()
        with self._lock:
            self._purge_locked(now)
            state = self._sources.get(client_ip)
            if self.mode != "enforce" or state is None or state.blocked_until <= now:
                return False
            state.last_seen = now
            self._sources.move_to_end(client_ip)
            self._bucket_locked(now)[1] += 1
            return True

    def record_failure(self, client_ip: str, *, at: str | None = None) -> None:
        now = self._clock()
        with self._lock:
            self._purge_locked(now)
            self._bucket_locked(now)[0] += 1
            self._last_failure_at = at or utc_now()
            state = self._sources.get(client_ip)
            if state is None:
                if len(self._sources) >= self.max_tracked_sources:
                    # LRU eviction is visible as approximate source coverage; the map stays bounded.
                    self._sources.popitem(last=False)
                    self._capacity_reached = True
                state = _FailureSource(deque(maxlen=self.threshold), now)
                self._sources[client_ip] = state
            state.last_seen = now
            state.attempts.append(now)
            if self.mode == "enforce" and len(state.attempts) >= self.threshold:
                state.blocked_until = max(state.blocked_until, now + self.cooldown_seconds)
            self._sources.move_to_end(client_ip)

    def snapshot(self) -> dict[str, object]:
        now = self._clock()
        with self._lock:
            self._purge_locked(now)
            failures = sum(values[0] for values in self._buckets.values())
            limited = sum(values[1] for values in self._buckets.values())
            return {
                "limiterMode": self.mode,
                "limiterWindowSeconds": self.window_seconds,
                "limiterWindowCoverageSeconds": min(self.window_seconds, max(0, int(now - self._started))),
                "authFailuresLimiterWindow": failures,
                "authRateLimitedLimiterWindow": limited,
                "uniqueFailureSourcesWindowApproximate": len(self._sources),
                "uniqueFailureSourcesWindowSeconds": self.window_seconds,
                "trackingCapacityReached": self._capacity_reached,
                "processStartedAt": self._started_at,
                "processUptimeSeconds": max(0, int(now - self._started)),
                "lastFailureAt": self._last_failure_at,
            }


def _auth_tx_valid(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= (1 << 63) - 1


def parse_xray_online(payload: object, account_id: str) -> int:
    """Read one Xray active-source-IP count without accepting IP-list data."""
    email = VLESS_EMAILS.get(account_id)
    item = payload.get("stat") if isinstance(payload, dict) else None
    expected_name = f"user>>>{email}>>>online" if email else None
    if not email or not isinstance(item, dict) or item.get("name") != expected_name:
        raise SourceFailure("invalid_response")
    value = item.get("value", 0)  # Xray omits value for an inactive user.
    if isinstance(value, int) and not isinstance(value, bool):
        parsed = int(value)
    elif isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        parsed = int(value)
    else:
        raise SourceFailure("invalid_response")
    if parsed < 0:
        raise SourceFailure("invalid_response")
    return parsed


def parse_xray_online_version(output: str) -> tuple[int, int, int]:
    """Require the first Xray release with StatsService user-online support."""
    match = re.search(r"\bXray\s+(\d+)\.(\d+)\.(\d+)\b", output)
    if not match:
        raise SourceFailure("unsupported_version")
    version = tuple(int(part) for part in match.groups())
    if version < MIN_XRAY_ONLINE_VERSION:
        raise SourceFailure("unsupported_version")
    return version


def xray_online_not_found_is_zero(output: str, account_id: str) -> bool:
    """Xray omits an offline user's online stat and returns gRPC NotFound."""
    email = VLESS_EMAILS.get(account_id)
    expected = f"user>>>{email}>>>online not found" if email else None
    return bool(expected and "code = NotFound" in output and expected in output)


def fetch_kiwivm(base_url: str, credentials_path: str | Path) -> dict[str, object]:
    try:
        _require_protected_file(credentials_path, "KiwiVM credentials")
        credentials = json.loads(Path(credentials_path).read_text(encoding="utf-8"))
        veid = credentials.get("veid") if isinstance(credentials, dict) else None
        api_key = credentials.get("apiKey", credentials.get("api_key")) if isinstance(credentials, dict) else None
        if not isinstance(veid, str) or not veid.strip() or not isinstance(api_key, str) or not api_key.strip():
            raise SourceFailure("unavailable")
    except SourceFailure:
        raise
    except (OSError, json.JSONDecodeError) as error:
        raise SourceFailure("unavailable") from error
    request = Request(
        f"{base_url.rstrip('/')}/getServiceInfo",
        data=urlencode({"veid": veid.strip(), "api_key": api_key.strip()}).encode("ascii"),
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AmadeusGatewayAccounting/1"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            payload = response.read(MAX_PROVIDER_BODY_BYTES + 1)
    except TimeoutError as error:
        raise SourceFailure("timeout") from error
    except (OSError, URLError) as error:
        raise SourceFailure("unreachable") from error
    if len(payload) > MAX_PROVIDER_BODY_BYTES:
        raise SourceFailure("invalid_response")
    try:
        item = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceFailure("invalid_response") from error
    if not isinstance(item, dict) or item.get("error") not in (None, 0, "0"):
        raise SourceFailure("invalid_response")
    counter = item.get("data_counter", item.get("data_counter_bytes"))
    total = item.get("plan_monthly_data", item.get("monthly_data_bytes"))
    counter, total = _counter_integer(counter), _counter_integer(total)
    if counter < 0 or total <= 0:
        raise SourceFailure("invalid_response")
    reset_at = item.get("data_next_reset", item.get("data_reset_date", item.get("reset_at", item.get("next_reset"))))
    if isinstance(reset_at, (int, float)) and not isinstance(reset_at, bool):
        import datetime
        epoch = reset_at / 1000 if reset_at >= 100_000_000_000 else reset_at
        reset_at = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    elif isinstance(reset_at, str):
        reset_at = reset_at[:64]
    else:
        reset_at = None
    return {"counterBytes": counter, "totalBytes": total, "resetAt": reset_at}


@dataclass(frozen=True)
class ServiceConfig:
    db_path: str
    snapshot_path: str
    snapshot_group: str
    listen_host: str
    listen_port: int
    sample_interval: int
    collector_enabled: bool
    hy2_stats_url: str
    hy2_stats_secret_file: str
    xray_stats_server: str
    xray_binary: str
    kiwivm_base_url: str
    kiwivm_credentials_file: str
    hy2_auth_fail_window_seconds: int
    hy2_auth_fail_threshold: int
    hy2_auth_fail_cooldown_seconds: int
    hy2_auth_fail_max_tracked_sources: int
    hy2_auth_fail_mode: str
    reality_fallback_alert_bytes: int
    account_dominant_share_percent: int
    account_dominant_min_window_bytes: int

    @classmethod
    def from_env(cls) -> "ServiceConfig":
        def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
            try:
                value = int(os.environ.get(name, str(default)))
            except ValueError as error:
                raise ValueError(f"{name} must be an integer") from error
            if not minimum <= value <= maximum:
                raise ValueError(f"{name} is outside its allowed range")
            return value

        host = os.environ.get("ACCOUNTING_LISTEN_HOST", "127.0.0.1")
        if host not in {"127.0.0.1", "::1", "localhost"}:
            raise ValueError("accounting auth endpoint must bind loopback")
        port = int(os.environ.get("ACCOUNTING_LISTEN_PORT", "18796"))
        if not 1024 <= port <= 65535:
            raise ValueError("accounting listen port is invalid")
        interval = int(os.environ.get("ACCOUNTING_SAMPLE_INTERVAL_SECONDS", "60"))
        if not 30 <= interval <= 300:
            raise ValueError("accounting interval must be between 30 and 300 seconds")
        collector_value = os.environ.get("ACCOUNTING_COLLECTOR_ENABLED", "true").strip().lower()
        if collector_value not in {"true", "false"}:
            raise ValueError("accounting collector enabled flag must be true or false")
        kiwivm_base_url = os.environ.get("KIWIVM_BASE_URL", "https://api.64clouds.com/v1").rstrip("/")
        parsed_kiwivm_url = urlsplit(kiwivm_base_url)
        if parsed_kiwivm_url.scheme != "https" or not parsed_kiwivm_url.hostname or parsed_kiwivm_url.username or parsed_kiwivm_url.password or parsed_kiwivm_url.query or parsed_kiwivm_url.fragment:
            raise ValueError("KiwiVM endpoint must use HTTPS")
        xray_stats_server = _loopback_host_port(os.environ.get("XRAY_STATS_SERVER", "127.0.0.1:10085"), "Xray StatsService")
        xray_binary = os.environ.get("XRAY_BINARY", "/usr/local/bin/xray")
        if not Path(xray_binary).is_absolute():
            raise ValueError("Xray binary path must be absolute")
        hy2_auth_fail_mode = os.environ.get("HY2_AUTH_FAIL_MODE", "telemetry").strip().lower()
        if hy2_auth_fail_mode not in {"telemetry", "enforce"}:
            raise ValueError("HY2_AUTH_FAIL_MODE must be telemetry or enforce")
        return cls(
            db_path=os.environ.get("ACCOUNTING_DB_PATH", "/var/lib/amadeus-accounting/subscription-accounts.sqlite"),
            snapshot_path=os.environ.get("ACCOUNTING_PUBLIC_SNAPSHOT_PATH", "/var/lib/amadeus-accounting/subscription-usage-public.json"),
            snapshot_group=os.environ.get("ACCOUNTING_SNAPSHOT_GROUP", "amadeus-accounting-snapshot"),
            listen_host=host,
            listen_port=port,
            sample_interval=interval,
            collector_enabled=collector_value == "true",
            hy2_stats_url=_loopback_url(os.environ.get("HY2_STATS_URL", "http://127.0.0.1:19999"), "HY2 stats"),
            hy2_stats_secret_file=os.environ.get("HY2_STATS_SECRET_FILE", "/etc/amadeus-accounting/hysteria-stats-secret"),
            xray_stats_server=xray_stats_server,
            xray_binary=xray_binary,
            kiwivm_base_url=kiwivm_base_url,
            kiwivm_credentials_file=os.environ.get("KIWIVM_CREDENTIALS_FILE", "/etc/amadeus-accounting/kiwivm-credentials.json"),
            hy2_auth_fail_window_seconds=bounded_int("HY2_AUTH_FAIL_WINDOW_SECONDS", 900, 60, 86400),
            hy2_auth_fail_threshold=bounded_int("HY2_AUTH_FAIL_THRESHOLD", 120, 1, 1_000_000),
            hy2_auth_fail_cooldown_seconds=bounded_int("HY2_AUTH_FAIL_COOLDOWN_SECONDS", 300, 1, 86400),
            hy2_auth_fail_max_tracked_sources=bounded_int("HY2_AUTH_FAIL_MAX_TRACKED_SOURCES", 4096, 16, 65536),
            hy2_auth_fail_mode=hy2_auth_fail_mode,
            reality_fallback_alert_bytes=bounded_int("REALITY_FALLBACK_ALERT_BYTES", 1024, 0, (1 << 53) - 1),
            account_dominant_share_percent=bounded_int("ACCOUNT_DOMINANT_SHARE_PERCENT", 85, 1, 100),
            account_dominant_min_window_bytes=bounded_int("ACCOUNT_DOMINANT_MIN_WINDOW_BYTES", 1 << 30, 0, (1 << 53) - 1),
        )


class AccountingCollector:
    def __init__(self, config: ServiceConfig, store: AccountingStore, auth_tracker: AuthFailureTracker | None = None) -> None:
        self.config = config
        self.store = store
        self.auth_tracker = auth_tracker
        _require_protected_file(config.hy2_stats_secret_file, "Hysteria stats secret")
        self._stats_secret = Path(config.hy2_stats_secret_file).read_text(encoding="utf-8").strip()
        if not self._stats_secret or len(self._stats_secret) > 4096:
            raise ValueError("Hysteria stats credential is unavailable")

    def _hysteria(self, endpoint: str) -> object:
        return _read_json(
            f"{self.config.hy2_stats_url}/{endpoint}",
            headers={"Authorization": self._stats_secret, "Accept": "application/json"},
            limit=MAX_STATS_BODY_BYTES,
            timeout=4,
        )

    def _xray_generation(self) -> str | None:
        result = subprocess.run(
            ["systemctl", "show", "--property=InvocationID", "--value", "xray.service"],
            check=False, capture_output=True, text=True, timeout=3,
        )
        return result.stdout.strip()[:80] or None if result.returncode == 0 else None

    def _hysteria_generation(self) -> str | None:
        result = subprocess.run(
            ["systemctl", "show", "--property=InvocationID", "--value", "hysteria-server.service"],
            check=False, capture_output=True, text=True, timeout=3,
        )
        return result.stdout.strip()[:80] or None if result.returncode == 0 else None

    def _xray(self) -> tuple[dict[str, tuple[int, int]], str | None]:
        try:
            generation = self._xray_generation()
            result = subprocess.run(
                [self.config.xray_binary, "api", "statsquery", f"--server={self.config.xray_stats_server}", "-pattern", XRAY_USER_STATS_PATTERN],
                check=False, capture_output=True, text=True, timeout=8,
            )
        except subprocess.TimeoutExpired as error:
            raise SourceFailure("timeout") from error
        except OSError as error:
            raise SourceFailure("unavailable") from error
        if result.returncode != 0 or len(result.stdout) > MAX_STATS_BODY_BYTES:
            raise SourceFailure("unreachable" if result.returncode else "invalid_response")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise SourceFailure("invalid_response") from error
        return parse_xray_stats(payload), generation

    def _xray_fallback(self) -> tuple[tuple[int, int], str | None]:
        try:
            generation = self._xray_generation()
            result = subprocess.run(
                [self.config.xray_binary, "api", "statsquery", f"--server={self.config.xray_stats_server}", "-pattern", XRAY_FALLBACK_STATS_PATTERN],
                check=False, capture_output=True, text=True, timeout=8,
            )
        except subprocess.TimeoutExpired as error:
            raise SourceFailure("timeout") from error
        except OSError as error:
            raise SourceFailure("unavailable") from error
        if result.returncode != 0 or len(result.stdout) > MAX_STATS_BODY_BYTES:
            raise SourceFailure("unreachable" if result.returncode else "invalid_response")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            raise SourceFailure("invalid_response") from error
        return parse_xray_fallback_stats(payload), generation

    def _xray_online(self) -> dict[str, int]:
        try:
            version_result = subprocess.run(
                [self.config.xray_binary, "version"],
                check=False, capture_output=True, text=True, timeout=5,
            )
        except subprocess.TimeoutExpired as error:
            raise SourceFailure("timeout") from error
        except OSError as error:
            raise SourceFailure("unavailable") from error
        if version_result.returncode != 0:
            raise SourceFailure("unavailable")
        parse_xray_online_version(version_result.stdout)

        values: dict[str, int] = {}
        for account_id, email in VLESS_EMAILS.items():
            try:
                result = subprocess.run(
                    [self.config.xray_binary, "api", "statsonline", f"--server={self.config.xray_stats_server}", "-email", email],
                    check=False, capture_output=True, text=True, timeout=5,
                )
            except subprocess.TimeoutExpired as error:
                raise SourceFailure("timeout") from error
            except OSError as error:
                raise SourceFailure("unavailable") from error
            if len(result.stdout) > 16_000 or len(result.stderr) > 16_000:
                raise SourceFailure("invalid_response")
            if result.returncode != 0:
                if xray_online_not_found_is_zero(result.stdout + result.stderr, account_id):
                    values[account_id] = 0
                    continue
                raise SourceFailure("unreachable")
            try:
                payload = json.loads(result.stdout)
            except json.JSONDecodeError as error:
                raise SourceFailure("invalid_response") from error
            values[account_id] = parse_xray_online(payload, account_id)
        return values

    def _provider_generation(self, reset_at: str | None) -> str | None:
        return reset_at[:64] if reset_at else None

    def sample_once(self) -> None:
        sampled_at = utc_now()
        try:
            provider = fetch_kiwivm(self.config.kiwivm_base_url, self.config.kiwivm_credentials_file)
            provider_generation = self._provider_generation(provider.get("resetAt") if isinstance(provider.get("resetAt"), str) else None)
            first_sample = self.store.record_provider_sample(
                counter_bytes=int(provider["counterBytes"]),
                total_bytes=int(provider["totalBytes"]),
                reset_at=provider.get("resetAt") if isinstance(provider.get("resetAt"), str) else None,
                sampled_at=sampled_at,
                generation=provider_generation,
            )
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("provider", sampled_at, code)
            first_sample = False
            logging.warning("accounting source=provider status=error code=%s", code)

        try:
            counters = parse_hysteria_traffic(self._hysteria("traffic"))
            generation = self._hysteria_generation()
            self.store.record_counter_sample(
                source="hysteria_traffic", protocol="hy2", counters=counters,
                generation=generation, sampled_at=sampled_at, baseline=first_sample or self.store.public_snapshot().get("monitoringStartedAt") is None,
            )
            logging.info("accounting source=hysteria_traffic status=ok account_counters=%d", len(counters))
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("hysteria_traffic", sampled_at, code)
            logging.warning("accounting source=hysteria_traffic status=error code=%s", code)

        try:
            online = parse_hysteria_online(self._hysteria("online"))
            self.store.record_online_sample(online, sampled_at, protocol="hy2", source="hysteria_online")
            logging.info("accounting source=hysteria_online status=ok account_instances=%d", len(online))
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("hysteria_online", sampled_at, code)
            logging.warning("accounting source=hysteria_online status=error code=%s", code)

        try:
            counters, generation = self._xray()
            self.store.record_counter_sample(
                source="xray", protocol="vless", counters=counters,
                generation=generation, sampled_at=sampled_at,
                baseline=first_sample or self.store.public_snapshot().get("monitoringStartedAt") is None,
            )
            logging.info("accounting source=xray status=ok account_counters=%d", len(counters))
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("xray", sampled_at, code)
            logging.warning("accounting source=xray status=error code=%s", code)

        try:
            (upload, download), generation = self._xray_fallback()
            self.store.record_reality_fallback_sample(
                upload=upload, download=download, generation=generation, sampled_at=sampled_at,
            )
            logging.info("accounting source=reality_fallback status=ok")
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("reality_fallback", sampled_at, code)
            logging.warning("accounting source=reality_fallback status=error code=%s", code)

        try:
            online = self._xray_online()
            self.store.record_online_sample(online, sampled_at, protocol="vless", source="xray_online")
            logging.info("accounting source=xray_online status=ok account_counts=%d", len(online))
        except Exception as error:
            code = error.code if isinstance(error, SourceFailure) else "unavailable"
            self.store.mark_source_error("xray_online", sampled_at, code)
            logging.warning("accounting source=xray_online status=error code=%s", code)

        try:
            group_id = grp.getgrnam(self.config.snapshot_group).gr_gid
            self.store.write_public_snapshot(
                self.config.snapshot_path,
                group_id=group_id,
                auth_security=self.auth_tracker.snapshot() if self.auth_tracker else None,
                security_thresholds={
                    "hy2AuthFailThreshold": self.config.hy2_auth_fail_threshold,
                    "realityFallbackAlertBytes": self.config.reality_fallback_alert_bytes,
                    "accountDominantSharePercent": self.config.account_dominant_share_percent,
                    "accountDominantMinWindowBytes": self.config.account_dominant_min_window_bytes,
                },
            )
        except Exception as error:
            # The sanitized view is unavailable; do not expose the exception or any path.
            logging.error("accounting snapshot status=error code=%s", type(error).__name__)

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            started = time.monotonic()
            self.sample_once()
            stop.wait(max(1, self.config.sample_interval - (time.monotonic() - started)))


class AccountingHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], store: AccountingStore, auth_tracker: AuthFailureTracker | None = None) -> None:
        self.accounting_store = store
        self.auth_failure_tracker = auth_tracker or AuthFailureTracker()
        super().__init__(address, AccountingRequestHandler)


def _request_shutdown(server: ThreadingHTTPServer, stop: threading.Event) -> threading.Thread:
    """Call BaseServer.shutdown outside the serve_forever thread to avoid deadlock."""
    stop.set()
    worker = threading.Thread(target=server.shutdown, name="accounting-http-shutdown", daemon=True)
    worker.start()
    return worker


class AccountingRequestHandler(BaseHTTPRequestHandler):
    server: AccountingHTTPServer
    server_version = "AmadeusGatewayAccounting/1"

    def setup(self) -> None:
        super().setup()
        self.connection.settimeout(3)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self._reply(404, {"status": "not_found"})
            return
        try:
            healthy = self.server.accounting_store.health()
        except Exception:
            healthy = False
        self._reply(200 if healthy else 503, {"status": "ok" if healthy else "error"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/auth":
            self._reply(404, {"ok": False})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            self._reply(400, {"ok": False})
            return
        if length <= 0 or length > MAX_AUTH_BODY_BYTES:
            self._reply(413, {"ok": False})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, TimeoutError):
            self._reply(400, {"ok": False})
            return
        candidate = payload.get("auth") if isinstance(payload, dict) else None
        client_ip = parse_hysteria_client_addr(payload.get("addr") if isinstance(payload, dict) else None)
        tx = payload.get("tx") if isinstance(payload, dict) else None
        if client_ip is None or not _auth_tx_valid(tx):
            self._reply(403, {"ok": False})
            return
        if self.server.auth_failure_tracker.reject_rate_limited(client_ip):
            try:
                self.server.accounting_store.record_security_event("hy2_auth_rate_limited", utc_now())
            except Exception as error:
                logging.error("accounting security telemetry status=error code=%s", type(error).__name__)
            self._reply(403, {"ok": False})
            return
        if not isinstance(candidate, str):
            self._record_auth_failure(client_ip)
            self._reply(403, {"ok": False})
            return
        try:
            account_id = self.server.accounting_store.auth_account_id(candidate)
        except Exception:
            self._reply(503, {"ok": False})
            return
        if account_id is None:
            self._record_auth_failure(client_ip)
            self._reply(403, {"ok": False})
            return
        self._reply(200, {"ok": True, "id": AUTH_IDS[account_id]})

    def _record_auth_failure(self, client_ip: str) -> None:
        failed_at = utc_now()
        self.server.auth_failure_tracker.record_failure(client_ip, at=failed_at)
        try:
            self.server.accounting_store.record_security_event("hy2_auth_failure", failed_at)
        except Exception as error:
            logging.error("accounting security telemetry status=error code=%s", type(error).__name__)

    def _reply(self, status: int, value: dict[str, object]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except OSError:
            pass

    def log_message(self, _format: str, *_args: object) -> None:
        # Auth payloads and subscription bearer paths are never written to logs.
        return


def run_service() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(message)s")
    config = ServiceConfig.from_env()
    store = AccountingStore(config.db_path)
    auth_tracker = AuthFailureTracker(
        window_seconds=config.hy2_auth_fail_window_seconds,
        threshold=config.hy2_auth_fail_threshold,
        cooldown_seconds=config.hy2_auth_fail_cooldown_seconds,
        max_tracked_sources=config.hy2_auth_fail_max_tracked_sources,
        mode=config.hy2_auth_fail_mode,
    )
    collector = AccountingCollector(config, store, auth_tracker)
    stop = threading.Event()
    server = AccountingHTTPServer((config.listen_host, config.listen_port), store, auth_tracker)
    thread: threading.Thread | None = None
    if config.collector_enabled:
        thread = threading.Thread(target=collector.run, args=(stop,), name="accounting-collector", daemon=True)
        thread.start()
    shutdown_threads: list[threading.Thread] = []

    def handle_signal(_signum: int, _frame: object) -> None:
        if not shutdown_threads:
            shutdown_threads.append(_request_shutdown(server, stop))

    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, handle_signal)
    if config.collector_enabled:
        logging.info("accounting auth endpoint listening on loopback; collector_enabled=true sampling_interval_seconds=%d", config.sample_interval)
    else:
        logging.info("accounting auth endpoint listening on loopback; collector_enabled=false")
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        stop.set()
        server.server_close()
        if thread is not None:
            thread.join(timeout=5)
        for shutdown_thread in shutdown_threads:
            shutdown_thread.join(timeout=5)


if __name__ == "__main__":
    run_service()
