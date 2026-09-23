#!/usr/bin/env python3
"""Fail-closed Compose and image checks for migration-safe OpenClaw startup."""

from __future__ import annotations

import json
import os
import re
import secrets
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


IMMUTABLE_IMAGE_RE = re.compile(r"^local/openclaw-amadeus:git-[0-9a-fA-F]{7,40}-[0-9]{14}$")
TEMPLATE_IMAGE_RE = re.compile(
    r"(?m)^([ \t]*)image:[ \t]*\$\{OPENCLAW_IMAGE:-local/openclaw-amadeus:unbuilt\}[ \t]*$"
)
CANONICAL_IMAGE_RE = re.compile(
    r"(?m)^([ \t]*image:[ \t]*)(local/openclaw-amadeus:git-[0-9a-fA-F]{7,40}-[0-9]{14})([ \t]*)(\r?)$"
)


class MigrationPreflightError(RuntimeError):
    pass


def render_canonical_compose(template: str, image: str) -> bytes:
    if not IMMUTABLE_IMAGE_RE.fullmatch(image):
        raise MigrationPreflightError("OpenClaw image must use an immutable local Git-and-timestamp tag")
    rendered, replacements = TEMPLATE_IMAGE_RE.subn(lambda match: match.group(1) + "image: " + image, template)
    if replacements != 1:
        raise MigrationPreflightError("OpenClaw Compose template must contain exactly one default image line")
    return rendered.encode("utf-8")


