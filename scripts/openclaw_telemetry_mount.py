#!/usr/bin/env python3
"""Install the durable PUBG telemetry bind mount for an OpenClaw-only candidate."""
from __future__ import annotations

import os
import re
import stat
import sys
import tempfile
from pathlib import Path

ARCHIVE_TARGET = "/var/lib/amadeus/pubg-telemetry-archive"
ARCHIVE_VOLUME = (
    "${PUBG_TELEMETRY_ARCHIVE_HOST_DIR:-/DATA/AppData/openclaw/data/"
    "pubg-telemetry-archive}:" + ARCHIVE_TARGET
)
ENV_KEY = "PUBG_TELEMETRY_ARCHIVE_HOST_DIR"
SERVICE_RE = re.compile(r"^  openclaw:\s*(?:#.*)?$")
TOP_LEVEL_SERVICE_RE = re.compile(r"^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$")


def _service_bounds(lines: list[str]) -> tuple[int, int]:
    starts = [index for index, line in enumerate(lines) if SERVICE_RE.match(line.rstrip("\r\n"))]
    if len(starts) != 1:
        raise ValueError("openclaw_compose_service_ambiguous")
    start = starts[0]
    end = next(
        (index for index in range(start + 1, len(lines))
         if TOP_LEVEL_SERVICE_RE.match(lines[index].rstrip("\r\n"))),
        len(lines),
    )
    return start, end


def ensure_archive_mount(compose: str, image: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9._/@:-]+", image):
        raise ValueError("openclaw_compose_image_invalid")
    newline = "\r\n" if "\r\n" in compose else "\n"
    lines = compose.splitlines(keepends=True)
    start, end = _service_bounds(lines)

    image_lines = [
        index for index in range(start + 1, end)
        if re.match(r"^\s*image:\s*\S+", lines[index])
    ]
    if len(image_lines) != 1:
        raise ValueError("openclaw_compose_image_ambiguous")
    image_index = image_lines[0]
    image_line = lines[image_index]
    match = re.match(r"^(\s*image:\s*)\S+", image_line)
    assert match is not None
    lines[image_index] = match.group(1) + image + image_line[match.end():]

    volume_headers = [
        index for index in range(start + 1, end)
        if re.match(r"^    volumes:\s*(?:#.*)?(?:\r?\n)?$", lines[index])
    ]
    if len(volume_headers) > 1:
        raise ValueError("openclaw_compose_volumes_ambiguous")
    if not volume_headers:
        lines[end:end] = [f"    volumes:{newline}", f"      - {ARCHIVE_VOLUME}{newline}"]
    else:
        header = volume_headers[0]
        block_end = end
        for index in range(header + 1, end):
            line = lines[index]
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            indent = len(line) - len(line.lstrip(" "))
            if indent <= 4:
                block_end = index
                break
        target_lines = [
            index for index in range(header + 1, block_end)
            if ARCHIVE_TARGET in lines[index] and not lines[index].lstrip().startswith("#")
        ]
        if len(target_lines) > 1:
            raise ValueError("openclaw_compose_archive_mount_ambiguous")
        if target_lines:
            index = target_lines[0]
            if not re.match(r"^\s*-\s+", lines[index]):
                raise ValueError("openclaw_compose_archive_mount_invalid")
            indent = re.match(r"^(\s*)-\s+", lines[index])
            assert indent is not None
            lines[index] = indent.group(1) + "- " + ARCHIVE_VOLUME + newline
        else:
            lines.insert(header + 1, f"      - {ARCHIVE_VOLUME}{newline}")

    return "".join(lines)


def ensure_archive_env(env_text: str, archive_dir: str) -> str:
    path = Path(archive_dir)
    if not path.is_absolute() or "\n" in archive_dir or "\r" in archive_dir:
        raise ValueError("pubg_telemetry_archive_path_invalid")
    lines = env_text.splitlines()
    indexes = [index for index, line in enumerate(lines) if line.split("=", 1)[0].strip() == ENV_KEY]
    if len(indexes) > 1:
        raise ValueError("pubg_telemetry_archive_env_ambiguous")
    value = f"{ENV_KEY}={archive_dir}"
    if indexes:
        lines[indexes[0]] = value
    else:
        lines.append(value)
    return "\n".join(lines) + "\n"


def _atomic_write(path: Path, content: str, default_mode: int) -> None:
    if path.is_symlink():
        raise ValueError("openclaw_compose_path_symlink")
    if path.exists() and not path.is_file():
        raise ValueError("openclaw_compose_path_invalid")
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else default_mode
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def install(compose_path: Path, env_path: Path, image: str, archive_dir: str) -> None:
    archive_path = Path(archive_dir)
    if not archive_path.is_absolute() or "\n" in archive_dir or "\r" in archive_dir:
        raise ValueError("pubg_telemetry_archive_path_invalid")

    # Validate all configuration before changing the archive directory or either
    # runtime file. A malformed live Compose file must leave the target untouched.
    for path in (compose_path, env_path):
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError("openclaw_runtime_config_path_invalid")
    compose_text = compose_path.read_text(encoding="utf-8")
    env_text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    updated_compose = ensure_archive_mount(compose_text, image)
    updated_env = ensure_archive_env(env_text, archive_dir)

    archive_path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if archive_path.is_symlink() or not archive_path.is_dir():
        raise ValueError("pubg_telemetry_archive_path_invalid")
    archive_entries = [archive_path, *archive_path.rglob("*")]
    for entry in archive_entries:
        if entry.is_symlink() or not (entry.is_dir() or entry.is_file()):
            raise ValueError("pubg_telemetry_archive_entry_invalid")
    for entry in archive_entries:
        os.chown(entry, 1000, 1000, follow_symlinks=False)
        os.chmod(entry, 0o700 if entry.is_dir() else 0o600)

    _atomic_write(compose_path, updated_compose, 0o644)
    _atomic_write(env_path, updated_env, 0o600)


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("usage: openclaw_telemetry_mount.py compose env image archive-dir")
    compose_path, env_path, image, archive_dir = sys.argv[1:]
    install(Path(compose_path), Path(env_path), image, archive_dir)
    print("OPENCLAW_COMPOSE_IMAGE=updated")
    print("OPENCLAW_TELEMETRY_ARCHIVE_MOUNT=installed")
    print("OPENCLAW_COMPOSE_ENV=updated")


if __name__ == "__main__":
    main()
