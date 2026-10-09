#!/usr/bin/env python3
"""Create the runtime-only scrypt verifier for the public Image Lab login."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import sys


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    password = sys.stdin.buffer.readline(4098).rstrip(b"\r\n")
    if not password or len(password) > 4096:
        raise SystemExit("public_password_input_invalid")
    output = Path(args.output).expanduser()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(output.parent, 0o700)
    if output.exists() or output.is_symlink():
        raise SystemExit("public_auth_verifier_already_exists")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password, salt=salt, n=32768, r=8, p=1, dklen=64, maxmem=128 * 1024 * 1024)
    record = {
        "format": "amadeus-qwen-image-lab-scrypt-v1",
        "salt": base64.b64encode(salt).decode("ascii"),
        "scrypt": {"n": 32768, "r": 8, "p": 1, "dklen": 64},
        "digest": base64.b64encode(digest).decode("ascii"),
    }
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(output, flags, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(record, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            output.unlink()
        except OSError:
            pass
        raise
    os.chmod(output, 0o600)
    if stat.S_IMODE(output.stat().st_mode) != 0o600:
        output.unlink(missing_ok=True)
        raise SystemExit("public_auth_verifier_permissions_invalid")
    print("PUBLIC_AUTH_VERIFIER_CREATED=yes")


if __name__ == "__main__":
    main()