def install_canonical_compose(template: str, target: Path, image: str) -> str:
    """Create the CasaOS Compose file without replacing any existing app data."""
    target = Path(target)
    payload = render_canonical_compose(template, image)
    if target.parent.is_symlink() or target.is_symlink():
        raise MigrationPreflightError("CasaOS Compose target is symlinked")
    if target.exists():
        if target.is_file() and target.read_bytes() == payload:
            return "already-identical"
        raise MigrationPreflightError("existing CasaOS Compose differs; refusing to overwrite")
    if target.parent.exists():
        if not target.parent.is_dir() or any(target.parent.iterdir()):
            raise MigrationPreflightError("existing OpenClaw app directory is not empty")
    else:
        target.parent.mkdir(mode=0o755, parents=True)

    descriptor, temporary_name = tempfile.mkstemp(prefix=".docker-compose.yml.", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o644)
        os.link(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except FileExistsError:
        raise MigrationPreflightError("CasaOS Compose appeared concurrently; refusing to replace it") from None
    finally:
        temporary.unlink(missing_ok=True)
    return "installed"


def update_canonical_compose_image(target: Path, image: str) -> dict[str, str]:
    """Atomically switch one existing immutable OpenClaw image, retaining a protected copy."""
    target = Path(target)
    if not IMMUTABLE_IMAGE_RE.fullmatch(image):
        raise MigrationPreflightError("OpenClaw image must use an immutable local Git-and-timestamp tag")
    if target.parent.is_symlink() or target.is_symlink() or not target.is_file():
        raise MigrationPreflightError("canonical Compose file is missing or symlinked")
    try:
        original = target.read_bytes()
        source = original.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        raise MigrationPreflightError("canonical Compose file is unreadable UTF-8") from None
    matches = list(CANONICAL_IMAGE_RE.finditer(source))
    if len(matches) != 1:
        raise MigrationPreflightError("canonical Compose must contain exactly one immutable OpenClaw image line")
    match = matches[0]
    previous_image = match.group(2)
    if previous_image == image:
        return {"status": "already-current", "previousImage": previous_image, "image": image, "backup": ""}

    metadata = target.stat(follow_symlinks=False)
    backup_root = target.parent / ".operation-skuld-compose-backups"
    if backup_root.is_symlink():
        raise MigrationPreflightError("protected Compose backup directory is symlinked")
    backup_root.mkdir(mode=0o700, exist_ok=True)
    if not backup_root.is_dir():
        raise MigrationPreflightError("protected Compose backup path is not a directory")
    os.chmod(backup_root, 0o700)
    if os.geteuid() == 0:
        os.chown(backup_root, 0, 0)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backup_root / f"docker-compose.yml.before-image-update-{stamp}-{secrets.token_hex(4)}.bak"
    try:
        descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise MigrationPreflightError("protected Compose backup unexpectedly already exists") from None
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(original)
            stream.flush()
            os.fsync(stream.fileno())
        if os.geteuid() == 0:
            os.chown(backup, 0, 0)
        os.chmod(backup, 0o600)
        directory_fd = os.open(backup_root, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        backup.unlink(missing_ok=True)
        raise MigrationPreflightError("protected Compose backup could not be completed") from error

    updated, replacements = CANONICAL_IMAGE_RE.subn(
        lambda item: item.group(1) + image + item.group(3) + item.group(4), source
    )
    if replacements != 1:
        raise MigrationPreflightError("canonical Compose image changed during update")
    temporary = target.with_name(f".{target.name}.{secrets.token_hex(8)}.tmp")
    try:
        if target.read_bytes() != original:
            raise MigrationPreflightError("canonical Compose changed concurrently; protected previous copy retained")
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IMODE(metadata.st_mode))
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(updated.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        if os.geteuid() == 0:
            os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.replace(temporary, target)
        directory_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        temporary.unlink(missing_ok=True)
        raise MigrationPreflightError(
            f"canonical Compose image update failed; protected previous copy retained at {backup.name}"
        ) from error
    return {"status": "updated", "previousImage": previous_image, "image": image, "backup": str(backup)}


def validate_compose_project(
    app_dir: Path,
    overlay_file: Path,
    run: Callable[..., subprocess.CompletedProcess[str]] | None = None,
) -> str:
    run = run or subprocess.run
    app_dir = Path(app_dir)
    compose_file = app_dir / "docker-compose.yml"
    overlay_file = Path(overlay_file)

    if compose_file.is_symlink() or not compose_file.is_file():
        raise MigrationPreflightError("canonical Compose file is missing or symlinked")
    if overlay_file.is_symlink() or not overlay_file.is_file():
        raise MigrationPreflightError("migration-safe Compose overlay is missing or symlinked")

    rendered = run(
        [
            "docker", "compose", "--project-directory", str(app_dir),
            "-f", str(compose_file), "-f", str(overlay_file),
            "config", "--format", "json",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if rendered.returncode != 0:
        raise MigrationPreflightError("Docker Compose render failed")
    try:
        document = json.loads(rendered.stdout)
        service = document["services"]["openclaw"]
    except (json.JSONDecodeError, KeyError, TypeError):
        raise MigrationPreflightError("rendered Compose has no valid openclaw service") from None

    image = service.get("image")
    if not isinstance(image, str) or not IMMUTABLE_IMAGE_RE.fullmatch(image):
        raise MigrationPreflightError("OpenClaw image must use an immutable local Git-and-timestamp tag")
    environment = service.get("environment") or {}
    volumes = service.get("volumes") or []
    if service.get("ports") not in (None, []):
        raise MigrationPreflightError("migration-safe Compose still publishes ports")
    if environment.get("OPENCLAW_CONFIG_PATH") != "/run/openclaw-migration/openclaw.json":
        raise MigrationPreflightError("migration-safe config path mismatch")
    if str(environment.get("OWNER_NOTIFICATION_DELIVERY_ENABLED")).lower() != "false":
        raise MigrationPreflightError("owner delivery is not disabled")
    if service.get("restart") not in ("no", None):
        raise MigrationPreflightError("migration-safe restart policy is not disabled")
    if not any(
        isinstance(volume, dict)
        and volume.get("target") == "/run/openclaw-migration"
        and volume.get("read_only") is True
        for volume in volumes
    ):
        raise MigrationPreflightError("migration overlay mount must be read-only")

    inspected = run(
        ["docker", "image", "inspect", image],
        check=False,
        capture_output=True,
        text=True,
    )
    if inspected.returncode != 0:
        raise MigrationPreflightError("immutable OpenClaw image is not loaded locally")
    return image


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print("Usage: openclaw_migration_safe_preflight.py APP_DIR OVERLAY_FILE", file=sys.stderr)
        return 2
    try:
        image = validate_compose_project(Path(args[0]), Path(args[1]))
    except (MigrationPreflightError, OSError) as error:
        print(f"MIGRATION_SAFE_PREFLIGHT=BLOCKED reason={error}", file=sys.stderr)
        return 1
    print(f"MIGRATION_SAFE_PREFLIGHT=passed image={image}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
