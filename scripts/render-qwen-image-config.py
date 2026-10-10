#!/usr/bin/env python3
"""Render a Qwen engine template with an operator-owned private path profile.

The checked-in engine JSON files contain only variable references.  The
runtime profile is a separate mode-0600 JSON file and is never copied to the
repository or printed by this helper.
"""
from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path


PROFILE_KEYS = {
    "QWEN_IMAGE_ASSET_ROOT": "assetRoot",
    "QWEN_IMAGE_SD_CPP_SOURCE": "sdCppSourcePath",
    "QWEN_IMAGE_SD_CPP_BINARY": "sdCppBinary",
    "QWEN_IMAGE_LOG_DIR": "logDir",
    "QWEN_IMAGE_FUN_ACC_CONVERTER": "funAccConverterPath",
    "QWEN_IMAGE_SD_CPP_PATCH": "sdCppPatchPath",
}


def fail(message: str) -> "NoReturn":
    raise SystemExit(message)


def load_profile(path: Path) -> dict[str, str]:
    try:
        metadata = path.lstat()
    except OSError as error:
        fail(f"qwen_runtime_profile_missing: {error}")
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        fail("qwen_runtime_profile_not_private")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"qwen_runtime_profile_invalid: {error}")
    if not isinstance(value, dict) or not set(PROFILE_KEYS.values()).issubset(value):
        fail("qwen_runtime_profile_invalid")
    result: dict[str, str] = {}
    for key in PROFILE_KEYS.values():
        item = value.get(key)
        if not isinstance(item, str) or not item.startswith("/") or "\x00" in item:
            fail(f"qwen_runtime_profile_path_invalid:{key}")
        result[key] = item
    if "hostName" in value and (not isinstance(value["hostName"], str) or not value["hostName"].strip()):
        fail("qwen_runtime_profile_host_invalid")
    if "macosUser" in value and (not isinstance(value["macosUser"], str) or not value["macosUser"].strip()):
        fail("qwen_runtime_profile_user_invalid")
    if "hostName" in value:
        result["hostName"] = value["hostName"].strip()
    if "macosUser" in value:
        result["macosUser"] = value["macosUser"].strip()
    return result


def render(value: object, profile: dict[str, str]) -> object:
    if isinstance(value, dict):
        return {key: render(item, profile) for key, item in value.items()}
    if isinstance(value, list):
        return [render(item, profile) for item in value]
    if not isinstance(value, str):
        return value
    result = value
    for env_name, profile_key in PROFILE_KEYS.items():
        result = result.replace("${" + env_name + "}", profile[profile_key])
    if "${QWEN_IMAGE_" in result:
        fail("qwen_runtime_template_unresolved")
    return result


def main() -> None:
    if len(sys.argv) != 4:
        fail("usage: render-qwen-image-config.py TEMPLATE PROFILE OUTPUT")
    template_path, profile_path, output_path = map(Path, sys.argv[1:])
    try:
        template = json.loads(template_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"qwen_engine_template_invalid: {error}")
    rendered = render(template, load_profile(profile_path))
    output_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = output_path.with_name(output_path.name + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(rendered, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
    temporary.replace(output_path)
    print("QWEN_RUNTIME_CONFIG=rendered")


if __name__ == "__main__":
    main()
