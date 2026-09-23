#!/usr/bin/env python3
"""Normalize restored OpenClaw provider credentials to the image's runtime user."""

from __future__ import annotations

import os
import stat
from pathlib import Path


OPENCLAW_RUNTIME_UID = 1000
OPENCLAW_RUNTIME_GID = 1000


def normalize_runtime_tree(root: Path, chown_fn=os.chown) -> int:
    """Set every credential directory/file to node's UID/GID; reject links and special files."""
    root = Path(root)
    try:
        info = root.lstat()
    except OSError as exc:
        raise ValueError("OpenClaw credential root is unavailable") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ValueError("OpenClaw credential root is not a real directory")
    paths = [root, *root.rglob("*")]
    for path in paths:
        try:
            entry = path.lstat()
        except OSError as exc:
            raise ValueError("OpenClaw credential entry is unavailable") from exc
        if not (stat.S_ISDIR(entry.st_mode) or stat.S_ISREG(entry.st_mode)):
            raise ValueError("OpenClaw credential tree contains a link or special file")
    for path in paths:
        chown_fn(path, OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID, follow_symlinks=False)
    return len(paths)
