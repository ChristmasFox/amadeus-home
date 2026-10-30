"""Fish Audio S2 Pro MLX backend behind the existing speech-engine contract."""
from __future__ import annotations

import io
from pathlib import Path
import threading
import time

from engine_contract import SynthesisTiming


def _quantize_everything_with_scales(_cls, _path, _module) -> bool:
    # mlx-audio's Fish loader excludes nn.Embedding and ``fast_*`` modules from
    # quantization, but the mlx-community 8-bit checkpoint quantized them too
    # ("Received 48 parameters not in model: embeddings.scales ..."). Returning
    # True defers to the generic rule: quantize a module iff the checkpoint
    # carries ``<path>.scales`` for it, so bf16 checkpoints are unaffected.
    return True


class FishMlxEngine:
    """Fish Audio S2 Pro zero-shot clone of the kurisu-v1 profile (tags pass through the text)."""

    def __init__(self, profile: Path, model_id: str, on_warmup=None):
        if not profile.is_dir() or not (profile / "reference.wav").is_file():
            raise ValueError("voice_profile_unavailable")
        reference_text = (profile / "reference.txt").read_text(encoding="utf-8").strip()
        if not reference_text:
            raise ValueError("voice_profile_unavailable")
        import mlx.core as mx
        import numpy as np
        import soundfile as sf
        from mlx_audio.tts.models.fish_qwen3_omni.fish_speech import Model
        from mlx_audio.tts.utils import load_model
        from mlx_audio.utils import load_audio

        self._mx = mx
        self._np = np
        mx.set_cache_limit(512 * 1024 * 1024)  # keep idle footprint near the weights, not the generation peak
        self._sf = sf
        Model.model_quant_predicate = classmethod(_quantize_everything_with_scales)
        self._model = load_model(model_id)
        reference = load_audio(str(profile / "reference.wav"), sample_rate=self._model.sample_rate)
        self._reference_audio = reference[0] if isinstance(reference, tuple) else reference
        self._reference_text = reference_text
        self._cache_reference_prompt()
        self._lock = threading.Lock()
        if on_warmup is not None:
            on_warmup()
        # Real synthesis before readiness, same boundary as the Qwen engines.
        self.synthesize_timed("你好、準備できてるわよ。")

    def _cache_reference_prompt(self) -> None:
        # The 46 s reference is re-encoded by the codec on every generate(); the
        # result only depends on the fixed profile, so compute it once.
        original = self._model._prepare_reference_prompt
        cache: dict[str, tuple] = {}

        def cached(ref_audio, ref_text):
            key = ref_text or ""
            if ref_audio is self._reference_audio:
                if key not in cache:
                    cache[key] = original(ref_audio, ref_text)
                return cache[key]
            return original(ref_audio, ref_text)

        self._model._prepare_reference_prompt = cached

    def synthesize_timed(self, text: str) -> tuple[bytes, int, SynthesisTiming]:
        queued_at = time.monotonic_ns()
        with self._lock:
            locked_at = time.monotonic_ns()
            output = list(self._model.generate(text=text, ref_audio=self._reference_audio,
                                               ref_text=self._reference_text, verbose=False))
            if not output:
                raise RuntimeError("no_audio_segments")
            samples = self._np.concatenate([self._np.asarray(item.audio, dtype="float32").reshape(-1) for item in output])
            rate = output[0].sample_rate
            generated_at = time.monotonic_ns()
            self._mx.clear_cache()
            wav = io.BytesIO()
            self._sf.write(wav, samples, rate, format="WAV")
            serialized_at = time.monotonic_ns()
        return wav.getvalue(), rate, SynthesisTiming(
            queue_wait_ms=(locked_at - queued_at) / 1_000_000,
            generate_or_model_ms=(generated_at - locked_at) / 1_000_000,
            wav_serialize_ms=(serialized_at - generated_at) / 1_000_000,
            engine_inside_lock_ms=(serialized_at - locked_at) / 1_000_000,
        )

    def close(self) -> None:
        self._model = None
