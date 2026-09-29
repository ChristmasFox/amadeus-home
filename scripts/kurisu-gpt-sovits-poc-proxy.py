#!/usr/bin/env python3
"""Expose a bounded loopback-only operator surface for the Kurisu PoC."""

from __future__ import annotations

import argparse
import json
import logging
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

MAX_REQUEST_BYTES = 64 * 1024
MAX_AUDIO_BYTES = 12 * 1024 * 1024


@dataclass(frozen=True)
class ProxyConfig:
    upstream: str
    reference_audio: Path
    prompt_text: str
    bind: str
    port: int
    timeout_seconds: float
    max_text_chars: int
    default_seed: int


def validate_text(value: Any, max_text_chars: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("text_required")
    text = value.strip()
    if len(text) > max_text_chars:
        raise ValueError("text_too_long")
    return text


def validate_seed(value: Any, default_seed: int) -> int:
    if value is None or value == "":
        return default_seed
    try:
        seed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("seed_invalid") from exc
    if seed < -1 or seed > 2**31 - 1:
        raise ValueError("seed_invalid")
    return seed


def upstream_query(config: ProxyConfig, text: str, seed: int) -> str:
    return urlencode(
        {
            "text": text,
            "text_lang": "ja",
            "ref_audio_path": str(config.reference_audio),
            "prompt_lang": "ja",
            "prompt_text": config.prompt_text,
            "top_k": "15",
            "top_p": "1",
            "temperature": "1",
            "text_split_method": "cut5",
            "speed_factor": "1.0",
            "seed": str(seed),
            "media_type": "wav",
            "streaming_mode": "0",
        }
    )


class ProxyServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], config: ProxyConfig):
        super().__init__(address, ProxyHandler)
        self.config = config
        self.inference_gate = threading.BoundedSemaphore(1)


class ProxyHandler(BaseHTTPRequestHandler):
    server: ProxyServer

    def log_message(self, format: str, *args: object) -> None:
        logging.info("http " + format, *args)

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _audio(self, raw: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _health(self) -> None:
        config = self.server.config
        try:
            with urlopen(
                Request(f"{config.upstream}/openapi.json", method="GET"),
                timeout=min(5.0, config.timeout_seconds),
            ) as response:
                if response.status != 200:
                    raise RuntimeError("upstream_not_ready")
        except Exception:
            self._json(
                503,
                {
                    "status": "not_ready",
                    "upstream": config.upstream,
                    "max_text_chars": config.max_text_chars,
                    "timeout_seconds": config.timeout_seconds,
                },
            )
            return
        self._json(
            200,
            {
                "status": "ready",
                "upstream": config.upstream,
                "max_text_chars": config.max_text_chars,
                "timeout_seconds": config.timeout_seconds,
                "concurrency": 1,
            },
        )

    def _request_values(self) -> tuple[str, int]:
        config = self.server.config
        if self.command == "GET":
            query = parse_qs(urlparse(self.path).query, keep_blank_values=True)
            text_value: Any = query.get("text", [None])[0]
            seed_value: Any = query.get("seed", [None])[0]
        else:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 0 or content_length > MAX_REQUEST_BYTES:
                raise ValueError("request_too_large")
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError("json_invalid") from exc
            text_value = payload.get("text") if isinstance(payload, dict) else None
            seed_value = payload.get("seed") if isinstance(payload, dict) else None
        return validate_text(text_value, config.max_text_chars), validate_seed(seed_value, config.default_seed)

    def _tts(self) -> None:
        config = self.server.config
        try:
            text, seed = self._request_values()
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        if not self.server.inference_gate.acquire(blocking=False):
            self._json(429, {"error": "inference_busy"})
            return
        started = time.monotonic()
        status = 502
        try:
            request = Request(
                f"{config.upstream}/tts?{upstream_query(config, text, seed)}",
                method="GET",
            )
            with urlopen(request, timeout=config.timeout_seconds) as response:
                status = response.status
                raw = response.read(MAX_AUDIO_BYTES + 1)
            if status != 200:
                raise RuntimeError(f"upstream_http_{status}")
            if len(raw) > MAX_AUDIO_BYTES or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
                raise RuntimeError("upstream_audio_invalid")
            elapsed_ms = round((time.monotonic() - started) * 1000, 1)
            logging.info("tts status=200 text_chars=%s elapsed_ms=%s", len(text), elapsed_ms)
            self._audio(raw)
        except HTTPError as exc:
            status = 502 if exc.code >= 500 else 400
            logging.warning("tts status=%s error=upstream_http_%s text_chars=%s", status, exc.code, len(text))
            self._json(status, {"error": f"upstream_http_{exc.code}"})
        except TimeoutError:
            logging.warning("tts status=504 error=upstream_timeout text_chars=%s", len(text))
            self._json(504, {"error": "upstream_timeout"})
        except (URLError, OSError, RuntimeError) as exc:
            error = str(exc) or "upstream_failure"
            error_status = status if status >= 400 else 502
            logging.warning("tts status=%s error=%s text_chars=%s", error_status, error, len(text))
            self._json(error_status, {"error": error})
        finally:
            self.server.inference_gate.release()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/healthz":
            self._health()
        elif path == "/tts":
            self._tts()
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path == "/tts":
            self._tts()
        else:
            self._json(404, {"error": "not_found"})


def parse_args() -> ProxyConfig:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", required=True, help="upstream GPT-SoVITS base URL")
    parser.add_argument("--reference-audio", required=True, type=Path)
    parser.add_argument("--prompt-text", required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--timeout-seconds", default=180.0, type=float)
    parser.add_argument("--max-text-chars", default=600, type=int)
    parser.add_argument("--default-seed", default=4242, type=int)
    args = parser.parse_args()
    upstream = args.upstream.rstrip("/")
    if not upstream.startswith("http://127.0.0.1:"):
        parser.error("--upstream must be loopback HTTP")
    if not args.reference_audio.is_file() or args.reference_audio.is_symlink():
        parser.error("--reference-audio must be a regular file")
    if args.bind not in {"127.0.0.1", "localhost"}:
        parser.error("--bind must remain loopback-only")
    if args.port < 1 or args.port > 65535:
        parser.error("--port is invalid")
    if args.timeout_seconds <= 0 or args.max_text_chars < 1:
        parser.error("timeout and max text settings must be positive")
    return ProxyConfig(
        upstream=upstream,
        reference_audio=args.reference_audio,
        prompt_text=args.prompt_text,
        bind=args.bind,
        port=args.port,
        timeout_seconds=args.timeout_seconds,
        max_text_chars=args.max_text_chars,
        default_seed=args.default_seed,
    )


def main() -> None:
    config = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = ProxyServer((config.bind, config.port), config)
    logging.info(
        "listen bind=%s port=%s upstream=%s max_text_chars=%s timeout_seconds=%s",
        config.bind,
        config.port,
        config.upstream,
        config.max_text_chars,
        config.timeout_seconds,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("shutdown reason=keyboard_interrupt")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
