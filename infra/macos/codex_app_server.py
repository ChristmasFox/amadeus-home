"""Narrow, authenticated bridge from CasaOS to the local Codex App Server.

This is intentionally not a generic host execution facility.  It accepts one
configured Git project, creates only detached worktrees below its configured
directory, and forwards only the App Server protocol methods Kurisu needs.
"""
from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

ALLOWED_METHODS = frozenset({"thread/start", "turn/start", "thread/resume", "turn/interrupt"})


class CodexBridgeError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Workspace:
    project_id: str
    root: str
    workspace_ref: str
    mode: str
    head: str


class CodexWorkspaceRegistry:
    def __init__(self, project_id: str, root: str, worktree_root: str):
        self.project_id = project_id
        self.root = Path(root).resolve()
        self.worktree_root = Path(worktree_root).resolve()

    def prepare(self, project_id: str) -> Workspace:
        self._check_id(project_id)
        self._verify_root()
        if self._git("status", "--porcelain", "--untracked-files=all").strip():
            raise CodexBridgeError("PROJECT_DIRTY", "configured Codex project has uncommitted changes")
        head = self._git("rev-parse", "HEAD").strip()
        self.worktree_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        workspace = self.worktree_root / f"{self.project_id}-{int(time.time() * 1000)}-{os.urandom(3).hex()}"
        self._git("worktree", "add", "--detach", str(workspace), head)
        return Workspace(self.project_id, str(self.root), str(workspace), "worktree", head)

    def restore(self, project_id: str, workspace_ref: str) -> Workspace:
        self._check_id(project_id)
        self._verify_root()
        workspace = Path(workspace_ref).resolve()
        try:
            workspace.relative_to(self.worktree_root)
        except ValueError as exc:
            raise CodexBridgeError("WORKSPACE_INVALID", "workspace is outside the executor-owned worktree root") from exc
        if not workspace.is_dir():
            raise CodexBridgeError("WORKSPACE_MISSING", "stored Codex workspace no longer exists")
        if self._git_at(workspace, "rev-parse", "--show-toplevel").strip() != str(workspace):
            raise CodexBridgeError("WORKSPACE_INVALID", "stored workspace is not a Git worktree")
        if self._common_dir(workspace) != self._common_dir(self.root):
            raise CodexBridgeError("WORKSPACE_INVALID", "stored workspace is not linked to the configured project")
        return Workspace(self.project_id, str(self.root), str(workspace), "worktree", self._git_at(workspace, "rev-parse", "HEAD").strip())

    def _check_id(self, project_id: str) -> None:
        if project_id != self.project_id:
            raise CodexBridgeError("PROJECT_NOT_CONFIGURED", "Codex project is not registered by the macOS host")

    def _verify_root(self) -> None:
        if not self.root.is_dir() or self._git("rev-parse", "--show-toplevel").strip() != str(self.root):
            raise CodexBridgeError("PROJECT_NOT_GIT", "configured Codex project is not the expected Git root")

    def _git(self, *args: str) -> str:
        return self._git_at(self.root, *args)

    @staticmethod
    def _git_at(cwd: Path, *args: str) -> str:
        try:
            result = subprocess.run(["/usr/bin/git", "-C", str(cwd), *args], check=True, capture_output=True, text=True, timeout=15)
            return result.stdout
        except (OSError, subprocess.SubprocessError) as exc:
            raise CodexBridgeError("GIT_CHECK_FAILED", "configured Git workspace could not be verified") from exc

    def _common_dir(self, cwd: Path) -> Path:
        value = self._git_at(cwd, "rev-parse", "--git-common-dir").strip()
        return (cwd / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()


class CodexAppServerBridge:
    """Single local App Server process with bounded RPC and event polling."""
    def __init__(self, command: str, registry: CodexWorkspaceRegistry, home: str):
        self.command = command
        self.registry = registry
        self.home = home
        self.process: subprocess.Popen[str] | None = None
        self.next_id = 1
        self.pending: dict[str, queue.Queue[dict[str, Any]]] = {}
        self.events: list[dict[str, Any]] = []
        self.workspaces: set[str] = set()
        self.cursor = 0
        self.lock = threading.RLock()
        self.event_ready = threading.Condition(self.lock)

    def health(self) -> dict[str, Any]:
        return {"status": "ok", "enabled": True, "connected": self.process is not None and self.process.poll() is None}

    def prepare(self, project_id: str) -> dict[str, Any]:
        value = self.registry.prepare(project_id)
        self.workspaces.add(value.workspace_ref)
        return value.__dict__

    def restore(self, project_id: str, workspace_ref: str) -> dict[str, Any]:
        value = self.registry.restore(project_id, workspace_ref)
        self.workspaces.add(value.workspace_ref)
        return value.__dict__

    def request(self, method: str, params: dict[str, Any]) -> Any:
        if method not in ALLOWED_METHODS:
            raise CodexBridgeError("METHOD_NOT_ALLOWED", "Codex App Server method is not allowed")
        self._validate_workspace(params)
        return self._request(method, params)

    def respond(self, rpc_id: str | int, result: Any) -> None:
        with self.lock:
            self._write({"jsonrpc": "2.0", "id": rpc_id, "result": result})

    def poll(self, cursor: int, timeout_ms: int = 25_000) -> dict[str, Any]:
        deadline = time.monotonic() + max(0, min(timeout_ms, 25_000)) / 1000
        with self.event_ready:
            while cursor >= self.cursor and time.monotonic() < deadline:
                self.event_ready.wait(timeout=max(0, deadline - time.monotonic()))
            return {"cursor": self.cursor, "events": [event for event in self.events if int(event["cursor"]) > cursor]}

    def close(self) -> None:
        with self.lock:
            if self.process and self.process.poll() is None:
                self.process.terminate()
            self.process = None

    def _validate_workspace(self, params: dict[str, Any]) -> None:
        cwd = str(params.get("cwd") or "")
        if not cwd or str(Path(cwd).resolve()) not in self.workspaces:
            raise CodexBridgeError("WORKSPACE_INVALID", "App Server cwd is not a prepared executor workspace")
        try:
            Path(cwd).resolve().relative_to(self.registry.worktree_root)
        except ValueError as exc:
            raise CodexBridgeError("WORKSPACE_INVALID", "App Server cwd is outside the executor-owned worktree root") from exc

    def _start(self) -> None:
        if self.process and self.process.poll() is None:
            return
        if not Path(self.command).is_file():
            raise CodexBridgeError("CODEX_UNAVAILABLE", "configured Codex CLI is unavailable")
        env = {"HOME": self.home, "PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"}
        self.process = subprocess.Popen([self.command, "app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1, env=env)
        threading.Thread(target=self._read_loop, daemon=True).start()
        result = self._request("initialize", {"clientInfo": {"name": "kurisu-macos-bridge", "version": "0.1.0"}}, internal=True)
        if not isinstance(result, dict):
            raise CodexBridgeError("CODEX_INITIALIZE_FAILED", "Codex App Server returned an invalid initialize response")
        self._write({"jsonrpc": "2.0", "method": "initialized", "params": {}})

    def _request(self, method: str, params: dict[str, Any], internal: bool = False) -> Any:
        with self.lock:
            if not internal:
                self._start()
            elif not self.process:
                raise CodexBridgeError("CODEX_UNAVAILABLE", "Codex App Server did not start")
            rpc_id = self.next_id
            self.next_id += 1
            result: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1)
            self.pending[str(rpc_id)] = result
            self._write({"jsonrpc": "2.0", "id": rpc_id, "method": method, "params": params})
        try:
            response = result.get(timeout=120)
        except queue.Empty as exc:
            raise CodexBridgeError("CODEX_TIMEOUT", "Codex App Server request timed out") from exc
        if "error" in response:
            raise CodexBridgeError("CODEX_RPC_FAILED", str(response["error"].get("message") or "Codex App Server request failed")[:500])
        return response.get("result")

    def _write(self, message: dict[str, Any]) -> None:
        if not self.process or not self.process.stdin:
            raise CodexBridgeError("CODEX_UNAVAILABLE", "Codex App Server is not connected")
        self.process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def _read_loop(self) -> None:
        process = self.process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(message, dict):
                continue
            rpc_id = message.get("id")
            with self.event_ready:
                pending = self.pending.pop(str(rpc_id), None) if rpc_id is not None and "method" not in message else None
                if pending is not None:
                    pending.put(message)
                    continue
                self.cursor += 1
                self.events.append({"cursor": self.cursor, "message": message})
                self.events = self.events[-256:]
                self.event_ready.notify_all()
        with self.event_ready:
            self.cursor += 1
            self.events.append({"cursor": self.cursor, "message": {"kind": "process_exit"}})
            self.events = self.events[-256:]
            self.event_ready.notify_all()
