#!/usr/bin/env python3
"""Serve existing subscription files with VPS-wide usage metadata.

The service deliberately keeps the existing /<token>/<format> URLs stable.
It reads the subscription body from the existing Caddy-owned directory and
adds a standard subscription-userinfo header backed by the KiwiVM service
counter. The counter represents the whole VPS plan, not an individual user.
"""

from __future__ import annotations

import json
import logging
import math
import os
import re
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import Request, urlopen


ALLOWED_SUBSCRIPTION_FILES = frozenset({
    "qx.conf",
    "server.snippet",
    "clash.yaml",
    "shadowrocket.txt",
})
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9._~-]+$")
FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


class UsageUnavailable(RuntimeError):
    """Raised when no fresh or previously successful usage sample exists."""


@dataclass(frozen=True)
class UsageSnapshot:
    used_bytes: int
    total_bytes: int
    reset_at: datetime | None
    checked_at: datetime
    stale: bool = False

    @property
    def remaining_bytes(self) -> int:
        return max(self.total_bytes - self.used_bytes, 0)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def _bytes(value: object, *, positive: bool = False) -> int | None:
    parsed = _number(value)
    if parsed is None or parsed < 0 or (positive and parsed <= 0):
        return None
    return int(parsed)


def _timestamp(value: object) -> datetime | None:
    parsed = _number(value)
    if parsed is not None:
        milliseconds = parsed * 1000 if parsed < 100_000_000_000 else parsed
        try:
            return datetime.fromtimestamp(milliseconds / 1000, timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if result.tzinfo is None:
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def _optional_value(item: dict[str, object], *keys: str) -> object | None:
    for key in keys:
        if key in item and item[key] not in (None, ""):
            return item[key]
    return None


def _snapshot_from_item(item: object, checked_at: datetime) -> UsageSnapshot:
    if not isinstance(item, dict):
        raise UsageUnavailable("KiwiVM returned a non-object response")
    error = _number(item.get("error"))
    if error is not None and error != 0:
        raise UsageUnavailable("KiwiVM rejected the usage request")
    used = _bytes(_optional_value(item, "data_counter", "data_counter_bytes"))
    total = _bytes(_optional_value(item, "plan_monthly_data", "monthly_data_bytes"), positive=True)
    if used is None or total is None:
        raise UsageUnavailable("KiwiVM returned incomplete usage counters")
    reset_at = _timestamp(_optional_value(item, "data_next_reset", "data_reset_date", "reset_at", "next_reset"))
    return UsageSnapshot(used, total, reset_at, checked_at)


def _read_credentials(path: Path) -> tuple[str, str]:
    try:
        item = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise UsageUnavailable("KiwiVM credentials are unavailable") from error
    if not isinstance(item, dict):
        raise UsageUnavailable("KiwiVM credentials are invalid")
    veid = item.get("veid")
    api_key = item.get("apiKey", item.get("api_key"))
    if not isinstance(veid, str) or not veid.strip() or not isinstance(api_key, str) or not api_key.strip():
        raise UsageUnavailable("KiwiVM credentials are invalid")
    return veid.strip(), api_key.strip()


def _state_snapshot(path: Path) -> UsageSnapshot | None:
    try:
        item = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(item, dict):
        return None
    used = _bytes(item.get("lastSuccessfulCounter", item.get("usedBytes")))
    total = _bytes(item.get("lastSuccessfulTotal", item.get("totalBytes")), positive=True)
    checked_at = _timestamp(item.get("lastSuccessfulAt", item.get("checkedAt")))
    if used is None or total is None or checked_at is None:
        return None
    reset_at = _timestamp(item.get("lastSuccessfulResetAt", item.get("resetAt")))
    return UsageSnapshot(used, total, reset_at, checked_at, stale=True)


def _write_state(path: Path, snapshot: UsageSnapshot) -> None:
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    state = {
        "lastSuccessfulCounter": snapshot.used_bytes,
        "lastSuccessfulAt": snapshot.checked_at.isoformat().replace("+00:00", "Z"),
        "lastSuccessfulTotal": snapshot.total_bytes,
        "lastSuccessfulResetAt": snapshot.reset_at.isoformat().replace("+00:00", "Z") if snapshot.reset_at else None,
    }
    temporary = tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
        delete=False,
    )
    temporary_path = Path(temporary.name)
    try:
        temporary.write(json.dumps(state, separators=(",", ":")) + "\n")
        temporary.flush()
        os.fchmod(temporary.fileno(), 0o600)
        temporary.close()
        os.replace(temporary_path, path)
    finally:
        try:
            temporary.close()
        except OSError:
            pass
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


