#!/usr/bin/env python3
"""Fail-closed Compose and image checks for migration-safe OpenClaw startup."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable


IMMUTABLE_IMAGE_RE = re.compile(r"^local/openclaw-amadeus:git-[0-9a-fA-F]{7,40}-[0-9]{14}$")


class MigrationPreflightError(RuntimeError):
    pass


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
