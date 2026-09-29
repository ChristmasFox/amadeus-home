#!/usr/bin/env python3
"""Run the direct Qwen-Audio-TTS smoke matrix without the local fallback."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "apps/qwen3-tts-service"))
from kurisu_style import cloud_instruction, load_style

TARGET_MODEL = "qwen-audio-3.0-tts-flash"
DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
MAX_AUDIO = 12 * 1024 * 1024
# The provider may inline audio as base64, which expands the binary payload.
MAX_RESPONSE = (MAX_AUDIO * 4 + 2) // 3 + 64 * 1024
CASES = (("default", "mp3", "短い確認です。"), ("angry", "mp3", "どうしてそんなことをするの。"),
         ("soft", "wav", "無理をしないで、少し休んで。"), ("embarrassed", "wav", "べ、別に心配しているわけじゃないわ。"))


def protected_read(path: str | Path, name: str, minimum: int = 1, maximum: int = 4096) -> str:
    p = Path(path).expanduser(); st = p.lstat()
    if not p.is_file() or p.is_symlink() or st.st_mode & 0o077:
        raise RuntimeError(f"{name}_file_unprotected")
    value = p.read_text(encoding="utf-8").strip()
    if not minimum <= len(value) <= maximum:
        raise RuntimeError(f"{name}_invalid")
    return value


def endpoint_ok(value: str) -> str:
    parsed = urlparse(value); host = (parsed.hostname or "").lower()
    allowed = host in {"dashscope.aliyuncs.com", "maas.qianwenaiapi.com"} or host.endswith(".maas.aliyuncs.com")
    if parsed.scheme != "https" or not allowed or parsed.path != "/api/v1/services/audio/tts/SpeechSynthesizer":
        raise RuntimeError("invalid_qwen_tts_endpoint")
    return value


def valid_audio(raw: bytes, fmt: str) -> bool:
    if len(raw) < 64 or len(raw) > MAX_AUDIO: return False
    if fmt == "wav": return raw[:4] == b"RIFF" and raw[8:12] == b"WAVE"
    if fmt == "opus": return raw[:4] == b"OggS"
    return raw[:3] == b"ID3" or (raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0)


def request_json(endpoint: str, key: str, payload: dict) -> tuple[int, dict, str | None]:
    req = Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode(), method="POST",
                  headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urlopen(req, timeout=100) as response:
            body = json.loads(response.read(MAX_RESPONSE).decode())
            return response.status, body, response.headers.get("x-request-id")
    except HTTPError as exc:
        try: body = json.loads(exc.read(MAX_RESPONSE).decode())
        except Exception: body = {}
        return exc.code, body, exc.headers.get("x-request-id")
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("qwen_tts_network_failure") from exc


def audio_from_response(payload: dict, fmt: str) -> bytes:
    audio = payload.get("output", {}).get("audio", {})
    encoded = audio.get("data")
    if isinstance(encoded, str) and encoded:
        raw = base64.b64decode(encoded, validate=True)
    else:
        output_url = audio.get("url")
        if not isinstance(output_url, str): raise RuntimeError("qwen_tts_audio_missing")
        parsed = urlparse(output_url); host = (parsed.hostname or "").lower()
        if parsed.scheme not in {"http", "https"} or not (host.endswith(".aliyuncs.com") or host.endswith(".alicdn.com")):
            raise RuntimeError("qwen_tts_audio_url_invalid")
        if parsed.scheme == "http":
            parsed = parsed._replace(scheme="https")
            output_url = urlunparse(parsed)
        with urlopen(Request(output_url, method="GET"), timeout=100) as response:
            raw = response.read(MAX_AUDIO + 1)
    if not valid_audio(raw, fmt): raise RuntimeError("qwen_tts_audio_invalid")
    return raw


def duration_seconds(raw: bytes, fmt: str) -> float | None:
    suffix = ".wav" if fmt == "wav" else ".mp3"
    with tempfile.NamedTemporaryFile(prefix="amadeus-qwen-smoke-", suffix=suffix, delete=True) as handle:
        handle.write(raw); handle.flush()
        try:
            value = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", handle.name], text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
            return round(float(value), 3)
        except (OSError, subprocess.SubprocessError, ValueError):
            return None


def write_evidence(path: Path, rows: list[dict]) -> None:
    path = path.expanduser()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    parent_stat = path.parent.lstat()
    if not path.parent.is_dir() or path.parent.is_symlink() or parent_stat.st_mode & 0o077:
        raise RuntimeError("evidence_parent_unprotected")
    if os.path.lexists(str(path)):
        existing = path.lstat()
        if path.is_symlink() or not path.is_file() or existing.st_mode & 0o077:
            raise RuntimeError("evidence_file_unprotected")
    payload = json.dumps({"schemaVersion": 1, "model": TARGET_MODEL, "cases": rows, "createdAt": int(time.time())}, indent=2) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent), text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(temporary, path)
        path.chmod(0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--endpoint", default=os.environ.get("AMADEUS_TTS_CLOUD_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--api-key-file")
    parser.add_argument("--voice-id-file")
    parser.add_argument("--evidence-file")
    args = parser.parse_args()
    endpoint = endpoint_ok(args.endpoint)
    if not args.apply:
        print("MODE=dry-run; no cloud synthesis, audio download or evidence write")
        print("TARGET_MODEL=" + TARGET_MODEL)
        print("CASES=default,angry,soft,embarrassed; formats=mp3,wav")
        return
    for name in ("api_key_file", "voice_id_file", "evidence_file"):
        if not getattr(args, name): parser.error(f"--apply requires --{name.replace('_', '-')}")
    key = protected_read(args.api_key_file, "qwen_tts_api_key", minimum=20)
    voice = protected_read(args.voice_id_file, "qwen_tts_voice_id", minimum=8, maximum=256)
    style = load_style()
    rows = []
    for emotion, fmt, text in CASES:
        started = time.monotonic()
        payload = {"model": TARGET_MODEL, "input": {"text": text, "voice": voice, "format": fmt, "sample_rate": 24000, "language_hints": ["ja"], "instruction": cloud_instruction(style, emotion)}}
        status, result, request_id = request_json(endpoint, key, payload)
        if status != 200: raise RuntimeError(f"qwen_tts_smoke_http_{status}")
        raw = audio_from_response(result, fmt)
        rows.append({"emotion": emotion, "format": fmt, "status": status, "requestIdSha256": hashlib.sha256((request_id or "").encode()).hexdigest() if request_id else None, "bytes": len(raw), "audioSha256": hashlib.sha256(raw).hexdigest(), "durationSeconds": duration_seconds(raw, fmt), "totalMs": round((time.monotonic() - started) * 1000, 1)})
    write_evidence(Path(args.evidence_file).expanduser(), rows)
    print("CLOUD_SMOKE=passed")
    print("CASES=4")
    print("EVIDENCE=protected")


if __name__ == "__main__":
    main()
