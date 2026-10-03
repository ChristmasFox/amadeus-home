#!/usr/bin/env python3
"""Host-native Amadeus image asset registry and on-demand upscaler.

The service is intentionally deterministic and non-conversational. It owns
asset identity, path policy, lineage and the Apple Silicon image engine; it
does not interpret chat text or select a delivery destination.
"""
from __future__ import annotations

import base64
import binascii
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sqlite3
import struct
import sys
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse


SERVICE_VERSION = "1"
IMAGE_ID_RE = re.compile(r"^img_[0-9a-f]{32}$")
STORAGE_KEY_RE = re.compile(r"^[a-z]+/[0-9]{4}/[0-9]{2}/img_[0-9a-f]{32}\.(png|jpg|jpeg|webp)$")
SUPPORTED_MIME = {"image/png", "image/jpeg", "image/webp"}
MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_ORIGIN_BYTES = 16_384

def debug_startup(message: str) -> None:
    if os.environ.get("AMADEUS_IMAGE_DEBUG_STARTUP") == "1":
        print(f"startup: {message}", file=sys.stderr, flush=True)


class ServiceError(Exception):
    def __init__(self, code: str, message: str | None = None, status: int = 400, details: dict[str, Any] | None = None):
        super().__init__(message or code)
        self.code = code
        self.status = status
        self.details = details or {}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def normalize_mime(value: str | None) -> str:
    candidate = (value or "").split(";", 1)[0].strip().lower()
    if candidate not in SUPPORTED_MIME:
        raise ServiceError("unsupported_image_type", status=415)
    return candidate


def parse_png(data: bytes) -> tuple[int, int] | None:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def parse_jpeg(data: bytes) -> tuple[int, int] | None:
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    index = 2
    while index + 4 <= len(data):
        while index < len(data) and data[index] != 0xFF:
            index += 1
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
        segment_length = struct.unpack(">H", data[index:index + 2])[0]
        if segment_length < 2 or index + segment_length > len(data):
            break
        if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
            if segment_length >= 7:
                height, width = struct.unpack(">HH", data[index + 3:index + 7])
                return width, height
        index += segment_length
    return None


