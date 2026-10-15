#!/usr/bin/env python3
"""Read only the Lab container/image identity fields used by release doctor."""

from __future__ import annotations

import json
import argparse
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OCI_REVISION_LABEL = "org.opencontainers.image.revision"
OCI_VERSION_LABEL = "org.opencontainers.image.version"
OCI_CREATED_LABEL = "org.opencontainers.image.created"
PROVENANCE_LABEL = "com.amadeus.release.provenance"
PROVENANCE_MARKER = "amadeus-product-release-v1"
QUERY_TIMEOUT_SECONDS = 30


def label_field(name: str) -> str:
    return '{{with (index .Config "Labels")}}{{index . "' + name + '"}}{{else}}<no value>{{end}}'


IMAGE_INSPECT_FORMAT = "|".join((
    "{{.Id}}",
    "{{json .RepoDigests}}",
    label_field(PROVENANCE_LABEL),
    label_field(OCI_REVISION_LABEL),
    label_field(OCI_VERSION_LABEL),
    label_field(OCI_CREATED_LABEL),
    "{{.Created}}",
))


def run(command: list[str]) -> str:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=QUERY_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("read-only Lab runtime query timed out") from None
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
        "orb", "-m", machine, "-u", "root", "sha256sum", "--", compose_file,
    ]).partition(" ")[0]
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RuntimeError("Compose configuration digest is invalid")
    return "sha256:" + value


def config_digest(machine: str, config_file: str) -> str:
    value = run([
        "orb", "-m", machine, "-u", "root", "sha256sum", "--", config_file,
    ]).partition(" ")[0]
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise RuntimeError("runtime configuration digest is invalid")
    return "sha256:" + value


def parse_image_inspect_output(output: str, image_id: str, image_ref: str, repo: Path = ROOT) -> dict[str, Any]:
    fields = output.split("|", 6)
    if len(fields) != 7:
        raise RuntimeError("cannot parse sanitized image provenance fields")
    inspected_id, repo_digests_text, provenance_marker, revision, version, created_label, created = fields
    if inspected_id != image_id:
        raise RuntimeError("container and image identity differ")
    try:
        repo_digests = json.loads(repo_digests_text)
    except json.JSONDecodeError as error:
        raise RuntimeError("image digest metadata is invalid") from error
    if not isinstance(repo_digests, list) or any(not isinstance(item, str) for item in repo_digests):
        raise RuntimeError("image digest metadata is invalid")
    digest = repo_digests[0].rsplit("@", 1)[-1] if repo_digests else image_id
    provenance_source = "oci-label"
    if provenance_marker != PROVENANCE_MARKER:
        revision = version = created_label = "<no value>"
        provenance_source = "unavailable"
    if revision in {"", "<no value>"} or version in {"", "<no value>"}:
        provenance_source = "unavailable"
        match = re.search(r":git-([0-9a-fA-F]{7,40})-([0-9]{12}|[0-9]{14})$", image_ref)
        if match:
            resolved = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "--verify", f"{match.group(1)}^{{commit}}"],
                capture_output=True, text=True, check=False,
            )
            if resolved.returncode == 0:
                revision = resolved.stdout.strip()
                version_result = subprocess.run(
                    ["git", "-C", str(repo), "show", f"{revision}:VERSION"],
                    capture_output=True, text=True, check=False,
                )
                if version_result.returncode == 0:
                    version = version_result.stdout.strip()
                    provenance_source = "immutable-image-tag+git-source"
    built_at = created_label if created_label not in {"", "<no value>"} else created
    return {
        "digest": digest,
        "gitSha": None if revision in {"", "<no value>"} else revision,
        "version": None if version in {"", "<no value>"} else version,
        "builtAt": built_at,
        "provenanceSource": provenance_source,
    }


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
        "--format", IMAGE_INSPECT_FORMAT,
        "--",
        image_id,
    ])
    image_provenance = parse_image_inspect_output(image_fields, image_id, image_ref)
    return {
        "service": service,
        "imageRef": image_ref,
        "composeDigest": compose_digest(machine, compose_file),
        "configDigest": config_digest(machine, config_file) if config_file else None,
        "digest": image_provenance["digest"],
        "imageId": image_id,
        "state": state,
        "health": health,
        "version": image_provenance["version"],
        "gitSha": image_provenance["gitSha"],
        "builtAt": image_provenance["builtAt"],
        "provenanceSource": image_provenance["provenanceSource"],
        "schemaVersion": None,
    }


def main() -> int:
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--service", choices=("openclaw", "product-radar"), action="append")
        args = parser.parse_args()
        machine, openclaw_compose, radar_compose, openclaw_config = host_profile()
        if machine == "community":
            raise RuntimeError("no operator-owned Lab host profile is configured")
        requested = set(args.service or ("openclaw", "product-radar"))
        services = []
        if "openclaw" in requested:
            services.append(one_container(machine, "openclaw", "openclaw", openclaw_compose, openclaw_config))
        if "product-radar" in requested:
            services.append(one_container(machine, "product-radar", "product-radar", radar_compose))
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
