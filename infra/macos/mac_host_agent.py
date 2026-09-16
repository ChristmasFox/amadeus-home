#!/usr/bin/env python3
"""Authenticated macOS host telemetry plus an optional narrowed Codex bridge.

The HTTP surface is deliberately limited to /v1/health, /v1/host/status and
/v1/cloudflared/status. There is no generic command, shell or exec endpoint.
All telemetry commands are fixed, local observations. The optional Codex
bridge has its own fixed project/method allowlists and is disabled by default.
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

try:  # package import for tests, direct sibling import for launchd execution
    from infra.macos.codex_app_server import CodexAppServerBridge, CodexBridgeError, CodexWorkspaceRegistry
except ModuleNotFoundError:  # pragma: no cover - launchd executes this file directly
    from codex_app_server import CodexAppServerBridge, CodexBridgeError, CodexWorkspaceRegistry

VERSION = "1.2.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 49152
DEFAULT_TOKEN_FILE = "/Users/Shared/HomeHub/mac-host-agent.token"
ALLOWED_PATHS = frozenset({"/v1/health", "/v1/host/status", "/v1/cloudflared/status", "/v1/codex/health", "/v1/codex/events"})
CODEX_POST_PATHS = frozenset({"/v1/codex/workspace/prepare", "/v1/codex/workspace/restore", "/v1/codex/rpc", "/v1/codex/respond"})

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
        elif path == "/v1/codex/health":
            if not self.agent_server.codex:
                self.send_json(503, {"error": "codex_disabled"})
                return
            body = self.agent_server.codex.health()
        elif path == "/v1/codex/events":
            if not self.agent_server.codex:
                self.send_json(503, {"error": "codex_disabled"})
                return
            try:
                cursor = max(0, int(self.query_value("cursor") or "0"))
                timeout_ms = max(0, min(25000, int(self.query_value("timeoutMs") or "0")))
            except ValueError:
                self.send_json(400, {"error": "invalid_request"})
                return
            body = self.agent_server.codex.poll(cursor, timeout_ms)
        else:
            body = collector.host_status()
        self.send_json(200, body)

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path not in CODEX_POST_PATHS:
            self.send_json(404, {"error": "not_found"})
            return
        if not self.authorized():
            self.send_json(401, {"error": "unauthorized"})
            return
        if not self.agent_server.codex:
            self.send_json(503, {"error": "codex_disabled"})
            return
        body = self.read_json()
        if body is None:
            self.send_json(400, {"error": "invalid_request"})
            return
        try:
            if path == "/v1/codex/workspace/prepare":
                result = self.agent_server.codex.prepare(str(body.get("projectId") or ""))
            elif path == "/v1/codex/workspace/restore":
                result = self.agent_server.codex.restore(str(body.get("projectId") or ""), str(body.get("workspaceRef") or ""))
            elif path == "/v1/codex/rpc":
                params = body.get("params")
                if not isinstance(params, dict):
                    self.send_json(400, {"error": "invalid_request"})
                    return
                result = {"result": self.agent_server.codex.request(str(body.get("method") or ""), params)}
            else:
                self.agent_server.codex.respond(body.get("id"), body.get("result"))
                result = {"accepted": True}
        except CodexBridgeError as exc:
            self.send_json(409 if exc.code.startswith("PROJECT_") or exc.code.startswith("WORKSPACE_") else 502, {"error": exc.code, "message": str(exc)})
            return
        self.send_json(200, result)

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

    def read_json(self) -> dict[str, Any] | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 256 * 1024:
                return None
            value = json.loads(self.rfile.read(length))
            return value if isinstance(value, dict) else None
        except (ValueError, json.JSONDecodeError):
            return None

    def query_value(self, key: str) -> str | None:
        from urllib.parse import parse_qs, urlsplit
        return (parse_qs(urlsplit(self.path).query).get(key) or [None])[0]


class MacHostAgentServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], token: str, collector: MacHostCollector | None = None, codex: CodexAppServerBridge | None = None):
        super().__init__(address, MacHostAgentHandler)
        self.token = token
        self.collector = collector or MacHostCollector()
        self.codex = codex


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
    parser.add_argument("--codex-project-id", default=os.environ.get("KURISU_CODEX_PROJECT_ID", ""))
    parser.add_argument("--codex-project-root", default=os.environ.get("KURISU_CODEX_PROJECT_ROOT", ""))
    parser.add_argument("--codex-worktree-root", default=os.environ.get("KURISU_CODEX_WORKTREE_ROOT", ""))
    parser.add_argument("--codex-command", default=os.environ.get("KURISU_CODEX_COMMAND", ""))
    args = parser.parse_args()
    token = load_token(args.token_file)
    if not token:
        raise SystemExit("MAC_HOST_AGENT_TOKEN or a non-empty token file is required")
    codex = None
    configured = [args.codex_project_id, args.codex_project_root, args.codex_worktree_root, args.codex_command]
    if any(configured):
        if not all(configured):
            raise SystemExit("Codex bridge requires project id, root, worktree root, and command")
        codex = CodexAppServerBridge(args.codex_command, CodexWorkspaceRegistry(args.codex_project_id, args.codex_project_root, args.codex_worktree_root), os.path.expanduser("~"))
    server = MacHostAgentServer((args.host, args.port), token, codex=codex)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if codex:
            codex.close()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