def parse_webp(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8X" and len(data) >= 30:
        width = 1 + int.from_bytes(data[24:27], "little")
        height = 1 + int.from_bytes(data[27:30], "little")
        return width, height
    if chunk == b"VP8 " and len(data) >= 30:
        start = data.find(b"\x9d\x01\x2a", 20)
        if start >= 0 and start + 7 <= len(data):
            width, height = struct.unpack("<HH", data[start + 3:start + 7])
            return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L" and len(data) >= 25 and data[20] == 0x2F:
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def inspect_image(data: bytes, declared_mime: str | None = None) -> tuple[str, int, int]:
    if not data:
        raise ServiceError("empty_image", status=422)
    png = parse_png(data)
    jpeg = parse_jpeg(data)
    webp = parse_webp(data)
    detected = "image/png" if png else "image/jpeg" if jpeg else "image/webp" if webp else None
    if detected is None:
        raise ServiceError("invalid_image", status=422)
    mime = normalize_mime(declared_mime) if declared_mime else detected
    if mime != detected:
        raise ServiceError("image_type_mismatch", status=422)
    width, height = (png or jpeg or webp or (0, 0))
    if width < 1 or height < 1 or width > 8192 or height > 8192:
        raise ServiceError("image_dimensions_out_of_bounds", status=422)
    return mime, width, height


def validate_image_id(value: str) -> str:
    if not IMAGE_ID_RE.fullmatch(value):
        raise ServiceError("image_id_invalid", status=400)
    return value


def validate_scale(value: Any) -> int:
    if value is None:
        return 2
    if value not in {2, 4}:
        raise ServiceError("scale_must_be_2_or_4", status=422)
    return int(value)


def validate_mode(value: Any) -> str:
    if value is None:
        return "auto"
    if value not in {"auto", "realistic", "anime"}:
        raise ServiceError("mode_invalid", status=422)
    return str(value)

def validate_resolution(value: Any) -> str | None:
    if value is None:
        return None
    if value not in {"2k", "4k"}:
        raise ServiceError("resolution_invalid", status=422)
    return str(value)

def target_dimensions(width: int, height: int, scale: int, resolution: str | None) -> tuple[int, int]:
    output_width = width * scale
    output_height = height * scale
    if resolution is None:
        return output_width, output_height
    max_edge = 2_560 if resolution == "2k" else 3_840
    current_edge = max(output_width, output_height)
    if current_edge <= max_edge:
        return output_width, output_height
    ratio = max_edge / current_edge
    return max(1, round(output_width * ratio)), max(1, round(output_height * ratio))


def engine_scale_for_target(width: int, height: int, scale: int, target: tuple[int, int]) -> int:
    """Choose a bounded inference scale when a resolution profile caps output.

    A 4x model allocates the full 4x intermediate tensor before the service can
    resize it to a 4K long-edge target. For large portrait assets that tensor
    can exhaust unified memory even though the requested final image is within
    the service's pixel limit. A tiled x2 pass keeps the requested final
    dimensions after the deterministic resize while avoiding that unnecessary
    intermediate allocation. Exact 4x requests continue to use the x4 model.
    """
    requested = (width * scale, height * scale)
    if scale == 4 and target != requested:
        return 2
    return scale


def parse_origin(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    if len(raw.encode("utf-8")) > MAX_ORIGIN_BYTES:
        raise ServiceError("origin_metadata_too_large", status=422)
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ServiceError("origin_metadata_invalid", status=422) from exc
    if not isinstance(value, dict):
        raise ServiceError("origin_metadata_invalid", status=422)
    allowed = {"channel", "conversationId", "messageId", "replyToMessageId", "sessionId", "runId", "generator", "promptRef", "styleHint"}
    result: dict[str, str] = {}
    for key, item in value.items():
        if key not in allowed or not isinstance(item, str) or not item.strip():
            continue
        result[key] = item.strip()[:1_024]
    return result


def safe_storage_key(value: str) -> str:
    if not STORAGE_KEY_RE.fullmatch(value):
        raise ServiceError("storage_key_invalid", status=500)
    return value


@dataclass(frozen=True)
class Asset:
    image_id: str
    kind: str
    source_kind: str
    created_at: str
    mime_type: str
    width: int
    height: int
    storage_key: str
    byte_size: int
    sha256: str
    parent_image_id: str | None
    transform: dict[str, Any] | None
    origin: dict[str, str]
    style_hint: str | None
    status: str
    error_code: str | None = None

    def public(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "imageId": self.image_id,
            "kind": self.kind,
            "sourceKind": self.source_kind,
            "createdAt": self.created_at,
            "mimeType": self.mime_type,
            "width": self.width,
            "height": self.height,
            "storageKey": self.storage_key,
            "byteSize": self.byte_size,
            "sha256": self.sha256,
            "parentImageId": self.parent_image_id,
            "origin": self.origin,
            "styleHint": self.style_hint,
            "status": self.status,
        }
        if self.transform is not None:
            result["transform"] = self.transform
        if self.error_code:
            result["error"] = self.error_code
        return result


class UpscaleEngine(Protocol):
    name: str

    def readiness(self) -> dict[str, Any]: ...

    def upscale(self, source: Path, destination: Path, scale: int, mode: str, target: tuple[int, int] | None = None) -> None: ...


class RealEsrganMlxEngine:
    name = "realesrgan-mlx"

    def __init__(self, weights_dir: str | None = None, tile: int = 0):
        self.weights_dir = weights_dir or os.environ.get("REALESRGAN_MLX_WEIGHTS_DIR")
        self.tile = max(0, int(tile))
        self._upsamplers: dict[str, Any] = {}
        self._import_error: str | None = None

    def readiness(self) -> dict[str, Any]:
        try:
            import mlx  # noqa: F401
            import realesrgan_mlx  # noqa: F401
            return {"status": "ready", "engine": self.name, "accelerator": "Apple MLX", "weightsConfigured": bool(self.weights_dir)}
        except Exception as exc:  # pragma: no cover - depends on host venv
            self._import_error = type(exc).__name__
            return {"status": "unavailable", "engine": self.name, "error": "engine_runtime_unavailable"}

    def _load(self, variant: str) -> Any:
        if variant in self._upsamplers:
            return self._upsamplers[variant]
        from realesrgan_mlx.pipeline_mlx import make_upsampler

        kwargs: dict[str, Any] = {"tile": self.tile}
        if self.weights_dir:
            os.environ["REALESRGAN_MLX_WEIGHTS_DIR"] = self.weights_dir
        upsampler = make_upsampler(variant, **kwargs)
        self._upsamplers[variant] = upsampler
        return upsampler

    def upscale(self, source: Path, destination: Path, scale: int, mode: str, target: tuple[int, int] | None = None) -> None:
        from PIL import Image
        from realesrgan_mlx.pipeline_mlx import upscale_image

        with Image.open(source) as original:
            original_size = (original.width, original.height)
            requested = (original.width * scale, original.height * scale)
        target_size = target or requested
        inference_scale = engine_scale_for_target(*original_size, scale, target_size)
        selected_mode = mode
        # The anime checkpoint is x4-only. A capped 4K result uses the general
        # x2 checkpoint so it does not allocate the discarded x4 intermediate.
        variant = "RealESRGAN_x4plus_anime_6B" if selected_mode == "anime" and inference_scale == 4 else "RealESRGAN_x2plus" if inference_scale == 2 else "RealESRGAN_x4plus"
        output = upscale_image(str(source), self._load(variant))
        image = Image.fromarray(output)
        if image.size != target_size:
            image = image.resize(target_size, Image.Resampling.LANCZOS)
        image.save(destination, format="PNG", optimize=False)


class AssetStore:
    def __init__(self, root: str | Path, engine: UpscaleEngine | None = None, max_input_bytes: int = 24 * 1024 * 1024, max_output_pixels: int = 8192 * 8192, max_concurrency: int = 1, registry_path: str | Path | None = None):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(registry_path or self.root / "asset-registry.sqlite3").expanduser().resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.max_input_bytes = max_input_bytes
        self.max_output_pixels = max_output_pixels
        self.engine = engine or RealEsrganMlxEngine()
        self._semaphore = threading.BoundedSemaphore(max(1, max_concurrency))
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _init_db(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    image_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL CHECK(kind IN ('original', 'derived')),
                    source_kind TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    storage_key TEXT NOT NULL UNIQUE,
                    byte_size INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    parent_image_id TEXT REFERENCES assets(image_id),
                    transform_json TEXT,
                    origin_json TEXT NOT NULL,
                    style_hint TEXT,
                    status TEXT NOT NULL CHECK(status IN ('ready', 'processing', 'failed')),
                    error_code TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_assets_conversation ON assets(json_extract(origin_json, '$.conversationId'), created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_assets_message ON assets(json_extract(origin_json, '$.messageId'));
                """
            )

    def _asset(self, row: sqlite3.Row | None) -> Asset | None:
        if row is None:
            return None
        return Asset(
            image_id=row["image_id"], kind=row["kind"], source_kind=row["source_kind"], created_at=row["created_at"],
            mime_type=row["mime_type"], width=row["width"], height=row["height"], storage_key=row["storage_key"],
            byte_size=row["byte_size"], sha256=row["sha256"], parent_image_id=row["parent_image_id"],
            transform=json.loads(row["transform_json"]) if row["transform_json"] else None,
            origin=json.loads(row["origin_json"]), style_hint=row["style_hint"], status=row["status"], error_code=row["error_code"],
        )

    def path_for(self, storage_key: str) -> Path:
        safe_storage_key(storage_key)
        candidate = (self.root / storage_key).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise ServiceError("storage_path_escape", status=500)
        return candidate

    def get(self, image_id: str) -> Asset:
        validate_image_id(image_id)
        with self._connect() as connection:
            asset = self._asset(connection.execute("SELECT * FROM assets WHERE image_id = ?", (image_id,)).fetchone())
        if asset is None or asset.status != "ready":
            raise ServiceError("image_asset_not_ready", status=404)
        return asset

    def resolve(self, image_id: str | None = None, conversation_id: str | None = None, reply_message_id: str | None = None) -> Asset:
        if image_id:
            return self.get(image_id)
        if not conversation_id:
            raise ServiceError("image_target_required", "reply to an image or provide imageId", 422)
        with self._connect() as connection:
            row = None
            if reply_message_id:
                row = connection.execute(
                    "SELECT * FROM assets WHERE status = 'ready' AND json_extract(origin_json, '$.conversationId') = ? AND json_extract(origin_json, '$.messageId') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
                    (conversation_id, reply_message_id),
                ).fetchone()
            if row is None:
                row = connection.execute(
                    "SELECT * FROM assets WHERE status = 'ready' AND json_extract(origin_json, '$.conversationId') = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
                    (conversation_id,),
                ).fetchone()
        asset = self._asset(row)
        if asset is None:
            raise ServiceError("image_target_not_found", "identify or reply to an image", 404)
        return asset

    def register(self, data: bytes, mime_type: str, source_kind: str, origin: dict[str, str] | None = None, style_hint: str | None = None) -> Asset:
        if len(data) > self.max_input_bytes:
            raise ServiceError("image_input_too_large", status=413)
        mime, width, height = inspect_image(data, mime_type)
        image_id = f"img_{uuid.uuid4().hex}"
        created_at = utc_now()
        extension = MIME_EXT[mime]
        date = created_at[:7].replace("-", "/")
        storage_key = f"originals/{date}/{image_id}.{extension}"
        path = self.path_for(storage_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._atomic_write(path, data)
        digest = hashlib.sha256(data).hexdigest()
        origin_value = dict(origin or {})
        if style_hint in {"realistic", "anime"}:
            origin_value.setdefault("styleHint", style_hint)
        asset = Asset(image_id, "original", source_kind, created_at, mime, width, height, storage_key, len(data), digest, None, None, origin_value, origin_value.get("styleHint"), "ready")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO assets(image_id, kind, source_kind, created_at, mime_type, width, height, storage_key, byte_size, sha256, parent_image_id, transform_json, origin_json, style_hint, status, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (asset.image_id, asset.kind, asset.source_kind, asset.created_at, asset.mime_type, asset.width, asset.height, asset.storage_key, asset.byte_size, asset.sha256, None, None, json.dumps(asset.origin), asset.style_hint, asset.status, None),
            )
        return asset

    def _atomic_write(self, destination: Path, data: bytes | None = None, source: Path | None = None) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
        try:
            with os.fdopen(fd, "wb") as handle:
                if data is not None:
                    handle.write(data)
                elif source is not None:
                    with source.open("rb") as source_handle:
                        while chunk := source_handle.read(1024 * 1024):
                            handle.write(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, destination)
        finally:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass

    def bind_delivery(self, asset_ids: list[str], message_id: str, origin: dict[str, str] | None = None) -> list[Asset]:
        if not asset_ids or not message_id.strip():
            raise ServiceError("delivery_correlation_invalid", status=422)
        updates: list[Asset] = []
        with self._connect() as connection:
            for image_id in asset_ids[:8]:
                validate_image_id(image_id)
                row = connection.execute("SELECT * FROM assets WHERE image_id = ?", (image_id,)).fetchone()
                asset = self._asset(row)
                if asset is None:
                    continue
                merged = dict(asset.origin)
                merged["messageId"] = message_id[:1_024]
                for key in ("channel", "conversationId", "sessionId", "runId"):
                    if origin and isinstance(origin.get(key), str) and origin[key].strip():
                        merged[key] = origin[key].strip()[:1_024]
                connection.execute("UPDATE assets SET origin_json = ?, style_hint = ? WHERE image_id = ?", (json.dumps(merged), merged.get("styleHint"), image_id))
                updates.append(self._asset(connection.execute("SELECT * FROM assets WHERE image_id = ?", (image_id,)).fetchone()))
        return [item for item in updates if item is not None]

    def upscale(self, image_id: str | None, conversation_id: str | None, reply_message_id: str | None, scale_value: Any, mode_value: Any, resolution_value: Any = None) -> Asset:
        resolution = validate_resolution(resolution_value)
        scale = validate_scale(scale_value)
        mode = validate_mode(mode_value)
        parent = self.resolve(image_id, conversation_id, reply_message_id)
        intermediate_width = parent.width * scale
        intermediate_height = parent.height * scale
        output_width, output_height = target_dimensions(parent.width, parent.height, scale, resolution)
        if intermediate_width * intermediate_height > self.max_output_pixels or output_width * output_height > self.max_output_pixels:
            raise ServiceError("image_output_limit_exceeded", status=413)
        selected_mode = parent.style_hint if mode == "auto" and parent.style_hint in {"realistic", "anime"} else "realistic" if mode == "auto" else mode
        image_id = f"img_{uuid.uuid4().hex}"
        created_at = utc_now()
        storage_key = f"derived/{created_at[:7].replace('-', '/')}/{image_id}.png"
        destination = self.path_for(storage_key)
        engine_scale = engine_scale_for_target(parent.width, parent.height, scale, (output_width, output_height))
        transform = {
            "operation": "upscale", "scale": scale, "mode": mode, "profile": selected_mode,
            "engine": self.engine.name,
            **({"engineScale": engine_scale} if engine_scale != scale else {}),
            **({"resolution": resolution} if resolution else {}),
        }
        origin = dict(parent.origin)
        if conversation_id:
            origin["conversationId"] = conversation_id
        if reply_message_id:
            origin["replyToMessageId"] = reply_message_id
        processing = Asset(image_id, "derived", "generated", created_at, "image/png", output_width, output_height, storage_key, 0, "", parent.image_id, transform, origin, selected_mode, "processing")
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO assets(image_id, kind, source_kind, created_at, mime_type, width, height, storage_key, byte_size, sha256, parent_image_id, transform_json, origin_json, style_hint, status, error_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (processing.image_id, processing.kind, processing.source_kind, processing.created_at, processing.mime_type, processing.width, processing.height, processing.storage_key, 0, "", processing.parent_image_id, json.dumps(processing.transform), json.dumps(processing.origin), processing.style_hint, processing.status, None),
            )
        source = self.path_for(parent.storage_key)
        acquired = self._semaphore.acquire(timeout=30)
        if not acquired:
            self._mark_failed(image_id, "upscale_busy")
            raise ServiceError("upscale_busy", status=429)
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=f".{image_id}.", suffix=".png", dir=destination.parent)
            os.close(fd)
            temporary_path = Path(temporary)
            try:
                self.engine.upscale(source, temporary_path, scale, selected_mode, (output_width, output_height))
                output = temporary_path.read_bytes()
                mime, width, height = inspect_image(output, "image/png")
                if (width, height) != (output_width, output_height):
                    from PIL import Image
                    with Image.open(temporary_path) as image:
                        resized = image.resize((output_width, output_height), Image.Resampling.LANCZOS)
                        resized.save(temporary_path, format="PNG", optimize=False)
                    output = temporary_path.read_bytes()
                    mime, width, height = inspect_image(output, "image/png")
                if (width, height) != (output_width, output_height):
                    raise ServiceError("upscale_dimensions_invalid", status=502)
                self._atomic_write(destination, source=temporary_path)
                digest = hashlib.sha256(output).hexdigest()
                with self._connect() as connection:
                    connection.execute("UPDATE assets SET mime_type = ?, width = ?, height = ?, byte_size = ?, sha256 = ?, status = 'ready', error_code = NULL WHERE image_id = ?", (mime, width, height, len(output), digest, image_id))
            finally:
                try:
                    temporary_path.unlink()
                except FileNotFoundError:
                    pass
        except ServiceError as exc:
            self._mark_failed(image_id, exc.code)
            raise
        except Exception as exc:
            self._mark_failed(image_id, "upscale_failed")
            raise ServiceError("upscale_failed", status=502, details={"engine": self.engine.name, "errorType": type(exc).__name__}) from exc
        finally:
            self._semaphore.release()
        return self.get(image_id)

    def _mark_failed(self, image_id: str, code: str) -> None:
        with self._connect() as connection:
            connection.execute("UPDATE assets SET status = 'failed', error_code = ? WHERE image_id = ?", (code, image_id))


def read_token(path: str) -> str:
    if not path:
        return ""
    try:
        value = Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return value


class Handler(BaseHTTPRequestHandler):
    store: AssetStore
    token: str
    server_version = "AmadeusImageService/1"

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _authorized(self) -> bool:
        if not self.token:
            return True
        header = self.headers.get("Authorization", "")
        return secrets.compare_digest(header, f"Bearer {self.token}")

    def _json(self, status: int, payload: Any) -> None:
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _error(self, error: Exception) -> None:
        if isinstance(error, ServiceError):
            payload = {"status": "error", "error": error.code}
            if error.details:
                payload["details"] = error.details
            self._json(error.status, payload)
        else:
            self._json(500, {"status": "error", "error": "internal_error"})

    def _body(self, limit: int) -> bytes:
        try:
            size = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            size = -1
        if size < 0 or size > limit:
            raise ServiceError("request_body_too_large", status=413)
        return self.rfile.read(size)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._json(200, {"status": "ok", "service": "amadeus-image-assets", "version": SERVICE_VERSION, "engine": self.store.engine.readiness()})
            return
        if not self._authorized():
            self._json(401, {"status": "error", "error": "unauthorized"})
            return
        match = re.fullmatch(r"/v1/assets/(img_[0-9a-f]{32})(?:/(metadata))?", parsed.path)
        if not match:
            self._json(404, {"status": "error", "error": "not_found"})
            return
        try:
            asset = self.store.get(match.group(1))
            if match.group(2) == "metadata":
                self._json(200, {"status": "ok", "asset": asset.public()})
                return
            data = self.store.path_for(asset.storage_key).read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", asset.mime_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "private, max-age=0, no-store")
            self.end_headers()
            self.wfile.write(data)
        except Exception as error:
            self._error(error)

    def do_POST(self) -> None:  # noqa: N802
        if not self._authorized():
            self._json(401, {"status": "error", "error": "unauthorized"})
            return
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/v1/assets/import":
                data = self._body(self.store.max_input_bytes)
                source_kind = self.headers.get("X-Amadeus-Source-Kind", "imported/manual")[:64]
                origin = parse_origin(self.headers.get("X-Amadeus-Origin"))
                asset = self.store.register(data, self.headers.get("Content-Type"), source_kind, origin, origin.get("styleHint"))
                self._json(201, {"status": "ok", "asset": asset.public()})
                return
            if parsed.path == "/v1/upscale":
                raw = self._body(64 * 1024)
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ServiceError("request_invalid", status=422)
                asset = self.store.upscale(payload.get("imageId"), payload.get("conversationId"), payload.get("replyMessageId"), payload.get("scale"), payload.get("mode"), payload.get("resolution"))
                self._json(201, {"status": "ok", "asset": asset.public()})
                return
            if parsed.path == "/v1/assets/bind-delivery":
                raw = self._body(64 * 1024)
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict) or not isinstance(payload.get("assetIds"), list) or not isinstance(payload.get("messageId"), str):
                    raise ServiceError("request_invalid", status=422)
                assets = self.store.bind_delivery([str(item) for item in payload["assetIds"]], payload["messageId"], payload.get("origin") if isinstance(payload.get("origin"), dict) else None)
                self._json(200, {"status": "ok", "assets": [asset.public() for asset in assets]})
                return
            self._json(404, {"status": "error", "error": "not_found"})
        except (ValueError, UnicodeDecodeError, binascii.Error) as error:
            self._error(ServiceError("request_invalid", status=422, details={"errorType": type(error).__name__}))
        except Exception as error:
            self._error(error)


def main() -> None:
    root = os.environ.get("AMADEUS_IMAGE_ASSET_ROOT", str(Path.home() / "Library/Application Support/Amadeus/ImageAssets/assets"))
    token_file = os.environ.get("AMADEUS_IMAGE_SERVICE_TOKEN_FILE", "")
    debug_startup(f"root={root}")
    engine = RealEsrganMlxEngine(
        weights_dir=os.environ.get("REALESRGAN_MLX_WEIGHTS_DIR") or None,
        # Tiled inference is required for large portrait 4x requests on Apple
        # unified memory. Operators can still override this with 0 or another
        # tile size through the host profile when benchmarking.
        tile=int(os.environ.get("AMADEUS_IMAGE_TILE", "256")),
    )
    store = AssetStore(
        root,
        engine=engine,
        max_input_bytes=int(os.environ.get("AMADEUS_IMAGE_MAX_INPUT_BYTES", str(24 * 1024 * 1024))),
        max_output_pixels=int(os.environ.get("AMADEUS_IMAGE_MAX_OUTPUT_PIXELS", str(8192 * 8192))),
        max_concurrency=int(os.environ.get("AMADEUS_IMAGE_MAX_CONCURRENCY", "1")),
        registry_path=os.environ.get("AMADEUS_IMAGE_REGISTRY_PATH") or None,
    )
    debug_startup(f"registry={store.db_path}")
    bind = os.environ.get("AMADEUS_IMAGE_SERVICE_BIND", "0.0.0.0")
    port = int(os.environ.get("AMADEUS_IMAGE_SERVICE_PORT", "18792"))
    debug_startup(f"binding={bind}:{port}")
    handler = type("AmadeusImageHandler", (Handler,), {"store": store, "token": read_token(token_file)})
    server = ThreadingHTTPServer((bind, port), handler)
    debug_startup("listening")
    server.daemon_threads = True
    server.serve_forever()


if __name__ == "__main__":
    main()
