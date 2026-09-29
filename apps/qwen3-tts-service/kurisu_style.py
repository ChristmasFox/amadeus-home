"""Canonical, validated Kurisu production style configuration.

This module is deliberately independent from HTTP, channels and the model.  It
is the only place that composes the baseline and bounded emotion deltas.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from kurisu_emotion import EMOTION_IDS, EMOTION_SET

STYLE_SCHEMA_VERSION = 1
PROFILE = "kurisu-v1"
LANGUAGE = "japanese"
DEFAULT_STYLE_PATH = Path(__file__).with_name("kurisu_style.json")
MAX_STYLE_CHARS = 4000
OPTION_POLICY: dict[str, dict[str, Any]] = {
    "temperature": {"type": "number", "min": 0.0, "max": 2.0, "step": 0.01, "default": None, "description": "OminiX sampling temperature; inherit when null."},
    "top_k": {"type": "integer", "min": 0, "max": 4096, "step": 1, "default": None, "description": "OminiX top-k; zero delegates to model semantics."},
    "top_p": {"type": "number", "min": 0.0, "max": 1.0, "step": 0.01, "default": None, "description": "OminiX nucleus sampling probability."},
    "max_new_tokens": {"type": "integer", "min": 1, "max": 8192, "step": 1, "default": None, "description": "Expert generation length cap."},
    "seed": {"type": "integer", "min": 0, "max": 2**63 - 1, "step": 1, "default": None, "description": "Fixed seed; null means model/runtime default."},
    "speed_factor": {"type": "number", "min": 0.5, "max": 2.0, "step": 0.01, "default": None, "description": "Pinned OminiX speed factor."},
    "repetition_penalty": {"type": "number", "min": 1.0, "max": 2.0, "step": 0.01, "default": None, "description": "Pinned OminiX repetition penalty."},
}


class StyleConfigError(ValueError):
    pass


def _text(value: Any, field: str, *, allow_empty: bool = True) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()) or len(value) > MAX_STYLE_CHARS:
        raise StyleConfigError(f"invalid_{field}")
    return value


def validate_options(value: Any, *, allow_unknown: bool = False) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise StyleConfigError("invalid_generation_overrides")
    if not allow_unknown and set(value) - set(OPTION_POLICY):
        raise StyleConfigError("unsupported_generation_option")
    output: dict[str, Any] = {}
    for key, raw in value.items():
        policy = OPTION_POLICY.get(key)
        if policy is None:
            if allow_unknown:
                continue
            raise StyleConfigError("unsupported_generation_option")
        if raw is None:
            output[key] = None
            continue
        kind = policy["type"]
        if kind == "integer":
            valid = isinstance(raw, int) and not isinstance(raw, bool)
        else:
            valid = isinstance(raw, (int, float)) and not isinstance(raw, bool)
        if not valid or raw < policy["min"] or raw > policy["max"]:
            raise StyleConfigError(f"invalid_{key}")
        output[key] = int(raw) if kind == "integer" else float(raw)
    return output


def validate_style(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("schemaVersion") != STYLE_SCHEMA_VERSION:
        raise StyleConfigError("invalid_style_schema")
    if raw.get("profile") != PROFILE or raw.get("language") != LANGUAGE:
        raise StyleConfigError("invalid_style_identity")
    baseline = _text(raw.get("baseline"), "baseline", allow_empty=False)
    cloud_persona = _text(raw.get("cloudPersona"), "cloud_persona", allow_empty=False)
    defaults = validate_options(raw.get("generationDefaults", {}))
    emotions = raw.get("emotions")
    if not isinstance(emotions, dict) or set(emotions) != set(EMOTION_SET):
        raise StyleConfigError("invalid_emotion_ids")
    normalized: dict[str, Any] = {"schemaVersion": STYLE_SCHEMA_VERSION, "profile": PROFILE, "language": LANGUAGE, "baseline": baseline, "cloudPersona": cloud_persona, "generationDefaults": defaults, "emotions": {}}
    for emotion in EMOTION_IDS:
        item = emotions[emotion]
        if not isinstance(item, dict) or set(item) - {"instruct", "generationOverrides", "cloudInstruction"}:
            raise StyleConfigError("invalid_emotion_config")
        normalized["emotions"][emotion] = {
            "instruct": _text(item.get("instruct", ""), f"{emotion}_instruct"),
            "cloudInstruction": _text(item.get("cloudInstruction", ""), f"{emotion}_cloud_instruction", allow_empty=False),
            "generationOverrides": validate_options(item.get("generationOverrides", {})),
        }
    return normalized


def load_style(path: Path | str = DEFAULT_STYLE_PATH) -> dict[str, Any]:
    candidate = Path(path)
    try:
        raw = json.loads(candidate.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StyleConfigError("style_config_unavailable") from exc
    return validate_style(raw)


def style_hash(style: dict[str, Any]) -> str:
    normalized = validate_style(style)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def compose(style: dict[str, Any], emotion: str, *, baseline: str | None = None, instruct: str | None = None, overrides: dict[str, Any] | None = None) -> tuple[str, dict[str, Any], str]:
    normalized = validate_style(style)
    if emotion not in EMOTION_SET:
        raise StyleConfigError("invalid_emotion")
    baseline_value = normalized["baseline"] if baseline is None else _text(baseline, "baseline", allow_empty=False)
    delta = normalized["emotions"][emotion]["instruct"] if instruct is None else _text(instruct, "instruct")
    effective = baseline_value if not delta else f"{baseline_value}{delta}"
    merged = dict(normalized["generationDefaults"])
    merged.update(normalized["emotions"][emotion]["generationOverrides"])
    if overrides is not None:
        merged.update(validate_options(overrides))
    return effective, merged, style_hash({**normalized, "baseline": baseline_value, "emotions": {**normalized["emotions"], emotion: {**normalized["emotions"][emotion], "instruct": delta}}})



def cloud_instruction(style: dict[str, Any], emotion: str) -> str:
    """Compose the bounded cloud instruction without exposing local OminiX prose."""
    normalized = validate_style(style)
    if emotion not in EMOTION_SET:
        raise StyleConfigError("invalid_emotion")
    return f"{normalized['cloudPersona']}{normalized['emotions'][emotion]['cloudInstruction']}"

def schema() -> dict[str, Any]:
    fields = []
    for key, policy in OPTION_POLICY.items():
        fields.append({"id": key, "type": policy["type"], "source": "pinned qwen3-tts-mlx SynthesizeOptions", "default": policy["default"], "safeMin": policy["min"], "safeMax": policy["max"], "step": policy["step"], "labMutable": True, "productionPromotable": True, "description": policy["description"]})
    return {"schemaVersion": STYLE_SCHEMA_VERSION, "profile": PROFILE, "language": LANGUAGE, "controls": fields}
