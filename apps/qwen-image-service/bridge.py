#!/usr/bin/env python3
"""Authenticated, bounded local bridge for Qwen-Image-2.1 edits and generation."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import signal
import stat
import subprocess
import threading
import time
from urllib import error, request

MODEL_ID = "local/qwen-image-2.1-uncensored"
SERVICE_VERSION = "1"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024
MAX_RESPONSE_BYTES = 30 * 1024 * 1024
MAX_PROMPT_CHARS = 8_000
MAX_OUTPUT_PIXELS = 768 * 1024
MAX_OUTPUT_EDGE = 1_024
GENERATION_TIMEOUT_SECONDS = 600
LOAD_TIMEOUT_SECONDS = 600
QUEUE_WAIT_SECONDS = 5
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}
MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
EDIT_EXTRA_ARGS = {"strength": 0.9}
SIZE_RE = re.compile(r"^(\d{2,5})x(\d{2,5})$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class ConfigError(RuntimeError):
    pass


def safe_failure(status: int, kind: str) -> bytes:
    return json.dumps({"error": {"type": kind, "message": kind}}, separators=(",", ":")).encode()


def private_token(path: Path) -> str:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise ConfigError("qwen_token_not_private")
    value = path.read_text(encoding="utf-8").strip()
    if len(value) < 32 or len(value) > 4096 or "\r" in value or "\n" in value:
        raise ConfigError("qwen_token_invalid")
    return value


def verify_hash(path: Path, expected: str, expected_bytes: int) -> None:
    if not SHA256_RE.fullmatch(expected) or path.stat().st_size != expected_bytes:
        raise ConfigError(f"qwen_asset_size:{path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ConfigError(f"qwen_asset_hash:{path.name}")


def load_config(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ConfigError("qwen_engine_config_missing")
    data = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "modelId", "assetRoot", "diffusionModelPath", "diffusionModelSha256", "diffusionModelBytes",
        "diffusionModelRepository", "diffusionModelRevision", "llmPath", "llmSha256", "llmBytes",
        "llmRepository", "llmRevision", "visionPath", "visionSha256", "visionBytes", "visionRepository",
        "visionRevision", "vaePath", "vaeSha256", "vaeBytes", "vaeRepository", "vaeRevision",
        "sdCppRepository", "sdCppSourcePath", "sdCppCommit", "sdCppBinary", "sdCppBinarySha256",
        "sdCppBinaryBytes", "internalPort", "servicePort", "backend", "steps", "cfgScale",
        "generationDeadlineMs", "loadTimeoutMs", "queueWaitSeconds", "idleShutdownSeconds",
        "defaultGenerationSize", "maxOutputPixels", "maxOutputEdge", "logDir",
    }
    if not isinstance(data, dict) or not required.issubset(data):
        raise ConfigError("qwen_engine_config_incomplete")
    if data["modelId"] != MODEL_ID or data["backend"] != "MTL0":
        raise ConfigError("qwen_engine_config_policy")
    if data["servicePort"] != 18793 or data["internalPort"] != 18795 or data["servicePort"] == data["internalPort"]:
        raise ConfigError("qwen_engine_port_policy")
    if data["steps"] != 16 or float(data["cfgScale"]) != 6.0 or data["generationDeadlineMs"] != 600_000:
        raise ConfigError("qwen_engine_sampling_policy")
    if data["maxOutputPixels"] != MAX_OUTPUT_PIXELS or data["maxOutputEdge"] != MAX_OUTPUT_EDGE:
        raise ConfigError("qwen_engine_geometry_policy")
    for field in ("diffusionModelPath", "llmPath", "visionPath", "vaePath", "sdCppBinary"):
        candidate = Path(data[field])
        if not candidate.is_absolute() or candidate.is_symlink() or not candidate.is_file():
            raise ConfigError(f"qwen_asset_missing:{field}")
    for field in ("diffusionModelRevision", "llmRevision", "visionRevision", "vaeRevision"):
        if not COMMIT_RE.fullmatch(data[field]):
            raise ConfigError(f"qwen_revision_invalid:{field}")
    if not COMMIT_RE.fullmatch(data["sdCppCommit"]):
        raise ConfigError("qwen_sd_cpp_commit_invalid")
    for field in ("diffusionModelSha256", "llmSha256", "visionSha256", "vaeSha256", "sdCppBinarySha256"):
        if not SHA256_RE.fullmatch(data[field]):
            raise ConfigError(f"qwen_hash_invalid:{field}")
    if data["defaultGenerationSize"] != "768x768":
        raise ConfigError("qwen_default_size_policy")
    return data


def verify_runtime_and_assets(config: dict) -> None:
    for path_key, hash_key, bytes_key in (
        ("diffusionModelPath", "diffusionModelSha256", "diffusionModelBytes"),
        ("llmPath", "llmSha256", "llmBytes"),
        ("visionPath", "visionSha256", "visionBytes"),
        ("vaePath", "vaeSha256", "vaeBytes"),
        ("sdCppBinary", "sdCppBinarySha256", "sdCppBinaryBytes"),
    ):
        verify_hash(Path(config[path_key]), config[hash_key], int(config[bytes_key]))
    result = subprocess.run(
        ["git", "-C", config["sdCppSourcePath"], "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.stdout.strip() != config["sdCppCommit"]:
        raise ConfigError("qwen_sd_cpp_revision_mismatch")


def detect_mime(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def image_dimensions(data: bytes, mime: str) -> tuple[int, int] | None:
    if mime == "image/png" and len(data) >= 24 and data[12:16] == b"IHDR":
        width = int.from_bytes(data[16:20], "big")
        height = int.from_bytes(data[20:24], "big")
        return (width, height) if width and height else None
    if mime == "image/jpeg":
        index = 2
        while index + 4 <= len(data):
            if data[index] != 0xFF:
                index += 1
                continue
            while index < len(data) and data[index] == 0xFF:
                index += 1
            if index >= len(data):
                break
            marker = data[index]
            index += 1
            if marker in {0xD8, 0xD9}:
                continue
            if index + 2 > len(data):
                break
            segment_length = int.from_bytes(data[index:index + 2], "big")
            if segment_length < 2 or index + segment_length > len(data):
                break
            if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
                if segment_length < 7:
                    break
                height = int.from_bytes(data[index + 3:index + 5], "big")
                width = int.from_bytes(data[index + 5:index + 7], "big")
                return (width, height) if width and height else None
            index += segment_length
    if mime == "image/webp" and len(data) >= 30:
        chunk = data[12:16]
        if chunk == b"VP8X":
            width = 1 + int.from_bytes(data[24:27], "little")
            height = 1 + int.from_bytes(data[27:30], "little")
            return width, height
        if chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
            width = 1 + data[21] + ((data[22] & 0x3F) << 8)
            height = 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 0x0F) << 10)
            return width, height
        if chunk == b"VP8 " and len(data) >= 30 and data[23:26] == b"\x9d\x01\x2a":
            width = int.from_bytes(data[26:28], "little") & 0x3FFF
            height = int.from_bytes(data[28:30], "little") & 0x3FFF
            return (width, height) if width and height else None
    return None


def derived_edit_size(width: int, height: int, max_pixels: int = MAX_OUTPUT_PIXELS, max_edge: int = MAX_OUTPUT_EDGE) -> str | None:
    if width < 1 or height < 1:
        raise ValueError("invalid_image_geometry")
    if width % 32 == 0 and height % 32 == 0 and width * height <= max_pixels and max(width, height) <= max_edge:
        return None
    scale = min(1.0, (max_pixels / (width * height)) ** 0.5, max_edge / max(width, height))
    target_width = max(32, round(width * scale / 32) * 32)
    target_height = max(32, round(height * scale / 32) * 32)
    while target_width * target_height > max_pixels or max(target_width, target_height) > max_edge:
        if target_width / width >= target_height / height:
            target_width -= 32
        else:
            target_height -= 32
        if target_width < 32 or target_height < 32:
            raise ValueError("image_geometry_unsupported")
    return f"{target_width}x{target_height}"


def parse_size(value: str) -> tuple[int, int] | None:
    match = SIZE_RE.fullmatch(value)
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    if width < 32 or height < 32 or width % 32 or height % 32 or width * height > MAX_OUTPUT_PIXELS or max(width, height) > MAX_OUTPUT_EDGE:
        return None
    return width, height


def parse_multipart(content_type: str, body: bytes) -> dict:
    if len(body) > MAX_BODY_BYTES or not content_type.lower().startswith("multipart/form-data"):
        raise ValueError("edit_body_unsupported")
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii", errors="strict")
    message = BytesParser(policy=policy.default).parsebytes(header + body)
    boundary = message.get_boundary()
    if not message.is_multipart() or not boundary or len(boundary) > 70:
        raise ValueError("edit_multipart_invalid")
    fields: dict[str, list[bytes]] = {}
    files: list[dict] = []
    for part in message.iter_parts():
        name = part.get_param("name", header="content-disposition")
        if not isinstance(name, str) or not name:
            raise ValueError("edit_multipart_field_invalid")
        payload = part.get_payload(decode=True)
        if not isinstance(payload, bytes):
            raise ValueError("edit_multipart_payload_invalid")
        filename = part.get_filename()
        if filename is not None:
            if name not in {"image[]", "image"} or len(payload) > MAX_IMAGE_BYTES or not payload:
                raise ValueError("edit_image_unsupported")
            mime = part.get_content_type().lower()
            if mime not in ALLOWED_MIME or detect_mime(payload) != mime:
                raise ValueError("edit_image_mime_invalid")
            files.append({"name": name, "filename": filename, "mime": mime, "bytes": payload})
        else:
            if name not in {"model", "prompt", "size", "n", "output_format"}:
                raise ValueError("edit_field_unsupported")
            fields.setdefault(name, []).append(payload)
    if any(len(values) != 1 for values in fields.values()) or len(files) != 1 or "prompt" not in fields:
        raise ValueError("edit_contract_invalid")
    try:
        prompt = fields["prompt"][0].decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ValueError("edit_prompt_invalid") from exc
    if not prompt or len(prompt) > MAX_PROMPT_CHARS or "<sd_cpp_extra_args>" in prompt:
        raise ValueError("edit_prompt_invalid")
    if "model" in fields and fields["model"][0].decode("utf-8", errors="strict").strip() not in {MODEL_ID, "sd-cpp-local"}:
        raise ValueError("edit_model_unsupported")
    if "n" in fields and fields["n"][0].strip() != b"1":
        raise ValueError("edit_count_unsupported")
    if "output_format" in fields and fields["output_format"][0].strip().lower() not in {b"png", b"jpeg"}:
        raise ValueError("edit_output_format_unsupported")
    explicit_size = fields.get("size", [b""])[0].decode("ascii", errors="ignore").strip()
    if explicit_size and parse_size(explicit_size) is None:
        explicit_size = ""
    image = files[0]
    dimensions = image_dimensions(image["bytes"], image["mime"])
    if dimensions is None:
        raise ValueError("edit_image_dimensions_invalid")
    size = explicit_size or derived_edit_size(*dimensions)
    if size:
        parsed_size = parse_size(size)
        if parsed_size is None:
            raise ValueError("edit_size_unsupported")
        if abs(parsed_size[0] / parsed_size[1] - dimensions[0] / dimensions[1]) > 0.02:
            size = derived_edit_size(*dimensions) or f"{dimensions[0]}x{dimensions[1]}"
    prompt = prompt + " <sd_cpp_extra_args>" + json.dumps(EDIT_EXTRA_ARGS, separators=(",", ":")) + "</sd_cpp_extra_args>"
    fields_out = [("model", b"sd-cpp-local")]
    fields_out.extend((name, values[0]) for name, values in fields.items() if name not in {"model", "prompt", "size", "n"})
    fields_out.extend([("prompt", prompt.encode("utf-8")), ("n", b"1")])
    if size:
        fields_out.append(("size", size.encode("ascii")))
    return {"boundary": boundary, "fields": fields_out, "image": image}


def build_multipart(payload: dict) -> tuple[str, bytes]:
    boundary = "qwen-" + os.urandom(18).hex()
    marker = boundary.encode("ascii")
    output = bytearray()
    for name, value in payload["fields"]:
        output.extend(b"--" + marker + b"\r\n")
        output.extend(b'Content-Disposition: form-data; name="' + name.encode("ascii") + b'"\r\n\r\n')
        output.extend(value + b"\r\n")
    image = payload["image"]
    filename = "reference." + MIME_EXT[image["mime"]]
    output.extend(b"--" + marker + b"\r\n")
    output.extend(b'Content-Disposition: form-data; name="image[]"; filename="' + filename.encode("ascii") + b'"\r\n')
    output.extend(b"Content-Type: " + image["mime"].encode("ascii") + b"\r\n\r\n")
    output.extend(image["bytes"] + b"\r\n--" + marker + b"--\r\n")
    if len(output) > MAX_BODY_BYTES + 4096:
        raise ValueError("edit_body_too_large")
    return "multipart/form-data; boundary=" + boundary, bytes(output)


def json_bytes(value: dict) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class QwenBridge:
    def __init__(self, config: dict, token: str, token_path: Path):
        self.config = config
        self.token = token
        self.token_path = token_path
        self.child: subprocess.Popen[bytes] | None = None
        self.lock = threading.Lock()
        self.active_generation = threading.Lock()
        self.slots = threading.BoundedSemaphore(2)
        self.last_activity = time.monotonic()
        self.stop_event = threading.Event()
        self.monitor = threading.Thread(target=self._idle_monitor, daemon=True)

    @property
    def service_port(self) -> int:
        return int(self.config["servicePort"])

    @property
    def internal_url(self) -> str:
        return f"http://127.0.0.1:{int(self.config['internalPort'])}"

    def health(self) -> dict:
        with self.lock:
            running = self.child is not None and self.child.poll() is None
            if self.child is not None and not running:
                self.child = None
        return {
            "status": "ready",
            "service": "amadeus-qwen-image",
            "version": SERVICE_VERSION,
            "model": MODEL_ID,
            "runtime": "stable-diffusion.cpp-metal",
            "sdCppCommit": self.config["sdCppCommit"],
            "state": "running" if running else "idle",
            "generationConcurrency": 1,
            "queueCapacity": 1,
            "deadlineMs": self.config["generationDeadlineMs"],
            "referenceEdits": True,
        }

    def start(self) -> None:
        with self.lock:
            if self.child is not None and self.child.poll() is None:
                return
            args = [
                self.config["sdCppBinary"],
                "--diffusion-model", self.config["diffusionModelPath"],
                "--llm", self.config["llmPath"],
                "--llm_vision", self.config["visionPath"],
                "--vae", self.config["vaePath"],
                "--listen-ip", "127.0.0.1",
                "--listen-port", str(self.config["internalPort"]),
                "--backend", self.config["backend"],
                "--steps", str(self.config["steps"]),
                "--cfg-scale", str(self.config["cfgScale"]),
                "--diffusion-fa",
                "--log-level", "error",
            ]
            log_dir = Path(self.config["logDir"])
            log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            log_path = log_dir / "sd-server.log"
            log_path.touch(mode=0o600, exist_ok=True)
            os.chmod(log_path, 0o600)
            with log_path.open("ab") as log:
                self.child = subprocess.Popen(args, stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + int(self.config["loadTimeoutMs"]) / 1000
        while time.monotonic() < deadline:
            if self.child is None or self.child.poll() is not None:
                raise ConfigError("qwen_runtime_exited")
            try:
                with request.urlopen(self.internal_url + "/v1/models", timeout=2) as response:
                    if response.status == 200:
                        self.last_activity = time.monotonic()
                        return
            except Exception:
                time.sleep(1)
        self.stop()
        raise TimeoutError("qwen_runtime_load_timeout")

    def stop(self) -> None:
        with self.lock:
            child = self.child
            self.child = None
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=15)
            except Exception:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except Exception:
                    pass

    def _idle_monitor(self) -> None:
        idle_seconds = int(self.config["idleShutdownSeconds"])
        while not self.stop_event.wait(15):
            with self.lock:
                running = self.child is not None and self.child.poll() is None
                expired = running and time.monotonic() - self.last_activity > idle_seconds
            if expired and self.active_generation.acquire(blocking=False):
                try:
                    if time.monotonic() - self.last_activity > idle_seconds:
                        self.stop()
                finally:
                    self.active_generation.release()

    def close(self) -> None:
        self.stop_event.set()
        self.stop()

    def ensure_ready(self) -> None:
        if self.child is None or self.child.poll() is not None:
            self.start()
        self.last_activity = time.monotonic()

    def _request(self, path: str, body: bytes, content_type: str) -> tuple[int, bytes]:
        if not self.slots.acquire(timeout=QUEUE_WAIT_SECONDS):
            return 429, safe_failure(429, "qwen_busy")
        try:
            with self.active_generation:
                self.ensure_ready()
                req = request.Request(
                    self.internal_url + path,
                    data=body,
                    method="POST",
                    headers={"Content-Type": content_type},
                )
                try:
                    with request.urlopen(req, timeout=GENERATION_TIMEOUT_SECONDS) as response:
                        data = response.read(MAX_RESPONSE_BYTES + 1)
                        if len(data) > MAX_RESPONSE_BYTES or response.status != 200:
                            return 502, safe_failure(502, "qwen_output_invalid")
                except error.HTTPError as exc:
                    status = 504 if exc.code in {408, 504} else 502
                    return status, safe_failure(status, "qwen_runtime_unavailable")
                except (TimeoutError, error.URLError):
                    self.stop()
                    return 504, safe_failure(504, "qwen_timeout")
                try:
                    parsed = json.loads(data)
                    items = parsed.get("data")
                    if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0].get("b64_json"), str):
                        raise ValueError("response_shape")
                    image_bytes = base64.b64decode(items[0]["b64_json"], validate=True)
                    if not image_bytes or len(image_bytes) > MAX_RESPONSE_BYTES:
                        raise ValueError("response_image_size")
                except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
                    return 502, safe_failure(502, "qwen_output_invalid")
                self.last_activity = time.monotonic()
                return 200, json_bytes({"created": parsed.get("created", int(time.time())), "data": [{"b64_json": items[0]["b64_json"]}], "model": MODEL_ID})
        except (ConfigError, TimeoutError):
            self.stop()
            return 503, safe_failure(503, "qwen_runtime_unavailable")
        finally:
            self.slots.release()

    def generate(self, payload: dict) -> tuple[int, bytes]:
        if not isinstance(payload, dict) or set(payload) - {"model", "prompt", "n", "size", "output_format"}:
            return 400, safe_failure(400, "qwen_request_invalid")
        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            return 400, safe_failure(400, "qwen_prompt_invalid")
        if payload.get("model", MODEL_ID) not in {MODEL_ID, "sd-cpp-local"} or payload.get("n", 1) != 1:
            return 400, safe_failure(400, "qwen_request_invalid")
        size = payload.get("size", self.config["defaultGenerationSize"])
        if not isinstance(size, str) or parse_size(size) is None:
            return 400, safe_failure(400, "qwen_size_unsupported")
        if payload.get("output_format", "png") not in {"png", "jpeg"}:
            return 400, safe_failure(400, "qwen_output_format_unsupported")
        body = json_bytes({"model": "sd-cpp-local", "prompt": prompt, "n": 1, "size": size, "output_format": "png"})
        return self._request("/v1/images/generations", body, "application/json")

    def edit(self, content_type: str, body: bytes) -> tuple[int, bytes]:
        try:
            payload = parse_multipart(content_type, body)
            proxied_type, proxied_body = build_multipart(payload)
        except (ValueError, UnicodeError):
            return 400, safe_failure(400, "qwen_edit_request_invalid")
        if len(proxied_body) > MAX_BODY_BYTES + 4096:
            return 413, safe_failure(413, "qwen_edit_body_too_large")
        return self._request("/v1/images/edits", proxied_body, proxied_type)


def auth_ok(handler: BaseHTTPRequestHandler, expected: str) -> bool:
    supplied = handler.headers.get("Authorization", "")
    prefix = "Bearer "
    return supplied.startswith(prefix) and hmac.compare_digest(supplied[len(prefix):], expected)


class Handler(BaseHTTPRequestHandler):
    server: "QwenHTTPServer"

    def log_message(self, format: str, *args) -> None:
        return

    def send_json(self, status: int, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, json_bytes(self.server.bridge.health()))
            return
        if self.path != "/v1/models":
            self.send_json(404, safe_failure(404, "not_found"))
            return
        if not auth_ok(self, self.server.bridge.token):
            self.send_json(401, safe_failure(401, "unauthorized"))
            return
        self.send_json(200, json_bytes({"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]}))

    def do_POST(self) -> None:
        if self.path not in {"/v1/images/generations", "/v1/images/edits"}:
            self.send_json(404, safe_failure(404, "not_found"))
            return
        if not auth_ok(self, self.server.bridge.token):
            self.send_json(401, safe_failure(401, "unauthorized"))
            return
        raw_length = self.headers.get("Content-Length", "")
        if not raw_length.isdigit():
            self.send_json(411, safe_failure(411, "content_length_required"))
            return
        length = int(raw_length)
        if length < 1 or length > MAX_BODY_BYTES:
            self.send_json(413, safe_failure(413, "qwen_request_too_large"))
            return
        body = self.rfile.read(length)
        if len(body) != length:
            self.send_json(400, safe_failure(400, "qwen_request_truncated"))
            return
        if self.path.endswith("/generations"):
            if self.headers.get_content_type() != "application/json":
                self.send_json(415, safe_failure(415, "qwen_content_type_invalid"))
                return
            try:
                payload = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_json(400, safe_failure(400, "qwen_json_invalid"))
                return
            status, response_body = self.server.bridge.generate(payload)
        else:
            content_type = self.headers.get("Content-Type", "")
            status, response_body = self.server.bridge.edit(content_type, body)
        self.send_json(status, response_body)


class QwenHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, server_address, bridge: QwenBridge):
        super().__init__(server_address, Handler)
        self.bridge = bridge


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--token-file", required=True)
    args = parser.parse_args()
    config = load_config(Path(args.config))
    verify_runtime_and_assets(config)
    token = private_token(Path(args.token_file))
    bridge = QwenBridge(config, token, Path(args.token_file))
    bridge.monitor.start()
    server = QwenHTTPServer(("127.0.0.1", bridge.service_port), bridge)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        bridge.close()


if __name__ == "__main__":
    main()
