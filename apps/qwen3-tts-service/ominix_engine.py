"""Persistent OminiX Rust worker behind the stable Python HTTP boundary."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import uuid

from engine_contract import SynthesisTiming
from kurisu_emotion import normalize_emotion
from kurisu_style import validate_options


class OminiXEngine:
    """Keep one pinned OminiX Base model process resident for all requests."""

    def __init__(self, profile: Path, model_path: Path, worker_path: Path, on_warmup=None):
        if not profile.is_dir() or not (profile / "reference.wav").is_file():
            raise ValueError("voice_profile_unavailable")
        if not model_path.is_dir() or not (model_path / "config.json").is_file():
            raise ValueError("ominix_model_unavailable")
        if not worker_path.is_file() or not os.access(worker_path, os.X_OK):
            raise ValueError("ominix_worker_unavailable")
        reference_text = (profile / "reference.txt").read_text(encoding="utf-8").strip()
        if not reference_text:
            raise ValueError("voice_profile_unavailable")
        self._tmp = Path(tempfile.mkdtemp(prefix="amadeus-ominix-", dir=os.environ.get("TMPDIR")))
        self._lock = threading.Lock()
        self._proc = subprocess.Popen(
            [str(worker_path), "--model", str(model_path), "--reference", str(profile / "reference.wav"),
             "--output-dir", str(self._tmp)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, encoding="utf-8", bufsize=1,
        )
        ready = self._read_response()
        if not ready.get("ready"):
            self.close()
            raise RuntimeError("ominix_worker_start_failed")
        if on_warmup is not None:
            on_warmup()
        # The worker loads the model, reference audio and speaker encoder before
        # emitting ready; this real request verifies the decoder path as well.
        self.synthesize_timed("準備できたわ。", "default")

    def _read_response(self) -> dict:
        if self._proc.stdout is None:
            raise RuntimeError("ominix_worker_stdout_unavailable")
        line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError("ominix_worker_exited")
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise RuntimeError("ominix_worker_protocol_error") from exc
        if not isinstance(value, dict):
            raise RuntimeError("ominix_worker_protocol_error")
        return value

    def synthesize_timed(self, text: str, emotion: str = "default", *, instruct: str | None = None, options: dict | None = None) -> tuple[bytes, int, SynthesisTiming]:
        emotion = normalize_emotion(emotion)
        if self._proc.poll() is not None or self._proc.stdin is None:
            raise RuntimeError("ominix_worker_exited")
        output = self._tmp / f"{uuid.uuid4().hex}.wav"
        request_started = time.monotonic_ns()
        safe_options = validate_options(options or {})
        request = {"text": text, "emotion": emotion, "output": str(output), "instruct": instruct, "options": safe_options}
        with self._lock:
            self._proc.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
            self._proc.stdin.flush()
            result = self._read_response()
        if not result.get("ok"):
            raise RuntimeError(str(result.get("error", "ominix_synthesis_failed")))
        try:
            wav = output.read_bytes()
        finally:
            output.unlink(missing_ok=True)
        if not wav:
            raise RuntimeError("ominix_empty_audio")
        total_ms = (time.monotonic_ns() - request_started) / 1_000_000
        worker_ms = float(result.get("timingMs", total_ms))
        return wav, int(result.get("sampleRate", 24000)), SynthesisTiming(
            queue_wait_ms=0.0,
            generate_or_model_ms=worker_ms,
            wav_serialize_ms=max(0.0, total_ms - worker_ms),
            engine_inside_lock_ms=total_ms,
            prefill_ms=float(result["prefillMs"]) if result.get("prefillMs") is not None else None,
            generation_ms=float(result["generationMs"]) if result.get("generationMs") is not None else None,
            decode_ms=float(result["decodeMs"]) if result.get("decodeMs") is not None else None,
            generation_frames=int(result["generationFrames"]) if result.get("generationFrames") is not None else None,
        )

    def close(self) -> None:
        proc = getattr(self, "_proc", None)
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        tmp = getattr(self, "_tmp", None)
        if tmp is not None:
            for child in tmp.glob("*"):
                child.unlink(missing_ok=True)
            tmp.rmdir()
