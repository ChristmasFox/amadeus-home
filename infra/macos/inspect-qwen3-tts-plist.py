#!/usr/bin/env python3
"""Report only the validity and selected engine in a Qwen3-TTS LaunchAgent plist."""
from __future__ import annotations

import argparse
from pathlib import Path
import plistlib


def inspect(path: Path) -> tuple[str, str]:
    if path.is_symlink():
        return "symlink", "unknown"
    if not path.exists():
        return "missing", "unknown"
    if not path.is_file():
        return "invalid_shape", "unknown"
    try:
        value = plistlib.loads(path.read_bytes())
    except (OSError, plistlib.InvalidFileException, ValueError, TypeError, OverflowError):
        return "invalid", "unknown"
    if not isinstance(value, dict):
        return "invalid_shape", "unknown"
    environment = value.get("EnvironmentVariables")
    if not isinstance(environment, dict):
        return "valid_missing_engine", "unknown"
    engine = environment.get("AMADEUS_TTS_ENGINE")
    if engine in ("mlx", "mps"):
        return "valid", engine
    return "valid_unsupported_engine", "unknown"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plist", type=Path)
    args = parser.parse_args()
    status, engine = inspect(args.plist)
    print(f"PLIST_STATUS={status}")
    print(f"PLIST_ENGINE={engine}")


if __name__ == "__main__":
    main()
