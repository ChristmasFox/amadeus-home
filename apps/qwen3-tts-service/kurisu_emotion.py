"""Deterministic Kurisu voice baseline and bounded V1 emotion contract."""
from __future__ import annotations

from typing import Final

EMOTION_IDS: Final = (
    "default",
    "irritated",
    "embarrassed",
    "angry",
    "sarcastic",
    "soft",
    "sad",
)
EMOTION_SET: Final = frozenset(EMOTION_IDS)

def normalize_emotion(value: object) -> str:
    """Normalize a request value, rejecting arbitrary prompt text."""
    if value is None or value == "":
        return "default"
    if not isinstance(value, str):
        raise ValueError("invalid_emotion")
    normalized = value.strip().lower()
    if normalized not in EMOTION_SET:
        raise ValueError("invalid_emotion")
    return normalized


def final_instruct(emotion: str) -> str:
    emotion = normalize_emotion(emotion)
    # Lazy import keeps this compatibility module usable by validation tools
    # while making kurisu_style.json the sole prompt source.
    from kurisu_style import compose, load_style
    effective, _, _ = compose(load_style(), emotion)
    return effective
