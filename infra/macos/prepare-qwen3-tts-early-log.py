#!/usr/bin/env python3
"""Prepare a private, capped launchd stderr destination before agent bootstrap."""
from __future__ import annotations

import os
from pathlib import Path
import stat
import sys

CAP_BYTES = 1024 * 1024


def prepare(path: Path) -> None:
    # launchd opens this file itself; refuse symlinks and foreign/non-private files.
    if path.is_symlink():
        raise ValueError('early_log_symlink_forbidden')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ValueError('early_log_owner_or_type_invalid')
        os.fchmod(fd, 0o600)
        if info.st_size > CAP_BYTES:
            os.ftruncate(fd, 0)
    finally:
        os.close(fd)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: prepare-qwen3-tts-early-log.py PATH')
    prepare(Path(sys.argv[1]))
