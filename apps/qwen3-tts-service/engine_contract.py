"""Shared timed synthesis contract; no model, HTTP, channel, or Agent dependency."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

@dataclass(frozen=True)
class SynthesisTiming:
    # Both upstream backends include decode/postprocessing inside their model API.
    queue_wait_ms: float
    generate_or_model_ms: float
    wav_serialize_ms: float
    engine_inside_lock_ms: float

class SpeechEngine(Protocol):
    def synthesize_timed(self, text: str) -> tuple[bytes, int, SynthesisTiming]: ...
