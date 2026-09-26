"""Bounded OpenAI-compatible speech endpoint; no conversational state or routing."""
from __future__ import annotations

import hmac
import io
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from dataclasses import dataclass, replace
from concurrent.futures import CancelledError, Future
import queue
from engine_contract import SpeechEngine, SynthesisTiming

MODEL_ID = "qwen3-tts-1.7b"
VOICE_ID = "kurisu-v1"
UPSTREAM_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MAX_TEXT = 1200
MAX_BODY = 8192
MAX_AUDIO = 12 * 1024 * 1024
LOG = logging.getLogger("amadeus.speech")
MAX_PENDING_INFERENCES = 1
QUEUE_START_TIMEOUT_S = 5  # fail closed before the upstream 120s TTS window


class QwenEngine:
    """Load the official model and reusable voice prompt once, on M204's MPS."""

    def __init__(self, profile: Path, model_path: str = UPSTREAM_MODEL, on_warmup=None,
                 *, language: str = "Auto", x_vector_only_mode: bool = False,
                 shared_model=None, warmup: bool = True):
        if not profile.is_dir() or not (profile / "reference.wav").is_file():
            raise ValueError("voice_profile_unavailable")
        reference_text = (profile / "reference.txt").read_text(encoding="utf-8").strip()
        if not reference_text:
            raise ValueError("voice_profile_unavailable")
        import torch
        import soundfile as sf
        from qwen_tts import Qwen3TTSModel

        if not torch.backends.mps.is_available():
            raise RuntimeError("mps_unavailable")
        self._sf = sf
        self._model = shared_model if shared_model is not None else Qwen3TTSModel.from_pretrained(
            model_path, device_map="mps", dtype=torch.float16
        )
        self._prompt = self._model.create_voice_clone_prompt(
            ref_audio=str(profile / "reference.wav"), ref_text=reference_text,
            x_vector_only_mode=x_vector_only_mode
        )
        self._language = language
        self._lock = threading.Lock()
        if warmup:
            if on_warmup is not None:
                on_warmup()
            # Real synthesis before production readiness; benchmark opts out to measure first call.
            self.synthesize("你好，我已经准备好了。")

    def synthesize(self, text: str) -> tuple[bytes, int]:
        wav, rate, _ = self.synthesize_timed(text)
        return wav, rate

    def synthesize_timed(self, text: str) -> tuple[bytes, int, SynthesisTiming]:
        queued_at = time.monotonic_ns()
        with self._lock:
            locked_at = time.monotonic_ns()
            samples, rate = self._model.generate_voice_clone(
                text=text, language=self._language, voice_clone_prompt=self._prompt
            )
            generated_at = time.monotonic_ns()
            output = io.BytesIO()
            self._sf.write(output, samples[0], rate, format="WAV")
            wav = output.getvalue()
            serialized_at = time.monotonic_ns()
        return wav, rate, SynthesisTiming(
            queue_wait_ms=(locked_at - queued_at) / 1_000_000,
            generate_or_model_ms=(generated_at - locked_at) / 1_000_000,
            wav_serialize_ms=(serialized_at - generated_at) / 1_000_000,
            engine_inside_lock_ms=(serialized_at - locked_at) / 1_000_000,
        )


def encode(wav: bytes, fmt: str) -> tuple[bytes, str]:
    if fmt == "wav":
        return wav, "audio/wav"
    if fmt not in ("mp3", "opus"):
        raise ValueError("unsupported_format")
    import imageio_ffmpeg
    args = [imageio_ffmpeg.get_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "wav", "-i", "pipe:0", "-ac", "1"]
    if fmt == "opus":
        args += ["-ar", "48000", "-c:a", "libopus", "-b:a", "64k", "-f", "ogg", "pipe:1"]
    else:
        args += ["-c:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"]
    result = subprocess.run(args, input=wav, capture_output=True, timeout=30, check=False)
    if result.returncode or not result.stdout or len(result.stdout) > MAX_AUDIO:
        raise RuntimeError("audio_encoding_failed")
    return result.stdout, "audio/ogg" if fmt == "opus" else "audio/mpeg"


class TtsBusyError(Exception):
    pass

@dataclass
class InferenceJob:
    text: str
    admitted_ns: int
    started: threading.Event
    result: Future[tuple[bytes, int, SynthesisTiming]]

