#!/usr/bin/env python3
"""Read-only macOS host telemetry agent for HomeHub V1.2.

The HTTP surface is deliberately limited to /v1/health, /v1/host/status and
/v1/cloudflared/status. There is no generic command, shell or exec endpoint.
All host commands are fixed, local observations and never include caller input.
"""
from __future__ import annotations

import argparse
import hmac
import json
import os
import re
import socket
import subprocess
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable, Sequence

VERSION = "1.2.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 49152
DEFAULT_TOKEN_FILE = "/Users/Shared/HomeHub/mac-host-agent.token"
ALLOWED_PATHS = frozenset({"/v1/health", "/v1/host/status", "/v1/cloudflared/status"})

CommandRunner = Callable[[Sequence[str], float], tuple[int, str, str]]


def _default_run(args: Sequence[str], timeout: float) -> tuple[int, str, str]:
    try:
        completed = subprocess.run(
            list(args),
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
            env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/opt/homebrew/sbin"},
        )
        return completed.returncode, completed.stdout, completed.stderr
    except (OSError, subprocess.SubprocessError) as exc:
        return 127, "", str(exc)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None


@dataclass
class MacHostCollector:
    runner: CommandRunner = _default_run
    command_timeout: float = 3.0

    def run(self, args: Sequence[str], timeout: float | None = None) -> tuple[int, str, str]:
        return self.runner(args, timeout or self.command_timeout)

    def output(self, args: Sequence[str], timeout: float | None = None) -> str | None:
        code, stdout, _ = self.run(args, timeout)
        return stdout.strip() if code == 0 and stdout.strip() else None

    def hostname(self) -> str:
        return self.output(["scutil", "--get", "ComputerName"]) or self.output(["hostname"]) or socket.gethostname() or "unknown"

    def os_info(self) -> dict[str, str | None]:
        version = self.output(["sw_vers", "-productVersion"])
        build = self.output(["sw_vers", "-buildVersion"])
        return {"name": "macOS", "version": version, "build": build}

    def model(self) -> str | None:
        return self.output(["sysctl", "-n", "hw.model"]) or self.output(["sysctl", "-n", "hw.product"])

    def cpu(self) -> dict[str, float | int | None]:
        cores = _integer(self.output(["sysctl", "-n", "hw.ncpu"]))
        if cores is None:
            cores = os.cpu_count()
        usage: float | None = None
        code, stdout, _ = self.run(["ps", "-A", "-o", "%cpu="], 5.0)
        if code == 0:
            values = [_number(line) for line in stdout.splitlines()]
            total = sum(value for value in values if value is not None)
            if cores and cores > 0:
                usage = round(max(0.0, min(100.0, total / cores)), 1)
        return {"usage": usage, "cores": cores}

    def load_average(self) -> list[float | None]:
        try:
            values = os.getloadavg()
            return [round(float(value), 2) for value in values[:3]]
        except (OSError, ValueError):
            return [None, None, None]

    def uptime(self) -> int | None:
        raw = self.output(["sysctl", "-n", "kern.boottime"])
        if raw:
            match = re.search(r"sec\s*=\s*(\d+)", raw)
            if match:
                return max(0, int(time.time()) - int(match.group(1)))
        return None

    def memory(self) -> dict[str, float | int | None]:
        total = _integer(self.output(["sysctl", "-n", "hw.memsize"]))
        page_size = 4096
        code, stdout, _ = self.run(["vm_stat"], 5.0)
        pages: dict[str, int] = {}
        if code == 0:
            first = re.search(r"page size of (\d+) bytes", stdout)
            if first:
                page_size = int(first.group(1))
            for line in stdout.splitlines():
                match = re.match(r"^([^:]+):\s*([0-9.]+)", line)
                if match:
                    pages[match.group(1).strip()] = int(float(match.group(2)))
        if total is None:
            return {"total": None, "used": None, "available": None, "percentage": None}
        available_pages = sum(pages.get(key, 0) for key in ("Pages free", "Pages inactive", "Pages speculative"))
        available = available_pages * page_size
        used = max(0, total - available)
        return {
            "total": total,
            "used": used,
            "available": available,
            "percentage": round(100.0 * used / total, 1) if total else None,
        }

    def disks(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for mount in ("/", "/Volumes/Avalon"):
            code, stdout, _ = self.run(["df", "-Pk", mount], 5.0)
            if code != 0:
                continue
            rows = [line.split() for line in stdout.splitlines()[1:] if line.split()]
            if not rows:
                continue
            row = rows[-1]
            if len(row) < 5:
                continue
            total_k, _reported_used_k, available_k = (_integer(row[1]), _integer(row[2]), _integer(row[3]))
            # APFS read-only root snapshots report only snapshot blocks in df's
            # Used column. The NAS formatter derives occupied capacity from
            # total - available; keep the same accounting here.
            used_k = total_k - available_k if total_k is not None and available_k is not None else None
            percentage = round(100.0 * used_k / total_k, 1) if total_k and used_k is not None else _number(row[4].rstrip("%"))
            result.append({
                "mount": mount,
                "total": total_k * 1024 if total_k is not None else None,
                "used": used_k * 1024 if used_k is not None else None,
                "available": available_k * 1024 if available_k is not None else None,
                "percentage": percentage,
            })
        return result

    def network(self) -> list[dict[str, Any]]:
        code, stdout, _ = self.run(["netstat", "-ib"], 5.0)
        if code != 0:
            return []
        result: dict[str, dict[str, Any]] = {}
        for line in stdout.splitlines():
            fields = line.split()
            if not fields or fields[0] in {"Name", "."} or fields[0].startswith("lo"):
                continue
            name = fields[0]
            # On macOS the Ibytes/Obytes columns are stable at positions
            # 6/9 for both link and IPv4/IPv6 rows; the final Coll column is
            # not a byte counter.
            if len(fields) < 10:
                continue
            bytes_in = _integer(fields[6])
            bytes_out = _integer(fields[9])
            if bytes_in is None or bytes_out is None:
                continue
            item = result.setdefault(name, {"interface": name, "bytesIn": 0, "bytesOut": 0})
            item["bytesIn"] = max(item["bytesIn"], bytes_in)
            item["bytesOut"] = max(item["bytesOut"], bytes_out)
        return list(result.values())

    def power(self) -> dict[str, Any]:
        code, stdout, _ = self.run(["pmset", "-g", "batt"], 5.0)
        if code != 0:
            return {"source": None, "percentage": None, "charging": None, "state": None}
        source_match = re.search(r"Now drawing from '([^']+)'", stdout)
        percent_match = re.search(r"(\d+)%", stdout)
        state = "充电中" if "charging" in stdout.lower() else "使用电池" if "battery power" in stdout.lower() else "接通电源"
        return {
            "source": source_match.group(1) if source_match else None,
            "percentage": _number(percent_match.group(1)) if percent_match else None,
            "charging": True if "charging" in stdout.lower() else False if percent_match else None,
            "state": state,
        }

    def cloudflared(self) -> dict[str, Any]:
        code, stdout, _ = self.run(["pgrep", "-x", "cloudflared"], 3.0)
        pid = None
        if code == 0:
            first = next((line.strip() for line in stdout.splitlines() if line.strip()), None)
            pid = _integer(first)
        version = None
        if pid is not None:
            version = self.output(["cloudflared", "--version"], 5.0)
        return {
            "status": "running" if pid is not None else "stopped",
            "running": pid is not None,
            "pid": pid,
            "version": version,
            "message": "cloudflared 进程运行中" if pid is not None else "未发现 cloudflared 进程",
        }

    def high_cpu_processes(self) -> list[dict[str, Any]]:
        code, stdout, _ = self.run(["ps", "-Ao", "pid=,pcpu=,pmem=,comm=,args=", "-r"], 5.0)
        if code != 0:
            return []
        result: list[dict[str, Any]] = []
        for line in stdout.splitlines()[:5]:
            fields = line.strip().split(None, 4)
            if len(fields) < 4:
                continue
            result.append({
                "pid": _integer(fields[0]),
                "cpu": _number(fields[1]),
                "memory": _number(fields[2]),
                "name": fields[3],
                "command": fields[4] if len(fields) > 4 else fields[3],
            })
        return result

    def host_status(self) -> dict[str, Any]:
        return {
            "status": "available",
            "hostname": self.hostname(),
            "os": self.os_info(),
            "model": self.model(),
            "cpu": self.cpu(),
            "loadAverage": self.load_average(),
            "uptime": self.uptime(),
            "memory": self.memory(),
            "disks": self.disks(),
            "network": self.network(),
            "power": self.power(),
            "cloudflared": self.cloudflared(),
            "highCpuProcesses": self.high_cpu_processes(),
        }


class MacHostAgentHandler(BaseHTTPRequestHandler):
    server_version = "HomeHubMacHostAgent/1.2"

    @property
    def agent_server(self) -> "MacHostAgentServer":
        return self.server  # type: ignore[return-value]

    def log_message(self, _format: str, *_args: Any) -> None:
        # Do not write request headers or paths containing caller-controlled data.
        return

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] not in ALLOWED_PATHS:
            self.send_json(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        path = self.path.split("?", 1)[0]
        collector = self.agent_server.collector
        if path == "/v1/health":
            body = {"status": "ok", "service": "mac-host-agent", "version": VERSION, "hostname": collector.hostname()}
        elif path == "/v1/cloudflared/status":
            body = collector.cloudflared()
        else:
            body = collector.host_status()
        self.send_json(200, body)

    def do_POST(self) -> None:  # noqa: N802
        self.send_json(405, {"error": "method_not_allowed"})

    def authorized(self) -> bool:
        expected = self.agent_server.token
        provided = self.headers.get("Authorization", "")
        if provided.lower().startswith("bearer "):
            provided = provided[7:].strip()
        else:
            provided = self.headers.get("X-MacHostAgent-Token", "").strip()
        return bool(expected) and hmac.compare_digest(provided, expected)

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)


class MacHostAgentServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], token: str, collector: MacHostCollector | None = None):
        super().__init__(address, MacHostAgentHandler)
        self.token = token
        self.collector = collector or MacHostCollector()


def load_token(token_file: str | None = None) -> str:
    direct = os.environ.get("MAC_HOST_AGENT_TOKEN", "").strip()
    if direct:
        return direct
    path = token_file or os.environ.get("MAC_HOST_AGENT_TOKEN_FILE", DEFAULT_TOKEN_FILE)
    try:
        return open(path, "r", encoding="utf-8").read().strip()
    except OSError:
        return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="HomeHub read-only macOS host agent")
    parser.add_argument("--host", default=os.environ.get("MAC_HOST_AGENT_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MAC_HOST_AGENT_PORT", str(DEFAULT_PORT))))
    parser.add_argument("--token-file", default=os.environ.get("MAC_HOST_AGENT_TOKEN_FILE", DEFAULT_TOKEN_FILE))
    args = parser.parse_args()
    token = load_token(args.token_file)
    if not token:
        raise SystemExit("MAC_HOST_AGENT_TOKEN or a non-empty token file is required")
    server = MacHostAgentServer((args.host, args.port), token)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
