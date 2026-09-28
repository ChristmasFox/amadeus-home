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
    "理性的で知的、芯のある女性の声。文ごとに自然な音高と抑揚をつけ、重要な語を軽く強調する。"
    "意味の対比ではリズムと声のエネルギーを変える。普段は少し鋭く素っ気なく始めるが、"
    "気遣いが表れる箇所では声と語尾をわずかに柔らげる、識別しやすいツンデレ調。"
    "自然な会話として話し、アニメ声、叫び声、甘すぎる声、接客口調にはしない。"
)
EMOTION_DELTAS: Final = {
    "default": "",
    "irritated": "語頭と重要な叱責語をやや鋭くし、短い間を置いて少し速く続ける。文末はきっぱり切る。",
    "embarrassed": "最初は尖った返しで始め、照れが出る語の前に短い間を置く。後半は少し速くなり、文末を弱く柔らげる。",
    "angry": "声のエネルギーと子音の鋭さを上げ、重要語を強く置いて短く区切る。文末は硬くするが、叫ばない。",
    "sarcastic": "皮肉の語を軽く強調し、その前後に短い間を置く。テンポは軽く、文末を少し引いて乾いたからかいを伝える。",
    "soft": "声のエネルギーを下げ、安心させる語を柔らかく強調する。間を少し長くし、文末を丸くするが、最初の素っ気なさは残す。",
    "sad": "音高を少し下げ、速度とエネルギーを落とす。重要語の前に長めの間を置き、文末を弱く余韻で終える。",
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