class InferenceWorker:
    """One model worker, one bounded waiting slot; no second Agent/runtime."""

    def __init__(self, server: SpeechServer):
        self.server = server
        self.pending: queue.Queue[InferenceJob] = queue.Queue(maxsize=MAX_PENDING_INFERENCES)
        self.closed = threading.Event()
        self.admission_lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name="qwen-inference", daemon=True)
        self.thread.start()

    def submit(self, text: str) -> tuple[bytes, int, SynthesisTiming]:
        with self.admission_lock:
            if self.closed.is_set():
                raise TtsBusyError()
            job = InferenceJob(text, time.monotonic_ns(), threading.Event(), Future())
            try:
                self.pending.put_nowait(job)
            except queue.Full as exc:
                raise TtsBusyError() from exc
        if not job.started.wait(QUEUE_START_TIMEOUT_S):
            if job.result.cancel():
                raise TtsBusyError()
            # Worker claimed the job at the deadline; wait only for that inference.
        try:
            return job.result.result()
        except CancelledError as exc:
            raise TtsBusyError() from exc

    def _run(self) -> None:
        while not self.closed.is_set():
            try:
                job = self.pending.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                if not job.result.set_running_or_notify_cancel():
                    continue
                begun_ns = time.monotonic_ns()
                job.started.set()
                engine = self.server.engine
                if engine is None or self.server.state != "ready":
                    raise TtsBusyError()
                wav, rate, timing = engine.synthesize_timed(job.text)
                wait_ms = (begun_ns - job.admitted_ns) / 1_000_000
                job.result.set_result((wav, rate, replace(timing, queue_wait_ms=wait_ms + timing.queue_wait_ms)))
            except Exception as exc:
                job.result.set_exception(exc)
            finally:
                self.pending.task_done()

    def close(self) -> None:
        with self.admission_lock:
            self.closed.set()
            while True:
                try:
                    job = self.pending.get_nowait()
                except queue.Empty:
                    break
                job.result.cancel()
                job.started.set()  # unblock the HTTP waiter during shutdown
                self.pending.task_done()
        # An in-flight model call cannot safely be interrupted; the worker is daemonized.
        self.thread.join(timeout=0.5)

def create_engine(profile: Path, model_path: str, on_warmup=None) -> SpeechEngine:
    backend = os.environ.get("AMADEUS_TTS_ENGINE", "mps")
    if backend == "mps":
        return QwenEngine(profile, model_path, on_warmup=on_warmup)
    if backend == "mlx":
        explicit_path = os.environ.get("AMADEUS_TTS_MLX_MODEL_PATH")
        if not explicit_path:
            raise ValueError("experimental_mlx_model_path_required")
        from mlx_engine import QwenMlxEngine
        return QwenMlxEngine(profile, Path(explicit_path), on_warmup=on_warmup)
    raise ValueError("unsupported_speech_engine")

class SpeechServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], token: str):
        super().__init__(address, SpeechHandler)
        self.token = token
        self.engine: SpeechEngine | None = None
        self.state = "starting"
        self.started = time.monotonic()
        self.inference = InferenceWorker(self)

    def server_close(self) -> None:
        self.inference.close()
        super().server_close()

    def load(self, profile: Path, model_path: str = UPSTREAM_MODEL) -> None:
        self.state = "loading_model"
        def expired() -> None:
            self.state = "failed"
            LOG.error("speech_startup_failed category=warmup_timeout")

        watchdog = threading.Timer(900, expired)
        watchdog.daemon = True
        watchdog.start()
        try:
            # QwenEngine loads model, profile and performs actual warmup before returning.
            self.engine = create_engine(profile, model_path,
                                        on_warmup=lambda: setattr(self, "state", "warming_up") if self.state != "failed" else None)
            if self.state != "failed":
                self.state = "ready"
        except Exception as exc:
            self.state = "failed"
            LOG.error("speech_startup_failed category=%s", type(exc).__name__)
        finally:
            watchdog.cancel()


