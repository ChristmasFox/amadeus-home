#!/usr/bin/env python3
"""Read only the Lab container/image identity fields used by release doctor."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode:
        raise RuntimeError("read-only Lab runtime query failed")
    return result.stdout.strip()


def host_profile() -> tuple[str, str, str, str]:
    profile = ROOT / "scripts/host-profile.sh"
    command = [
        "bash", "-c",
        'source "$1"; amadeus_host_profile_load "$2"; printf "%s\\t%s\\t%s\\t%s" "$ORBSTACK_MACHINE" "$OPENCLAW_APP_DIR/docker-compose.yml" "$RADAR_APP_DIR/docker-compose.yml" "$OPENCLAW_DATA_DIR/config/openclaw.json"',
        "lab-runtime-profile", str(profile), str(ROOT),
    ]
    values = run(command).split("\t")
    if len(values) != 4:
        raise RuntimeError("configured host profile is incomplete")
    return values[0], values[1], values[2], values[3]


def compose_digest(machine: str, compose_file: str) -> str:
    value = run([
        "orb", "-m", machine, "-u", "root", "bash", "-lc",
        'sha256sum -- "$1" | cut -d" " -f1', "release-compose-hash", compose_file,
    ])
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RuntimeError("Compose configuration digest is invalid")
    return "sha256:" + value


def config_digest(machine: str, config_file: str) -> str:
    value = run([
        "orb", "-m", machine, "-u", "root", "bash", "-lc",
        'sha256sum -- "$1" | cut -d" " -f1', "release-config-hash", config_file,
    ])
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RuntimeError("runtime configuration digest is invalid")
    return "sha256:" + value


def one_container(machine: str, container: str, service: str, compose_file: str, config_file: str | None = None) -> dict[str, Any]:
    fields = run([
        "orb", "-m", machine, "-u", "root", "docker", "inspect",
        "--format", '{{.Image}}|{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}',
        container,
    ]).split("|")
    if len(fields) != 4:
        raise RuntimeError(f"cannot parse sanitized inspect fields for {service}")
    image_id, image_ref, state, health = fields
    if not image_id.startswith("sha256:") or not image_ref:
        raise RuntimeError(f"runtime identity is incomplete for {service}")
    image_fields = run([
        "orb", "-m", machine, "-u", "root", "docker", "image", "inspect",
        "--format", '{{.Id}}|{{json .RepoDigests}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.created"}}|{{.Created}}',
        image_id,
    ]).split("|", 5)
    if len(image_fields) != 6:
        raise RuntimeError(f"cannot parse sanitized provenance fields for {service}")
    inspected_id, repo_digests_text, revision, version, created_label, created = image_fields
    if inspected_id != image_id:
        raise RuntimeError(f"container and image identity differ for {service}")
    try:
        repo_digests = json.loads(repo_digests_text)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"image digest metadata is invalid for {service}") from error
    digest = repo_digests[0].rsplit("@", 1)[-1] if isinstance(repo_digests, list) and repo_digests else image_id
    provenance_source = "oci-label"
    if revision in {"", "<no value>"} or version in {"", "<no value>"}:
        match = re.search(r":git-([0-9a-fA-F]{7,40})-([0-9]{12}|[0-9]{14})$", image_ref)
        if match:
            resolved = subprocess.run(
                ["git", "-C", str(ROOT), "rev-parse", "--verify", f"{match.group(1)}^{{commit}}"],
                capture_output=True, text=True, check=False,
            )
            if resolved.returncode == 0:
                revision = resolved.stdout.strip()
                version_result = subprocess.run(
                    ["git", "-C", str(ROOT), "show", f"{revision}:VERSION"],
                    capture_output=True, text=True, check=False,
                )
                if version_result.returncode == 0:
                    version = version_result.stdout.strip()
                    provenance_source = "immutable-image-tag+git-source"
    built_at = created_label if created_label not in {"", "<no value>"} else created
    return {
        "service": service,
        "imageRef": image_ref,
        "composeDigest": compose_digest(machine, compose_file),
        "configDigest": config_digest(machine, config_file) if config_file else None,
        "digest": digest,
        "imageId": image_id,
        "state": state,
        "health": health,
        "version": None if version in {"", "<no value>"} else version,
        "gitSha": None if revision in {"", "<no value>"} else revision,
        "builtAt": built_at,
        "provenanceSource": provenance_source,
        "schemaVersion": None,
    }


def main() -> int:
    try:
        machine, openclaw_compose, radar_compose, openclaw_config = host_profile()
        if machine == "community":
            raise RuntimeError("no operator-owned Lab host profile is configured")
        services = [
            one_container(machine, "openclaw", "openclaw", openclaw_compose, openclaw_config),
            one_container(machine, "product-radar", "product-radar", radar_compose),
        ]
    except (OSError, RuntimeError) as error:
        print(f"LAB_RUNTIME_SNAPSHOT_ERROR={error}", file=sys.stderr)
        return 2
    snapshot = {
        "runtimeSchema": "amadeus-release-runtime/v1",
        "product": "lab",
        "environment": "lab-maintainer",
        "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "services": services,
    }
    json.dump(snapshot, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
