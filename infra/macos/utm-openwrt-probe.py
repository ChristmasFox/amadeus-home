#!/usr/bin/env python3
"""Keep the M204 UTM OpenWrt VM available and notify the owner on recovery."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

HOME = Path.home()
LABEL = "com.amadeus.utm-openwrt-probe"
UTMCTL = "/Applications/UTM.app/Contents/MacOS/utmctl"
UTM_APP = "/Applications/UTM.app"
VM_ID = "20749BCD-CE6D-4A33-B26E-8C5D17E3C705"
OPENWRT_IP = "192.168.5.2"
PROBES = (("ssh", 22), ("luci", 80))
NOTIFY_HELPER = HOME / "amadeus-home-codex/scripts/notify-owner.sh"
REMOTE_MACHINE = "nyannyan"
REMOTE_OUTBOX = "/DATA/AppData/openclaw/notifications"
ORB = "/opt/homebrew/bin/orb"
PATH_VALUE = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

ROOT = HOME / ".local/state/amadeus/utm-openwrt-probe"
STATE_FILE = ROOT / "state.json"
LOCK_FILE = ROOT / "probe.lock"
PAUSE_FILE = ROOT / "paused"
OUTBOX = ROOT / "outbox"
LOG_FILE = HOME / "Library/Logs/Amadeus/utm-openwrt-probe.log"

INTERVAL = 30
FAILURE_THRESHOLD = 3
STARTUP_GRACE = 240
RETRY_SECONDS = 300
MAX_ATTEMPTS = 3

ENV = {"HOME": str(HOME), "PATH": PATH_VALUE, "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8"}


def ensure_dirs() -> None:
    for directory in (ROOT, OUTBOX, LOG_FILE.parent):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        try:
            os.chmod(directory, 0o700)
        except OSError:
            pass


def log(message: str) -> None:
    ensure_dirs()
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    with LOG_FILE.open("a", encoding="utf-8") as stream:
        stream.write(f"{stamp} {message.replace(chr(10), ' ')[:1000]}\n")


def atomic_json(path: Path, value: dict) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def run(args: list[str], timeout: int = 20) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(args, env=ENV, text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return subprocess.CompletedProcess(args, 124, "", type(exc).__name__)


def boot_id() -> str:
    result = run(["/usr/sbin/sysctl", "-n", "kern.boottime"])
    match = re.search(r"sec\s*=\s*(\d+)", result.stdout)
    return match.group(1) if result.returncode == 0 and match else "unknown"


def vm_status() -> str:
    result = run([UTMCTL, "status", VM_ID], timeout=20)
    if result.returncode != 0 or not result.stdout.strip():
        return "unknown"
    return result.stdout.strip().splitlines()[-1].strip().lower()


def openwrt_probe() -> dict[str, bool]:
    result: dict[str, bool] = {}
    for name, port in PROBES:
        try:
            with socket.create_connection((OPENWRT_IP, port), timeout=3):
                result[name] = True
        except OSError:
            result[name] = False
    return result


def is_healthy(status: str, probes: dict[str, bool]) -> bool:
    return status == "started" and all(probes.values())


def start_vm() -> bool:
    args = [UTMCTL, "start", "--hide", VM_ID]
    result = run(args, timeout=90)
    if result.returncode == 0:
        log("UTM start command accepted")
        return True
    # Launch UTM quietly, then retry its documented control command.
    run(["/usr/bin/open", "-g", "-j", "-a", UTM_APP], timeout=20)
    time.sleep(5)
    result = run(args, timeout=90)
    if result.returncode == 0:
        log("UTM start command accepted after launching UTM")
        return True
    log(f"UTM start command failed: {result.stderr.strip()[:300] or result.stdout.strip()[:300]}")
    return False


def restart_running_vm() -> bool:
    # Ask OpenWrt to shut down cleanly first; force power-off only after 90s.
    run([UTMCTL, "stop", "--request", VM_ID], timeout=30)
    stopped = False
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        if vm_status() == "stopped":
            stopped = True
            break
        time.sleep(5)
    if not stopped:
        log("UTM graceful shutdown did not finish in 90s; using force power-off")
        forced = run([UTMCTL, "stop", "--force", VM_ID], timeout=30)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if vm_status() == "stopped":
                stopped = True
                break
            time.sleep(3)
        if not stopped:
            log(f"UTM force stop did not confirm stopped: {forced.stderr.strip()[:300]}")
            return False
    return start_vm()


def event_id(event_key: str) -> str:
    return hashlib.sha256(event_key.encode("utf-8")).hexdigest()[:40]


def queue_notice(incident: dict, phase: str, headline: str, summary: str, severity: str) -> None:
    key = f"utm-openwrt-probe:{incident['id']}:{phase}"
    path = OUTBOX / f"{event_id(key)}.json"
    if path.exists():
        return
    atomic_json(path, {
        "eventKey": key,
        "source": "utm-openwrt-probe",
        "headline": headline,
        "summary": summary,
        "severity": severity,
        "significance": "major",
        "theme": "worldline_observation",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "lastAttempt": 0,
    })
    log(f"owner notification queued locally: {phase} {incident['id']}")


def notification_exists_remote(key: str) -> bool:
    identifier = event_id(key)
    for suffix in ("pending.json", "sent.json"):
        path = f"{REMOTE_OUTBOX}/{identifier}.{suffix}"
        result = run([ORB, "-m", REMOTE_MACHINE, "-u", "root", "test", "-e", path], timeout=20)
        if result.returncode == 0:
            return True
    return False


def deliver_notifications() -> None:
    if not NOTIFY_HELPER.is_file():
        return
    now = time.time()
    for path in sorted(OUTBOX.glob("*.json")):
        try:
            event = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if now - float(event.get("lastAttempt", 0)) < RETRY_SECONDS:
            continue
        event["lastAttempt"] = now
        atomic_json(path, event)
        args = [
            "/bin/bash", str(NOTIFY_HELPER),
            "--event-key", str(event["eventKey"]),
            "--source", str(event["source"]),
            "--headline", str(event["headline"]),
            "--summary", str(event["summary"]),
            "--severity", str(event["severity"]),
            "--significance", str(event["significance"]),
            "--theme", str(event["theme"]),
            "--outbox-dir", REMOTE_OUTBOX,
            "--remote-machine", REMOTE_MACHINE,
        ]
        run(args, timeout=60)
        if notification_exists_remote(str(event["eventKey"])):
            try:
                path.unlink()
            except OSError:
                pass
            log(f"owner notification handed to Lab outbox: {event['eventKey']}")
        else:
            log(f"owner notification retained locally for retry: {event['eventKey']}")


def new_incident(reason: str, status: str, probes: dict[str, bool]) -> dict:
    incident = {
        "id": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"),
        "reason": reason,
        "attempts": 0,
        "lastAttempt": 0,
        "failureNoticeSent": False,
    }
    ports = ", ".join(f"{name}={'可达' if value else '不可达'}" for name, value in probes.items())
    queue_notice(
        incident,
        "detected",
        "M204 OpenWrt 探针发现异常",
        f"UTM ImmortalWrt/OpenWrt 异常：{reason}；UTM 状态={status}；{ports}。正在自动恢复。",
        "warning",
    )
    log(f"incident detected: {incident['id']} reason={reason} status={status} {ports}")
    return incident


def recover(incident: dict, status: str, probes: dict[str, bool]) -> bool:
    now = time.time()
    if incident["attempts"] >= MAX_ATTEMPTS:
        if not incident.get("failureNoticeSent"):
            queue_notice(
                incident,
                "failed",
                "M204 OpenWrt 自动恢复失败",
                f"UTM ImmortalWrt/OpenWrt 连续自动恢复 {incident['attempts']} 次仍未恢复；UTM 状态={status}；请检查 Mac、UTM 和家庭网络。",
                "critical",
            )
            incident["failureNoticeSent"] = True
        return False
    if incident["attempts"] and now - float(incident.get("lastAttempt", 0)) < RETRY_SECONDS:
        return False
    incident["attempts"] += 1
    incident["lastAttempt"] = now
    if status == "started":
        ok = restart_running_vm()
    else:
        ok = start_vm()
    log(f"recovery attempt {incident['attempts']}/{MAX_ATTEMPTS}: command_accepted={ok}")
    return ok


def fresh_state(current_boot: str, now: float) -> dict:
    return {
        "schema": 1,
        "bootId": current_boot,
        "sessionStarted": now,
        "armed": False,
        "failureCount": 0,
        "startupAttempts": 0,
        "lastStartupAttempt": 0,
        "incident": None,
    }


def load_state(current_boot: str, now: float) -> dict:
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        if state.get("schema") != 1:
            raise ValueError("unsupported state schema")
    except (OSError, ValueError, TypeError):
        return fresh_state(current_boot, now)
    if state.get("bootId") != current_boot:
        previous_incident = state.get("incident")
        last_incident = state.get("lastIncident")
        state = fresh_state(current_boot, now)
        state["lastIncident"] = last_incident
        if previous_incident:
            state["incident"] = previous_incident
            state["armed"] = True
        log("new macOS boot session detected")
    return state


def save_state(state: dict) -> None:
    state["lastCheckAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    atomic_json(STATE_FILE, state)


def run_check() -> None:
    ensure_dirs()
    with LOCK_FILE.open("a") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        deliver_notifications()
        if PAUSE_FILE.exists():
            return
        now = time.time()
        current_boot = boot_id()
        state = load_state(current_boot, now)
        status = vm_status()
        probes = openwrt_probe()
        healthy = is_healthy(status, probes)

        if healthy:
            incident = state.get("incident")
            if incident:
                ports = ", ".join(f"{name}可达" for name, value in probes.items() if value)
                queue_notice(
                    incident,
                    "recovered",
                    "M204 OpenWrt 已自动恢复",
                    f"UTM ImmortalWrt/OpenWrt 已恢复：UTM 状态=started；{ports}；自动恢复尝试 {incident.get('attempts', 0)} 次。",
                    "success",
                )
                log(f"incident recovered: {incident['id']}")
            state["armed"] = True
            state["failureCount"] = 0
            state["startupAttempts"] = 0
            state["lastIncident"] = {**incident, "result": "recovered", "resolvedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")} if incident else state.get("lastIncident")
            state["incident"] = None
            save_state(state)
            deliver_notifications()
            return

        state["failureCount"] = int(state.get("failureCount", 0)) + 1
        incident = state.get("incident")

        if incident:
            recover(incident, status, probes)
            state["incident"] = incident
            state["lastIncident"] = incident
            save_state(state)
            deliver_notifications()
            return

        if not state.get("armed", False):
            age = now - float(state.get("sessionStarted", now))
            if status != "started":
                last_start = float(state.get("lastStartupAttempt", 0))
                if now - last_start >= 120 and int(state.get("startupAttempts", 0)) < MAX_ATTEMPTS:
                    state["startupAttempts"] = int(state.get("startupAttempts", 0)) + 1
                    state["lastStartupAttempt"] = now
                    start_vm()
            elif age < STARTUP_GRACE:
                save_state(state)
                return
            if age >= STARTUP_GRACE and state["failureCount"] >= FAILURE_THRESHOLD:
                reason = "开机后 OpenWrt 管理服务在宽限期内仍不可达"
                state["armed"] = True
                state["incident"] = new_incident(reason, status, probes)
                state["lastIncident"] = state["incident"]
                recover(state["incident"], status, probes)
            save_state(state)
            deliver_notifications()
            return

        if status != "started" or state["failureCount"] >= FAILURE_THRESHOLD:
            reason = (
                "UTM 虚拟机已停止或状态不可查询"
                if status != "started"
                else "连续多次无法连接 OpenWrt 的 SSH(22) 和 LuCI HTTP(80)"
            )
            state["incident"] = new_incident(reason, status, probes)
            state["lastIncident"] = state["incident"]
            recover(state["incident"], status, probes)
        save_state(state)
        deliver_notifications()


def report_status() -> int:
    status = vm_status()
    probes = openwrt_probe()
    paused = PAUSE_FILE.exists()
    print(f"probe={'paused' if paused else 'active'}; UTM ImmortalWrt={status}; "
          f"SSH22={'reachable' if probes['ssh'] else 'unreachable'}; "
          f"LuCI80={'reachable' if probes['luci'] else 'unreachable'}")
    return 0 if (paused or is_healthy(status, probes)) else 1


def main() -> int:
    ensure_dirs()
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    if command == "pause":
        PAUSE_FILE.write_text(datetime.now(timezone.utc).isoformat(), encoding="utf-8")
        os.chmod(PAUSE_FILE, 0o600)
        log("probe paused by owner")
        print("UTM/OpenWrt probe paused")
        return 0
    if command == "resume":
        try:
            PAUSE_FILE.unlink()
        except FileNotFoundError:
            pass
        log("probe resumed by owner")
        print("UTM/OpenWrt probe resumed; next check runs within 30 seconds")
        return 0
    if command == "status":
        return report_status()
    if command in ("check", "run"):
        run_check()
        return 0
    print("usage: utm-openwrt-probe.py [check|status|pause|resume]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
