#!/usr/bin/env python3
"""LAN-only web interface for the local Qwen image bridge."""
from __future__ import annotations

import argparse
import base64
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as default_email_policy
import ipaddress
import json
import os
from pathlib import Path
import socket
import stat
import threading
import time
import uuid
from urllib.parse import urlsplit

MODEL_ID = "local/qwen-image-2.1-uncensored"
MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024
MAX_RESPONSE_BYTES = 30 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000
GENERATION_DEADLINE_SECONDS = 610
ALLOWED_SIZES = {"768x768", "1024x768", "768x1024", "896x640", "640x896"}
TASK_HISTORY_LIMIT = 30
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SAVED_IMAGE_BYTES = 20 * 1024 * 1024


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_private_secret(path: Path) -> str:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ValueError("secret_file_not_private")
    value = path.read_text(encoding="utf-8").strip()
    if len(value) < 32 or len(value) > 4096 or "\r" in value or "\n" in value:
        raise ValueError("secret_invalid")
    return value


def is_lan_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_loopback or address.is_private or address.is_link_local


def host_is_lan(value: str) -> bool:
    try:
        hostname = urlsplit(f"//{value}").hostname
    except ValueError:
        return False
    return bool(hostname and is_lan_ip(hostname))


def validate_generation_payload(payload: object) -> bytes:
    if not isinstance(payload, dict) or set(payload) - {"prompt", "size"}:
        raise ValueError("generation_request_invalid")
    prompt = payload.get("prompt")
    size = payload.get("size")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError("generation_prompt_invalid")
    if not isinstance(size, str) or size not in ALLOWED_SIZES:
        raise ValueError("generation_size_unsupported")
    width, height = (int(part) for part in size.split("x", 1))
    if width * height > 786_432 or max(width, height) > 1_024:
        raise ValueError("generation_size_unsupported")
    return json_bytes({
        "model": MODEL_ID,
        "prompt": prompt.strip(),
        "n": 1,
        "size": size,
        "output_format": "png",
    })

def extract_edit_task_details(body: bytes, content_type: str) -> tuple[str, str | None]:
    headers = (
        b"MIME-Version: 1.0\r\nContent-Type: "
        + content_type.encode("latin-1", "replace")
        + b"\r\n\r\n"
    )
    try:
        message = BytesParser(policy=default_email_policy).parsebytes(headers + body)
        prompt = ""
        filename = None
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            field_name = part.get_param("name", header="content-disposition")
            if field_name == "prompt":
                value = part.get_content()
                prompt = value.strip()[:MAX_PROMPT_CHARS] if isinstance(value, str) else ""
            elif field_name == "image[]":
                candidate = part.get_filename()
                filename = candidate[:160] if isinstance(candidate, str) else None
        return prompt, filename
    except (LookupError, ValueError, TypeError):
        return "", None

def failure_summary(status: int, body: bytes) -> dict[str, str]:
    error_type = "request_failed"
    try:
        payload = json.loads(body)
        error = payload.get("error") if isinstance(payload, dict) else None
        candidate = error.get("type") if isinstance(error, dict) else None
        if isinstance(candidate, str) and candidate and len(candidate) <= 80:
            error_type = candidate
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    messages = {
        "qwen_timeout": "本地模型处理超时",
        "qwen_runtime_unavailable": "本地模型服务暂不可用",
        "qwen_output_invalid": "模型返回的图片数据无效",
        "qwen_busy": "模型正忙，请稍后重试",
        "qwen_edit_request_invalid": "编辑请求或参考图无效",
        "qwen_request_invalid": "生图请求参数无效",
        "qwen_prompt_invalid": "提示词无效",
        "qwen_size_unsupported": "输出尺寸不受支持",
        "qwen_generation_size_policy": "输出尺寸超出模型限制",
        "qwen_output_format_unsupported": "输出格式不受支持",
        "qwen_edit_body_too_large": "参考图请求超过大小限制",
        "qwen_request_too_large": "请求超过大小限制",
        "qwen_ui_timeout": "等待本地模型响应超时",
        "qwen_bridge_unavailable": "本地模型桥接暂不可用",
    }
    return {"type": error_type, "message": messages.get(error_type, f"请求失败（HTTP {status}）")}


def parse_bridge_url(value: str) -> tuple[str, int]:
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("bridge_url_must_be_loopback_http")
    if parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("bridge_url_must_be_loopback_http")
    return parsed.hostname, parsed.port or 80


class DebugHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        bridge_url: str,
        bridge_token: str,
        static_file: Path,
        output_dir: Path,
    ):
        super().__init__(server_address, DebugHandler)
        self.bridge_host, self.bridge_port = parse_bridge_url(bridge_url)
        self.bridge_token = bridge_token
        self.static_file = static_file
        self.output_dir = output_dir
        self.generation_lock = threading.Lock()
        self.task_lock = threading.Lock()
        self.active_task: dict | None = None
        self.task_history: list[dict] = []

    @staticmethod
    def _task_view(task: dict, now: float) -> dict:
        started = task["_started_monotonic"]
        ended = task.get("_finished_monotonic", now)
        return {
            "id": task["id"],
            "kind": task["kind"],
            "prompt": task["prompt"],
            "details": task["details"],
            "status": task["status"],
            "startedAt": task["startedAt"],
            "finishedAt": task.get("finishedAt"),
            "durationMs": max(0, round((ended - started) * 1000)),
            "error": task.get("error"),
            "savedPath": task.get("savedPath"),
            "saveError": task.get("saveError"),
        }

    def begin_task(self, kind: str, prompt: str, details: str) -> str:
        now = time.monotonic()
        task = {
            "id": uuid.uuid4().hex[:12],
            "kind": kind,
            "prompt": prompt[:MAX_PROMPT_CHARS],
            "details": details[:160],
            "status": "running",
            "startedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "_started_monotonic": now,
        }
        with self.task_lock:
            self.active_task = task
            self.task_history.insert(0, task)
            del self.task_history[TASK_HISTORY_LIMIT:]
        return task["id"]

    def finish_task(
        self,
        task_id: str,
        status: str,
        error: dict[str, str] | None = None,
        saved_path: str | None = None,
        save_error: str | None = None,
    ) -> None:
        with self.task_lock:
            for task in self.task_history:
                if task["id"] != task_id or task["status"] != "running":
                    continue
                task["status"] = status
                task["finishedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
                task["_finished_monotonic"] = time.monotonic()
                task["error"] = error
                task["savedPath"] = saved_path
                task["saveError"] = save_error
                if self.active_task is task:
                    self.active_task = None
                return

    def save_image_result(self, task_id: str, response_body: bytes) -> tuple[str | None, str | None]:
        try:
            payload = json.loads(response_body)
            encoded = payload["data"][0]["b64_json"]
            if not isinstance(encoded, str):
                raise ValueError("image_data_invalid")
            image = base64.b64decode(encoded, validate=True)
            if not image.startswith(PNG_SIGNATURE) or len(image) > MAX_SAVED_IMAGE_BYTES:
                raise ValueError("image_data_invalid")
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
            return None, "模型图片数据无效，未能自动保存"

        try:
            self.output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            metadata = self.output_dir.lstat()
            if not stat.S_ISDIR(metadata.st_mode):
                raise OSError("output_path_not_directory")
            os.chmod(self.output_dir, 0o700)
            directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
            directory_fd = os.open(self.output_dir, directory_flags)
            try:
                filename = f"qwen-image-{datetime.now().astimezone().strftime('%Y%m%d-%H%M%S')}-{task_id}.png"
                file_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
                file_fd = os.open(filename, file_flags, 0o600, dir_fd=directory_fd)
                try:
                    with os.fdopen(file_fd, "wb") as image_file:
                        image_file.write(image)
                        image_file.flush()
                        os.fsync(image_file.fileno())
                except BaseException:
                    try:
                        os.unlink(filename, dir_fd=directory_fd)
                    except OSError:
                        pass
                    raise
            finally:
                os.close(directory_fd)
            return str(self.output_dir / filename), None
        except OSError:
            return None, "自动保存失败，请检查图片目录权限或磁盘空间"

    @staticmethod
    def attach_save_result(response_body: bytes, saved_path: str | None, save_error: str | None) -> bytes:
        try:
            payload = json.loads(response_body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return response_body
        if not isinstance(payload, dict):
            return response_body
        payload["debug_ui"] = {"saved_path": saved_path, "save_error": save_error}
        return json_bytes(payload)

    def task_snapshot(self) -> dict:
        now = time.monotonic()
        with self.task_lock:
            active = self._task_view(self.active_task, now) if self.active_task else None
            history = [self._task_view(task, now) for task in self.task_history]
        return {"active": active, "history": history}


class DebugHandler(BaseHTTPRequestHandler):
    server: DebugHTTPServer
    server_version = "AmadeusQwenDebug/1.0"
    sys_version = ""

    def log_message(self, format: str, *args) -> None:
        return

    def send_bytes(self, status: int, body: bytes, content_type: str, extra_headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'",
        )
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def send_json(self, status: int, value: object, extra_headers: dict[str, str] | None = None) -> None:
        self.send_bytes(status, json_bytes(value), "application/json; charset=utf-8", extra_headers)

    def send_error_json(self, status: int, error_type: str, message: str | None = None) -> None:
        self.send_json(status, {"error": {"type": error_type, "message": message or error_type}})

    def _network_allowed(self) -> bool:
        return is_lan_ip(self.client_address[0]) and host_is_lan(self.headers.get("Host", ""))

    def _same_origin(self) -> bool:
        origin = self.headers.get("Origin", "")
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return False
        host = self.headers.get("Host", "")
        return parsed.scheme == "http" and parsed.netloc.lower() == host.lower() and host_is_lan(host)

    def _body(self, limit: int = MAX_REQUEST_BYTES) -> bytes | None:
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdigit():
            self.send_error_json(HTTPStatus.LENGTH_REQUIRED, "content_length_required")
            return None
        length = int(raw_length)
        if length < 1 or length > limit:
            self.send_error_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request_too_large")
            return None
        body = self.rfile.read(length)
        if len(body) != length:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "request_truncated")
            return None
        return body

    def _proxy(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        content_type: str | None = None,
        task_id: str | None = None,
    ) -> None:
        connection = http.client.HTTPConnection(
            self.server.bridge_host,
            self.server.bridge_port,
            timeout=GENERATION_DEADLINE_SECONDS,
        )
        headers = {"Authorization": f"Bearer {self.server.bridge_token}", "Connection": "close"}
        if content_type:
            headers["Content-Type"] = content_type
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read(MAX_RESPONSE_BYTES + 1)
            if len(data) > MAX_RESPONSE_BYTES:
                if task_id:
                    self.server.finish_task(task_id, "failed", {"type": "bridge_response_too_large", "message": "模型响应超过大小限制"})
                self.send_error_json(HTTPStatus.BAD_GATEWAY, "bridge_response_too_large")
                return
            if task_id:
                if 200 <= response.status < 300:
                    saved_path, save_error = self.server.save_image_result(task_id, data)
                    self.server.finish_task(task_id, "succeeded", saved_path=saved_path, save_error=save_error)
                    data = self.server.attach_save_result(data, saved_path, save_error)
                else:
                    self.server.finish_task(task_id, "failed", failure_summary(response.status, data))
            self.send_bytes(response.status, data, response.getheader("Content-Type", "application/json"))
        except (TimeoutError, socket.timeout):
            if task_id:
                self.server.finish_task(task_id, "failed", {"type": "qwen_ui_timeout", "message": "等待本地模型响应超时"})
            self.send_error_json(HTTPStatus.GATEWAY_TIMEOUT, "qwen_ui_timeout", "本地模型调用超时，请检查模型服务日志后重试。")
        except (OSError, http.client.HTTPException):
            if task_id:
                self.server.finish_task(task_id, "failed", {"type": "qwen_bridge_unavailable", "message": "本地模型桥接暂不可用"})
            self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "qwen_bridge_unavailable", "本地模型桥接暂不可用。")
        finally:
            connection.close()

    def do_GET(self) -> None:
        if not self._network_allowed():
            self.send_error_json(HTTPStatus.FORBIDDEN, "lan_access_required")
            return
        if self.path in {"/", "/index.html"}:
            try:
                page = self.server.static_file.read_bytes()
            except OSError:
                self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "debug_page_unavailable")
                return
            self.send_bytes(HTTPStatus.OK, page, "text/html; charset=utf-8")
            return
        if self.path in {"/api/health", "/api/models"}:
            path = "/health" if self.path == "/api/health" else "/v1/models"
            self._proxy("GET", path)
            return
        if self.path == "/api/tasks":
            self.send_json(HTTPStatus.OK, self.server.task_snapshot())
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "not_found")

    def do_POST(self) -> None:
        if not self._network_allowed():
            self.send_error_json(HTTPStatus.FORBIDDEN, "lan_access_required")
            return
        if not self._same_origin():
            self.send_error_json(HTTPStatus.FORBIDDEN, "same_origin_required")
            return
        if self.path not in {"/api/generations", "/api/edits"}:
            self.send_error_json(HTTPStatus.NOT_FOUND, "not_found")
            return
        if not self.server.generation_lock.acquire(blocking=False):
            self.send_error_json(HTTPStatus.CONFLICT, "qwen_ui_generation_busy", "已有本地生图任务运行，请等待完成。")
            return
        task_id: str | None = None
        try:
            if self.path == "/api/generations":
                if self.headers.get_content_type() != "application/json":
                    self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "json_required")
                    return
                body = self._body()
                if body is None:
                    return
                try:
                    proxied_body = validate_generation_payload(json.loads(body))
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "generation_json_invalid")
                    return
                except ValueError as error:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
                    return
                task_id = self.server.begin_task("generation", json.loads(body)["prompt"].strip(), json.loads(body)["size"])
                self._proxy("POST", "/v1/images/generations", proxied_body, "application/json", task_id)
                return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;"):
                self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "multipart_required")
                return
            body = self._body()
            if body is None:
                return
            prompt, filename = extract_edit_task_details(body, content_type)
            task_id = self.server.begin_task("edit", prompt, filename or "参考图编辑")
            self._proxy("POST", "/v1/images/edits", body, content_type, task_id)
        finally:
            if task_id:
                self.server.finish_task(task_id, "failed", {"type": "request_interrupted", "message": "本地请求中断"})
            self.server.generation_lock.release()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=18798)
    parser.add_argument("--bridge-url", default="http://127.0.0.1:18793")
    parser.add_argument("--bridge-token-file", required=True)
    parser.add_argument("--static-file", required=True)
    parser.add_argument("--output-dir", default="~/Pictures/Amadeus/QwenImage")
    args = parser.parse_args()
    bridge_token = read_private_secret(Path(args.bridge_token_file))
    static_file = Path(args.static_file)
    if not static_file.is_file() or not 1 <= args.port <= 65535:
        raise SystemExit("debug_ui_config_invalid")
    output_dir = Path(args.output_dir).expanduser()
    server = DebugHTTPServer((args.host, args.port), args.bridge_url, bridge_token, static_file, output_dir)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
