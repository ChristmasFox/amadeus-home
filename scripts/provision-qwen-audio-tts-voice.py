#!/usr/bin/env python3
"""Create or verify the protected Qwen-Audio-TTS Kurisu cloned voice.

The default is a no-network plan.  ``--apply`` is the only mode that can call
the voice-cloning API or write the protected voice-id/manifest files.  The
audio sample and its public enrollment URL are operator-owned inputs and never
enter Git or logs.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import wave
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

TARGET_MODEL = "qwen-audio-3.0-tts-flash"
ENROLLMENT_MODEL = "voice-enrollment"
DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
MAX_RESPONSE = 1024 * 1024
MAX_REFERENCE_SECONDS = 60.0
RECOMMENDED_REFERENCE_SECONDS = (10.0, 20.0)
MAX_PROMPT_AUDIO_LENGTH = 30.0
MAX_REFERENCE_BYTES = 10 * 1024 * 1024
VOICE_RE = re.compile(r"^[A-Za-z0-9._-]{8,256}$")


def digest(value: bytes | str) -> str:
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def protected_read(path: str | Path, name: str, *, minimum: int = 1, maximum: int = 4096) -> str:
    p = Path(path)
    st = p.lstat()
    if not p.is_file() or p.is_symlink() or st.st_mode & 0o077:
        raise RuntimeError(f"{name}_file_unprotected")
    value = p.read_text(encoding="utf-8").strip()
    if len(value) < minimum or len(value) > maximum:
        raise RuntimeError(f"{name}_invalid")
    return value


def validate_endpoint(value: str) -> str:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    allowed = host in {"dashscope.aliyuncs.com", "maas.qianwenaiapi.com"} or host.endswith(".maas.aliyuncs.com")
    if parsed.scheme != "https" or not allowed or parsed.path != "/api/v1/services/audio/tts/customization":
        raise ValueError("invalid_qwen_voice_endpoint")
    return value


def validate_reference(path: str | Path, repo_root: Path | None = None) -> tuple[Path, float, str]:
    p = Path(path).expanduser()
    st = p.lstat()
    if not p.is_file() or p.is_symlink() or st.st_mode & 0o077:
        raise RuntimeError("reference_file_unprotected")
    if repo_root is not None:
        try:
            p.resolve().relative_to(repo_root.resolve())
        except ValueError:
            pass
        else:
            raise RuntimeError("reference_must_be_outside_repo")
    if st.st_size < 1024 or st.st_size > MAX_REFERENCE_BYTES:
        raise RuntimeError("reference_size_invalid")
    duration = probe_duration(p)
    if not 10.0 <= duration <= MAX_REFERENCE_SECONDS:
        raise RuntimeError("reference_duration_must_be_10_to_60_seconds")
    return p, duration, digest(p.read_bytes())


def probe_duration(path: Path) -> float:
    """Read duration with the host-native macOS fallback when ffprobe is absent."""
    try:
        raw_duration = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            text=True, stderr=subprocess.DEVNULL, timeout=15,
        ).strip()
        duration = float(raw_duration)
    except (OSError, subprocess.SubprocessError, ValueError):
        duration = None
    if duration is None:
        try:
            afinfo = subprocess.check_output(["afinfo", str(path)], text=True, stderr=subprocess.DEVNULL, timeout=15)
            match = re.search(r"estimated duration:\s*([0-9.]+)\s*sec", afinfo, re.IGNORECASE)
            if match:
                duration = float(match.group(1))
        except (OSError, subprocess.SubprocessError, ValueError):
            duration = None
    if duration is None and path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as handle:
                duration = handle.getnframes() / handle.getframerate()
        except (OSError, wave.Error, ZeroDivisionError):
            duration = None
    if duration is None or not duration > 0:
        raise RuntimeError("reference_duration_unverified")
    return float(duration)


def post_json(endpoint: str, api_key: str, payload: dict, *, timeout: float = 60.0, opener=urlopen) -> tuple[int, dict, str | None]:
    request = Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode(), method="POST", headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
    })
    try:
        with opener(request, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise RuntimeError("voice_api_response_too_large")
            return response.status, json.loads(raw.decode("utf-8")), response.headers.get("x-request-id")
    except HTTPError as exc:
        body = exc.read(MAX_RESPONSE + 1)
        try:
            decoded = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            decoded = {}
        return exc.code, decoded, exc.headers.get("x-request-id")
    except (URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("voice_api_network_failure") from exc


def protected_guest_read(machine: str, path: str | Path, *, minimum: int = 20, maximum: int = 4096) -> str:
    """Read an existing uid-1000 guest secret without putting it in argv/logs."""
    probe = r'''
from pathlib import Path
import sys
p = Path(sys.argv[1]); st = p.lstat()
if p.is_symlink() or not p.is_file() or st.st_uid != 1000 or st.st_mode & 0o077:
    raise SystemExit("guest_secret_unprotected")
value = p.read_text(encoding="utf-8").strip()
if not value or len(value) < int(sys.argv[2]) or len(value) > int(sys.argv[3]):
    raise SystemExit("guest_secret_invalid")
sys.stdout.write(value)
'''
    try:
        result = subprocess.run(
            ["orb", "-m", machine, "-u", "root", "python3", "-c", probe, str(path), str(minimum), str(maximum)],
            check=True, capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise RuntimeError("guest_secret_unavailable") from exc
    value = result.stdout.strip()
    if not minimum <= len(value) <= maximum:
        raise RuntimeError("guest_secret_invalid")
    return value


def extract_voice(payload: dict) -> str:
    value = payload.get("output", {}).get("voice_id")
    if not isinstance(value, str) or not VOICE_RE.fullmatch(value):
        raise RuntimeError("voice_id_missing_or_invalid")
    return value


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.stat().st_mode & 0o077:
        path.parent.chmod(0o700)


def atomic_secret_write(path: Path, value: str) -> None:
    ensure_parent(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent), text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value + "\n")
        os.replace(tmp_name, path)
        path.chmod(0o600)
    finally:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)


def write_manifest(path: Path, *, voice_id: str, target_model: str, reference_sha256: str | None, duration: float | None, request_id: str | None, authorization_confirmed: bool | None = None) -> None:
    ensure_parent(path)
    payload = {
        "schemaVersion": 1,
        "provider": "qwen-audio-tts",
        "targetModel": target_model,
        "voiceIdSha256": digest(voice_id),
        "referenceSha256": reference_sha256,
        "referenceDurationSeconds": round(duration, 3) if duration is not None else None,
        "sampleAuthorizationConfirmed": authorization_confirmed,
        "requestIdSha256": digest(request_id) if request_id else None,
        "updatedAt": int(time.time()),
    }
    atomic_secret_write(path, json.dumps(payload, ensure_ascii=False, sort_keys=True))


def apply(args: argparse.Namespace) -> None:
    endpoint = validate_endpoint(args.endpoint)
    guest_key_file = getattr(args, "api_key_guest_file", None)
    if args.api_key_file and guest_key_file:
        raise RuntimeError("choose_one_api_key_source")
    if guest_key_file:
        key = protected_guest_read(args.machine, guest_key_file, minimum=20)
    else:
        key = protected_read(args.api_key_file, "qwen_tts_api_key", minimum=20)
    voice_path = Path(args.voice_id_file).expanduser()
    manifest_path = Path(args.manifest_file).expanduser()
    existing = None
    if voice_path.exists():
        existing = protected_read(voice_path, "qwen_tts_voice_id", minimum=8, maximum=256)
        if not VOICE_RE.fullmatch(existing):
            raise RuntimeError("voice_id_invalid")
        status, payload, request_id = post_json(endpoint, key, {
            "model": ENROLLMENT_MODEL,
            "input": {"action": "query_voice", "voice_id": existing},
        })
        output = payload.get("output", {}) if isinstance(payload, dict) else {}
        if status != 200 or output.get("target_model") != TARGET_MODEL or output.get("status") not in (None, "OK"):
            raise RuntimeError("existing_voice_not_ready_or_target_mismatch")
        write_manifest(manifest_path, voice_id=existing, target_model=TARGET_MODEL, reference_sha256=None, duration=None, request_id=request_id)
        print("VOICE_ACTION=reused_existing")
        print("VOICE_ID=protected")
        print("VOICE_ID_SHA256=" + digest(existing))
        return

    if not args.reference_audio or not args.audio_url_file:
        raise RuntimeError("--apply_requires_reference_audio_and_audio_url_file")
    reference, duration, reference_sha = validate_reference(args.reference_audio, Path(__file__).resolve().parents[1])
    audio_url = protected_read(args.audio_url_file, "voice_clone_audio_url", minimum=12, maximum=4096)
    parsed = urlparse(audio_url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("voice_clone_audio_url_invalid")
    prefix = args.prefix
    if not re.fullmatch(r"[A-Za-z0-9]{1,10}", prefix):
        raise RuntimeError("voice_clone_prefix_invalid")
    status, payload, request_id = post_json(endpoint, key, {
        "model": ENROLLMENT_MODEL,
        "input": {
            "action": "create_voice", "target_model": TARGET_MODEL,
            "prefix": prefix, "url": audio_url, "language_hints": ["ja"],
            # The source file may be up to 60 seconds, while this API control
            # accepts only [3, 30] seconds for the post-preprocessing prompt.
            "max_prompt_audio_length": MAX_PROMPT_AUDIO_LENGTH, "enable_preprocess": False,
            "enable_volume_normalization": "false",
        },
    })
    if status in (401, 403):
        raise RuntimeError("voice_api_auth_failed")
    if status >= 400:
        raise RuntimeError("voice_api_create_failed")
    voice_id = extract_voice(payload)
    atomic_secret_write(voice_path, voice_id)
    write_manifest(manifest_path, voice_id=voice_id, target_model=TARGET_MODEL, reference_sha256=reference_sha, duration=duration, request_id=request_id, authorization_confirmed=True)
    print("VOICE_ACTION=created")
    print("VOICE_ID=protected")
    print("VOICE_ID_SHA256=" + digest(voice_id))
    print("REFERENCE_SHA256=" + reference_sha)
    print("REFERENCE_DURATION_SECONDS=%.3f" % duration)
    print("VOICE_MANIFEST=protected")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--endpoint", default=os.environ.get("AMADEUS_TTS_CLOUD_ENROLLMENT_URL", DEFAULT_ENDPOINT))
    parser.add_argument("--api-key-file")
    parser.add_argument("--api-key-guest-file", help="protected guest file, such as the existing ASR upstream key")
    parser.add_argument("--voice-id-file")
    parser.add_argument("--manifest-file")
    parser.add_argument("--reference-audio")
    parser.add_argument("--audio-url-file")
    parser.add_argument("--prefix", default="kurisu")
    parser.add_argument("--machine", default="nyannyan", help="OrbStack machine for --api-key-guest-file")
    parser.add_argument("--confirm-authorized-sample", action="store_true",
                        help="confirm the operator-owned sample is licensed for this cloud enrollment")
    args = parser.parse_args()
    if not args.apply:
        validate_endpoint(args.endpoint)
        print("MODE=dry-run; no cloud request, audio upload or protected runtime write")
        print("TARGET_MODEL=" + TARGET_MODEL)
        print("ENROLLMENT_MODEL=" + ENROLLMENT_MODEL)
        print("REFERENCE=operator-owned 10-60 second Japanese sample outside Git; 10-20 seconds recommended")
        return
    if not args.api_key_file and not args.api_key_guest_file:
        parser.error("--apply requires --api-key-file or --api-key-guest-file")
    for name in ("voice_id_file", "manifest_file"):
        if not getattr(args, name):
            parser.error(f"--apply requires --{name.replace('_', '-')}")
    if not args.confirm_authorized_sample:
        parser.error("--apply requires --confirm-authorized-sample")
    apply(args)


if __name__ == "__main__":
    main()
