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
import secrets
import signal
import socket
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
MAX_OUTPUT_PIXELS = 1024 * 1024
MAX_OUTPUT_EDGE = 1_024
GENERATION_TIMEOUT_SECONDS = 900
LOAD_TIMEOUT_SECONDS = 600
QUALITY_SAMPLING_PROFILE = "baseline-16step"
QUALITY_STEPS = 16
QUALITY_CFG_SCALE = 1.0
QUEUE_WAIT_SECONDS = 5
ALLOWED_MIME = {"image/png", "image/jpeg", "image/webp"}
MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
FUN_ACC_PROFILE = "fun-acc-4step"
FUN_ACC_SIGMAS = [1.0, 0.9169867038726807, 0.7861579060554504, 0.5494909882545471, 0.0]
FUN_ACC_SOURCE_REPOSITORY = "alibaba-pai/Qwen-Image-2.1-Fun-Acc-LoRAs"
FUN_ACC_SOURCE_REVISION = "f7545234760e1847cd8e89e52bd951cb0b7e327f"
FUN_ACC_CONVERTER_REVISION = "qwen-fun-acc-sdcpp-v1"
FUN_ACC_FORMAT = "qwen_image_2_1_fun_acc_sdcpp_v1"
SERVICE_PORTS = (18793, 18795)
ALLOWED_PROFILES = {"quality", "fast"}
ALLOWED_RESOLUTIONS = {"1024x1024", "1024x768", "768x1024"}
SIZE_RE = re.compile(r"^(\d{2,5})x(\d{2,5})$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class ConfigError(RuntimeError):
    pass


def expand_runtime_references(value: object) -> object:
    """Expand private path references when a template is loaded directly.

    The Mac manager normally renders templates before installation.  Keeping
    this fallback here makes direct operator launches explicit while an
    unresolved public checkout fails closed.
    """
    if isinstance(value, dict):
        return {key: expand_runtime_references(item) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_runtime_references(item) for item in value]
    if not isinstance(value, str):
        return value
    result = value
    for name in (
        "QWEN_IMAGE_ASSET_ROOT", "QWEN_IMAGE_SD_CPP_SOURCE", "QWEN_IMAGE_SD_CPP_BINARY",
        "QWEN_IMAGE_LOG_DIR", "QWEN_IMAGE_FUN_ACC_CONVERTER", "QWEN_IMAGE_SD_CPP_PATCH",
    ):
        marker = "${" + name + "}"
        if marker in result:
            replacement = os.environ.get(name, "").strip()
            if not replacement:
                raise ConfigError("qwen_runtime_config_missing")
            result = result.replace(marker, replacement)
    if "${QWEN_IMAGE_" in result:
        raise ConfigError("qwen_runtime_config_invalid")
    return result


def ensure_internal_port_available(port: int) -> None:
    """Fail closed instead of treating another sd-server's health as ours."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", int(port)))
    except OSError as error:
        raise ConfigError("qwen_internal_port_in_use") from error


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
    data = expand_runtime_references(json.loads(path.read_text(encoding="utf-8")))
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
    sampling_profile = data.get("samplingProfile", QUALITY_SAMPLING_PROFILE)
    if sampling_profile not in {QUALITY_SAMPLING_PROFILE, FUN_ACC_PROFILE}:
        raise ConfigError("qwen_engine_sampling_profile")
    if data.get("flashAttentionMode") not in {None, "full", "diffusion", "off"}:
        raise ConfigError("qwen_engine_flash_attention_mode")
    if data.get("prefixCacheType") not in {None, "q8_0", "auto"}:
        raise ConfigError("qwen_engine_prefix_cache_type")
    if (data["servicePort"], data["internalPort"]) != SERVICE_PORTS:
        raise ConfigError("qwen_engine_port_policy")
    if (data["generationDeadlineMs"] != GENERATION_TIMEOUT_SECONDS * 1_000 or
            data["loadTimeoutMs"] != LOAD_TIMEOUT_SECONDS * 1_000):
        raise ConfigError("qwen_engine_timeout_policy")
    if sampling_profile == FUN_ACC_PROFILE:
        fun_acc_required = {"customSigmas", "prefixCacheType", "mmap", "flashAttention", "funAcc", "sdCppPatch"}
        if not fun_acc_required.issubset(data):
            raise ConfigError("qwen_fun_acc_config_incomplete")
        if data["steps"] != 4 or float(data["cfgScale"]) != 1.0 or data["customSigmas"] != FUN_ACC_SIGMAS:
            raise ConfigError("qwen_fun_acc_sampling_policy")
        if data["prefixCacheType"] not in {"q8_0", "auto"} or not isinstance(data["mmap"], bool) or data["flashAttention"] is not True:
            raise ConfigError("qwen_fun_acc_acceleration_policy")
        if data["idleShutdownSeconds"] != 900 or data["defaultGenerationSize"] != "1024x1024":
            raise ConfigError("qwen_fun_acc_size_or_idle_policy")
        if data["maxOutputPixels"] != MAX_OUTPUT_PIXELS or data["maxOutputEdge"] != MAX_OUTPUT_EDGE:
            raise ConfigError("qwen_engine_geometry_policy")
        fun_acc = data["funAcc"]
        fun_acc_fields = {
            "enabled", "sourceRepository", "sourceRevision", "sourcePath", "sourceSha256", "sourceBytes",
            "configPath", "configSha256", "configBytes", "converterRevision", "converterPath",
            "converterSha256", "converterBytes", "adapterPath", "adapterSha256", "adapterBytes",
            "manifestPath", "manifestSha256", "manifestBytes", "loraGroups", "fullParameterCount",
            "pddBlockSize", "pddNumSteps", "pddHeadCount",
        }
        if not isinstance(fun_acc, dict) or not fun_acc_fields.issubset(fun_acc):
            raise ConfigError("qwen_fun_acc_artifacts_incomplete")
        if (fun_acc["enabled"] is not True or fun_acc["sourceRepository"] != FUN_ACC_SOURCE_REPOSITORY or
                fun_acc["sourceRevision"] != FUN_ACC_SOURCE_REVISION or
                fun_acc["converterRevision"] != FUN_ACC_CONVERTER_REVISION or
                fun_acc["loraGroups"] != 231 or fun_acc["fullParameterCount"] != 65 or
                fun_acc["pddBlockSize"] != 1 or fun_acc["pddNumSteps"] != 4 or fun_acc["pddHeadCount"] != 4):
            raise ConfigError("qwen_fun_acc_artifact_policy")
        for key in ("sourceSha256", "configSha256", "converterSha256", "adapterSha256", "manifestSha256"):
            if not isinstance(fun_acc[key], str) or not SHA256_RE.fullmatch(fun_acc[key]):
                raise ConfigError(f"qwen_fun_acc_hash_invalid:{key}")
        for key in ("sourceBytes", "configBytes", "converterBytes", "adapterBytes", "manifestBytes"):
            if not isinstance(fun_acc[key], int) or fun_acc[key] < 1:
                raise ConfigError(f"qwen_fun_acc_size_invalid:{key}")
        patch = data["sdCppPatch"]
        if not isinstance(patch, dict) or not {"path", "sha256", "bytes"}.issubset(patch):
            raise ConfigError("qwen_sd_cpp_patch_incomplete")
        if not isinstance(patch["sha256"], str) or not SHA256_RE.fullmatch(patch["sha256"]):
            raise ConfigError("qwen_sd_cpp_patch_hash_invalid")
        if not isinstance(patch["bytes"], int) or patch["bytes"] < 1:
            raise ConfigError("qwen_sd_cpp_patch_size_invalid")
    else:
        if data["steps"] != QUALITY_STEPS or float(data["cfgScale"]) != QUALITY_CFG_SCALE:
            raise ConfigError("qwen_engine_sampling_policy")
        if data["maxOutputPixels"] != MAX_OUTPUT_PIXELS or data["maxOutputEdge"] != MAX_OUTPUT_EDGE:
            raise ConfigError("qwen_engine_geometry_policy")
    for field in ("diffusionModelPath", "llmPath", "visionPath", "vaePath", "sdCppBinary"):
        asset_path = Path(data[field])
        if not asset_path.is_absolute() or asset_path.is_symlink() or not asset_path.is_file():
            raise ConfigError(f"qwen_asset_missing:{field}")
    for field in ("diffusionModelRevision", "llmRevision", "visionRevision", "vaeRevision"):
        if not COMMIT_RE.fullmatch(data[field]):
            raise ConfigError(f"qwen_revision_invalid:{field}")
    if not COMMIT_RE.fullmatch(data["sdCppCommit"]):
        raise ConfigError("qwen_sd_cpp_commit_invalid")
    for field in ("diffusionModelSha256", "llmSha256", "visionSha256", "vaeSha256", "sdCppBinarySha256"):
        if not SHA256_RE.fullmatch(data[field]):
            raise ConfigError(f"qwen_hash_invalid:{field}")
    expected_size = "1024x1024"
    if data["defaultGenerationSize"] != expected_size:
        raise ConfigError("qwen_default_size_policy")
    if sampling_profile == FUN_ACC_PROFILE:
        for key in ("sourcePath", "configPath", "converterPath", "adapterPath", "manifestPath"):
            asset_path = Path(data["funAcc"][key])
            if not asset_path.is_absolute() or asset_path.is_symlink() or not asset_path.is_file():
                raise ConfigError(f"qwen_fun_acc_asset_missing:{key}")
        patch_path = Path(data["sdCppPatch"]["path"])
        if not patch_path.is_absolute() or patch_path.is_symlink() or not patch_path.is_file():
            raise ConfigError("qwen_sd_cpp_patch_missing")
    return data


def verify_runtime_and_assets(config: dict, verified_assets: set[tuple[str, str, int]] | None = None) -> None:
    verified_assets = verified_assets if verified_assets is not None else set()
    for path_key, hash_key, bytes_key in (
        ("diffusionModelPath", "diffusionModelSha256", "diffusionModelBytes"),
        ("llmPath", "llmSha256", "llmBytes"),
        ("visionPath", "visionSha256", "visionBytes"),
        ("vaePath", "vaeSha256", "vaeBytes"),
        ("sdCppBinary", "sdCppBinarySha256", "sdCppBinaryBytes"),
    ):
        marker = (config[path_key], config[hash_key], int(config[bytes_key]))
        if marker not in verified_assets:
            verify_hash(Path(config[path_key]), config[hash_key], int(config[bytes_key]))
            verified_assets.add(marker)
    result = subprocess.run(
        ["git", "-C", config["sdCppSourcePath"], "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.stdout.strip() != config["sdCppCommit"]:
        raise ConfigError("qwen_sd_cpp_revision_mismatch")
    if config.get("samplingProfile") == FUN_ACC_PROFILE:
        fun_acc = config["funAcc"]
        for path_key, hash_key, bytes_key in (
            ("sourcePath", "sourceSha256", "sourceBytes"),
            ("configPath", "configSha256", "configBytes"),
            ("converterPath", "converterSha256", "converterBytes"),
            ("adapterPath", "adapterSha256", "adapterBytes"),
            ("manifestPath", "manifestSha256", "manifestBytes"),
        ):
            marker = (fun_acc[path_key], fun_acc[hash_key], int(fun_acc[bytes_key]))
            if marker not in verified_assets:
                verify_hash(Path(fun_acc[path_key]), fun_acc[hash_key], int(fun_acc[bytes_key]))
                verified_assets.add(marker)
        patch = config["sdCppPatch"]
        marker = (patch["path"], patch["sha256"], int(patch["bytes"]))
        if marker not in verified_assets:
            verify_hash(Path(patch["path"]), patch["sha256"], int(patch["bytes"]))
            verified_assets.add(marker)
        try:
            manifest = json.loads(Path(fun_acc["manifestPath"]).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ConfigError("qwen_fun_acc_manifest_invalid") from error
        expected_manifest = {
            "format": FUN_ACC_FORMAT,
            "sourceRepository": fun_acc["sourceRepository"],
            "sourceRevision": fun_acc["sourceRevision"],
            "sourceSha256": fun_acc["sourceSha256"],
            "sourceBytes": fun_acc["sourceBytes"],
            "pddConfigSha256": fun_acc["configSha256"],
            "pddConfigBytes": fun_acc["configBytes"],
            "converterRevision": fun_acc["converterRevision"],
            "converterSha256": fun_acc["converterSha256"],
            "outputSha256": fun_acc["adapterSha256"],
            "outputBytes": fun_acc["adapterBytes"],
            "customSigmas": config["customSigmas"],
            "pddBlockSize": fun_acc["pddBlockSize"],
            "pddNumSteps": fun_acc["pddNumSteps"],
            "pddHeadCount": fun_acc["pddHeadCount"],
            "loraGroups": fun_acc["loraGroups"],
            "fullParameterCount": fun_acc["fullParameterCount"],
        }
        if any(manifest.get(key) != value for key, value in expected_manifest.items()):
            raise ConfigError("qwen_fun_acc_manifest_mismatch")


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


def parse_size(value: str, max_pixels: int = MAX_OUTPUT_PIXELS, max_edge: int = MAX_OUTPUT_EDGE) -> tuple[int, int] | None:
    match = SIZE_RE.fullmatch(value)
    if not match:
        return None
    width, height = int(match.group(1)), int(match.group(2))
    if width < 32 or height < 32 or width % 32 or height % 32 or width * height > max_pixels or max(width, height) > max_edge:
        return None
    return width, height


def parse_seed(value: object) -> int:
    if type(value) is not int or value < -1 or value > (1 << 63) - 1:
        raise ValueError("seed_invalid")
    return value


def parse_multipart(content_type: str, body: bytes, max_pixels: int = MAX_OUTPUT_PIXELS, max_edge: int = MAX_OUTPUT_EDGE) -> dict:
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
            if name not in {"model", "prompt", "profile", "resolution", "seed", "n", "output_format"}:
                raise ValueError("edit_field_unsupported")
            fields.setdefault(name, []).append(payload)
    if any(len(values) != 1 for values in fields.values()) or len(files) != 1 or not {"prompt", "profile", "resolution", "seed"}.issubset(fields):
        raise ValueError("edit_contract_invalid")
    try:
        prompt = fields["prompt"][0].decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise ValueError("edit_prompt_invalid") from exc
    if (not prompt or len(prompt) > MAX_PROMPT_CHARS or "<sd_cpp_extra_args>" in prompt or
            "</sd_cpp_extra_args>" in prompt):
        raise ValueError("edit_prompt_invalid")
    try:
        profile = fields["profile"][0].decode("ascii").strip()
        resolution = fields["resolution"][0].decode("ascii").strip()
        seed_value = int(fields["seed"][0].decode("ascii").strip())
        seed = parse_seed(seed_value)
    except (UnicodeDecodeError, ValueError) as exc:
        raise ValueError("edit_profile_resolution_or_seed_invalid") from exc
    if profile not in ALLOWED_PROFILES:
        raise ValueError("edit_profile_unsupported")
    if "model" in fields and fields["model"][0].decode("utf-8", errors="strict").strip() not in {MODEL_ID, "sd-cpp-local"}:
        raise ValueError("edit_model_unsupported")
    if "n" in fields and fields["n"][0].strip() != b"1":
        raise ValueError("edit_count_unsupported")
    if "output_format" in fields and fields["output_format"][0].strip().lower() not in {b"png", b"jpeg"}:
        raise ValueError("edit_output_format_unsupported")
    image = files[0]
    dimensions = image_dimensions(image["bytes"], image["mime"])
    if dimensions is None:
        raise ValueError("edit_image_dimensions_invalid")
    if resolution == "auto":
        resolution = derived_edit_size(*dimensions, max_pixels, max_edge) or f"{dimensions[0]}x{dimensions[1]}"
    elif resolution not in ALLOWED_RESOLUTIONS:
        raise ValueError("edit_resolution_unsupported")
    if parse_size(resolution, max_pixels, max_edge) is None:
        raise ValueError("edit_resolution_unsupported")
    fields_out = [("model", b"sd-cpp-local")]
    fields_out.extend((name, values[0]) for name, values in fields.items() if name not in {"model", "prompt", "profile", "resolution", "seed", "n"})
    fields_out.extend([("prompt", prompt.encode("utf-8")), ("n", b"1")])
    fields_out.extend([("size", resolution.encode("ascii"))])
    return {"boundary": boundary, "fields": fields_out, "image": image, "profile": profile, "resolution": resolution, "seed": seed}


def profile_prompt(prompt: str, config: dict, editing: bool = False, seed: int = -1) -> str:
    if "<sd_cpp_extra_args>" in prompt or "</sd_cpp_extra_args>" in prompt:
        raise ValueError("prompt_extra_args_marker_rejected")
    extra: dict = {"seed": parse_seed(seed)}
    if config.get("samplingProfile") == FUN_ACC_PROFILE:
        extra.update({
            "lora": [{"path": config["funAcc"]["adapterPath"], "multiplier": 1.0}],
            "sample_params": {
                "sample_steps": 4,
                "custom_sigmas": config["customSigmas"],
            },
        })
    if editing:
        extra["strength"] = 1.0
    return prompt + " <sd_cpp_extra_args>" + json.dumps(extra, separators=(",", ":")) + "</sd_cpp_extra_args>"

def build_multipart(payload: dict, prompt_override: str | None = None) -> tuple[str, bytes]:
    boundary = "qwen-" + os.urandom(18).hex()
    marker = boundary.encode("ascii")
    output = bytearray()
    for name, value in payload["fields"]:
        if name == "prompt" and prompt_override is not None:
            value = prompt_override.encode("utf-8")
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
    def __init__(self, profiles: dict[str, dict], token: str, token_path: Path):
        if set(profiles) != ALLOWED_PROFILES:
            raise ConfigError("qwen_profile_set_invalid")
        if profiles["quality"].get("samplingProfile", QUALITY_SAMPLING_PROFILE) != QUALITY_SAMPLING_PROFILE:
            raise ConfigError("qwen_quality_profile_invalid")
        if profiles["fast"].get("samplingProfile") != FUN_ACC_PROFILE:
            raise ConfigError("qwen_fast_profile_invalid")
        if any((config["servicePort"], config["internalPort"]) != SERVICE_PORTS for config in profiles.values()):
            raise ConfigError("qwen_profile_ports_mismatch")
        self.profiles = profiles
        self.config = profiles["quality"]
        self.active_profile = "none"
        self.active_config: dict | None = None
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
                self.active_config = None
                self.active_profile = "none"
            profile = self.active_profile if running else "none"
            config = self.active_config if running else self.config
        health = {
            "status": "ready",
            "service": "amadeus-qwen-image",
            "version": SERVICE_VERSION,
            "model": MODEL_ID,
            "runtime": "stable-diffusion.cpp-metal",
            "sdCppCommit": config["sdCppCommit"],
            "state": "running" if running else "idle",
            "activeProfile": profile,
            "availableProfiles": ["quality", "fast"],
            "generationConcurrency": 1,
            "queueCapacity": 1,
            "deadlineMs": config["generationDeadlineMs"],
            "referenceEdits": True,
        }
        if profile == "fast":
            health.update({
                "samplingProfile": FUN_ACC_PROFILE,
                "steps": 4,
                "cfgScale": 1.0,
                "customSigmas": config["customSigmas"],
                "prefixCacheType": config["prefixCacheType"],
                "mmap": config["mmap"],
                "flashAttention": config["flashAttention"],
            })
        elif profile == "quality":
            flash_mode = config.get("flashAttentionMode")
            flash_argument = "--fa" if flash_mode == "full" else "--diffusion-fa" if flash_mode == "diffusion" or (flash_mode is None and config.get("flashAttention", True)) else None
            health.update({
                "samplingProfile": QUALITY_SAMPLING_PROFILE,
                "steps": QUALITY_STEPS,
                "cfgScale": QUALITY_CFG_SCALE,
                "flashAttentionArgument": flash_argument,
                "prefixCacheType": config.get("prefixCacheType", "disabled"),
            })
        return health

    def _stop_locked(self) -> None:
        child = self.child
        self.child = None
        self.active_config = None
        self.active_profile = "none"
        if child is not None and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=15)
            except Exception:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except Exception:
                    pass

    def start(self, profile: str) -> None:
        if profile not in ALLOWED_PROFILES:
            raise ConfigError("qwen_profile_unsupported")
        config = self.profiles[profile]
        with self.lock:
            if self.child is not None and self.child.poll() is None and self.active_profile == profile:
                return
            self._stop_locked()
            ensure_internal_port_available(int(config["internalPort"]))
            args = [
                config["sdCppBinary"],
                "--diffusion-model", config["diffusionModelPath"],
                "--llm", config["llmPath"],
                "--llm_vision", config["visionPath"],
                "--vae", config["vaePath"],
                "--listen-ip", "127.0.0.1",
                "--listen-port", str(config["internalPort"]),
                "--backend", config["backend"],
                "--steps", str(config["steps"]),
                "--cfg-scale", str(config["cfgScale"]),
            ]
            flash_mode = config.get("flashAttentionMode")
            if flash_mode == "full":
                args.append("--fa")
            elif flash_mode == "diffusion" or (flash_mode is None and config.get("flashAttention", True)):
                args.append("--diffusion-fa")
            if config.get("mmap", False):
                args.append("--mmap")
            model_args = []
            if config.get("samplingProfile") == FUN_ACC_PROFILE:
                model_args.append("qwen_image_2_1_fun_acc_pdd=true")
            if config.get("prefixCacheType"):
                model_args.extend([
                    "qwen_image_2_1_prefix_cache=true",
                    "qwen_image_2_1_prefix_cache_type=" + config["prefixCacheType"],
                ])
            if model_args:
                args.extend(["--model-args", ",".join(model_args)])
            args.extend(["--log-level", "info" if profile == "fast" else "error"])
            log_dir = Path(config["logDir"])
            log_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
            log_path = log_dir / "sd-server.log"
            log_path.touch(mode=0o600, exist_ok=True)
            os.chmod(log_path, 0o600)
            with log_path.open("ab") as log:
                child = subprocess.Popen(args, stdout=log, stderr=log, start_new_session=True)
            self.child = child
            self.active_config = config
            self.active_profile = profile
        deadline = time.monotonic() + int(config["loadTimeoutMs"]) / 1000
        while time.monotonic() < deadline:
            if child.poll() is not None:
                self.stop()
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
            self._stop_locked()

    def _idle_monitor(self) -> None:
        while not self.stop_event.wait(15):
            with self.lock:
                running = self.child is not None and self.child.poll() is None
                config = self.active_config
                expired = running and config is not None and time.monotonic() - self.last_activity > int(config["idleShutdownSeconds"])
            if expired and self.active_generation.acquire(blocking=False):
                try:
                    with self.lock:
                        still_expired = (
                            self.child is not None
                            and self.active_config is not None
                            and time.monotonic() - self.last_activity > int(self.active_config["idleShutdownSeconds"])
                        )
                        if still_expired:
                            self._stop_locked()
                finally:
                    self.active_generation.release()

    def close(self) -> None:
        self.stop_event.set()
        self.stop()

    def ensure_ready(self, profile: str) -> None:
        with self.lock:
            ready = self.child is not None and self.child.poll() is None and self.active_profile == profile
        if not ready:
            self.start(profile)
        self.last_activity = time.monotonic()

    def _request(self, path: str, body: bytes, content_type: str, profile: str, resolution: str, seed: int) -> tuple[int, bytes]:
        config = self.profiles[profile]
        if not self.slots.acquire(timeout=float(config.get("queueWaitSeconds", QUEUE_WAIT_SECONDS))):
            return 429, safe_failure(429, "qwen_busy")
        try:
            with self.active_generation:
                self.ensure_ready(profile)
                req = request.Request(
                    self.internal_url + path,
                    data=body,
                    method="POST",
                    headers={"Content-Type": content_type},
                )
                try:
                    with request.urlopen(req, timeout=int(config["generationDeadlineMs"]) / 1000) as response:
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
                    mime = detect_mime(image_bytes)
                    if mime is None:
                        raise ValueError("response_image_mime")
                    dimensions = image_dimensions(image_bytes, mime)
                    expected_dimensions = parse_size(
                        resolution,
                        int(config["maxOutputPixels"]),
                        int(config["maxOutputEdge"]),
                    )
                    if dimensions is None or dimensions != expected_dimensions or parse_size(
                            f"{dimensions[0]}x{dimensions[1]}",
                            int(config["maxOutputPixels"]),
                            int(config["maxOutputEdge"])) is None:
                        raise ValueError("response_image_geometry")
                except (ValueError, TypeError, KeyError, binascii.Error, json.JSONDecodeError):
                    return 502, safe_failure(502, "qwen_output_invalid")
                self.last_activity = time.monotonic()
                return 200, json_bytes({
                    "created": parsed.get("created", int(time.time())),
                    "data": [{"b64_json": items[0]["b64_json"]}],
                    "model": MODEL_ID,
                    "seed": seed,
                })
        except (ConfigError, TimeoutError):
            self.stop()
            return 503, safe_failure(503, "qwen_runtime_unavailable")
        finally:
            self.slots.release()

    @staticmethod
    def _effective_seed(value: object) -> int:
        seed = parse_seed(value)
        return secrets.randbelow(1 << 63) if seed == -1 else seed

    def generate(self, payload: dict) -> tuple[int, bytes]:
        if not isinstance(payload, dict) or set(payload) - {"model", "prompt", "n", "profile", "resolution", "seed"}:
            return 400, safe_failure(400, "qwen_request_invalid")
        prompt = payload.get("prompt")
        profile = payload.get("profile")
        resolution = payload.get("resolution")
        try:
            seed = self._effective_seed(payload.get("seed"))
        except ValueError:
            return 400, safe_failure(400, "qwen_seed_invalid")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            return 400, safe_failure(400, "qwen_prompt_invalid")
        if "<sd_cpp_extra_args>" in prompt or "</sd_cpp_extra_args>" in prompt:
            return 400, safe_failure(400, "qwen_prompt_invalid")
        if profile not in ALLOWED_PROFILES:
            return 400, safe_failure(400, "qwen_profile_unsupported")
        if not isinstance(resolution, str) or resolution not in ALLOWED_RESOLUTIONS:
            return 400, safe_failure(400, "qwen_resolution_unsupported")
        config = self.profiles[profile]
        if parse_size(resolution, int(config["maxOutputPixels"]), int(config["maxOutputEdge"])) is None:
            return 400, safe_failure(400, "qwen_resolution_unsupported")
        if payload.get("model", MODEL_ID) not in {MODEL_ID, "sd-cpp-local"} or payload.get("n", 1) != 1:
            return 400, safe_failure(400, "qwen_request_invalid")
        body = json_bytes({
            "model": "sd-cpp-local",
            "prompt": profile_prompt(prompt.strip(), config, seed=seed),
            "n": 1,
            "size": resolution,
            "output_format": "png",
        })
        return self._request("/v1/images/generations", body, "application/json", profile, resolution, seed)

    def edit(self, content_type: str, body: bytes) -> tuple[int, bytes]:
        try:
            payload = parse_multipart(content_type, body)
            profile = payload["profile"]
            config = self.profiles[profile]
            seed = self._effective_seed(payload["seed"])
            prompt = next(value.decode("utf-8") for name, value in payload["fields"] if name == "prompt")
            proxied_type, proxied_body = build_multipart(
                payload,
                profile_prompt(prompt, config, editing=True, seed=seed),
            )
        except (ValueError, UnicodeError, KeyError):
            return 400, safe_failure(400, "qwen_edit_request_invalid")
        if len(proxied_body) > MAX_BODY_BYTES + 4096:
            return 413, safe_failure(413, "qwen_edit_body_too_large")
        return self._request("/v1/images/edits", proxied_body, proxied_type, profile, payload["resolution"], seed)


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
    parser.add_argument("--quality-config", required=True)
    parser.add_argument("--fast-config", required=True)
    parser.add_argument("--token-file", required=True)
    args = parser.parse_args()
    profiles = {
        "quality": load_config(Path(args.quality_config)),
        "fast": load_config(Path(args.fast_config)),
    }
    verified_assets: set[tuple[str, str, int]] = set()
    for config in profiles.values():
        verify_runtime_and_assets(config, verified_assets)
    token = private_token(Path(args.token_file))
    bridge = QwenBridge(profiles, token, Path(args.token_file))
    bridge.monitor.start()
    server = QwenHTTPServer(("127.0.0.1", bridge.service_port), bridge)

    def stop_on_sigterm(_signum, _frame) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, stop_on_sigterm)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        bridge.close()


if __name__ == "__main__":
    main()
