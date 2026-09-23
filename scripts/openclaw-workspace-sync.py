#!/usr/bin/env python3
"""Review or explicitly synchronize one OpenClaw workspace seed file."""

from __future__ import annotations

import argparse
import difflib
import hashlib
import os
import stat
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = Path(os.environ.get("OPENCLAW_WORKSPACE_DIR", "/DATA/AppData/openclaw/workspace"))
SEEDS = {
    "AGENTS.md": ROOT / "integrations/openclaw/workspace-seed/AGENTS.seed.md",
    "SOUL.md": ROOT / "integrations/openclaw/workspace-seed/SOUL.seed.md",
    "USER.md": ROOT / "integrations/openclaw/workspace-seed/USER.seed.md",
    "MEMORY.md": ROOT / "integrations/openclaw/workspace-seed/MEMORY.seed.md",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def runtime_bytes(path: Path) -> tuple[str, bytes | None]:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return "missing", None
    if stat.S_ISLNK(info.st_mode):
        return "symlink", os.fsencode(os.readlink(path))
    if stat.S_ISREG(info.st_mode):
        return "file", path.read_bytes()
    if stat.S_ISDIR(info.st_mode):
        return "directory", None
    return "other", None


def show_plan(name: str) -> tuple[Path, bytes, str, bytes | None]:
    seed_path = SEEDS[name]
    seed = seed_path.read_bytes()
    target = WORKSPACE / name
    kind, current = runtime_bytes(target)
    print(f"FILE={name}")
    print(f"SEED_SHA256={digest(seed)}")
    print(f"RUNTIME_KIND={kind}")
    print(f"RUNTIME_SHA256={digest(current) if current is not None else 'unavailable'}")
    if kind in ("missing", "file"):
        old_text = current.decode("utf-8", errors="replace").splitlines(keepends=True) if current is not None else []
        new_text = seed.decode("utf-8", errors="replace").splitlines(keepends=True)
        diff = list(difflib.unified_diff(old_text, new_text, fromfile=f"runtime/{name}", tofile=f"seed/{name}"))
        if diff:
            sys.stdout.writelines(diff)
        else:
            print("DIFF=identical")
    else:
        print("DIFF=unavailable (runtime path is not a regular file)")
    return target, seed, kind, current


def write_new(target: Path, content: bytes) -> None:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o644)
    created = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(target, 0o644, follow_symlinks=False)
    except BaseException:
        try:
            current = target.lstat()
            if current.st_dev == created.st_dev and current.st_ino == created.st_ino:
                target.unlink()
        except FileNotFoundError:
            pass
        raise


def replace_regular(target: Path, content: bytes, original: os.stat_result) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.sync-", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(original.st_mode), follow_symlinks=False)
        if os.geteuid() == 0:
            os.chown(temporary, original.st_uid, original.st_gid, follow_symlinks=False)
        current = target.lstat()
        if not stat.S_ISREG(current.st_mode) or (current.st_dev, current.st_ino) != (original.st_dev, original.st_ino):
            raise RuntimeError("runtime file changed during sync; refusing replacement")
        os.replace(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--plan", action="store_true", help="show hashes and diff (default)")
    action.add_argument("--apply", action="store_true", help="synchronize one approved file")
    parser.add_argument("--approve-file", action="append", choices=tuple(SEEDS), help="approve exactly one file for --apply")
    args = parser.parse_args()

    if args.apply:
        if args.approve_file is None or len(args.approve_file) != 1:
            parser.error("--apply requires exactly one --approve-file NAME")
        if WORKSPACE.is_symlink():
            raise SystemExit("refusing to use a symlink as runtime workspace")
        WORKSPACE.mkdir(parents=True, exist_ok=True)
        if not WORKSPACE.is_dir():
            raise SystemExit("runtime workspace is not a directory")
        name = args.approve_file[0]
        target, seed, kind, _ = show_plan(name)
        if kind == "missing":
            write_new(target, seed)
        elif kind == "file":
            original = target.lstat()
            replace_regular(target, seed, original)
        else:
            raise SystemExit(f"refusing to replace runtime {kind}: {name}")
        print(f"SYNC_APPLIED_FILE={name}")
        print(f"SYNC_RESULT_SHA256={digest(seed)}")
        return 0

    if args.approve_file:
        parser.error("--approve-file is valid only with --apply")
    for name in SEEDS:
        show_plan(name)
    print("SYNC_MODE=plan-only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
