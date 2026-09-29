#!/usr/bin/env python3
"""Authenticated OpenAI-compatible boundary for the Kurisu GPT-SoVITS MPS runtime."""
from __future__ import annotations

from dataclasses import dataclass
import hmac
import http.server
import json
import os
from pathlib import Path
import subprocess
import threading
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


MODEL_ID = "gpt-sovits-v2pro-mps"
MODEL_ALIASES = frozenset({"amadeus-tts", MODEL_ID, "gpt-sovits-v2pro"})
VOICE_ID = "kurisu-v1"
MAX_TEXT = 1200
MAX_BODY = 8192
MAX_AUDIO = 12 * 1024 * 1024
DEFAULT_PORT = 19871
DEFAULT_TIMEOUT_SECONDS = 55
DEFAULT_PROMPT = "からあげのことはどうでもいい今は電話レンジに何が起きたのか解析するのが先"
MIME_BY_FORMAT = {"wav": "audio/wav", "mp3": "audio/mpeg", "opus": "audio/ogg"}
SUPPORTED_FORMATS = frozenset(MIME_BY_FORMAT)
ALLOWED_FIELDS = frozenset({"model", "voice", "input", "response_format", "style", "language"})


@dataclass(frozen=True)
class AdapterConfig:
    token: str
    upstream_url: str
    reference_audio: Path
    prompt_text: str
    ffmpeg_path: str = "ffmpeg"
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS


def _read_secret(path: Path) -> str:
    stat = path.lstat()
    if not path.is_file() or path.is_symlink() or stat.st_mode & 0o077:
        raise RuntimeError("token_file_unprotected")
    value = path.read_text(encoding="utf-8").strip()
    if not value or len(value) < 32 or len(value) > 4096:
        raise RuntimeError("token_invalid")
    return value


def _validate_reference(path: Path) -> None:
    stat = path.lstat()
    if not path.is_file() or path.is_symlink() or not stat.st_size:
        raise RuntimeError("reference_audio_invalid")