class SpeechHandler(BaseHTTPRequestHandler):
    server: SpeechServer

    def log_message(self, format: str, *args: object) -> None:
        # HTTP request lines can contain sensitive query strings; log only status by route.
        pass

    def _json(self, code: int, body: dict) -> None:
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _error(self, code: int, category: str) -> None:
        self._json(code, {"error": {"type": category, "message": category}})

    def _authorized(self) -> bool:
        expected = "Bearer " + self.server.token
        if hmac.compare_digest(self.headers.get("Authorization", ""), expected):
            return True
        self._error(401, "auth_unavailable")
        return False

    def do_GET(self) -> None:
        if self.path == "/healthz":
            state = self.server.state
            self._json(200 if state == "ready" else 503, {"status": state, "model": MODEL_ID, "voice": VOICE_ID})
        elif self.path == "/v1/voices":
            if self._authorized():
                self._json(200, {"object": "list", "data": [{"id": VOICE_ID, "model": MODEL_ID}]})
        else:
            self._error(404, "not_found")

    def do_POST(self) -> None:
        if self.path != "/v1/audio/speech":
            self._error(404, "not_found")
            return
        if not self._authorized():
            return
        if self.server.state != "ready" or self.server.engine is None:
            self._error(503, "provider_unavailable")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_BODY or "application/json" not in self.headers.get("Content-Type", ""):
            self._error(413, "invalid_request")
            return
        try:
            data = json.loads(self.rfile.read(size))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "invalid_request")
            return
        if not isinstance(data, dict) or data.get("model") != MODEL_ID:
            self._error(400, "unknown_model")
            return
        if data.get("voice") != VOICE_ID:
            self._error(400, "unknown_voice")
            return
        text = data.get("input")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_TEXT:
            self._error(400, "invalid_input")
            return
        fmt = data.get("response_format", "mp3")
        if fmt not in ("wav", "mp3", "opus"):
            self._error(400, "unsupported_format")
            return
        started = time.monotonic()
        try:
            wav, _, timing = self.server.inference.submit(text)
            if not wav or len(wav) > MAX_AUDIO:
                raise RuntimeError("invalid_audio")
            with wave.open(io.BytesIO(wav), "rb") as reader:
                audio_duration_ms = int(reader.getnframes() * 1000 / reader.getframerate())
            encode_started = time.monotonic()
            audio, mime = encode(wav, fmt)
            encode_ms = int((time.monotonic() - encode_started) * 1000)
            if not audio:
                raise RuntimeError("invalid_audio")
        except TtsBusyError:
            LOG.warning("speech_synthesis_rejected category=tts_busy")
            self._error(503, "tts_busy")
            return
        except Exception as exc:
            LOG.error("speech_synthesis_failed category=%s", type(exc).__name__)
            self._error(503, "synthesis_failed")
            return
        input_bucket = "<=40" if len(text) <= 40 else "<=80" if len(text) <= 80 else "<=160" if len(text) <= 160 else "<=320" if len(text) <= 320 else ">320"
        total_ms = int((time.monotonic() - started) * 1000)
        rtf = timing.engine_inside_lock_ms / audio_duration_ms if audio_duration_ms > 0 else float("nan")
        LOG.info(
            "speech_synthesis_ok model=%s voice=%s format=%s input_chars=%s "
            "audio_ms=%d queue_wait_ms=%.1f generate_or_model_ms=%.1f "
            "decode_stage=inside_model_api wav_serialize_ms=%.1f engine_inside_lock_ms=%.1f "
            "encode_ms=%d total_ms=%d rtf=%.3f",
            MODEL_ID, VOICE_ID, fmt, input_bucket, audio_duration_ms,
            timing.queue_wait_ms, timing.generate_or_model_ms, timing.wav_serialize_ms,
            timing.engine_inside_lock_ms, encode_ms, total_ms, rtf,
        )
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(audio)))
        self.end_headers()
        self.wfile.write(audio)


def main() -> None:
    log_dir = Path(os.environ["AMADEUS_TTS_LOG_DIR"])
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(log_dir / "qwen3-tts.log", maxBytes=2_000_000, backupCount=3)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", handlers=[handler])
    token_file = Path(os.environ["AMADEUS_TTS_TOKEN_FILE"])
    token = token_file.read_text().strip()
    if len(token) < 32 or token_file.stat().st_mode & 0o077:
        raise ValueError("protected_tts_token_required")
    profile = Path(os.environ["AMADEUS_TTS_VOICE_DIR"])
    server = SpeechServer((os.environ.get("AMADEUS_TTS_BIND", "127.0.0.1"), int(os.environ.get("AMADEUS_TTS_PORT", "18792"))), token)
    threading.Thread(target=server.load, args=(profile, os.environ.get("AMADEUS_TTS_MODEL_PATH", UPSTREAM_MODEL)), daemon=True).start()
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
