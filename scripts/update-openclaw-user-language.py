#!/usr/bin/env python3
"""Replace only the legacy USER.md language preference; preserve other user data."""
from __future__ import annotations

import argparse
import hashlib
import os
import stat
import tempfile
from pathlib import Path

OLD = b"- Prefer Japanese replies by default; switch to Simplified Chinese only when explicitly requested."
NEW = b"- Prefer Simplified Chinese for ordinary text replies."
WORKSPACE = Path(os.environ.get("OPENCLAW_WORKSPACE_DIR", "/DATA/AppData/openclaw/workspace"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    target = WORKSPACE / "USER.md"
    if WORKSPACE.is_symlink() or target.is_symlink() or not target.is_file():
        raise SystemExit("USER.md must be a regular file in a real workspace")
    before = target.read_bytes()
    if before.count(NEW) == 1 and OLD not in before:
        print("USER_LANGUAGE=already-current")
        return
    if before.count(OLD) != 1 or NEW in before:
        raise SystemExit("legacy USER.md language anchor changed; refusing overwrite")
    after = before.replace(OLD, NEW)
    print("USER_LANGUAGE=would-update" if not args.apply else "USER_LANGUAGE=updating")
    print("USER_SHA256_BEFORE=" + hashlib.sha256(before).hexdigest())
    print("USER_SHA256_AFTER=" + hashlib.sha256(after).hexdigest())
    if not args.apply:
        return
    original = target.lstat()
    fd, name = tempfile.mkstemp(prefix=".USER.md.language-", dir=WORKSPACE)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(after)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(original.st_mode))
        if os.geteuid() == 0:
            os.chown(temporary, original.st_uid, original.st_gid)
        current = target.lstat()
        if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
            raise SystemExit("USER.md changed during update")
        os.replace(temporary, target)
        print("USER_LANGUAGE=updated")
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
