#!/usr/bin/env python3
"""Probe KOOK bot liveness and recover LangBot after a sustained offline state.

The watchdog is intentionally independent from LangBot. It uses the external
KOOK token file, so a broken LangBot adapter or database connection cannot make
the monitor report a false healthy state. It never logs the token or response
body.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import ssl
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_API_URL = "https://www.kookapp.cn/api/v3/user/me"
DEFAULT_TOKEN_FILE = Path("/DATA/AppData/langbot/secrets/kook-bot-token")
DEFAULT_STATE_FILE = Path("/DATA/AppData/langbot/monitoring/kook-watchdog-state.json")
DEFAULT_LOCK_FILE = Path("/run/kook-watchdog.lock")
DEFAULT_COMPOSE_DIR = Path("/var/lib/casaos/apps/langbot")
DEFAULT_SERVICE = "langbot"
DEFAULT_CONTAINER = "langbot"


@dataclass(frozen=True)
class Config:
    api_url: str
    token_file: Path
    state_file: Path
    lock_file: Path
    compose_dir: Path
    compose_service: str
    container_name: str
    docker_bin: str
    request_timeout_seconds: float
    offline_threshold: int
    restart_cooldown_seconds: int
    restart_window_seconds: int
    max_restarts: int


@dataclass(frozen=True)
class ProbeResult:
    kind: str
    http_status: Optional[int] = None
    api_code: Optional[Any] = None


def _positive_int(name: str, env: Mapping[str, str], default: int) -> int:
    raw = env.get(name)
    if raw is None:
        return default
    value = int(raw)
    if value < 1:
        raise ValueError(f"{name} must be positive")
    return value


def _positive_float(name: str, env: Mapping[str, str], default: float) -> float:
    raw = env.get(name)
    if raw is None:
        return default
    value = float(raw)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def make_config(env: Optional[Mapping[str, str]] = None) -> Config:
    values = os.environ if env is None else env
    return Config(
        api_url=values.get("KOOK_WATCHDOG_API_URL", DEFAULT_API_URL),
        token_file=Path(values.get("KOOK_WATCHDOG_TOKEN_FILE", str(DEFAULT_TOKEN_FILE))),
        state_file=Path(values.get("KOOK_WATCHDOG_STATE_FILE", str(DEFAULT_STATE_FILE))),
        lock_file=Path(values.get("KOOK_WATCHDOG_LOCK_FILE", str(DEFAULT_LOCK_FILE))),
        compose_dir=Path(values.get("KOOK_WATCHDOG_COMPOSE_DIR", str(DEFAULT_COMPOSE_DIR))),
        compose_service=values.get("KOOK_WATCHDOG_COMPOSE_SERVICE", DEFAULT_SERVICE),
        container_name=values.get("KOOK_WATCHDOG_CONTAINER", DEFAULT_CONTAINER),
        docker_bin=values.get("KOOK_WATCHDOG_DOCKER_BIN", "docker"),
        request_timeout_seconds=_positive_float(
            "KOOK_WATCHDOG_REQUEST_TIMEOUT_SECONDS", values, 10.0
        ),
        offline_threshold=_positive_int(
            "KOOK_WATCHDOG_OFFLINE_THRESHOLD", values, 3
        ),
        restart_cooldown_seconds=_positive_int(
            "KOOK_WATCHDOG_RESTART_COOLDOWN_SECONDS", values, 900
        ),
        restart_window_seconds=_positive_int(
            "KOOK_WATCHDOG_RESTART_WINDOW_SECONDS", values, 21600
        ),
        max_restarts=_positive_int("KOOK_WATCHDOG_MAX_RESTARTS", values, 3),
    )


def emit(event: str, **fields: Any) -> None:
    """Write a structured, secret-free journal line."""

    record = {"event": event, **fields}
    print(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


def utc_iso(timestamp: Optional[float] = None) -> str:
    value = time.time() if timestamp is None else timestamp
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def classify_payload(payload: Any, http_status: int) -> ProbeResult:
    if http_status in (401, 403):
        return ProbeResult("credential_invalid", http_status=http_status)
    if http_status >= 400:
        return ProbeResult("probe_unavailable", http_status=http_status)
    if not isinstance(payload, dict):
        return ProbeResult("invalid_response", http_status=http_status)

    api_code = payload.get("code")
    if api_code not in (None, 0, "0"):
        if str(api_code) in {"401", "403"}:
            return ProbeResult(
                "credential_invalid", http_status=http_status, api_code=api_code
            )
        return ProbeResult("api_error", http_status=http_status, api_code=api_code)

    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("online"), bool):
        return ProbeResult("invalid_response", http_status=http_status, api_code=api_code)
    return ProbeResult(
        "online" if data["online"] else "offline",
        http_status=http_status,
        api_code=api_code,
    )


def probe(config: Config) -> ProbeResult:
    try:
        token = config.token_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ProbeResult("credential_unavailable")
    if not token:
        return ProbeResult("credential_unavailable")

    request = Request(
        config.api_url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bot {token}",
            "User-Agent": "kook-watchdog/1",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=config.request_timeout_seconds) as response:
            http_status = int(response.getcode())
            body = response.read(131072)
    except HTTPError as error:
        try:
            error.close()
        except OSError:
            pass
        return classify_payload({}, int(error.code))
    except (URLError, TimeoutError, OSError, ssl.SSLError):
        return ProbeResult("probe_unavailable")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return ProbeResult("invalid_response", http_status=http_status)
    return classify_payload(payload, http_status)


def default_state() -> dict[str, Any]:
    return {
        "version": 1,
        "consecutive_offline": 0,
        "consecutive_probe_failures": 0,
        "restart_history": [],
        "last_restart_at": None,
        "last_probe_at": None,
        "last_recovery_at": None,
        "last_http_status": None,
        "last_result": "unknown",
        "last_event": None,
    }


def normalise_state(raw: Any) -> dict[str, Any]:
    state = default_state()
    if isinstance(raw, dict):
        state.update(raw)

    for key in ("consecutive_offline", "consecutive_probe_failures"):
        value = state.get(key)
        state[key] = value if type(value) is int and value >= 0 else 0

    history: list[float] = []
    raw_history = state.get("restart_history")
    if isinstance(raw_history, list):
        for value in raw_history:
            if type(value) in (int, float) and value >= 0:
                history.append(float(value))
    state["restart_history"] = history
    if state.get("last_restart_at") is not None and type(state["last_restart_at"]) not in (
        int,
        float,
    ):
        state["last_restart_at"] = None
    return state


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return default_state()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        emit("KOOK_STATE_RESET", reason="invalid_state_file")
        return default_state()
    return normalise_state(raw)


def save_state(path: Path, state: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, temp_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=str(path.parent), text=True
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def prune_restart_history(state: dict[str, Any], now: float, window_seconds: int) -> None:
    state["restart_history"] = [
        timestamp
        for timestamp in state.get("restart_history", [])
        if now - float(timestamp) < window_seconds
    ]


def restart_decision(
    state: Mapping[str, Any],
    now: float,
    config: Config,
    container_state: str,
) -> str:
    if int(state.get("consecutive_offline", 0)) < config.offline_threshold:
        return "threshold"
    if container_state != "running":
        return "container_not_running"
    if len(state.get("restart_history", [])) >= config.max_restarts:
        return "exhausted"
    last_restart = state.get("last_restart_at")
    if type(last_restart) in (int, float) and now - float(last_restart) < config.restart_cooldown_seconds:
        return "cooldown"
    return "restart"


def container_state(config: Config) -> str:
    try:
        result = subprocess.run(
            [
                config.docker_bin,
                "inspect",
                "--format",
                "{{.State.Status}}",
                config.container_name,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    return result.stdout.strip().lower() or "unknown"


def restart_container(config: Config) -> bool:
    compose_file = config.compose_dir / "docker-compose.yml"
    if not compose_file.is_file():
        return False
    try:
        result = subprocess.run(
            [config.docker_bin, "compose", "restart", config.compose_service],
            cwd=str(config.compose_dir),
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _probe_event(result_kind: str) -> str:
    return {
        "online": "KOOK_HEALTHY",
        "offline": "KOOK_CONNECTION_DEGRADED",
        "credential_invalid": "KOOK_CREDENTIAL_INVALID",
        "credential_unavailable": "KOOK_CREDENTIAL_UNAVAILABLE",
        "probe_unavailable": "KOOK_PROBE_UNAVAILABLE",
        "invalid_response": "KOOK_PROBE_INVALID_RESPONSE",
        "api_error": "KOOK_API_ERROR",
    }.get(result_kind, "KOOK_WATCHDOG_UNKNOWN_RESULT")


def _record_probe(state: dict[str, Any], result: ProbeResult, now: float) -> None:
    state["last_probe_at"] = utc_iso(now)
    state["last_http_status"] = result.http_status


def run_watchdog(config: Config, dry_run: bool = False) -> int:
    if dry_run:
        result = probe(config)
        emit(
            _probe_event(result.kind),
            mode="dry-run",
            result=result.kind,
            http_status=result.http_status,
        )
        return 0 if result.kind == "online" else 1

    config.lock_file.parent.mkdir(parents=True, exist_ok=True)
    with config.lock_file.open("a+", encoding="utf-8") as lock_handle:
        os.chmod(config.lock_file, 0o600)
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)

        now = time.time()
        state = load_state(config.state_file)
        prune_restart_history(state, now, config.restart_window_seconds)
        previous_result = state.get("last_result", "unknown")
        result = probe(config)
        _record_probe(state, result, now)

        if result.kind == "online":
            recovered = previous_result in {
                "offline",
                "restart_requested",
                "restart_failed",
                "probe_unavailable",
                "invalid_response",
                "api_error",
                "credential_invalid",
                "credential_unavailable",
            }
            state["consecutive_offline"] = 0
            state["consecutive_probe_failures"] = 0
            state["last_result"] = "online"
            event = "KOOK_CONNECTION_RECOVERED" if recovered else "KOOK_HEALTHY"
            state["last_event"] = event
            if recovered:
                state["last_recovery_at"] = utc_iso(now)
            save_state(config.state_file, state)
            if recovered or previous_result != "online":
                emit(event, result="online", restart_count=len(state["restart_history"]))
            return 0

        if result.kind == "offline":
            state["consecutive_offline"] = int(state["consecutive_offline"]) + 1
            state["consecutive_probe_failures"] = 0
            state["last_result"] = "offline"
            current_container_state = container_state(config)
            decision = restart_decision(state, now, config, current_container_state)

            if decision == "threshold":
                event = "KOOK_CONNECTION_DEGRADED"
                state["last_event"] = event
                save_state(config.state_file, state)
                if previous_result != "offline" or state["consecutive_offline"] == 1:
                    emit(
                        event,
                        consecutive_offline=state["consecutive_offline"],
                        threshold=config.offline_threshold,
                    )
                return 0

            if current_container_state == "unknown":
                event = "KOOK_CONTAINER_STATUS_UNAVAILABLE"
                state["last_event"] = event
                save_state(config.state_file, state)
                emit(event, consecutive_offline=state["consecutive_offline"])
                return 0

            if decision == "container_not_running":
                event = "KOOK_CONTAINER_NOT_RUNNING"
                state["last_event"] = event
                save_state(config.state_file, state)
                emit(event, consecutive_offline=state["consecutive_offline"])
                return 0

            if decision == "exhausted":
                event = "KOOK_RECOVERY_EXHAUSTED"
                state["last_event"] = event
                save_state(config.state_file, state)
                emit(
                    event,
                    consecutive_offline=state["consecutive_offline"],
                    restart_count=len(state["restart_history"]),
                    max_restarts=config.max_restarts,
                )
                return 0

            if decision == "cooldown":
                event = "KOOK_RESTART_COOLDOWN"
                state["last_event"] = event
                save_state(config.state_file, state)
                emit(
                    event,
                    consecutive_offline=state["consecutive_offline"],
                    restart_count=len(state["restart_history"]),
                )
                return 0

            state["restart_history"].append(now)
            state["last_restart_at"] = now
            state["last_result"] = "restart_requested"
            state["last_event"] = "KOOK_AUTO_RESTART_REQUESTED"
            save_state(config.state_file, state)
            emit(
                "KOOK_AUTO_RESTART_REQUESTED",
                consecutive_offline=state["consecutive_offline"],
                restart_count=len(state["restart_history"]),
            )
            if restart_container(config):
                state["consecutive_offline"] = 0
                state["last_event"] = "KOOK_AUTO_RESTART_STARTED"
                save_state(config.state_file, state)
                emit(
                    "KOOK_AUTO_RESTART_STARTED",
                    restart_count=len(state["restart_history"]),
                )
                return 0

            state["last_result"] = "restart_failed"
            state["last_event"] = "KOOK_AUTO_RESTART_FAILED"
            save_state(config.state_file, state)
            emit(
                "KOOK_AUTO_RESTART_FAILED",
                restart_count=len(state["restart_history"]),
            )
            return 1

        if result.kind in {
            "credential_invalid",
            "credential_unavailable",
            "api_error",
            "invalid_response",
        }:
            state["consecutive_offline"] = 0
            state["consecutive_probe_failures"] = 0
            state["last_result"] = result.kind
            event = _probe_event(result.kind)
            state["last_event"] = event
            save_state(config.state_file, state)
            if previous_result != result.kind:
                emit(event, result=result.kind, http_status=result.http_status)
            return 0

        state["consecutive_offline"] = 0
        state["consecutive_probe_failures"] = int(state["consecutive_probe_failures"]) + 1
        state["last_result"] = result.kind
        event = "KOOK_PROBE_UNAVAILABLE"
        state["last_event"] = event
        save_state(config.state_file, state)
        if previous_result != result.kind or state["consecutive_probe_failures"] == 1:
            emit(
                event,
                result=result.kind,
                consecutive_probe_failures=state["consecutive_probe_failures"],
            )
        return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="probe KOOK only; do not read/write state or restart LangBot",
    )
    args = parser.parse_args(argv)
    try:
        return run_watchdog(make_config(), dry_run=args.dry_run)
    except Exception as error:  # keep journal output secret-free and bounded
        emit("KOOK_WATCHDOG_ERROR", error=type(error).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())
