#!/usr/bin/env python3
"""Validate the ID-only VPS account map used by accounting and the probe."""

from __future__ import annotations

import json
import re
import stat
import sys
from pathlib import Path

EXPECTED_KEYS = {"activeAccountIds", "dedicatedAccountId", "legacyAccountId"}
ACCOUNT_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")


def validate(path: Path, *, require_private_mode: bool = False) -> dict[str, object]:
    if not path.is_file() or path.is_symlink():
        raise ValueError("map must be a regular file")
    if require_private_mode and stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError("private map must be mode 0600")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != EXPECTED_KEYS:
        raise ValueError("map must contain only the three ID fields")
    active = value.get("activeAccountIds")
    dedicated = value.get("dedicatedAccountId")
    legacy = value.get("legacyAccountId")
    if not isinstance(active, list) or len(active) != 5:
        raise ValueError("map must contain five active account IDs")
    ids = [*active, dedicated, legacy]
    if any(not isinstance(item, str) or ACCOUNT_ID.fullmatch(item) is None for item in ids):
        raise ValueError("map contains an invalid account ID")
    if len(set(ids)) != 7:
        raise ValueError("account IDs must be unique")
    return {"activeAccountIds": active, "dedicatedAccountId": dedicated, "legacyAccountId": legacy}


def main() -> int:
    if len(sys.argv) not in (2, 3) or sys.argv[1] in {"-h", "--help"}:
        print("usage: validate-vps-account-map.py PATH [--private]", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        normalized = validate(path, require_private_mode=len(sys.argv) == 3 and sys.argv[2] == "--private")
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ACCOUNT_MAP_INVALID={error}", file=sys.stderr)
        return 1
    print(json.dumps(normalized, separators=(",", ":"), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
