#!/usr/bin/env python3
"""Validate protected release manifests and compare them with runtime evidence."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SCHEMA = "amadeus-release-manifest/v1"
RUNTIME_SCHEMA = "amadeus-release-runtime/v1"
SEMVER = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")


class StateError(Exception):
    pass


def timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise StateError(f"{field} must be a timezone-aware ISO timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise StateError(f"{field} must be a timezone-aware ISO timestamp") from error
    if parsed.tzinfo is None:
        raise StateError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def required_string(document: dict[str, Any], key: str) -> str:
    value = document.get(key)
    if not isinstance(value, str) or not value.strip():
        raise StateError(f"{key} must be a non-empty string")
    return value.strip()


def require_nonsecret_ref(document: dict[str, Any], key: str) -> str:
    value = required_string(document, key)
    if re.search(r"(?i)(token|secret|password|api[_-]?key|bearer)", value) or re.search(r"\w://[^/\s]*@", value):
        raise StateError(f"{key} must be a non-secret identifier")
    return value


def validate_manifest(document: Any) -> dict[str, Any]:
    if not isinstance(document, dict):
        raise StateError("manifest must be a JSON object")
    if document.get("manifestSchema") != MANIFEST_SCHEMA:
        raise StateError("unsupported release manifest schema")
    product = required_string(document, "product")
    if product not in {"lab", "gate"}:
        raise StateError("product must be lab or gate")
    environment = required_string(document, "environment")
    if product == "lab" and environment != "lab-maintainer":
        raise StateError("Lab environment must be lab-maintainer")
    if product == "gate" and environment not in {"gate-local", "gate-staging", "gate-prod"}:
        raise StateError("Gate environment must be gate-local, gate-staging, or gate-prod")
    status = required_string(document, "status")
    if status not in {"candidate", "released", "rolled_back"}:
        raise StateError("status must be candidate, released, or rolled_back")
    version = required_string(document, "version")
    if not SEMVER.fullmatch(version):
        raise StateError("version must be stable SemVer")
    if not SHA.fullmatch(required_string(document, "gitSha")):
        raise StateError("gitSha must be a full 40-character lowercase commit SHA")
    for key in ("builtAt", "deployedAt"):
        timestamp(document.get(key), key)
    for key in ("checkpointRef", "actor", "approvalRef", "validationRef"):
        require_nonsecret_ref(document, key)
    schema_version = document.get("schemaVersion")
    if schema_version is not None and (not isinstance(schema_version, str) or not schema_version.strip()):
        raise StateError("schemaVersion must be null or a non-empty string")
    digests = document.get("imageDigests")
    refs = document.get("imageRefs")
    if not isinstance(digests, list) or not digests:
        raise StateError("imageDigests must list every controlled service image")
    if not isinstance(refs, list) or not refs:
        raise StateError("imageRefs must list each service's immutable image reference")
    def service_map(rows: Any, field: str, value_key: str, pattern: re.Pattern[str] | None = None) -> dict[str, str]:
        if not isinstance(rows, list) or not rows:
            raise StateError(f"{field} must be a non-empty list")
        mapped: dict[str, str] = {}
        for row in rows:
            if not isinstance(row, dict):
                raise StateError(f"{field} entries must be objects")
            service = required_string(row, "service")
            value = required_string(row, value_key)
            if service in mapped:
                raise StateError(f"{field} contains a duplicate service: {service}")
            if pattern and not pattern.fullmatch(value):
                raise StateError(f"{field}.{service} must be a sha256 digest")
            mapped[service] = value
        return mapped
    digest_map = service_map(digests, "imageDigests", "digest", DIGEST)
    ref_map = service_map(refs, "imageRefs", "imageRef")
    for row in refs:
        image_ref = required_string(row, "imageRef")
        if re.search(r"(?i)(token|secret|password|api[_-]?key|bearer)", image_ref) or re.search(r"\w://[^/\s]*@", image_ref):
            raise StateError(f"imageRefs.{row['service']} must not contain credentials")
        if not DIGEST.fullmatch(required_string(row, "composeDigest")):
            raise StateError(f"imageRefs.{row['service']} must record a Compose config sha256")
        config_digest = row.get("configDigest")
        if config_digest is not None and (not isinstance(config_digest, str) or not DIGEST.fullmatch(config_digest)):
            raise StateError(f"imageRefs.{row['service']} configDigest must be null or a sha256 digest")
    if set(digest_map) != set(ref_map):
        raise StateError("imageDigests and imageRefs must contain the same services")
    for row in digests:
        if not SHA.fullmatch(required_string(row, "gitSha")):
            raise StateError(f"imageDigests.{row['service']} must record a full source SHA")
        if not SEMVER.fullmatch(required_string(row, "version")):
            raise StateError(f"imageDigests.{row['service']} must record its product version")
        timestamp(row.get("builtAt"), f"imageDigests.{row['service']}.builtAt")
        require_nonsecret_ref(row, "provenanceSource")
    if status == "candidate":
        created = timestamp(document.get("candidateAt"), "candidateAt")
        if created > timestamp(document["deployedAt"], "deployedAt") + timedelta(minutes=5):
            raise StateError("candidateAt cannot be materially later than deployedAt")
    if status == "released":
        expected_tag = f"{product}/v{version}"
        if required_string(document, "releaseTag") != expected_tag:
            raise StateError(f"releaseTag must be {expected_tag}")
    if status == "rolled_back":
        require_nonsecret_ref(document, "rollbackFrom")
    return document


def load_json(path: Path, label: str) -> Any:
    if path.is_symlink() or not path.is_file():
        raise StateError(f"{label} must be a regular non-symlink file")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise StateError(f"{label} is not valid UTF-8 JSON") from error


def validate_runtime(document: Any, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(document, dict) or document.get("runtimeSchema") != RUNTIME_SCHEMA:
        raise StateError("unsupported runtime snapshot schema")
    if document.get("product") != manifest["product"] or document.get("environment") != manifest["environment"]:
        raise StateError("runtime snapshot product/environment does not match the manifest")
    timestamp(document.get("capturedAt"), "capturedAt")
    rows = document.get("services")
    if not isinstance(rows, list) or not rows:
        raise StateError("runtime snapshot must list controlled services")
    return rows


def resolve_tag(tag: str, repo: Path = ROOT) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        return None
    return result.stdout.strip()


def doctor(manifest: dict[str, Any], runtime: list[dict[str, Any]], now: datetime, repo: Path = ROOT) -> tuple[str, list[str]]:
    expected_images = {row["service"]: row for row in manifest["imageDigests"]}
    expected_digests = {key: value["digest"] for key, value in expected_images.items()}
    expected_refs = {row["service"]: row["imageRef"] for row in manifest["imageRefs"]}
    actual: dict[str, dict[str, Any]] = {}
    for row in runtime:
        if not isinstance(row, dict):
            return "UNKNOWN", ["runtime service entry is not an object"]
        service = row.get("service")
        if not isinstance(service, str) or not service or service in actual:
            return "UNKNOWN", ["runtime service names are missing or duplicated"]
        actual[service] = row
    if set(actual) != set(expected_digests):
        return "RUNTIME_DRIFT", ["runtime service set differs from the manifest"]
    for service, expected in expected_digests.items():
        row = actual[service]
        if row.get("digest") != expected:
            return "IMAGE_DRIFT", [f"{service} digest differs from the manifest"]
        if row.get("imageRef") != expected_refs[service]:
            return "RUNTIME_DRIFT", [f"{service} Compose image reference differs from the manifest"]
        expected_compose_digest = next(item["composeDigest"] for item in manifest["imageRefs"] if item["service"] == service)
        if row.get("composeDigest") != expected_compose_digest:
            return "RUNTIME_DRIFT", [f"{service} Compose config digest differs from the manifest"]
        expected_config_digest = next(item.get("configDigest") for item in manifest["imageRefs"] if item["service"] == service)
        if expected_config_digest is not None and row.get("configDigest") != expected_config_digest:
            return "RUNTIME_DRIFT", [f"{service} runtime config digest differs from the manifest"]
        if service.lower() in {"migrator", "migrate"}:
            service_healthy = row.get("state") in {"completed", "exited"} and row.get("exitCode") == 0 and row.get("health") == "not_configured"
        else:
            service_healthy = row.get("state") == "running" and row.get("health") in {"healthy", "not_configured"}
        if not service_healthy:
            return "RUNTIME_DRIFT", [f"{service} is not in its expected healthy runtime state"]
        expected_image = expected_images[service]
        if row.get("version") != expected_image["version"] or row.get("gitSha") != expected_image["gitSha"]:
            return "SOURCE_DRIFT", [f"{service} version or source revision differs from its image provenance record"]
        if row.get("builtAt") != expected_image["builtAt"]:
            return "SOURCE_DRIFT", [f"{service} build timestamp differs from its image provenance record"]
        if manifest.get("schemaVersion") is not None and row.get("schemaVersion") != manifest["schemaVersion"]:
            return "RUNTIME_DRIFT", [f"{service} schema version differs from the manifest"]
    if manifest["status"] == "released":
        tag = manifest["releaseTag"]
        if resolve_tag(tag, repo) != manifest["gitSha"]:
            return "SOURCE_DRIFT", ["formal product tag is absent or points at a different source commit"]
        return "IN_SYNC", ["manifest, product tag, Compose references, image digests and health agree"]
    if manifest["status"] == "candidate":
        created = timestamp(manifest["candidateAt"], "candidateAt")
        age = now - created
        if age >= timedelta(hours=48):
            hours = int(age.total_seconds() // 3600)
            return "UNRELEASED_CANDIDATE", [f"candidate is {hours} hours old; 48-hour review reminder due, no automatic shutdown"]
        return "UNRELEASED_CANDIDATE", ["candidate is live and explicitly not a formal release"]
    return "IN_SYNC", ["runtime matches the explicitly recorded rollback state; the PostgreSQL volume was not restored by this tool"]


def write_manifest(input_path: Path, output_path: Path) -> None:
    document = validate_manifest(load_json(input_path, "input manifest"))
    destination = output_path.expanduser().absolute()
    if destination == ROOT or ROOT in destination.parents:
        raise StateError("release state must be stored outside the Git repository")
    parent = destination.parent
    if parent.is_symlink() or not parent.is_dir():
        raise StateError("external release-state directory must already exist and must not be a symlink")
    resolved_parent = parent.resolve(strict=True)
    if resolved_parent == ROOT or ROOT in resolved_parent.parents:
        raise StateError("release state must be stored outside the Git repository")
    if stat.S_IMODE(parent.stat().st_mode) != 0o700:
        raise StateError("external release-state directory must have mode 0700")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(destination, flags, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(document, stream, ensure_ascii=False, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        try:
            destination.unlink()
        except FileNotFoundError:
            pass
        raise


def compose_manifest(args: argparse.Namespace) -> None:
    if not args.apply:
        raise StateError("external state write requires --apply")
    if not SHA.fullmatch(args.git_sha):
        raise StateError("git-sha must be a full 40-character lowercase commit SHA")
    if not SEMVER.fullmatch(args.version):
        raise StateError("version must be stable SemVer")
    snapshot = load_json(args.runtime, "runtime snapshot")
    runtime_rows = validate_runtime(snapshot, {"product": args.product, "environment": args.environment})
    if args.status not in {"candidate", "released", "rolled_back"}:
        raise StateError("status must be candidate, released, or rolled_back")
    deployed_at = args.now or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    timestamp(deployed_at, "deployedAt")
    digest_rows: list[dict[str, str]] = []
    ref_rows: list[dict[str, str]] = []
    schema_values: set[str] = set()
    build_times: list[datetime] = []
    for row in runtime_rows:
        if not isinstance(row, dict):
            raise StateError("runtime service entry is not an object")
        service = required_string(row, "service")
        if service.lower() in {"migrator", "migrate"}:
            service_healthy = row.get("state") in {"completed", "exited"} and row.get("exitCode") == 0 and row.get("health") == "not_configured"
        else:
            service_healthy = row.get("state") == "running" and row.get("health") in {"healthy", "not_configured"}
        if not service_healthy:
            raise StateError(f"runtime service is not in its expected healthy state: {service}")
        digest = required_string(row, "digest")
        source_sha = row.get("gitSha")
        image_version = row.get("version")
        built_at = row.get("builtAt")
        if not isinstance(source_sha, str) or not SHA.fullmatch(source_sha):
            raise StateError(f"runtime provenance is unavailable for {service}")
        if not isinstance(image_version, str) or not SEMVER.fullmatch(image_version):
            raise StateError(f"runtime product version is unavailable for {service}")
        parsed_built_at = timestamp(built_at, f"{service}.builtAt")
        if not DIGEST.fullmatch(digest):
            raise StateError(f"runtime digest is invalid for {service}")
        image_ref = required_string(row, "imageRef")
        provenance_source = required_string(row, "provenanceSource")
        digest_rows.append({
            "service": service,
            "digest": digest,
            "gitSha": source_sha,
            "version": image_version,
            "builtAt": str(built_at),
            "provenanceSource": provenance_source,
        })
        compose_digest = required_string(row, "composeDigest")
        if not DIGEST.fullmatch(compose_digest):
            raise StateError(f"Compose config digest is invalid for {service}")
        config_digest = row.get("configDigest")
        if config_digest is not None and (not isinstance(config_digest, str) or not DIGEST.fullmatch(config_digest)):
            raise StateError(f"runtime config digest is invalid for {service}")
        ref_rows.append({"service": service, "imageRef": image_ref, "composeDigest": compose_digest, "configDigest": config_digest})
        build_times.append(parsed_built_at)
        schema = row.get("schemaVersion")
        if schema is not None:
            if not isinstance(schema, str) or not schema:
                raise StateError(f"schemaVersion is invalid for {service}")
            schema_values.add(schema)
    if not digest_rows or len({row["service"] for row in digest_rows}) != len(digest_rows):
        raise StateError("runtime snapshot must contain distinct controlled services")
    if len(schema_values) > 1:
        raise StateError("controlled services report incompatible database schema versions")
    manifest: dict[str, Any] = {
        "manifestSchema": MANIFEST_SCHEMA,
        "product": args.product,
        "environment": args.environment,
        "status": args.status,
        "version": args.version,
        "gitSha": args.git_sha,
        "imageRefs": ref_rows,
        "imageDigests": digest_rows,
        "builtAt": max(build_times).isoformat().replace("+00:00", "Z"),
        "deployedAt": deployed_at,
        "schemaVersion": next(iter(schema_values)) if schema_values else None,
        "checkpointRef": args.checkpoint_ref,
        "actor": args.actor,
        "approvalRef": args.approval_ref,
        "validationRef": args.validation_ref,
        "candidateAt": deployed_at if args.status == "candidate" else None,
        "releaseTag": args.release_tag if args.status == "released" else None,
        "rollbackFrom": args.rollback_from if args.status == "rolled_back" else None,
    }
    document = validate_manifest(manifest)
    output = args.output.expanduser().absolute()
    write_manifest_from_document(document, output)
    print(f"RELEASE_MANIFEST_WRITTEN={output}")


def write_manifest_from_document(document: dict[str, Any], output_path: Path) -> None:
    temporary_input = output_path.parent / f".{output_path.name}.validated-input"
    if temporary_input.exists() or temporary_input.is_symlink():
        raise StateError("temporary manifest input path already exists")
    try:
        temporary_input.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        write_manifest(temporary_input, output_path)
    finally:
        try:
            temporary_input.unlink()
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    validate_cmd = sub.add_parser("validate", help="validate one release manifest")
    validate_cmd.add_argument("manifest", type=Path)
    doctor_cmd = sub.add_parser("doctor", help="compare a manifest with an actual-runtime snapshot")
    doctor_cmd.add_argument("--manifest", type=Path, required=True)
    doctor_cmd.add_argument("--runtime", type=Path, required=True)
    doctor_cmd.add_argument("--repo", type=Path, default=ROOT, help="repository to resolve formal product tags")
    doctor_cmd.add_argument("--now", help="synthetic ISO time for fixture tests")
    write_cmd = sub.add_parser("write", help="write a completed manifest to protected external state")
    write_cmd.add_argument("--input", type=Path, required=True)
    write_cmd.add_argument("--output", type=Path, required=True)
    write_cmd.add_argument("--apply", action="store_true", help="required for external state writes")
    compose_cmd = sub.add_parser("compose", help="record a completed runtime observation into external state")
    compose_cmd.add_argument("--product", choices=("lab", "gate"), required=True)
    compose_cmd.add_argument("--environment", required=True)
    compose_cmd.add_argument("--status", choices=("candidate", "released", "rolled_back"), required=True)
    compose_cmd.add_argument("--version", required=True)
    compose_cmd.add_argument("--git-sha", required=True)
    compose_cmd.add_argument("--runtime", type=Path, required=True)
    compose_cmd.add_argument("--checkpoint-ref", required=True)
    compose_cmd.add_argument("--actor", required=True)
    compose_cmd.add_argument("--approval-ref", required=True)
    compose_cmd.add_argument("--validation-ref", required=True)
    compose_cmd.add_argument("--release-tag")
    compose_cmd.add_argument("--rollback-from")
    compose_cmd.add_argument("--output", type=Path, required=True)
    compose_cmd.add_argument("--now", help="synthetic ISO time for fixture tests")
    compose_cmd.add_argument("--apply", action="store_true", help="required for external state writes")
    args = parser.parse_args()
    try:
        if args.command == "validate":
            doc = validate_manifest(load_json(args.manifest, "manifest"))
            print(f"RELEASE_MANIFEST=valid product={doc['product']} environment={doc['environment']} status={doc['status']}")
            return 0
        if args.command == "write":
            if not args.apply:
                raise StateError("external state write requires --apply")
            write_manifest(args.input, args.output)
            print(f"RELEASE_MANIFEST_WRITTEN={args.output.expanduser().absolute()}")
            return 0
        if args.command == "compose":
            if args.status == "released" and args.release_tag != f"{args.product}/v{args.version}":
                raise StateError(f"released state requires tag {args.product}/v{args.version}")
            if args.status == "rolled_back" and not args.rollback_from:
                raise StateError("rolled_back state requires --rollback-from")
            compose_manifest(args)
            return 0
        manifest = validate_manifest(load_json(args.manifest, "manifest"))
        snapshot = load_json(args.runtime, "runtime snapshot")
        runtime = validate_runtime(snapshot, manifest)
        now = timestamp(args.now, "now") if args.now else datetime.now(timezone.utc)
        state, reasons = doctor(manifest, runtime, now, args.repo.resolve())
        print(f"DRIFT_STATUS={state}")
        for reason in reasons:
            print(f"DETAIL={reason}")
        print("AUTOMATIC_ACTION=none")
        return 0
    except (StateError, OSError) as error:
        print(f"RELEASE_STATE_ERROR={error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
