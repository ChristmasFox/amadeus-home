#!/usr/bin/env python3
"""LAN-only web interface for the local Qwen image bridge."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
from http.cookies import SimpleCookie
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as default_email_policy
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import threading
import time
import uuid
from urllib.parse import urlsplit

MODEL_ID = "local/qwen-image-2.1-uncensored"
MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024
MAX_LOGIN_BYTES = 8 * 1024
MAX_RESPONSE_BYTES = 30 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000
GENERATION_DEADLINE_SECONDS = 910
ALLOWED_PROFILES = {"quality", "fast"}
ALLOWED_RESOLUTIONS = {"1024x1024", "1024x768", "768x1024"}
PUBLIC_HOST = "image.nyannyan.top"
PUBLIC_ORIGIN = "https://image.nyannyan.top"
SESSION_COOKIE = "amadeus_image_lab_session"
SESSION_SECONDS = 12 * 60 * 60
LOGIN_WINDOW_SECONDS = 60
LOGIN_MAX_ATTEMPTS = 5
TASK_HISTORY_LIMIT = 30
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_SAVED_IMAGE_BYTES = 20 * 1024 * 1024
MAX_BROWSER_SAFE_INTEGER = (1 << 53) - 1
LOGIN_PAGE = '''<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Amadeus Image Lab 登录</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121311;color:#eee9df;font:16px system-ui,-apple-system,sans-serif}
.card{width:min(380px,calc(100% - 40px));padding:30px;border:1px solid #343631;border-radius:18px;background:#1a1c19;box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{color:#92958d;font-size:13px;line-height:1.6}
input,button{box-sizing:border-box;width:100%;border-radius:10px;padding:12px;font:inherit}
input{margin:16px 0;background:#121411;color:#f0eee8;border:1px solid #3b3e37}
button{border:0;background:#b9e79c;color:#182014;font-weight:700;cursor:pointer}
#error{min-height:20px;color:#ee998d;font-size:12px}
</style>
<main class="card"><h1>Amadeus Image Lab</h1><p>输入访问密码以打开本地图像实验室。</p>
<form id="login"><label for="password">访问密码</label><input id="password" type="password" autocomplete="current-password" required autofocus><button>登录</button></form>
<div id="error" role="status"></div></main>
<script>
document.getElementById("login").addEventListener("submit",async e=>{
  e.preventDefault();const error=document.getElementById("error");error.textContent="";
  try{
    const response=await fetch("/api/login",{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("password").value})});
    if(response.status===401){error.textContent="密码不正确，请检查后重试。";return}
    if(response.status===429){error.textContent="尝试次数过多，请稍后再试。";return}
    if(!response.ok){error.textContent=`登录服务返回 HTTP ${response.status}，请稍后重试。`;return}
    location.replace("/");
  }catch{error.textContent="无法连接登录服务，请检查网络后重试。"}
});
</script>
</html>'''.encode("utf-8")


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def browser_seed(value: int | None) -> int | str | None:
    if type(value) is int and abs(value) > MAX_BROWSER_SAFE_INTEGER:
        return str(value)
    return value


def response_image_resolution(response_body: bytes) -> str | None:
    try:
        payload = json.loads(response_body)
        encoded = payload["data"][0]["b64_json"]
        if not isinstance(encoded, str):
            return None
        image = base64.b64decode(encoded, validate=True)
        if len(image) < 24 or image[:8] != PNG_SIGNATURE or image[12:16] != b"IHDR":
            return None
        width = int.from_bytes(image[16:20], "big")
        height = int.from_bytes(image[20:24], "big")
        return f"{width}x{height}" if width > 0 and height > 0 else None
    except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        return None


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
    if not isinstance(payload, dict) or set(payload) != {"prompt", "profile", "resolution", "seed"}:
        raise ValueError("generation_request_invalid")
    prompt = payload.get("prompt")
    profile = payload.get("profile")
    resolution = payload.get("resolution")
    seed = payload.get("seed")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
        raise ValueError("generation_prompt_invalid")
    if "<sd_cpp_extra_args>" in prompt or "</sd_cpp_extra_args>" in prompt:
        raise ValueError("generation_prompt_invalid")
    if profile not in ALLOWED_PROFILES:
        raise ValueError("generation_profile_unsupported")
    if not isinstance(resolution, str) or resolution not in ALLOWED_RESOLUTIONS:
        raise ValueError("generation_resolution_unsupported")
    if isinstance(seed, str):
        if len(seed) > 20 or not re.fullmatch(r"-?[0-9]+", seed):
            raise ValueError("generation_seed_invalid")
        seed = int(seed)
    if type(seed) is not int or seed < -1 or seed > (1 << 63) - 1:
        raise ValueError("generation_seed_invalid")
    return json_bytes({
        "model": MODEL_ID,
        "prompt": prompt.strip(),
        "n": 1,
        "profile": profile,
        "resolution": resolution,
        "seed": seed,
    })

def extract_edit_task_details(body: bytes, content_type: str) -> dict:
    headers = (
        b"MIME-Version: 1.0\r\nContent-Type: "
        + content_type.encode("latin-1", "replace")
        + b"\r\n\r\n"
    )
    try:
        message = BytesParser(policy=default_email_policy).parsebytes(headers + body)
        fields: dict[str, list[str]] = {}
        filename = None
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            field_name = part.get_param("name", header="content-disposition")
            if part.get_filename() is not None and field_name == "image[]":
                candidate = part.get_filename()
                filename = candidate[:160] if isinstance(candidate, str) else None
            elif field_name in {"prompt", "profile", "resolution", "seed"}:
                value = part.get_content()
                if isinstance(value, str):
                    fields.setdefault(field_name, []).append(value.strip())
        prompt = fields.get("prompt", [""])[0][:MAX_PROMPT_CHARS]
        try:
            seed = int(fields.get("seed", ["-1"])[0])
        except ValueError:
            seed = -1
        return {
            "prompt": prompt,
            "filename": filename,
            "profile": fields.get("profile", ["quality"])[0],
            "resolution": fields.get("resolution", ["1024x1024"])[0],
            "seed": seed,
        }
    except (LookupError, ValueError, TypeError):
        return {"prompt": "", "filename": None, "profile": "quality", "resolution": "1024x1024", "seed": -1}


def load_password_verifier(path: Path) -> dict:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ValueError("public_auth_file_not_private")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("public_auth_verifier_invalid")
        if data.get("format") != "amadeus-qwen-image-lab-scrypt-v1":
            raise ValueError("public_auth_format_invalid")
        salt = base64.b64decode(data["salt"], validate=True)
        digest = base64.b64decode(data["digest"], validate=True)
        params = data["scrypt"]
        if (len(salt) < 16 or len(salt) > 64 or len(digest) != 64 or
                params != {"n": 32768, "r": 8, "p": 1, "dklen": 64}):
            raise ValueError("public_auth_verifier_invalid")
        return {"salt": salt, "digest": digest, "n": params["n"], "r": params["r"], "p": params["p"], "dklen": params["dklen"]}
    except (OSError, KeyError, TypeError, json.JSONDecodeError, ValueError) as error:
        if isinstance(error, ValueError) and str(error).startswith("public_auth_"):
            raise
        raise ValueError("public_auth_verifier_invalid") from error

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


class PublicAuth:
    def __init__(self, verifier: dict):
        self.verifier = verifier
        self.lock = threading.Lock()
        self.sessions: dict[str, float] = {}
        self.attempts: dict[str, list[float]] = {}

    def _begin_login(self, remote: str) -> tuple[bool, int]:
        now = time.monotonic()
        with self.lock:
            recent = [stamp for stamp in self.attempts.get(remote, []) if now - stamp < LOGIN_WINDOW_SECONDS]
            self.attempts[remote] = recent
            if len(recent) >= LOGIN_MAX_ATTEMPTS:
                retry = max(1, int(LOGIN_WINDOW_SECONDS - (now - recent[0])))
                return False, retry
            delay_slot = len(recent) + 1
            recent.append(now)
            return True, delay_slot

    def login(self, remote: str, password: object) -> tuple[str | None, int | None]:
        allowed, value = self._begin_login(remote)
        if not allowed:
            return None, value
        valid = False
        if isinstance(password, str) and 1 <= len(password) <= 4096:
            candidate = hashlib.scrypt(
                password.encode("utf-8"),
                salt=self.verifier["salt"],
                n=self.verifier["n"],
                r=self.verifier["r"],
                p=self.verifier["p"],
                dklen=self.verifier["dklen"],
                maxmem=128 * 1024 * 1024,
            )
            valid = hmac.compare_digest(candidate, self.verifier["digest"])
        if not valid:
            time.sleep(min(value * 0.25, 1.5))
            return None, None
        token = secrets.token_urlsafe(32)
        with self.lock:
            self.sessions[token] = time.time() + SESSION_SECONDS
            self.attempts.pop(remote, None)
        return token, None

    def valid_session(self, token: str | None) -> bool:
        if not token:
            return False
        now = time.time()
        with self.lock:
            expires = self.sessions.get(token)
            if expires is None:
                return False
            if expires <= now:
                self.sessions.pop(token, None)
                return False
            return True

    def logout(self, token: str | None) -> None:
        if token:
            with self.lock:
                self.sessions.pop(token, None)


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
        auth_file: Path,
    ):
        super().__init__(server_address, DebugHandler)
        self.bridge_host, self.bridge_port = parse_bridge_url(bridge_url)
        self.bridge_token = bridge_token
        self.static_file = static_file
        self.output_dir = output_dir
        self.public_auth = PublicAuth(load_password_verifier(auth_file))
        self.generation_lock = threading.Lock()
        self.task_lock = threading.Lock()
        self.active_task: dict | None = None
        self.task_history: list[dict] = []

    @staticmethod
    def _task_view(task: dict, now: float, public: bool = False) -> dict:
        started = task["_started_monotonic"]
        ended = task.get("_finished_monotonic", now)
        return {
            "id": task["id"],
            "kind": task["kind"],
            "prompt": task["prompt"],
            "details": task["details"],
            "profile": task["profile"],
            "resolution": task["resolution"],
            "seed": browser_seed(task["seed"]),
            "effectiveSeed": browser_seed(task.get("effectiveSeed")),
            "status": task["status"],
            "startedAt": task["startedAt"],
            "finishedAt": task.get("finishedAt"),
            "durationMs": max(0, round((ended - started) * 1000)),
            "error": task.get("error"),
            "savedPath": None if public else task.get("savedPath"),
            "hasImage": bool(task.get("savedPath")) and task["status"] == "succeeded",
            "saveError": task.get("saveError"),
        }

    def begin_task(self, kind: str, prompt: str, details: str, profile: str, resolution: str, seed: int) -> str:
        now = time.monotonic()
        task = {
            "id": uuid.uuid4().hex[:12],
            "kind": kind,
            "prompt": prompt[:MAX_PROMPT_CHARS],
            "details": details[:160],
            "profile": profile,
            "resolution": resolution,
            "seed": seed,
            "effectiveSeed": None,
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
        effective_seed: int | None = None,
        resolution: str | None = None,
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
                task["effectiveSeed"] = effective_seed
                if resolution:
                    task["resolution"] = resolution
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
    def attach_result_metadata(
        response_body: bytes,
        saved_path: str | None,
        save_error: str | None,
        public: bool,
        profile: str,
        resolution: str,
        seed: int,
    ) -> tuple[bytes, int | None, str]:
        try:
            payload = json.loads(response_body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return response_body, None, resolution
        if not isinstance(payload, dict):
            return response_body, None, resolution
        effective_seed = payload.get("seed") if type(payload.get("seed")) is int else None
        actual_resolution = response_image_resolution(response_body) if resolution == "auto" else None
        if actual_resolution:
            resolution = actual_resolution
        if type(payload.get("seed")) is int:
            payload["seed"] = browser_seed(payload["seed"])
        payload["debug_ui"] = {
            "saved": saved_path is not None,
            "saved_path": None if public else saved_path,
            "save_error": save_error,
            "profile": profile,
            "resolution": resolution,
            "seed": browser_seed(seed),
            "effective_seed": browser_seed(effective_seed),
        }
        return json_bytes(payload), effective_seed, resolution

    def task_snapshot(self, public: bool = False) -> dict:
        now = time.monotonic()
        with self.task_lock:
            active = self._task_view(self.active_task, now, public) if self.active_task else None
            history = [self._task_view(task, now, public) for task in self.task_history]
        return {"active": active, "history": history}

    def read_task_image(self, task_id: str) -> bytes | None:
        if len(task_id) != 12 or any(char not in "0123456789abcdef" for char in task_id):
            return None
        with self.task_lock:
            task = next((item for item in self.task_history if item["id"] == task_id), None)
            if task is None or task["status"] != "succeeded":
                return None
            saved_path = task.get("savedPath")
        if not isinstance(saved_path, str):
            return None

        saved_file = Path(saved_path)
        filename = saved_file.name
        if saved_file.parent != self.output_dir or len(filename) != 43:
            return None
        if (not filename.startswith("qwen-image-") or filename[19] != "-" or
                filename[26] != "-" or filename[27:39] != task_id or filename[39:] != ".png" or
                not filename[11:19].isdigit() or not filename[20:26].isdigit()):
            return None

        directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        file_flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        try:
            directory_fd = os.open(self.output_dir, directory_flags)
            try:
                file_fd = os.open(filename, file_flags, dir_fd=directory_fd)
                try:
                    with os.fdopen(file_fd, "rb") as image_file:
                        metadata = os.fstat(image_file.fileno())
                        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_size < len(PNG_SIGNATURE)
                                or metadata.st_size > MAX_SAVED_IMAGE_BYTES):
                            return None
                        image = image_file.read(MAX_SAVED_IMAGE_BYTES + 1)
                    if len(image) > MAX_SAVED_IMAGE_BYTES or not image.startswith(PNG_SIGNATURE):
                        return None
                    return image
                except OSError:
                    return None
            finally:
                os.close(directory_fd)
        except OSError:
            return None


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
        if self.headers.get("Host", "").lower() == PUBLIC_HOST:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
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

    def send_error_json(
        self,
        status: int,
        error_type: str,
        message: str | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        self.send_json(status, {"error": {"type": error_type, "message": message or error_type}}, extra_headers)

    def _network_scope(self) -> str | None:
        host = self.headers.get("Host", "").lower()
        if host == PUBLIC_HOST:
            return "public"
        if is_lan_ip(self.client_address[0]) and host_is_lan(host):
            return "lan"
        return None

    def _same_origin(self, scope: str) -> bool:
        origin = self.headers.get("Origin", "")
        if scope == "public":
            return self.headers.get("Host", "").lower() == PUBLIC_HOST and origin == PUBLIC_ORIGIN
        try:
            parsed = urlsplit(origin)
        except ValueError:
            return False
        host = self.headers.get("Host", "")
        return (
            parsed.scheme == "http"
            and parsed.netloc.lower() == host.lower()
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
            and parsed.username is None
            and parsed.password is None
            and host_is_lan(host)
        )

    def _session_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel is not None else None

    def _public_session_valid(self) -> bool:
        return self.server.public_auth.valid_session(self._session_token())

    def _login_cookie(self, token: str) -> str:
        return f"{SESSION_COOKIE}={token}; Path=/; Max-Age={SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict"

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
        public: bool = False,
        profile: str = "quality",
        resolution: str = "1024x1024",
        seed: int = -1,
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
                    data, effective_seed, actual_resolution = self.server.attach_result_metadata(
                        data, saved_path, save_error, public, profile, resolution, seed,
                    )
                    self.server.finish_task(
                        task_id, "succeeded", saved_path=saved_path, save_error=save_error,
                        effective_seed=effective_seed, resolution=actual_resolution,
                    )
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
        scope = self._network_scope()
        if scope is None:
            self.send_error_json(HTTPStatus.FORBIDDEN, "origin_not_allowed")
            return
        if self.path in {"/", "/index.html"}:
            if scope == "public" and not self._public_session_valid():
                self.send_bytes(HTTPStatus.OK, LOGIN_PAGE, "text/html; charset=utf-8")
                return
            try:
                page = self.server.static_file.read_bytes()
            except OSError:
                self.send_error_json(HTTPStatus.SERVICE_UNAVAILABLE, "debug_page_unavailable")
                return
            self.send_bytes(HTTPStatus.OK, page, "text/html; charset=utf-8")
            return
        if self.path in {"/api/health", "/api/models"}:
            if scope == "public" and not self._public_session_valid():
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "login_required")
                return
            path = "/health" if self.path == "/api/health" else "/v1/models"
            self._proxy("GET", path)
            return
        if self.path == "/api/tasks":
            if scope == "public" and not self._public_session_valid():
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "login_required")
                return
            self.send_json(HTTPStatus.OK, self.server.task_snapshot(public=scope == "public"))
            return
        parsed_path = urlsplit(self.path)
        task_image_parts = parsed_path.path.split("/")
        if (not parsed_path.query and len(task_image_parts) == 5 and task_image_parts[:3] == ["", "api", "tasks"]
                and task_image_parts[4] == "image"):
            if scope == "public" and not self._public_session_valid():
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "login_required")
                return
            image = self.server.read_task_image(task_image_parts[3])
            if image is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "task_image_not_found")
                return
            self.send_bytes(
                HTTPStatus.OK,
                image,
                "image/png",
                {"Content-Disposition": 'inline; filename="qwen-image.png"'},
            )
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "not_found")

    def do_POST(self) -> None:
        scope = self._network_scope()
        if scope is None:
            self.send_error_json(HTTPStatus.FORBIDDEN, "origin_not_allowed")
            return
        if not self._same_origin(scope):
            self.send_error_json(HTTPStatus.FORBIDDEN, "same_origin_required")
            return
        if self.path == "/api/login":
            if scope != "public" or self.headers.get_content_type() != "application/json":
                self.send_error_json(HTTPStatus.NOT_FOUND, "not_found")
                return
            body = self._body(MAX_LOGIN_BYTES)
            if body is None:
                return
            try:
                payload = json.loads(body)
                if not isinstance(payload, dict) or set(payload) != {"password"}:
                    raise ValueError("login_payload_invalid")
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                self.send_error_json(HTTPStatus.BAD_REQUEST, "login_payload_invalid")
                return
            token, retry_after = self.server.public_auth.login(self.client_address[0], payload.get("password"))
            if retry_after is not None:
                self.send_error_json(
                    HTTPStatus.TOO_MANY_REQUESTS,
                    "login_rate_limited",
                    extra_headers={"Retry-After": str(retry_after)},
                )
                return
            if token is None:
                self.send_error_json(HTTPStatus.UNAUTHORIZED, "login_failed")
                return
            self.send_bytes(HTTPStatus.NO_CONTENT, b"", "application/json", {"Set-Cookie": self._login_cookie(token)})
            return
        if scope == "public" and not self._public_session_valid():
            self.send_error_json(HTTPStatus.UNAUTHORIZED, "login_required")
            return
        if self.path == "/api/logout":
            self.server.public_auth.logout(self._session_token())
            self.send_bytes(
                HTTPStatus.NO_CONTENT,
                b"",
                "application/json",
                {"Set-Cookie": f"{SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict"},
            )
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
                    payload = json.loads(body)
                    proxied_body = validate_generation_payload(payload)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    self.send_error_json(HTTPStatus.BAD_REQUEST, "generation_json_invalid")
                    return
                except ValueError as error:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
                    return
                task_id = self.server.begin_task(
                    "generation", payload["prompt"].strip(), payload["resolution"],
                    payload["profile"], payload["resolution"],
                    int(payload["seed"]) if isinstance(payload["seed"], str) else payload["seed"],
                )
                self._proxy(
                    "POST", "/v1/images/generations", proxied_body, "application/json", task_id,
                    scope == "public", payload["profile"], payload["resolution"], payload["seed"],
                )
                return
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;"):
                self.send_error_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "multipart_required")
                return
            body = self._body()
            if body is None:
                return
            details = extract_edit_task_details(body, content_type)
            task_id = self.server.begin_task(
                "edit", details["prompt"], details["filename"] or "参考图编辑",
                details["profile"], details["resolution"], details["seed"],
            )
            self._proxy(
                "POST", "/v1/images/edits", body, content_type, task_id,
                scope == "public", details["profile"], details["resolution"], details["seed"],
            )
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
    parser.add_argument("--auth-file", required=True)
    args = parser.parse_args()
    bridge_token = read_private_secret(Path(args.bridge_token_file))
    static_file = Path(args.static_file)
    if not static_file.is_file() or not 1 <= args.port <= 65535:
        raise SystemExit("debug_ui_config_invalid")
    output_dir = Path(args.output_dir).expanduser()
    server = DebugHTTPServer((args.host, args.port), args.bridge_url, bridge_token, static_file, output_dir, Path(args.auth_file))
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
