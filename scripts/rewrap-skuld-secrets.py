#!/usr/bin/env python3
"""Rewrap a legacy encrypted Skuld bundle beside its original, without changing it."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from skuld_secret_bundle_auth import passphrase, seal


ROOT = Path(__file__).resolve().parents[1]
RESTORE_POLICY = "decrypt-to-private-staging-validate-metadata-and-normalize-openclaw-credentials-to-1000:1000"
CURRENT_LOGICAL_IDS = {
    "openclaw-runtime-env",
    "openclaw-secret-files",
    "openclaw-runtime-credentials",
    "product-radar-runtime-env",
    "9router-runtime-env-and-provider-state",
    "immich-db-credential-and-compose",
    "changedetection-state",
    "media-adapter-state",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict:
    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate manifest key: {key}")
            result[key] = value
        return result

    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=no_duplicates)


def source_metadata(bundle: Path, manifest_path: Path, expected_manifest: Path) -> tuple[dict, str, str]:
    if bundle.is_symlink() or manifest_path.is_symlink() or not bundle.is_file() or not manifest_path.is_file():
        raise ValueError("legacy bundle inputs must be regular files")
    checksum_path = bundle.with_name(bundle.name + ".sha256")
    if checksum_path.is_symlink() or not checksum_path.is_file():
        raise ValueError("legacy bundle checksum sidecar is missing")
    sidecar_fields = checksum_path.read_text(encoding="ascii").split()
    if not sidecar_fields or len(sidecar_fields[0]) != 64:
        raise ValueError("legacy bundle checksum sidecar is invalid")
    source_artifact_sha = sha256_file(bundle)
    if not hmac.compare_digest(sidecar_fields[0].lower(), source_artifact_sha):
        raise ValueError("legacy bundle checksum does not match its sidecar")

    manifest = load_json(manifest_path)
    if manifest.get("contentsInGit") is not False or manifest.get("plaintextTemporaryFiles") is not False:
        raise ValueError("input is not a supported legacy plaintext-policy manifest")
    if any(key in manifest for key in ("authentication", "manifestAuthentication")):
        raise ValueError("authenticated bundles must use the normal verifier, not legacy rewrap")
    files = manifest.get("files")
    logical_ids = manifest.get("logicalIds")
    if not isinstance(files, list) or not files or not isinstance(logical_ids, list):
        raise ValueError("legacy manifest lacks file or logical-id metadata")
    expected = load_json(expected_manifest)
    required_ids = {
        item.get("id") for item in expected.get("secretInventory", [])
        if item.get("required", True) and isinstance(item.get("id"), str)
    }
    if required_ids - set(logical_ids):
        raise ValueError("legacy manifest does not cover all required logical ids")

    normalized = []
    seen_paths = set()
    credential_prefix = "DATA/AppData/openclaw/config/credentials/"
    for item in files:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("legacy manifest file entry is not a supported path record")
        rel = item["path"]
        parts = Path(rel).parts
        if not rel or rel.startswith("/") or ".." in parts or "\\" in rel or rel in seen_paths:
            raise ValueError("legacy manifest contains an unsafe or duplicate path")
        seen_paths.add(rel)
        mode = str(item.get("mode", ""))
        size = item.get("size")
        if len(mode) != 4 or any(char not in "01234567" for char in mode) or not isinstance(size, int) or size < 0:
            raise ValueError("legacy manifest file metadata is invalid")
        current = {"mode": mode, "size": size}
        if rel.startswith(credential_prefix):
            current["pathSha256"] = hashlib.sha256(rel.encode("utf-8")).hexdigest()
            current["pathScope"] = "openclaw-runtime-credentials"
        else:
            current["path"] = rel
        normalized.append(current)

    return {"files": normalized, "logicalIds": sorted(set(logical_ids) | CURRENT_LOGICAL_IDS)}, source_artifact_sha, sha256_file(manifest_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--passphrase-file", required=True, type=Path)
    parser.add_argument("--expected-manifest", type=Path, default=ROOT / "docs/OPERATION_SKULD_MIGRATION_MANIFEST.json")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--apply", action="store_true", help="create a separate current-format bundle; default is plan-only")
    args = parser.parse_args()

    bundle = args.bundle.absolute()
    manifest_path = args.manifest.absolute()
    expected_manifest = args.expected_manifest.absolute()
    passphrase(args.passphrase_file)
    metadata, source_artifact_sha, source_manifest_sha = source_metadata(bundle, manifest_path, expected_manifest)
    source_manifest = load_json(manifest_path)
    output_dir = args.output_dir.absolute() if args.output_dir else bundle.parent / datetime.now(timezone.utc).strftime("secrets-rewrapped-%Y%m%dT%H%M%SZ")
    if output_dir.parent.resolve() != bundle.parent.resolve() or output_dir.exists() or output_dir.is_symlink():
        raise ValueError("output must be a new sibling directory beside the original bundle")

    print(f"SECRET_REWRAP_MODE={'apply' if args.apply else 'plan'}")
    print(f"SECRET_REWRAP_SOURCE_SHA256={source_artifact_sha}")
    print(f"SECRET_REWRAP_OUTPUT_DIR={output_dir}")
    if not args.apply:
        print("SECRET_REWRAP=plan-ready; original bundle and manifest remain unchanged")
        return 0

    temp_dir = Path(tempfile.mkdtemp(prefix=".skuld-secret-rewrap-", dir=bundle.parent))
    os.chmod(temp_dir, 0o700)
    try:
        output_bundle = temp_dir / "secrets.tar.enc"
        output_manifest = temp_dir / "secrets.manifest.json"
        output_sidecar = temp_dir / "secrets.tar.enc.sha256"
        with bundle.open("rb") as src, output_bundle.open("xb") as dst:
            shutil.copyfileobj(src, dst, length=1024 * 1024)
            dst.flush()
            os.fsync(dst.fileno())
        os.chmod(output_bundle, 0o600)
        manifest = {
            "schemaVersion": 2,
            "encryptedArtifact": "secrets.tar.enc",
            "createdAtUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "logicalIds": metadata["logicalIds"],
            "files": metadata["files"],
            "contentsInGit": False,
            "plaintextTemporaryFiles": True,
            "plaintextTemporaryFilesRemovedOnExit": True,
            "temporaryStagingPermissions": "0700",
            "restorePolicy": RESTORE_POLICY,
            "rewrappedFrom": {
                "schemaVersion": source_manifest.get("schemaVersion"),
                "plaintextTemporaryFilesClaim": source_manifest.get("plaintextTemporaryFiles"),
                "restorePolicy": source_manifest.get("restorePolicy"),
                "artifactSha256": source_artifact_sha,
                "manifestSha256": source_manifest_sha,
                "capturedAtUtc": source_manifest.get("createdAtUtc"),
            },
        }
        with output_manifest.open("x", encoding="utf-8") as stream:
            json.dump(manifest, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(output_manifest, 0o600)
        output_sidecar.write_text(f"{sha256_file(output_bundle)}  secrets.tar.enc\n", encoding="ascii")
        os.chmod(output_sidecar, 0o600)
        seal(output_bundle, output_manifest, args.passphrase_file)

        result = subprocess.run([
            "bash", str(ROOT / "scripts/verify-skuld-secret-bundle.sh"),
            "--bundle", str(output_bundle), "--manifest", str(output_manifest),
            "--passphrase-file", str(args.passphrase_file), "--expected-manifest", str(expected_manifest),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            raise ValueError("rewrapped bundle failed current import and restore verification")
        if output_dir.exists() or output_dir.is_symlink():
            raise ValueError("output directory appeared during rewrap; refusing to overwrite")
        os.replace(temp_dir, output_dir)
        temp_dir = None
    finally:
        if temp_dir is not None and temp_dir.exists():
            shutil.rmtree(temp_dir)

    print(f"SECRET_BUNDLE={output_dir / 'secrets.tar.enc'}")
    print(f"SECRET_MANIFEST={output_dir / 'secrets.manifest.json'}")
    print(f"SECRET_BUNDLE_SHA256={sha256_file(output_dir / 'secrets.tar.enc')}")
    print("LEGACY_SOURCE_PRESERVED=yes")
    print("SECRET_REWRAP=passed; source capture time remains whatever the legacy artifact proves")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"SECRET_REWRAP_ERROR={exc}", file=sys.stderr)
        raise SystemExit(1)