class UsageProvider:
    def __init__(
        self,
        base_url: str,
        credentials_path: Path,
        state_path: Path,
        cache_seconds: int = 60,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.credentials_path = credentials_path
        self.state_path = state_path
        self.cache_seconds = max(cache_seconds, 1)
        self._cached: UsageSnapshot | None = None
        self._cached_until = 0.0
        self._lock = threading.Lock()

    def _fetch(self) -> UsageSnapshot:
        veid, api_key = _read_credentials(self.credentials_path)
        request = Request(
            f"{self.base_url}/getServiceInfo",
            data=urlencode({"veid": veid, "api_key": api_key}).encode("ascii"),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        with urlopen(request, timeout=10) as response:
            payload = json.loads(response.read(1_000_000).decode("utf-8"))
        return _snapshot_from_item(payload, datetime.now(timezone.utc))

    def snapshot(self) -> UsageSnapshot | None:
        now = time.monotonic()
        with self._lock:
            if self._cached is not None and now < self._cached_until:
                return self._cached
            try:
                fresh = self._fetch()
                _write_state(self.state_path, fresh)
                self._cached = fresh
            except (OSError, UsageUnavailable, ValueError):
                self._cached = _state_snapshot(self.state_path)
            self._cached_until = now + self.cache_seconds
            return self._cached


def subscription_userinfo(snapshot: UsageSnapshot) -> str:
    """Expose aggregate VPS bytes through the common subscription header.

    KiwiVM returns one aggregate counter. It is placed in the download field
    so clients that calculate upload + download still display the VPS total.
    """

    values = [f"upload=0", f"download={snapshot.used_bytes}", f"total={snapshot.total_bytes}"]
    if snapshot.reset_at is not None:
        values.append(f"expire={int(snapshot.reset_at.timestamp())}")
    return "; ".join(values)


def usage_summary(snapshot: UsageSnapshot) -> str:
    status = "stale" if snapshot.stale else "fresh"
    return (
        f"usedBytes={snapshot.used_bytes}; remainingBytes={snapshot.remaining_bytes}; "
        f"totalBytes={snapshot.total_bytes}; status={status}"
    )


def _subscription_target(root: Path, request_path: str) -> tuple[Path, str]:
    parsed = urlsplit(request_path)
    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if len(parts) != 2:
        raise FileNotFoundError
    token, filename = parts
    if not TOKEN_PATTERN.fullmatch(token) or filename not in ALLOWED_SUBSCRIPTION_FILES:
        raise FileNotFoundError
    root_path = root.resolve()
    token_path = (root_path / token).resolve()
    target = (token_path / filename).resolve()
    try:
        token_path.relative_to(root_path)
        target.relative_to(token_path)
    except ValueError as error:
        raise FileNotFoundError from error
    if not target.is_file():
        raise FileNotFoundError
    return target, filename


class SubscriptionServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        address: tuple[str, int],
        root: Path,
        provider: UsageProvider,
        download_filename: str,
    ) -> None:
        if not FILENAME_PATTERN.fullmatch(download_filename):
            raise ValueError("invalid subscription download filename")
        self.subscription_root = root
        self.usage_provider = provider
        self.download_filename = download_filename
        super().__init__(address, SubscriptionRequestHandler)


class SubscriptionRequestHandler(BaseHTTPRequestHandler):
    server: SubscriptionServer
    server_version = "AmadeusGatewaySubscription/1"

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._serve(include_body=True)

    def do_HEAD(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
        self._serve(include_body=False)

    def _serve(self, *, include_body: bool) -> None:
        if urlsplit(self.path).path == "/healthz":
            self._send_bytes(200, b"ok\n", "text/plain; charset=utf-8", include_body=include_body)
            return
        try:
            target, filename = _subscription_target(self.server.subscription_root, self.path)
            body = target.read_bytes()
        except (FileNotFoundError, OSError):
            self._send_bytes(404, b"not found\n", "text/plain; charset=utf-8", include_body=include_body)
            return

        snapshot = self.server.usage_provider.snapshot()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Disposition", f'inline; filename="{self.server.download_filename}"')
        self.send_header("X-Amadeus-Gateway-Format", filename)
        if snapshot is None:
            self.send_header("X-Amadeus-Gateway-Usage-Status", "unavailable")
        else:
            self.send_header("Subscription-Userinfo", subscription_userinfo(snapshot))
            self.send_header("X-Amadeus-Gateway-Usage", usage_summary(snapshot))
            self.send_header("X-Amadeus-Gateway-Usage-Status", "stale" if snapshot.stale else "fresh")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def _send_bytes(self, status: int, body: bytes, content_type: str, *, include_body: bool) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        # Never log self.path: the token in the subscription URL is a bearer credential.
        logging.info("subscription request")


def _env_path(name: str, fallback: str) -> Path:
    return Path(os.environ.get(name, fallback))


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(levelname)s %(message)s")
    listen_host = os.environ.get("SUBSCRIPTION_LISTEN_HOST", "127.0.0.1")
    listen_port = int(os.environ.get("SUBSCRIPTION_LISTEN_PORT", "8787"))
    cache_seconds = int(os.environ.get("USAGE_CACHE_SECONDS", "60"))
    root = _env_path("SUBSCRIPTION_ROOT", "/var/lib/caddy/subscription")
    provider = UsageProvider(
        os.environ.get("KIWIVM_BASE_URL", "https://api.64clouds.com/v1"),
        _env_path("KIWIVM_CREDENTIALS_FILE", "/etc/amadeus-gateway/kiwivm-credentials.json"),
        _env_path("USAGE_STATE_FILE", "/var/lib/amadeus-gateway/usage-state.json"),
        cache_seconds,
    )
    filename = os.environ.get("SUBSCRIPTION_FILENAME", "amadeus-gateway")
    server = SubscriptionServer((listen_host, listen_port), root, provider, filename)
    logging.info("subscription responder listening on %s:%d", listen_host, listen_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
