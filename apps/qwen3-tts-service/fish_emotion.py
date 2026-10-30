"""Kurisu emotion -> Fish Audio S2 Pro tag mapping and inline-tag sanitizer (stdlib only)."""
from __future__ import annotations

import re

# One tag per Kurisu emotion. Fish accepts free-form bracket tags; these are the
# documented ones (or the documented "<x> tone" form) that moved pitch/energy in
# the 2026-10-30 sample sweep. ``default`` adds nothing.
EMOTION_TAGS: dict[str, str] = {
    "default": "",
    "irritated": "irritated tone",
    "embarrassed": "shy",
    "angry": "angry",
    "sarcastic": "sarcastic tone",
    "soft": "low voice",
    "sad": "sad",
}

# Inline tags the model may place inside the spoken line: Fish's documented
# event/emotion tags minus the ones that do not fit Kurisu (singing, moaning,
# screaming, echo, accent, audience laughter, panting, interrupting).
ALLOWED_INLINE: frozenset[str] = frozenset({
    "pause", "short pause", "emphasis", "volume down", "low volume", "whisper", "low voice",
    "laughing", "laughing tone", "chuckle", "chuckling", "inhale", "exhale", "sigh",
    "clearing throat", "tsk", "excited", "excited tone", "surprised", "shocked", "delight",
    "angry", "sad", "shouting", "shy", "gentle", "irritated tone", "sarcastic tone", "soft tone",
})
MAX_TAGS = 3

_TAG = re.compile(r"\[([^\[\]\r\n]{1,40})\]")
_CONTROL = re.compile(r"<\|[^|]*\|>")
_STRAY_BRACKET = re.compile(r"[\[\]]")


def sanitize(text: str) -> tuple[str, list[str]]:
    """Keep only allowlisted, de-duplicated tags (max MAX_TAGS); drop every other bracket or control token."""
    kept: list[str] = []

    def replace(match: re.Match[str]) -> str:
        name = " ".join(match.group(1).lower().split())
        if name in ALLOWED_INLINE and name not in kept and len(kept) < MAX_TAGS:
            kept.append(name)
            return f"\x00{len(kept) - 1}\x00"
        return ""

    cleaned = _CONTROL.sub("", text.replace("\x00", ""))
    cleaned = _TAG.sub(replace, cleaned)
    cleaned = _STRAY_BRACKET.sub("", cleaned)
    cleaned = re.sub(r"\x00(\d)\x00", lambda m: f"[{kept[int(m.group(1))]}]", cleaned)
    return re.sub(r"[ \t]{2,}", " ", cleaned).strip(), kept


def prepare(text: str, emotion: str) -> tuple[str, list[str]]:
    """Return the text to synthesize and the tags that took effect (emotion tag first)."""
    if emotion not in EMOTION_TAGS:
        raise ValueError("unsupported_style")
    body, inline = sanitize(text)
    prefix = EMOTION_TAGS[emotion]
    tags = list(inline)
    if prefix and prefix not in tags:
        body = f"[{prefix}] {body}".strip()
        tags.insert(0, prefix)
    if not re.sub(r"\[[^\]]*\]", "", body).strip():
        raise ValueError("invalid_input")
    return body, tags
