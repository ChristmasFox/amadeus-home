"""Experimental community MLX backend behind the existing speech-engine contract."""
from __future__ import annotations

import io
from pathlib import Path
import threading
import time

from engine_contract import SynthesisTiming


class QwenMlxEngine:
    """Community mlx-audio 1.7B Base 8-bit ICL clone; opt-in, never default."""

    def __init__(self, profile: Path, model_path: Path, on_warmup=None):
        if not profile.is_dir() or not (profile / "reference.wav").is_file():
            raise ValueError("voice_profile_unavailable")
        if not model_path.is_dir() or not (model_path / "config.json").is_file():
            raise ValueError("mlx_model_unavailable")
        reference_text = (profile / "reference.txt").read_text(encoding="utf-8").strip()
        if not reference_text:
            raise ValueError("voice_profile_unavailable")
        import numpy as np
        import soundfile as sf
        from mlx_audio.tts.utils import load_model

        self._np = np
        self._sf = sf
        self._model = load_model(model_path)
        self._reference_audio = str(profile / "reference.wav")
        self._reference_text = reference_text
        self._lock = threading.Lock()
        if on_warmup is not None:
            on_warmup()
        # Same actual synthesis readiness boundary as MPS; no HTTP API difference.
        self.synthesize_timed("你好，我已经准备好了。")

    def synthesize_timed(self, text: str) -> tuple[bytes, int, SynthesisTiming]:
        queued_at = time.monotonic_ns()
        with self._lock:
            locked_at = time.monotonic_ns()
            output = list(self._model.generate(text=text, ref_audio=self._reference_audio,
                                               ref_text=self._reference_text, lang_code="auto", verbose=False))
            if len(output) != 1:
                raise RuntimeError("unexpected_segment_count")
            samples = self._np.asarray(output[0].audio)
            rate = output[0].sample_rate
            generated_at = time.monotonic_ns()
            wav = io.BytesIO()
            self._sf.write(wav, samples, rate, format="WAV")
            payload = wav.getvalue()
            serialized_at = time.monotonic_ns()
        return payload, rate, SynthesisTiming(
            queue_wait_ms=(locked_at - queued_at)/1_000_000,
            generate_or_model_ms=(generated_at - locked_at)/1_000_000,
            wav_serialize_ms=(serialized_at - generated_at)/1_000_000,
            engine_inside_lock_ms=(serialized_at - locked_at)/1_000_000,
        )
