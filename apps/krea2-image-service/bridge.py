#!/usr/bin/env python3
"""Loopback-only, authenticated OpenAI image boundary for stable-diffusion.cpp.

The native sd-server is intentionally kept on a second loopback port without a
public bind. This process owns the bearer boundary, request limits, one active
generation plus one queued request, and lazy model residency. It never logs
prompts, image bytes, credentials, or upstream response bodies.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import error, request


MODEL_ID = "local/wild-krea2-turbo-nsfw"
SERVICE_VERSION = "1"
MAX_BODY_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 30 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000
GENERATION_TIMEOUT_SECONDS = 600
LOAD_TIMEOUT_SECONDS = 420
QUEUE_WAIT_SECONDS = 5
ALLOWED_SIZES = {(1024, 1024), (768, 1024), (1024, 768)}


class ConfigError(RuntimeError):
    pass


def private_token(path: Path) -> str:
    st = path.lstat()
    if not stat.S_ISREG(st.st_mode) or st.st_mode & 0o077:
        raise ConfigError("krea2_token_not_private")
    value = path.read_text(encoding="utf-8").strip()
    if len(value) < 32 or len(value) > 4096:
        raise ConfigError("krea2_token_invalid")
    return value


def load_config(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ConfigError("krea2_engine_config_missing")
    data = json.loads(path.read_text(encoding="utf-8"))
    required = {"modelId", "modelPath", "modelSha256", "modelBytes", "vaePath", "vaeSha256", "vaeBytes", "llmPath", "llmSha256", "llmBytes", "sdCppBinary", "sdCppCommit", "internalPort", "servicePort", "backend", "steps"}
    if set(data) < required:
        raise ConfigError("krea2_engine_config_incomplete")
    if data["modelId"] != MODEL_ID or data["steps"] != 8 or data["backend"] != "MTL0" or data["internalPort"] == data["servicePort"]:
        raise ConfigError("krea2_engine_config_policy")
    for field in ("modelPath", "vaePath", "llmPath", "sdCppBinary"):
        path_value = Path(data[field])
        if not path_value.is_absolute() or path_value.is_symlink() or not path_value.is_file():
            raise ConfigError(f"krea2_asset_missing:{field}")
    return data


def verify_hash(path: Path, expected: str, expected_bytes: int) -> None:
    if path.stat().st_size != expected_bytes:
        raise ConfigError(f"krea2_asset_size:{path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ConfigError(f"krea2_asset_hash:{path.name}")


def safe_failure(status: int, kind: str) -> bytes:
    return json.dumps({"error": {"type": kind, "message": kind}}, separators=(",", ":")).encode()


class KreaBridge:
    def __init__(self, config: dict, token: str, token_path: Path):
        self.config = config
        self.token = token
        self.token_path = token_path
        self.child: subprocess.Popen[bytes] | None = None
        self.child_started_at = 0.0
        self.last_activity = 0.0
        self.lock = threading.Lock()
        self.active_generation = threading.Lock()
        self.slot = threading.BoundedSemaphore(2)  # one active request plus one bounded waiter
        self.stop_event = threading.Event()
        self.monitor = threading.Thread(target=self._idle_monitor, daemon=True)

    @property
    def port(self) -> int:
        return int(self.config["servicePort"])

    @property
    def internal_url(self) -> str:
        return f"http://127.0.0.1:{int(self.config['internalPort'])}"

    def health(self) -> dict:
        with self.lock:
            child = self.child
            state = "running" if child and child.poll() is None else "idle"
            if child and child.poll() is not None:
                self.child = None
        return {
            "status": "ready",
            "service": "amadeus-krea2-image",
            "version": SERVICE_VERSION,
            "model": MODEL_ID,
            "runtime": "stable-diffusion.cpp-metal",
            "sdCppCommit": self.config["sdCppCommit"],
            "state": state,
            "generationConcurrency": 1,
            "queueCapacity": 1,
            "deadlineMs": GENERATION_TIMEOUT_SECONDS * 1000,
            "referenceEdits": False,
        }

    def start(self) -> None:
        with self.lock:
            if self.child and self.child.poll() is None:
                return
            args = [
                self.config["sdCppBinary"],
                "--diffusion-model", self.config["modelPath"],
                "--llm", self.config["llmPath"],
                "--vae", self.config["vaePath"],
                "--listen-ip", "127.0.0.1",
                "--listen-port", str(self.config["internalPort"]),
                "--backend", self.config["backend"],
                "--steps", str(self.config["steps"]),
                "--cfg-scale", "0",
                "--diffusion-fa",
                "--log-level", "error",
            ]
            log_dir = Path(self.config["logDir"])
            log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            log_path = log_dir / "sd-server.log"
            log_path.touch(mode=0o600, exist_ok=True)
            log = log_path.open("ab")
            self.child = subprocess.Popen(args, stdout=log, stderr=log, start_new_session=True)
            self.child_started_at = time.monotonic()
            self.last_activity = time.monotonic()
        deadline = time.monotonic() + LOAD_TIMEOUT_SECONDS
        while time.monotonic() < deadline:
            if self.child is None or self.child.poll() is not None:
                raise ConfigError("krea2_runtime_exited")
            try:
                with request.urlopen(self.internal_url + "/v1/models", timeout=2) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(1)
        self.stop()
        raise TimeoutError("krea2_model_load_timeout")

    def stop(self) -> None:
        with self.lock:
            child = self.child
            self.child = None
        if child and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=15)
            except Exception:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except Exception:
                    pass

    def _idle_monitor(self) -> None:
        idle_seconds = int(self.config.get("idleShutdownSeconds", 900))
        while not self.stop_event.wait(30):
            if idle_seconds > 0 and self.child and time.monotonic() - self.last_activity > idle_seconds:
                self.stop()

    def close(self) -> None:
        self.stop_event.set()
        self.stop()

    def ensure_ready(self) -> None:
        if self.child is None or self.child.poll() is not None:
            self.start()
        self.last_activity = time.monotonic()

    def generate(self, payload: dict) -> tuple[int, bytes]:
        if not self.slot.acquire(timeout=QUEUE_WAIT_SECONDS):
            return 429, safe_failure(429, "krea2_busy")
        try:
            with self.active_generation:
                self.ensure_ready()
                body = dict(payload)
                body["model"] = "sd-cpp-local"
                body["n"] = 1
                body.pop("image", None)
                body.pop("images", None)
                encoded = json.dumps(body, separators=(",", ":")).encode()
                req = request.Request(self.internal_url + "/v1/images/generations", data=encoded, method="POST", headers={"Content-Type": "application/json"})
                try:
                    with request.urlopen(req, timeout=GENERATION_TIMEOUT_SECONDS) as response:
                        data = response.read(MAX_RESPONSE_BYTES + 1)
                        if len(data) > MAX_RESPONSE_BYTES:
                            return 502, safe_failure(502, "krea2_output_too_large")
                        if response.status != 200:
                            return 503, safe_failure(503, "krea2_provider_unavailable")
                except error.HTTPError as exc:
                    return 504 if exc.code in {408, 504} else 503, safe_failure(exc.code if exc.code in {400, 408, 429, 500, 502, 503, 504} else 503, "krea2_provider_unavailable")
                except (TimeoutError, error.URLError):
                    return 504, safe_failure(504, "krea2_timeout")
                try:
                    parsed = json.loads(data)
                    items = parsed.get("data")
                    encoded_image = items[0].get("b64_json") if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict) else None
                    if not isinstance(encoded_image, str) or not (1000 <= len(encoded_image) <= MAX_RESPONSE_BYTES * 2):
                        raise ValueError
                    base64.b64decode(encoded_image, validate=True)
                except Exception:
                    return 502, safe_failure(502, "krea2_invalid_output")
                return 200, data
        except TimeoutError:
            return 504, safe_failure(504, "krea2_timeout")
        except ConfigError:
            return 503, safe_failure(503, "krea2_provider_unavailable")
        finally:
            self.last_activity = time.monotonic()
            self.slot.release()


def auth_ok(handler: BaseHTTPRequestHandler, expected: str) -> bool:
    return handler.headers.get("Authorization", "") == f"Bearer {expected}"


class Handler(BaseHTTPRequestHandler):
    server: "KreaHTTPServer"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_json(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in {"/health", "/healthz"}:
            self.send_json(200, json.dumps(self.server.bridge.health(), separators=(",", ":")).encode())
            return
        if self.path == "/v1/models":
            if not auth_ok(self, self.server.bridge.token):
                self.send_json(401, safe_failure(401, "unauthorized"))
                return
            self.send_json(200, json.dumps({"data": [{"id": MODEL_ID, "object": "model", "owned_by": "amadeus"}]}, separators=(",", ":")).encode())
            return
        self.send_json(404, safe_failure(404, "not_found"))

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/v1/images/edits":
            self.send_json(400, safe_failure(400, "reference_edit_unsupported"))
            return
        if self.path != "/v1/images/generations":
            self.send_json(404, safe_failure(404, "not_found"))
            return
        if not auth_ok(self, self.server.bridge.token):
            self.send_json(401, safe_failure(401, "unauthorized"))
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES or "application/json" not in self.headers.get("Content-Type", ""):
            self.send_json(413, safe_failure(413, "request_too_large"))
            return
        try:
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or not isinstance(payload.get("prompt"), str) or not payload["prompt"].strip() or len(payload["prompt"]) > MAX_PROMPT_CHARS:
                raise ValueError
            if payload.get("model") not in {None, MODEL_ID, "wild-krea2-turbo-nsfw"}:
                raise ValueError
            if any(key in payload for key in ("image", "images", "reference", "reference_image", "input_image", "mask")):
                self.send_json(400, safe_failure(400, "reference_edit_unsupported"))
                return
            width, height = 1024, 1024
            if payload.get("size"):
                width, height = (int(x) for x in str(payload["size"]).lower().split("x", 1))
            if (width, height) not in ALLOWED_SIZES or payload.get("n", 1) != 1:
                raise ValueError
            payload["size"] = f"{width}x{height}"
            payload["output_format"] = "png"
        except Exception:
            self.send_json(400, safe_failure(400, "invalid_image_request"))
            return
        status, body = self.server.bridge.generate(payload)
        self.send_json(status, body)


class KreaHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], bridge: KreaBridge):
        self.bridge = bridge
        super().__init__(address, Handler)


def main() -> None:
    config_path = Path(os.environ["AMADEUS_KREA2_ENGINE_CONFIG"])
    token_path = Path(os.environ["AMADEUS_KREA2_TOKEN_FILE"])
    config = load_config(config_path)
    for field, sha_field, bytes_field in (("modelPath", "modelSha256", "modelBytes"), ("vaePath", "vaeSha256", "vaeBytes"), ("llmPath", "llmSha256", "llmBytes")):
        verify_hash(Path(config[field]), config[sha_field], int(config[bytes_field]))
    bridge = KreaBridge(config, private_token(token_path), token_path)
    server = KreaHTTPServer(("127.0.0.1", int(config["servicePort"])), bridge)
    bridge.monitor.start()
    def _stop(_signum: int, _frame: object) -> None:
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        bridge.close()


if __name__ == "__main__":
    main()
