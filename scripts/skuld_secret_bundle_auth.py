#!/usr/bin/env python3
"""Authenticate encrypted Skuld secret bundles and their sanitized manifests."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import stat
import sys
from pathlib import Path


ITERATIONS = 300_000


def passphrase(path: Path) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise SystemExit("secret passphrase file is unavailable")
    if stat.S_IMODE(path.stat().st_mode) not in {0o400, 0o440, 0o600, 0o640}:
        raise SystemExit("secret passphrase file permissions are unsafe")
    value = path.read_bytes().rstrip(b"\r\n")
    if not value:
        raise SystemExit("secret passphrase file is empty")
    return value


def keyed_digest(path: Path, key: bytes) -> tuple[str, str]:
    sha = hashlib.sha256()
    mac = hmac.new(key, digestmod=hashlib.sha256)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
            mac.update(chunk)
    return sha.hexdigest(), mac.hexdigest()


def canonical_manifest(value: dict) -> bytes:
    body = dict(value)
    body.pop("manifestAuthentication", None)
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def seal(artifact: Path, manifest_path: Path, passphrase_path: Path) -> dict:
    secret = passphrase(passphrase_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    artifact_salt = secrets.token_bytes(16)
    artifact_key = hashlib.pbkdf2_hmac("sha256", secret, artifact_salt, ITERATIONS, dklen=32)
    artifact_sha, artifact_tag = keyed_digest(artifact, artifact_key)
    manifest["artifactSha256"] = artifact_sha
    manifest["authentication"] = {
        "algorithm": "HMAC-SHA256/PBKDF2-HMAC-SHA256",
        "iterations": ITERATIONS,
        "saltHex": artifact_salt.hex(),
        "tagHex": artifact_tag,
    }
    manifest_salt = secrets.token_bytes(16)
    manifest_key = hashlib.pbkdf2_hmac("sha256", secret, manifest_salt, ITERATIONS, dklen=32)
    manifest_tag = hmac.new(manifest_key, canonical_manifest(manifest), hashlib.sha256).hexdigest()
    manifest["manifestAuthentication"] = {
        "algorithm": "HMAC-SHA256/PBKDF2-HMAC-SHA256",
        "iterations": ITERATIONS,
        "saltHex": manifest_salt.hex(),
        "tagHex": manifest_tag,
    }
    temporary = manifest_path.with_name(f".{manifest_path.name}.{secrets.token_hex(8)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, manifest_path)
    os.chmod(manifest_path, 0o600)
    return manifest


def verify(artifact: Path, manifest_path: Path, passphrase_path: Path) -> dict:
    secret = passphrase(passphrase_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for key_name in ("authentication", "manifestAuthentication"):
        auth = manifest.get(key_name)
        if not isinstance(auth, dict) or auth.get("algorithm") != "HMAC-SHA256/PBKDF2-HMAC-SHA256" or auth.get("iterations") != ITERATIONS:
            raise SystemExit(f"secret bundle {key_name} metadata is missing or invalid")
        try:
            salt = bytes.fromhex(auth["saltHex"])
            expected_tag = bytes.fromhex(auth["tagHex"])
        except (KeyError, ValueError, TypeError) as exc:
            raise SystemExit(f"secret bundle {key_name} metadata is invalid") from exc
        if len(salt) != 16 or len(expected_tag) != 32:
            raise SystemExit(f"secret bundle {key_name} metadata is invalid")
        key = hashlib.pbkdf2_hmac("sha256", secret, salt, ITERATIONS, dklen=32)
        if key_name == "authentication":
            actual_sha, actual_tag_hex = keyed_digest(artifact, key)
            if not hmac.compare_digest(str(manifest.get("artifactSha256", "")), actual_sha):
                raise SystemExit("secret bundle artifact SHA-256 mismatch")
            actual_tag = bytes.fromhex(actual_tag_hex)
        else:
            actual_tag = hmac.new(key, canonical_manifest(manifest), hashlib.sha256).digest()
        if not hmac.compare_digest(expected_tag, actual_tag):
            raise SystemExit(f"secret bundle {key_name} verification failed")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("seal", "verify"))
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--passphrase-file", required=True, type=Path)
    args = parser.parse_args()
    if args.action == "seal":
        manifest = seal(args.artifact, args.manifest, args.passphrase_file)
        print(f"SECRET_BUNDLE_AUTHENTICATED=yes SHA256={manifest['artifactSha256']}")
    else:
        manifest = verify(args.artifact, args.manifest, args.passphrase_file)
        print(f"SECRET_BUNDLE_AUTHENTICATED=yes SHA256={manifest['artifactSha256']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, json.JSONDecodeError) as exc:
        print(f"SECRET_BUNDLE_AUTH_ERROR={type(exc).__name__}", file=sys.stderr)
        raise SystemExit(1)
