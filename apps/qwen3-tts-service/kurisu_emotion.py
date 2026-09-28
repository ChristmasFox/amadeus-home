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

# These are reviewed speech-delivery instructions. They are intentionally
# separate from the Agent persona and are never exposed as free-form input.
KURISU_DEFAULT_BASELINE: Final = (
    "理性的で、落ち着いていて知的、自信のある話し方。自然で控えめに話し、"
    "少し辛口で乾いたユーモアを含める。軽いツンデレの、素直に心配を認めたがらない"
    "雰囲気を保つ。無理に萌え声にしたり、大げさなアニメ演技や決まり文句を繰り返したりしない。"
)
EMOTION_DELTAS: Final = {
    "default": "",
    "irritated": "少し苛立ちと軽い叱責を強めるが、冷静さは保つ。",
    "embarrassed": "照れと戸惑いを隠そうとし、少しためらうように話す。",
    "angry": "明確に怒った鋭い話し方にするが、通常は叫ばず抑制する。",
    "sarcastic": "乾いた皮肉と軽いからかいを含め、抑えた嘲笑の調子にする。",
    "soft": "気遣いと慰めを込め、少し柔らかく話すが、控えめな個性は保つ。",
    "sad": "抑えた悲しみをにじませ、少し低くゆっくり話す。",
}


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
    delta = EMOTION_DELTAS[emotion]
    return KURISU_DEFAULT_BASELINE if not delta else f"{KURISU_DEFAULT_BASELINE}{delta}"