def _validate_upstream(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.path != "/tts":
        raise RuntimeError("upstream_url_invalid")


def load_config_from_env() -> AdapterConfig:
    token_file = Path(os.environ.get("AMADEUS_GPT_SOVITS_TTS_TOKEN_FILE", ""))
    reference_audio = Path(os.environ.get("AMADEUS_GPT_SOVITS_REFERENCE_AUDIO", ""))
    upstream_url = os.environ.get("AMADEUS_GPT_SOVITS_UPSTREAM_URL", "http://127.0.0.1:19870/tts")
    prompt_text = os.environ.get("AMADEUS_GPT_SOVITS_PROMPT_TEXT", DEFAULT_PROMPT).strip()
    _validate_upstream(upstream_url)
    _validate_reference(reference_audio)
    if not prompt_text or len(prompt_text) > 512:
        raise RuntimeError("prompt_text_invalid")
    timeout = float(os.environ.get("AMADEUS_GPT_SOVITS_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    if timeout <= 0 or timeout > 120:
        raise RuntimeError("timeout_invalid")
    return AdapterConfig(
        token=_read_secret(token_file),
        upstream_url=upstream_url,
        reference_audio=reference_audio,
        prompt_text=prompt_text,
        ffmpeg_path=os.environ.get("AMADEUS_GPT_SOVITS_FFMPEG", "ffmpeg"),
        timeout_seconds=timeout,
    )


def _is_wav(audio: bytes) -> bool:
    return len(audio) >= 44 and audio[:4] == b"RIFF" and audio[8:12] == b"WAVE"


def _convert_audio(audio: bytes, output_format: str, ffmpeg_path: str, timeout_seconds: float) -> bytes:
    if output_format == "wav":
        if not _is_wav(audio):
            raise RuntimeError("audio_invalid")
        return audio
    args = [ffmpeg_path, "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "wav", "-i", "pipe:0", "-ac", "1"]
    if output_format == "mp3":
        args.extend(["-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"])
    else:
        args.extend(["-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-f", "ogg", "pipe:1"])
    try:
        result = subprocess.run(
            args,
            input=audio,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError("audio_conversion_timeout") from exc
    if result.returncode != 0 or not result.stdout or len(result.stdout) > MAX_AUDIO:
        raise RuntimeError("audio_conversion_failed")
    return result.stdout


def _upstream_payload(config: AdapterConfig, text: str) -> dict[str, Any]:
    return {
        "text": text,
        "text_lang": "ja",
        "ref_audio_path": str(config.reference_audio),
        "prompt_lang": "ja",
        "prompt_text": config.prompt_text,
        "text_split_method": "cut5",
        "batch_size": 1,
        "split_bucket": True,
        "speed_factor": 1.0,
        "fragment_interval": 0.3,
        "seed": -1,
        "media_type": "wav",
        "parallel_infer": False,
        "repetition_penalty": 1.35,
        "sample_steps": 32,
        "super_sampling": False,
    }


def synthesize_wav(config: AdapterConfig, text: str) -> bytes:
    payload = json.dumps(_upstream_payload(config, text), ensure_ascii=False).encode("utf-8")
    request = Request(config.upstream_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=config.timeout_seconds) as response:
            audio = response.read(MAX_AUDIO + 1)
    except HTTPError as exc:
        raise RuntimeError("upstream_provider_unavailable") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise TimeoutError("upstream_provider_timeout") from exc
    if len(audio) > MAX_AUDIO or not _is_wav(audio):
        raise RuntimeError("upstream_audio_invalid")
    return audio


class AdapterServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], config: AdapterConfig):
        super().__init__(address, AdapterHandler)
        self.config = config
        self.inference_lock = threading.Lock()
        self.ready = False


class AdapterHandler(http.server.BaseHTTPRequestHandler):
    server: AdapterServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(self, status: int, error_type: str) -> None:
        self._send_json(status, {"error": {"type": error_type, "message": error_type}})

    def _authorized(self) -> bool:
        expected = f"Bearer {self.server.config.token}".encode("utf-8")
        actual = self.headers.get("Authorization", "").encode("utf-8")
        return hmac.compare_digest(actual, expected)

    def _read_json(self) -> dict[str, Any] | None:
        raw_length = self.headers.get("Content-Length")
        try:
            length = int(raw_length or "-1")
        except ValueError:
            return None
        if length < 1 or length > MAX_BODY or "application/json" not in self.headers.get("Content-Type", ""):
            return None
        try:
            payload = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def do_GET(self) -> None:
        if self.path == "/healthz":
            if not self.server.ready:
                self._send_json(503, {"status": "starting", "model": MODEL_ID, "voice": VOICE_ID})
                return
            self._send_json(200, {"status": "ready", "backend": "mps", "model": MODEL_ID, "voice": VOICE_ID})
            return
        if self.path == "/v1/models":
            if not self._authorized():
                self._send_error(401, "provider_unavailable")
                return
            self._send_json(200, {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "amadeus"}]})
            return
        if self.path == "/v1/voices":
            if not self._authorized():
                self._send_error(401, "provider_unavailable")
                return
            self._send_json(200, {"object": "list", "data": [{"id": VOICE_ID, "model": MODEL_ID, "language": "ja"}]})
            return
        self._send_error(404, "provider_unavailable")

    def do_POST(self) -> None:
        if self.path != "/v1/audio/speech":
            self._send_error(404, "provider_unavailable")
            return
        if not self._authorized():
            self._send_error(401, "provider_unavailable")
            return
        payload = self._read_json()
        if payload is None:
            self._send_error(400, "audio_invalid")
            return
        if set(payload) - ALLOWED_FIELDS:
            self._send_error(400, "unsupported_parameter")
            return
        if payload.get("model", "amadeus-tts") not in MODEL_ALIASES or payload.get("voice") != VOICE_ID:
            self._send_error(400, "audio_invalid")
            return
        text = payload.get("input")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            self._send_error(400, "audio_invalid")
            return
        output_format = payload.get("response_format", "mp3")
        if output_format not in SUPPORTED_FORMATS:
            self._send_error(400, "unsupported_format")
            return
        if payload.get("style", "default") not in ("", "default"):
            self._send_error(400, "unsupported_style")
            return
        if payload.get("language") not in (None, "ja"):
            self._send_error(400, "unsupported_language")
            return
        if not self.server.inference_lock.acquire(blocking=False):
            self._send_error(503, "tts_busy")
            return
        try:
            wav = synthesize_wav(self.server.config, text)
            audio = _convert_audio(wav, output_format, self.server.config.ffmpeg_path, self.server.config.timeout_seconds)
        except TimeoutError:
            self._send_error(504, "provider_timeout")
            return
        except (RuntimeError, OSError):
            self._send_error(503, "provider_unavailable")
            return
        finally:
            self.server.inference_lock.release()
        self.send_response(200)
        self.send_header("Content-Type", MIME_BY_FORMAT[output_format])
        self.send_header("Content-Length", str(len(audio)))
        self.send_header("X-Amadeus-TTS-Provider", "gpt-sovits-mps")
        self.end_headers()
        self.wfile.write(audio)


def warm_server(server: AdapterServer) -> None:
    synthesize_wav(server.config, "確認")
    server.ready = True


def main() -> None:
    config = load_config_from_env()
    bind = os.environ.get("AMADEUS_GPT_SOVITS_TTS_BIND", "127.0.0.1")
    port = int(os.environ.get("AMADEUS_GPT_SOVITS_TTS_PORT", DEFAULT_PORT))
    if bind != "127.0.0.1" or not 1024 <= port <= 65535:
        raise SystemExit("bind_or_port_invalid")
    server = AdapterServer((bind, port), config)
    warm_server(server)
    print(f"kurisu GPT-SoVITS adapter ready on {bind}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
