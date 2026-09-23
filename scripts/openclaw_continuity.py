#!/usr/bin/env python3
"""Sanitized OpenClaw state inventory, archive verification, and artifact authentication."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import io
import json
import os
import shutil
import secrets
import sqlite3
import stat
import subprocess
import sys
import tempfile
import tarfile
from pathlib import Path, PurePosixPath


AREAS = ("config", "workspace", "data", "notifications")
REQUIRED_SQLITE = ("data/identity.sqlite", "data/pubg.sqlite")
SQLITE_MAGIC = b"SQLite format 3\x00"
AUTH_ITERATIONS = 300_000
OPENSSL_ITERATIONS = 200_000
OPENCLAW_RUNTIME_UID = 1000
OPENCLAW_RUNTIME_GID = 1000


class ContinuityError(RuntimeError):
    pass


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _path_id(relative: str) -> str:
    return hashlib.sha256(relative.encode("utf-8")).hexdigest()


def _tree_digest(entries: list[dict]) -> str:
    digest = hashlib.sha256()
    for item in sorted(entries, key=lambda entry: entry["path"]):
        path = item["path"].encode("utf-8")
        kind = item["kind"].encode("ascii")
        digest.update(len(kind).to_bytes(2, "big"))
        digest.update(kind)
        digest.update(len(path).to_bytes(8, "big"))
        digest.update(path)
        digest.update(int(item["mode"]).to_bytes(4, "big"))
        digest.update(int(item.get("uid", 0)).to_bytes(8, "big"))
        digest.update(int(item.get("gid", 0)).to_bytes(8, "big"))
        if item["kind"] == "file":
            digest.update(int(item["size"]).to_bytes(8, "big"))
            digest.update(bytes.fromhex(item["sha256"]))
        elif item["kind"] == "symlink":
            target_hash = hashlib.sha256(item["target"].encode("utf-8", errors="surrogateescape")).digest()
            digest.update(target_hash)
    return digest.hexdigest()


def _walk_tree(
    root: Path,
    area: str,
    *,
    skip_credentials: bool = False,
    reject_symlinks: bool = False,
    owner_overrides: dict[str, tuple[int, int]] | None = None,
) -> list[dict]:
    base = root / area
    try:
        base_info = base.lstat()
    except FileNotFoundError as exc:
        raise ContinuityError(f"required state directory missing: {area}") from exc
    if stat.S_ISLNK(base_info.st_mode) or not stat.S_ISDIR(base_info.st_mode):
        raise ContinuityError(f"state directory is not a real directory: {area}")

    entries: list[dict] = []
    stack = [base]
    while stack:
        directory = stack.pop()
        relative_directory = directory.relative_to(root).as_posix()
        directory_info = directory.lstat()
        directory_owner = (owner_overrides or {}).get(
            relative_directory, (directory_info.st_uid, directory_info.st_gid)
        )
        entries.append({
            "path": relative_directory,
            "kind": "directory",
            "mode": stat.S_IMODE(directory_info.st_mode),
            "uid": directory_owner[0],
            "gid": directory_owner[1],
        })
        try:
            children = sorted(directory.iterdir(), key=lambda child: child.name, reverse=True)
        except OSError as exc:
            raise ContinuityError(f"cannot read state directory: {area}") from exc
        for child in children:
            relative = child.relative_to(root).as_posix()
            if skip_credentials and relative == "config/credentials":
                continue
            try:
                info = child.lstat()
            except OSError as exc:
                raise ContinuityError(f"cannot stat state entry: {area}") from exc
            mode = stat.S_IMODE(info.st_mode)
            entry_owner = (owner_overrides or {}).get(relative, (info.st_uid, info.st_gid))
            owner = {"uid": entry_owner[0], "gid": entry_owner[1]}
            if stat.S_ISLNK(info.st_mode):
                if reject_symlinks:
                    raise ContinuityError("credential state contains a symlink")
                entries.append({"path": relative, "kind": "symlink", "mode": mode, **owner, "target": os.readlink(child)})
            elif stat.S_ISDIR(info.st_mode):
                stack.append(child)
            elif stat.S_ISREG(info.st_mode):
                file_hash, size = _hash_file(child)
                entries.append({"path": relative, "kind": "file", "mode": mode, **owner, "size": size, "sha256": file_hash})
            else:
                raise ContinuityError("state contains an unsupported special file")
    return entries


def _require_whatsapp_credentials(
    root: Path, owner_overrides: dict[str, tuple[int, int]] | None = None
) -> list[dict]:
    credential_root = root / "config/credentials"
    whatsapp = credential_root / "whatsapp"
    for path in (credential_root, whatsapp):
        try:
            info = path.lstat()
        except FileNotFoundError as exc:
            raise ContinuityError("required provider credential state is missing") from exc
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise ContinuityError("provider credential state is not a real directory")
    entries = _walk_tree(root, "config/credentials", reject_symlinks=True, owner_overrides=owner_overrides)
    files = [item for item in entries if item["kind"] == "file"]
    if not files:
        raise ContinuityError("required provider credential state is empty")
    return entries


def private_credential_fingerprints(entries: list[dict]) -> list[dict]:
    """Return path/content fingerprints for private, short-lived migration staging only."""
    records = []
    for item in entries:
        if item["kind"] not in {"directory", "file"}:
            raise ContinuityError("provider credential state contains an unsupported entry")
        full_path = "DATA/AppData/openclaw/" + item["path"]
        record = {
            "pathSha256": _path_id(full_path),
            "kind": item["kind"],
            "mode": int(item["mode"]),
            "uid": int(item["uid"]),
            "gid": int(item["gid"]),
        }
        if item["kind"] == "file":
            record.update({"size": int(item["size"]), "sha256": str(item["sha256"])})
        records.append(record)
    return sorted(records, key=lambda item: (item["pathSha256"], item["kind"]))


def _source_credential_fingerprints(inventory: dict) -> list[dict]:
    internal = inventory.get("_internal")
    if isinstance(internal, dict) and isinstance(internal.get("credentialEntries"), list):
        records = private_credential_fingerprints(internal["credentialEntries"])
    else:
        records = inventory.get("_privateCredentialFingerprints")
        if not isinstance(records, list):
            raise ContinuityError("private source credential fingerprints are unavailable")
    normalized = []
    for item in records:
        if not isinstance(item, dict) or item.get("kind") not in {"directory", "file"}:
            raise ContinuityError("private source credential fingerprints are invalid")
        path_hash = item.get("pathSha256")
        mode = item.get("mode")
        if not isinstance(path_hash, str) or len(path_hash) != 64 or any(char not in "0123456789abcdef" for char in path_hash):
            raise ContinuityError("private source credential fingerprints are invalid")
        if not isinstance(mode, int) or mode < 0 or mode > 0o7777:
            raise ContinuityError("private source credential fingerprints are invalid")
        uid = item.get("uid")
        gid = item.get("gid")
        if not isinstance(uid, int) or uid < 0 or not isinstance(gid, int) or gid < 0:
            raise ContinuityError("private source credential ownership is invalid")
        record = {"pathSha256": path_hash, "kind": item["kind"], "mode": mode, "uid": uid, "gid": gid}
        if item["kind"] == "file":
            size = item.get("size")
            digest = item.get("sha256")
            if (
                not isinstance(size, int) or size < 0 or not isinstance(digest, str) or len(digest) != 64
                or any(char not in "0123456789abcdef" for char in digest)
            ):
                raise ContinuityError("private source credential fingerprints are invalid")
            record.update({"size": size, "sha256": digest})
        normalized.append(record)
    if not normalized or len({item["pathSha256"] for item in normalized}) != len(normalized):
        raise ContinuityError("private source credential fingerprints are incomplete")
    return sorted(normalized, key=lambda item: (item["pathSha256"], item["kind"]))


def _sqlite_integrity(path: Path) -> str:
    try:
        uri = path.resolve().as_uri() + "?mode=ro"
        with sqlite3.connect(uri, uri=True, timeout=10) as database:
            values = [row[0] for row in database.execute("PRAGMA integrity_check")]
        return "ok" if values == ["ok"] else "failed"
    except (sqlite3.Error, OSError, ValueError):
        return "failed"


def collect_inventory(
    data_root: Path,
    *,
    require_credentials: bool = True,
    owner_overrides: dict[str, tuple[int, int]] | None = None,
) -> dict:
    root = Path(data_root)
    if root.is_symlink() or not root.is_dir():
        raise ContinuityError("OpenClaw data root is not a real directory")

    area_entries: dict[str, list[dict]] = {}
    for area in AREAS:
        area_entries[area] = _walk_tree(
            root, area, skip_credentials=(area == "config"), owner_overrides=owner_overrides
        )

    credential_entries: list[dict] = []
    credential_root = root / "config/credentials"
    if require_credentials:
        credential_entries = _require_whatsapp_credentials(root, owner_overrides=owner_overrides)
    elif credential_root.is_dir() and not credential_root.is_symlink():
        credential_entries = _walk_tree(
            root, "config/credentials", reject_symlinks=True, owner_overrides=owner_overrides
        )

    workspace_entries = area_entries["workspace"]
    memory_file = root / "workspace/MEMORY.md"
    if not memory_file.is_file() or memory_file.is_symlink():
        raise ContinuityError("runtime MEMORY.md is missing or not a regular file")
    memory_hash, _ = _hash_file(memory_file)
    memory_entries = [entry for entry in workspace_entries if entry["path"] == "workspace/memory" or entry["path"].startswith("workspace/memory/")]

    state_entries = area_entries["config"] + area_entries["data"] + area_entries["notifications"]
    all_entries = state_entries + workspace_entries
    regular_workspace = [entry for entry in workspace_entries if entry["kind"] == "file"]
    regular_state = [entry for entry in state_entries if entry["kind"] == "file"]
    regular_credentials = [entry for entry in credential_entries if entry["kind"] == "file"]

    databases = []
    database_by_path: dict[str, dict] = {}
    for entry in state_entries:
        if entry["kind"] != "file":
            continue
        source = root / entry["path"]
        with source.open("rb") as stream:
            magic = stream.read(len(SQLITE_MAGIC))
        if magic != SQLITE_MAGIC:
            continue
        integrity = _sqlite_integrity(source)
        database = {
            "pathId": _path_id(entry["path"]),
            "size": entry["size"],
            "sha256": entry["sha256"],
            "integrity": integrity,
        }
        databases.append(database)
        database_by_path[entry["path"]] = database

    for relative in REQUIRED_SQLITE:
        database = database_by_path.get(relative)
        if database is None or database["integrity"] != "ok":
            raise ContinuityError(f"required SQLite database failed integrity validation: {relative.split('/')[-1]}")
    if any(item["integrity"] != "ok" for item in databases):
        raise ContinuityError("a discovered SQLite database failed integrity validation")

    def total_bytes(items: list[dict]) -> int:
        return sum(item["size"] for item in items if item["kind"] == "file")

    identity = database_by_path["data/identity.sqlite"]
    pubg = database_by_path["data/pubg.sqlite"]
    state_file_paths = [entry["path"].lower() for entry in regular_state]
    session_files = sum("session" in path or path.endswith(".jsonl") for path in state_file_paths)
    transcript_files = sum("transcript" in path for path in state_file_paths)

    return {
        "workspace": {
            "fileCount": len(regular_workspace),
            "totalBytes": total_bytes(regular_workspace),
            "symlinkCount": sum(entry["kind"] == "symlink" for entry in workspace_entries),
            "treeSha256": _tree_digest(workspace_entries),
            "memoryMdSha256": memory_hash,
            "memoryTreeSha256": _tree_digest(memory_entries),
        },
        "state": {
            "fileCount": len(regular_state),
            "totalBytes": total_bytes(regular_state),
            "symlinkCount": sum(entry["kind"] == "symlink" for entry in state_entries),
            "treeSha256": _tree_digest(state_entries),
            "treeSha256ByRoot": {
                area: _tree_digest([entry for entry in state_entries if entry["path"].split("/", 1)[0] == area])
                for area in ("config", "data", "notifications")
            },
        },
        "credentials": {
            "fileCount": len(regular_credentials),
            "totalBytes": total_bytes(regular_credentials),
            "symlinkCount": sum(entry["kind"] == "symlink" for entry in credential_entries),
        },
        "sessionState": {
            "sessionAndJsonlFileCount": session_files,
            "transcriptFileCount": transcript_files,
        },
        "sqlite": {
            "integrity": "passed",
            "databaseCount": len(databases),
            "databases": sorted(databases, key=lambda entry: entry["pathId"]),
            "identityDbSha256": identity["sha256"],
            "identityDbIntegrity": identity["integrity"],
            "pubgDbSha256": pubg["sha256"],
            "pubgDbIntegrity": pubg["integrity"],
        },
        "_internal": {
            "entryCount": len(all_entries),
            "stateEntries": state_entries,
            "workspaceEntries": workspace_entries,
            "credentialEntries": credential_entries,
        },
    }


def public_inventory(inventory: dict) -> dict:
    return {key: value for key, value in inventory.items() if not key.startswith("_")}


def continuity_projection(inventory: dict) -> dict:
    return {
        key: inventory[key]
        for key in ("workspace", "state", "sessionState", "sqlite")
    }


def _metric_mismatch_paths(expected: object, actual: object, prefix: str = "") -> list[str]:
    if isinstance(expected, dict) and isinstance(actual, dict):
        paths = []
        for key in sorted(set(expected) | set(actual)):
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            if key not in expected or key not in actual:
                paths.append(child_prefix)
            else:
                paths.extend(_metric_mismatch_paths(expected[key], actual[key], child_prefix))
        return paths
    return [] if expected == actual else [prefix]


def check_source_stopped(container_state: str) -> None:
    if container_state not in {"exited", "created"}:
        raise ContinuityError("COLD_SNAPSHOT=BLOCKED: source OpenClaw container is not stopped")


def _passphrase(passphrase_file: Path) -> bytes:
    path = Path(passphrase_file)
    if not path.is_file() or path.is_symlink():
        raise ContinuityError("passphrase file is unavailable")
    mode = stat.S_IMODE(path.stat().st_mode)
    if mode not in {0o400, 0o440, 0o600, 0o640}:
        raise ContinuityError("passphrase file permissions are unsafe")
    value = path.read_bytes().rstrip(b"\r\n")
    if not value:
        raise ContinuityError("passphrase file is empty")
    return value


def authenticate_artifact(artifact: Path, passphrase_file: Path, salt: bytes | None = None) -> dict:
    secret = _passphrase(passphrase_file)
    salt = salt or secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", secret, salt, AUTH_ITERATIONS, dklen=32)
    digest = hashlib.sha256()
    authenticator = hmac.new(key, digestmod=hashlib.sha256)
    with Path(artifact).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
            authenticator.update(chunk)
    return {
        "artifactSha256": digest.hexdigest(),
        "authentication": {
            "algorithm": "HMAC-SHA256/PBKDF2-HMAC-SHA256",
            "iterations": AUTH_ITERATIONS,
            "saltHex": salt.hex(),
            "tagHex": authenticator.hexdigest(),
        },
    }


def verify_artifact_authentication(artifact: Path, passphrase_file: Path, manifest: dict) -> None:
    auth = manifest.get("authentication")
    expected_sha = manifest.get("artifactSha256")
    if not isinstance(auth, dict) or auth.get("algorithm") != "HMAC-SHA256/PBKDF2-HMAC-SHA256":
        raise ContinuityError("snapshot authentication metadata is missing")
    try:
        salt = bytes.fromhex(str(auth["saltHex"]))
        expected_tag = bytes.fromhex(str(auth["tagHex"]))
    except (KeyError, ValueError) as exc:
        raise ContinuityError("snapshot authentication metadata is invalid") from exc
    if len(salt) != 16 or len(expected_tag) != 32 or auth.get("iterations") != AUTH_ITERATIONS:
        raise ContinuityError("snapshot authentication metadata is invalid")
    actual = authenticate_artifact(artifact, passphrase_file, salt)
    if not hmac.compare_digest(str(expected_sha), actual["artifactSha256"]):
        raise ContinuityError("snapshot artifact SHA-256 mismatch")
    if not hmac.compare_digest(expected_tag, bytes.fromhex(actual["authentication"]["tagHex"])):
        raise ContinuityError("snapshot artifact authentication failed")


def _canonical_json(value: dict) -> bytes:
    body = dict(value)
    body.pop("manifestAuthentication", None)
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def authenticate_manifest(manifest: dict, passphrase_file: Path) -> dict:
    secret = _passphrase(passphrase_file)
    salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac("sha256", secret, salt, AUTH_ITERATIONS, dklen=32)
    tag = hmac.new(key, _canonical_json(manifest), hashlib.sha256).hexdigest()
    sealed = dict(manifest)
    sealed["manifestAuthentication"] = {
        "algorithm": "HMAC-SHA256/PBKDF2-HMAC-SHA256",
        "iterations": AUTH_ITERATIONS,
        "saltHex": salt.hex(),
        "tagHex": tag,
    }
    return sealed


def verify_manifest_authentication(manifest: dict, passphrase_file: Path) -> None:
    auth = manifest.get("manifestAuthentication")
    if not isinstance(auth, dict) or auth.get("algorithm") != "HMAC-SHA256/PBKDF2-HMAC-SHA256":
        raise ContinuityError("snapshot manifest authentication metadata is missing")
    try:
        salt = bytes.fromhex(str(auth["saltHex"]))
        expected = bytes.fromhex(str(auth["tagHex"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise ContinuityError("snapshot manifest authentication metadata is invalid") from exc
    if len(salt) != 16 or len(expected) != 32 or auth.get("iterations") != AUTH_ITERATIONS:
        raise ContinuityError("snapshot manifest authentication metadata is invalid")
    key = hashlib.pbkdf2_hmac("sha256", _passphrase(passphrase_file), salt, AUTH_ITERATIONS, dklen=32)
    actual = hmac.new(key, _canonical_json(manifest), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, actual):
        raise ContinuityError("snapshot manifest authentication failed")


def _atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(value, stream, sort_keys=True, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, 0o600)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _openssl_args(action: str, passphrase_file: Path) -> list[str]:
    return [
        "openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2",
        "-iter", str(OPENSSL_ITERATIONS), "-md", "sha256",
        "-" + action, "-pass", f"file:{passphrase_file}",
    ]


def _finish_process(process: subprocess.Popen) -> tuple[int, bytes]:
    if process.stdin is not None and not process.stdin.closed:
        process.stdin.close()
    stderr = process.stderr.read() if process.stderr is not None else b""
    return process.wait(), stderr


def _credential_bundle_inventory(artifact: Path, manifest_path: Path, passphrase_file: Path) -> tuple[dict, list[dict]]:
    """Authenticate/decrypt the separate secret bundle and fingerprint exact OpenClaw credential entries."""
    try:
        from skuld_secret_bundle_auth import verify as verify_secret_bundle
    except ImportError as exc:
        raise ContinuityError("secret bundle authentication helper is unavailable") from exc
    secret_manifest = verify_secret_bundle(artifact, manifest_path, passphrase_file)
    if "openclaw-runtime-credentials" not in secret_manifest.get("logicalIds", []):
        raise ContinuityError("secret bundle does not declare OpenClaw runtime credentials")

    listed = []
    for item in secret_manifest.get("files", []):
        if item.get("pathScope") == "openclaw-runtime-credentials":
            listed.append((str(item.get("pathSha256", "")), int(item.get("size", -1)), int(item.get("mode", "0"), 8)))
    if not listed or any(len(path_hash) != 64 or size < 0 for path_hash, size, _mode in listed):
        raise ContinuityError("secret bundle credential metadata is incomplete")

    process = subprocess.Popen(
        _openssl_args("d", passphrase_file) + ["-in", str(artifact)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert process.stdout is not None
    discovered: list[dict] = []
    discovered_files: list[tuple[str, int, int]] = []
    seen_paths: set[str] = set()
    whatsapp_count = 0
    root_prefix = "DATA/AppData/openclaw/config/credentials"
    try:
        with tarfile.open(fileobj=process.stdout, mode="r|gz") as archive:
            for member in archive:
                name = member.name
                while name.startswith("./"):
                    name = name[2:]
                if name.startswith("/") and name.lstrip("/").startswith(root_prefix):
                    raise ContinuityError("secret bundle credential archive contains an absolute path")
                name = name.rstrip("/")
                in_credentials = name == root_prefix or name.startswith(root_prefix + "/")
                if not in_credentials:
                    continue
                path = PurePosixPath(name)
                if path.is_absolute() or ".." in path.parts or "\\" in name or name in seen_paths:
                    raise ContinuityError("secret bundle credential archive contains an unsafe or duplicate path")
                seen_paths.add(name)
                if member.isdir():
                    discovered.append({
                        "pathSha256": _path_id(name),
                        "kind": "directory",
                        "mode": member.mode & 0o7777,
                    })
                    continue
                if member.issym() or member.islnk() or not member.isfile():
                    raise ContinuityError("secret bundle credential archive contains a non-regular path")
                source = archive.extractfile(member)
                if source is None:
                    raise ContinuityError("secret bundle credential archive has an unreadable file")
                digest = hashlib.sha256()
                actual_size = 0
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                    actual_size += len(chunk)
                if actual_size != member.size:
                    raise ContinuityError("secret bundle credential archive has a truncated file")
                path_hash = _path_id(name)
                mode = member.mode & 0o7777
                discovered.append({
                    "pathSha256": path_hash,
                    "kind": "file",
                    "mode": mode,
                    "size": actual_size,
                    "sha256": digest.hexdigest(),
                })
                discovered_files.append((path_hash, actual_size, mode))
                if name.startswith(root_prefix + "/whatsapp/"):
                    whatsapp_count += 1
        return_code, stderr = _finish_process(process)
        if return_code != 0:
            del stderr
            raise ContinuityError("secret bundle decryption or archive validation failed")
    except (tarfile.TarError, OSError) as exc:
        process.kill()
        _finish_process(process)
        raise ContinuityError("secret bundle archive is invalid") from exc
    if whatsapp_count == 0 or sorted(discovered_files) != sorted(listed):
        raise ContinuityError("secret bundle credential contents do not match its authenticated manifest")
    if not discovered:
        raise ContinuityError("secret bundle credential tree is empty")
    return secret_manifest, sorted(discovered, key=lambda item: (item["pathSha256"], item["kind"]))


def _credential_continuity_auth(records: list[dict], passphrase_file: Path, salt: bytes | None = None) -> dict:
    owners = {(item.get("uid"), item.get("gid")) for item in records}
    if len(owners) != 1:
        raise ContinuityError("provider credential ownership is inconsistent")
    owner_uid, owner_gid = next(iter(owners))
    salt = salt or secrets.token_bytes(16)
    if len(salt) != 16:
        raise ContinuityError("credential continuity salt is invalid")
    key = hashlib.pbkdf2_hmac("sha256", _passphrase(passphrase_file), salt, AUTH_ITERATIONS, dklen=32)
    payload = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    tag = hmac.new(key, b"openclaw-credential-continuity-v1\x00" + payload, hashlib.sha256).hexdigest()
    return {
        "algorithm": "HMAC-SHA256/PBKDF2-HMAC-SHA256",
        "iterations": AUTH_ITERATIONS,
        "saltHex": salt.hex(),
        "tagHex": tag,
        "recordCount": len(records),
        "ownerUid": owner_uid,
        "ownerGid": owner_gid,
    }


def _bundle_summary(secret_manifest: dict, manifest_path: Path, records: list[dict]) -> dict:
    files = [item for item in records if item["kind"] == "file"]
    return {
        "artifactSha256": secret_manifest.get("artifactSha256"),
        "manifestSha256": hashlib.sha256(Path(manifest_path).read_bytes()).hexdigest(),
        "credentialFileCount": len(files),
        "credentialTotalBytes": sum(item["size"] for item in files),
    }


def _verify_bundle_matches_inventory(
    inventory: dict,
    artifact: Path,
    manifest_path: Path,
    passphrase_file: Path,
    *,
    continuity_salt: bytes | None = None,
    expected_owner: tuple[int, int] = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID),
) -> dict:
    secret_manifest, entries = _credential_bundle_inventory(artifact, manifest_path, passphrase_file)
    source_records = _source_credential_fingerprints(inventory)
    source_content = [{key: value for key, value in item.items() if key not in {"uid", "gid"}} for item in source_records]
    if source_content != entries:
        raise ContinuityError("secret bundle credential tree differs from the exact source paths, contents, or modes")
    owners = {(item["uid"], item["gid"]) for item in source_records}
    if owners != {expected_owner}:
        raise ContinuityError("source provider credential ownership differs from the OpenClaw runtime user")
    source_owner = next(iter(owners))
    continuity_records = [item | {"uid": source_owner[0], "gid": source_owner[1]} for item in entries]
    files = [item for item in entries if item["kind"] == "file"]
    file_count = len(files)
    total_bytes = sum(item["size"] for item in files)
    if file_count != inventory["credentials"]["fileCount"] or total_bytes != inventory["credentials"]["totalBytes"]:
        raise ContinuityError("secret bundle credential totals differ from cold-state inventory")
    summary = _bundle_summary(secret_manifest, manifest_path, entries)
    summary["credentialContinuity"] = _credential_continuity_auth(continuity_records, passphrase_file, continuity_salt)
    return summary


def _verify_bundle_matches_manifest(
    artifact: Path,
    manifest_path: Path,
    passphrase_file: Path,
    expected: dict,
    expected_owner: tuple[int, int] | None = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID),
) -> dict:
    secret_manifest, entries = _credential_bundle_inventory(artifact, manifest_path, passphrase_file)
    actual = _bundle_summary(secret_manifest, manifest_path, entries)
    for key in ("artifactSha256", "manifestSha256", "credentialFileCount", "credentialTotalBytes"):
        if actual[key] != expected.get(key):
            raise ContinuityError("cold snapshot secret bundle identity or credential totals changed")
    auth = expected.get("credentialContinuity")
    if not isinstance(auth, dict) or auth.get("algorithm") != "HMAC-SHA256/PBKDF2-HMAC-SHA256" or auth.get("iterations") != AUTH_ITERATIONS:
        raise ContinuityError("cold snapshot credential continuity authentication is missing")
    try:
        salt = bytes.fromhex(str(auth["saltHex"]))
        expected_tag = bytes.fromhex(str(auth["tagHex"]))
    except (KeyError, TypeError, ValueError) as exc:
        raise ContinuityError("cold snapshot credential continuity authentication is invalid") from exc
    owner_uid = auth.get("ownerUid")
    owner_gid = auth.get("ownerGid")
    if not isinstance(owner_uid, int) or not isinstance(owner_gid, int) or (expected_owner is not None and (owner_uid, owner_gid) != expected_owner):
        raise ContinuityError("snapshot provider credential owner is incompatible with the OpenClaw runtime")
    continuity_records = [item | {"uid": owner_uid, "gid": owner_gid} for item in entries]
    actual_auth = _credential_continuity_auth(continuity_records, passphrase_file, salt)
    if len(expected_tag) != 32 or auth.get("recordCount") != len(entries) or not hmac.compare_digest(expected_tag, bytes.fromhex(actual_auth["tagHex"])):
        raise ContinuityError("secret bundle credentials do not match the cold snapshot continuity proof")
    actual["credentialContinuity"] = actual_auth
    return actual


def _archive_state(source_root: Path, inventory: dict, output: Path, passphrase_file: Path) -> None:
    entries = inventory["_internal"]["stateEntries"] + inventory["_internal"]["workspaceEntries"]
    entries = sorted(entries, key=lambda item: (len(PurePosixPath(item["path"]).parts), item["path"]))
    process = subprocess.Popen(_openssl_args("e", passphrase_file) + ["-out", str(output)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        with tarfile.open(fileobj=process.stdin, mode="w|gz", format=tarfile.PAX_FORMAT) as archive:
            for entry in entries:
                path = source_root / entry["path"]
                archive.add(path, arcname=entry["path"], recursive=False)
        return_code, stderr = _finish_process(process)
        if return_code != 0:
            del stderr
            raise ContinuityError("OpenSSL failed to encrypt the cold snapshot")
    except BaseException:
        process.kill()
        _finish_process(process)
        raise
    with output.open("rb") as stream:
        os.fsync(stream.fileno())
    os.chmod(output, 0o600)


def create_snapshot(
    source_root: Path,
    output_dir: Path,
    passphrase_file: Path,
    secret_artifact: Path,
    secret_manifest: Path,
    metadata: dict,
    *,
    expected_owner: tuple[int, int] = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID),
) -> tuple[Path, Path, dict]:
    """Create an encrypted cold snapshot directly from the source tree (no plaintext tar staging)."""
    required = ("sourceHost", "sourceMachine", "amadeusVersion", "gitCommit", "openclawImage")
    if any(not isinstance(metadata.get(key), str) or not metadata[key] for key in required):
        raise ContinuityError("snapshot source metadata is incomplete")
    if metadata["amadeusVersion"] != "1.4.8":
        raise ContinuityError("snapshot requires repository version 1.4.8")
    source = Path(source_root)
    output_root = Path(output_dir)
    if source.is_symlink() or not source.is_dir():
        raise ContinuityError("OpenClaw source root is not a real directory")
    if output_root.is_symlink():
        raise ContinuityError("snapshot output directory is a symlink")
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output_root, 0o700)
    before = collect_inventory(source)
    secret_info = _verify_bundle_matches_inventory(
        before, secret_artifact, secret_manifest, passphrase_file, expected_owner=expected_owner
    )
    stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    filename_stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = output_root / f"openclaw-cold-{filename_stamp}.tar.gz.enc"
    manifest_path = output_root / f"openclaw-cold-{filename_stamp}.manifest.json"
    partial = output_root / f".{artifact.name}.{secrets.token_hex(6)}.partial"
    if artifact.exists() or manifest_path.exists():
        raise ContinuityError("snapshot output name already exists")
    try:
        _archive_state(source, before, partial, passphrase_file)
        after = collect_inventory(source)
        if continuity_projection(before) != continuity_projection(after):
            raise ContinuityError("source state changed while the cold snapshot was being created")
        continuity_salt = bytes.fromhex(secret_info["credentialContinuity"]["saltHex"])
        secret_after = _verify_bundle_matches_inventory(
            after, secret_artifact, secret_manifest, passphrase_file,
            continuity_salt=continuity_salt, expected_owner=expected_owner,
        )
        if secret_info != secret_after:
            raise ContinuityError("secret bundle changed while the cold snapshot was being created")
        body = {
            "schemaVersion": 2,
            "sourceHost": metadata["sourceHost"],
            "sourceMachine": metadata["sourceMachine"],
            "createdAtUtc": stamp,
            "amadeusVersion": metadata["amadeusVersion"],
            "gitCommit": metadata["gitCommit"],
            "openclawImage": metadata["openclawImage"],
            **public_inventory(after),
            "secretBundle": secret_info,
            "encryption": {"algorithm": "AES-256-CBC/PBKDF2-SHA256", "iterations": OPENSSL_ITERATIONS},
        }
        body.update(authenticate_artifact(partial, passphrase_file))
        body = authenticate_manifest(body, passphrase_file)
        os.replace(partial, artifact)
        os.chmod(artifact, 0o600)
        _atomic_json(manifest_path, body)
        return artifact, manifest_path, body
    except BaseException:
        try:
            partial.unlink()
        except FileNotFoundError:
            pass
        for path in (artifact, manifest_path):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        raise


def _validate_snapshot_plaintext(
    archive_path: Path,
    manifest: dict,
    secret_artifact: Path,
    secret_manifest: Path,
    passphrase_file: Path,
    expected_owner: tuple[int, int] | None,
) -> None:
    extracted = archive_path.parent / "state"
    members = validate_archive(archive_path)
    owner_overrides = {
        _safe_member_name(member.name).as_posix().rstrip("/"): (member.uid, member.gid)
        for member in members
    }
    extract_archive_safely(archive_path, extracted)
    # The encrypted archive retains the Linux guest's numeric ownership. On macOS,
    # the verifier may not be root, so the temporary extraction cannot chown files;
    # use the authenticated tar headers when rebuilding the source tree digest.
    actual = collect_inventory(extracted, require_credentials=False, owner_overrides=owner_overrides)
    expected_projection = {key: manifest[key] for key in ("workspace", "state", "sessionState", "sqlite")}
    actual_projection = continuity_projection(actual)
    mismatches = _metric_mismatch_paths(expected_projection, actual_projection)
    if mismatches:
        raise ContinuityError(
            "cold snapshot contents do not match authenticated manifest metrics; fields="
            + ",".join(mismatches)
        )
    if extracted.joinpath("config/credentials").exists():
        raise ContinuityError("cold snapshot unexpectedly contains provider credentials")
    secret_info = _verify_bundle_matches_manifest(
        secret_artifact, secret_manifest, passphrase_file, manifest.get("secretBundle", {}), expected_owner
    )
    if secret_info != manifest.get("secretBundle"):
        raise ContinuityError("cold snapshot and separate secret bundle metadata differ")


def _write_encrypted_stream(source, partial: Path, passphrase_file: Path) -> None:
    process = subprocess.Popen(_openssl_args("e", passphrase_file) + ["-out", str(partial)], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdin is not None
    try:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            process.stdin.write(chunk)
        return_code, stderr = _finish_process(process)
        if return_code != 0:
            del stderr
            raise ContinuityError("OpenSSL failed to encrypt the cold snapshot stream")
        with partial.open("rb") as stream:
            os.fsync(stream.fileno())
        os.chmod(partial, 0o600)
    except BaseException:
        process.kill()
        _finish_process(process)
        raise


def create_snapshot_from_stream(
    stream,
    inventory: dict,
    output_dir: Path,
    passphrase_file: Path,
    secret_artifact: Path,
    secret_manifest: Path,
    metadata: dict,
    *,
    expected_owner: tuple[int, int] = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID),
) -> tuple[Path, Path, dict]:
    """Encrypt a tar stream supplied by a stopped remote guest without writing plaintext staging."""
    required = ("sourceHost", "sourceMachine", "amadeusVersion", "gitCommit", "openclawImage")
    if any(not isinstance(metadata.get(key), str) or not metadata[key] for key in required):
        raise ContinuityError("snapshot source metadata is incomplete")
    if metadata["amadeusVersion"] != "1.4.8":
        raise ContinuityError("snapshot requires repository version 1.4.8")
    if "_internal" in inventory or any(key not in inventory for key in ("workspace", "state", "credentials", "sessionState", "sqlite")):
        raise ContinuityError("remote source inventory is incomplete or not sanitized")
    secret_info = _verify_bundle_matches_inventory(
        inventory, secret_artifact, secret_manifest, passphrase_file, expected_owner=expected_owner
    )
    output_root = Path(output_dir)
    if output_root.is_symlink():
        raise ContinuityError("snapshot output directory is a symlink")
    output_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output_root, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    filename_stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    artifact = output_root / f"openclaw-cold-{filename_stamp}.tar.gz.enc"
    manifest_path = output_root / f"openclaw-cold-{filename_stamp}.manifest.json"
    partial = output_root / f".{artifact.name}.{secrets.token_hex(6)}.partial"
    if artifact.exists() or manifest_path.exists():
        raise ContinuityError("snapshot output name already exists")
    try:
        _write_encrypted_stream(stream, partial, passphrase_file)
        body = {
            "schemaVersion": 2,
            "sourceHost": metadata["sourceHost"],
            "sourceMachine": metadata["sourceMachine"],
            "createdAtUtc": stamp,
            "amadeusVersion": metadata["amadeusVersion"],
            "gitCommit": metadata["gitCommit"],
            "openclawImage": metadata["openclawImage"],
            **{key: inventory[key] for key in ("workspace", "state", "credentials", "sessionState", "sqlite")},
            "secretBundle": secret_info,
            "encryption": {"algorithm": "AES-256-CBC/PBKDF2-SHA256", "iterations": OPENSSL_ITERATIONS},
        }
        body.update(authenticate_artifact(partial, passphrase_file))
        body = authenticate_manifest(body, passphrase_file)
        os.replace(partial, artifact)
        os.chmod(artifact, 0o600)
        _atomic_json(manifest_path, body)
        verify_snapshot(
            artifact, manifest_path, passphrase_file, secret_artifact, secret_manifest,
            expected_owner=expected_owner,
        )
        return artifact, manifest_path, body
    except BaseException:
        for path in (partial, artifact, manifest_path):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        raise


def verify_snapshot(
    artifact: Path,
    manifest_path: Path,
    passphrase_file: Path,
    secret_artifact: Path,
    secret_manifest: Path,
    *,
    expected_owner: tuple[int, int] | None = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID),
) -> dict:
    """Authenticate before decrypting, then compare all restored state metrics to the manifest."""
    try:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContinuityError("snapshot manifest is unavailable or invalid") from exc
    verify_manifest_authentication(manifest, passphrase_file)
    verify_artifact_authentication(artifact, passphrase_file, manifest)
    if manifest.get("schemaVersion") != 2 or manifest.get("amadeusVersion") != "1.4.8":
        raise ContinuityError("snapshot manifest version is unsupported")
    with tempfile.TemporaryDirectory(prefix="openclaw-cold-verify-") as temporary:
        private_root = Path(temporary)
        os.chmod(private_root, 0o700)
        archive_path = private_root / "snapshot.tar.gz"
        with archive_path.open("xb") as plaintext:
            result = subprocess.run(_openssl_args("d", passphrase_file) + ["-in", str(artifact)], stdout=plaintext, stderr=subprocess.PIPE)
            plaintext.flush()
            os.fsync(plaintext.fileno())
            os.chmod(archive_path, 0o600)
        if result.returncode != 0:
            raise ContinuityError("snapshot decryption failed")
        _validate_snapshot_plaintext(
            archive_path, manifest, secret_artifact, secret_manifest, passphrase_file, expected_owner
        )
    return manifest


def verify_restored_credentials(
    data_root: Path,
    secret_artifact: Path,
    secret_manifest: Path,
    passphrase_file: Path,
    *,
    expected_owner: tuple[int, int] | None = None,
) -> None:
    root = Path(data_root)
    if root.is_symlink() or not root.is_dir():
        raise ContinuityError("destination OpenClaw root is not a real directory")
    # Verify the encrypted bundle before comparing every target path, mode and content hash.
    _secret_manifest, bundle_records = _credential_bundle_inventory(secret_artifact, secret_manifest, passphrase_file)
    target_entries = _require_whatsapp_credentials(root)
    actual = private_credential_fingerprints(target_entries)
    actual_comparable = actual if expected_owner is not None else [
        {key: value for key, value in item.items() if key not in {"uid", "gid"}} for item in actual
    ]
    bundle_comparable = [item | ({"uid": expected_owner[0], "gid": expected_owner[1]} if expected_owner else {}) for item in bundle_records]
    if actual_comparable != bundle_comparable:
        raise ContinuityError("restored provider credentials differ from the authenticated secret bundle paths, contents, or modes")
    if expected_owner is not None and any((item["uid"], item["gid"]) != expected_owner for item in target_entries):
        raise ContinuityError("restored provider credential ownership differs from the OpenClaw runtime user")


def _copy_tree_preserving_metadata(source: Path, destination: Path) -> None:
    shutil.copytree(source, destination, symlinks=True, copy_function=shutil.copy2)
    entries = _walk_tree(destination.parent, destination.name, reject_symlinks=False)
    for item in entries:
        path = destination.parent / item["path"]
        if os.geteuid() == 0:
            os.chown(path, item["uid"], item["gid"], follow_symlinks=False)
        if item["kind"] != "symlink":
            os.chmod(path, item["mode"], follow_symlinks=False)


def restore_snapshot(
    artifact: Path,
    manifest_path: Path,
    passphrase_file: Path,
    secret_artifact: Path,
    secret_manifest: Path,
    destination_root: Path,
    *,
    approval_token: str,
    approved_replacements: set[str],
    verify_runtime_state: bool = True,
) -> Path:
    areas = set(AREAS)
    if approval_token != "APPROVE_AVALON_MOVE_1_4_8":
        raise ContinuityError("restore apply requires exact APPROVE_AVALON_MOVE_1_4_8")
    if approved_replacements != areas:
        raise ContinuityError("restore requires explicit replacement approval for config, workspace, data, and notifications")
    if verify_runtime_state:
        try:
            running = subprocess.run(
                ["docker", "ps", "--format", "{{.Names}} {{.Image}}"],
                check=True, capture_output=True, text=True,
            ).stdout.splitlines()
        except (OSError, subprocess.CalledProcessError) as exc:
            raise ContinuityError("destination container inventory is unavailable; restore remains blocked") from exc
        if any("openclaw" in line.lower() for line in running) or process_probe():
            raise ContinuityError("destination OpenClaw/Gateway is not stopped")
    destination = Path(destination_root)
    if destination.is_symlink() or not destination.is_dir():
        raise ContinuityError("destination OpenClaw root is missing, symlinked, or not a directory")
    for area in AREAS:
        target = destination / area
        if target.exists() and (target.is_symlink() or not target.is_dir()):
            raise ContinuityError(f"destination state root is not a real directory: {area}")
    runtime_owner = (OPENCLAW_RUNTIME_UID, OPENCLAW_RUNTIME_GID) if verify_runtime_state else None
    manifest = verify_snapshot(
        artifact, manifest_path, passphrase_file, secret_artifact, secret_manifest,
        expected_owner=runtime_owner,
    )
    owner_auth = manifest["secretBundle"]["credentialContinuity"]
    expected_owner = (owner_auth["ownerUid"], owner_auth["ownerGid"]) if verify_runtime_state else None
    verify_restored_credentials(
        destination, secret_artifact, secret_manifest, passphrase_file, expected_owner=expected_owner
    )

    backup_parent = destination / ".operation-skuld-restore-backups"
    if backup_parent.is_symlink():
        raise ContinuityError("restore backup path is a symlink")
    backup_parent.mkdir(mode=0o700, exist_ok=True)
    os.chmod(backup_parent, 0o700)
    backup_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(4)
    backup = backup_parent / backup_id
    backup.mkdir(mode=0o700)
    staged = destination / f".operation-skuld-restore-stage-{secrets.token_hex(6)}"
    staged.mkdir(mode=0o700)
    moved_old: list[str] = []
    installed_new: list[str] = []
    try:
        with tempfile.TemporaryDirectory(prefix="openclaw-restore-plain-", dir=destination.parent) as temporary:
            private_root = Path(temporary)
            os.chmod(private_root, 0o700)
            archive_path = private_root / "snapshot.tar.gz"
            with archive_path.open("xb") as plaintext:
                result = subprocess.run(_openssl_args("d", passphrase_file) + ["-in", str(artifact)], stdout=plaintext, stderr=subprocess.PIPE)
                plaintext.flush()
                os.fsync(plaintext.fileno())
                os.chmod(archive_path, 0o600)
            if result.returncode != 0:
                raise ContinuityError("snapshot decryption failed during restore")
            extracted = private_root / "state"
            extract_archive_safely(archive_path, extracted)
            for area in AREAS:
                source = extracted / area
                if area == "config":
                    credentials = destination / "config/credentials"
                    if credentials.is_dir() and not credentials.is_symlink():
                        _copy_tree_preserving_metadata(credentials, source / "credentials")
                    else:
                        raise ContinuityError("separate OpenClaw credentials must be restored before cold state")
                _copy_tree_preserving_metadata(source, staged / area)

        for area in AREAS:
            current = destination / area
            if current.exists():
                os.replace(current, backup / area)
                moved_old.append(area)
        for area in AREAS:
            os.replace(staged / area, destination / area)
            installed_new.append(area)

        restored = collect_inventory(destination)
        expected_projection = {key: manifest[key] for key in ("workspace", "state", "sessionState", "sqlite")}
        if continuity_projection(restored) != expected_projection:
            raise ContinuityError("restored OpenClaw state does not match the cold snapshot")
        verify_restored_credentials(
            destination, secret_artifact, secret_manifest, passphrase_file, expected_owner=expected_owner
        )
        return backup
    except BaseException:
        failed_new = backup / "failed-new"
        failed_new.mkdir(mode=0o700, exist_ok=True)
        for area in reversed(installed_new):
            current = destination / area
            if current.exists() and not (failed_new / area).exists():
                os.replace(current, failed_new / area)
        for area in reversed(moved_old):
            old = backup / area
            current = destination / area
            if old.exists() and not current.exists():
                os.replace(old, current)
        raise
    finally:
        if staged.exists():
            shutil.rmtree(staged)


def process_probe(proc_root: Path = Path("/proc"), current_pid: int | None = None) -> list[int]:
    """Find an uncontained OpenClaw/Gateway process by executable metadata without returning arguments."""
    current_pid = current_pid or os.getpid()
    parents = {current_pid}
    cursor = current_pid
    for _ in range(4):
        try:
            status = (proc_root / str(cursor) / "status").read_text(encoding="utf-8", errors="ignore")
            parent_line = next((line for line in status.splitlines() if line.startswith("PPid:")), "")
            cursor = int(parent_line.split()[1])
            parents.add(cursor)
        except (OSError, ValueError, IndexError):
            break
    matches = []
    for entry in proc_root.iterdir():
        if not entry.name.isdecimal() or int(entry.name) in parents:
            continue
        try:
            executable = (entry / "comm").read_text(encoding="utf-8", errors="ignore").strip().lower()
            argv = (entry / "cmdline").read_bytes().decode("utf-8", errors="ignore").replace("\x00", " ").lower()
        except OSError:
            continue
        if executable in {"openclaw", "openclaw-gateway", "gateway"}:
            matches.append(int(entry.name))
        elif executable in {"node", "nodejs"} and ("openclaw" in argv or "openclaw.mjs" in argv or "openclaw gateway" in argv):
            matches.append(int(entry.name))
    return matches


def _safe_member_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or ".." in path.parts or "\\" in name:
        raise ContinuityError("archive contains an unsafe path")
    if path.parts[0] not in AREAS:
        raise ContinuityError("archive contains an unexpected state root")
    if path.parts[:2] == ("config", "credentials"):
        raise ContinuityError("cold snapshot contains separate secret credentials")
    return path


def validate_archive(archive: Path) -> list[tarfile.TarInfo]:
    try:
        with tarfile.open(archive, "r:gz") as tar:
            members = tar.getmembers()
    except (tarfile.TarError, OSError) as exc:
        raise ContinuityError("encrypted snapshot plaintext is not a valid gzip tar archive") from exc
    names: set[str] = set()
    symlinks: set[str] = set()
    for member in members:
        normalized = _safe_member_name(member.name).as_posix().rstrip("/")
        if normalized in names:
            raise ContinuityError("archive contains duplicate entries")
        names.add(normalized)
        if member.issym():
            symlinks.add(normalized)
        elif member.islnk():
            _safe_member_name(member.linkname)
        elif not (member.isdir() or member.isreg()):
            raise ContinuityError("archive contains an unsupported special entry")
    for name in names:
        for parent in PurePosixPath(name).parents:
            if parent.as_posix() in symlinks:
                raise ContinuityError("archive contains a child below a symlink")
    return members


def extract_archive_safely(archive: Path, destination: Path) -> None:
    members = validate_archive(archive)
    root = Path(destination)
    if root.is_symlink():
        raise ContinuityError("archive extraction destination is a symlink")
    if root.exists() and any(root.iterdir()):
        raise ContinuityError("archive extraction destination is not empty")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            relative = _safe_member_name(member.name)
            target = root.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if member.issym():
                os.symlink(member.linkname, target)
                if os.geteuid() == 0:
                    os.chown(target, member.uid, member.gid, follow_symlinks=False)
            elif member.islnk():
                link = root.joinpath(*_safe_member_name(member.linkname).parts)
                if not link.exists() or link.is_symlink() or not link.is_file():
                    raise ContinuityError("archive hard link target is unavailable")
                os.link(link, target)
            elif member.isreg():
                source = tar.extractfile(member)
                if source is None:
                    raise ContinuityError("archive regular file has no content")
                with target.open("xb") as output:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        output.write(chunk)
                if os.geteuid() == 0:
                    os.chown(target, member.uid, member.gid, follow_symlinks=False)
                os.chmod(target, member.mode & 0o7777, follow_symlinks=False)
            else:
                raise ContinuityError("archive contains an unsupported entry")
    directories = [member for member in members if member.isdir()]
    for member in sorted(directories, key=lambda item: len(PurePosixPath(item.name).parts), reverse=True):
        target = root.joinpath(*_safe_member_name(member.name).parts)
        if os.geteuid() == 0:
            os.chown(target, member.uid, member.gid, follow_symlinks=False)
        os.chmod(target, member.mode & 0o7777, follow_symlinks=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    inventory_parser = subparsers.add_parser("inventory")
    inventory_parser.add_argument("data_root")
    inventory_parser.add_argument("--allow-missing-credentials", action="store_true")
    inventory_parser.add_argument("--private-credential-fingerprints", action="store_true")
    stream_parser = subparsers.add_parser("snapshot-stream")
    stream_parser.add_argument("--inventory-file", required=True, type=Path)
    stream_parser.add_argument("--metadata-file", required=True, type=Path)
    stream_parser.add_argument("--output-dir", required=True, type=Path)
    stream_parser.add_argument("--passphrase-file", required=True, type=Path)
    stream_parser.add_argument("--secret-artifact", required=True, type=Path)
    stream_parser.add_argument("--secret-manifest", required=True, type=Path)
    stream_parser.add_argument("--approve-source-freeze", required=True)
    verify_parser = subparsers.add_parser("verify-snapshot")
    verify_parser.add_argument("--artifact", required=True, type=Path)
    verify_parser.add_argument("--manifest", required=True, type=Path)
    verify_parser.add_argument("--passphrase-file", required=True, type=Path)
    verify_parser.add_argument("--secret-artifact", required=True, type=Path)
    verify_parser.add_argument("--secret-manifest", required=True, type=Path)
    restore_parser = subparsers.add_parser("restore-snapshot")
    restore_parser.add_argument("--artifact", required=True, type=Path)
    restore_parser.add_argument("--manifest", required=True, type=Path)
    restore_parser.add_argument("--passphrase-file", required=True, type=Path)
    restore_parser.add_argument("--secret-artifact", required=True, type=Path)
    restore_parser.add_argument("--secret-manifest", required=True, type=Path)
    restore_parser.add_argument("--destination-root", required=True, type=Path)
    restore_parser.add_argument("--apply", action="store_true")
    restore_parser.add_argument("--approval-token", default="")
    restore_parser.add_argument("--approve-replace", action="append", choices=AREAS, default=[])
    subparsers.add_parser("process-probe")
    args = parser.parse_args()
    if args.command == "inventory":
        result = collect_inventory(Path(args.data_root), require_credentials=not args.allow_missing_credentials)
        output = public_inventory(result)
        if args.private_credential_fingerprints:
            output["_privateCredentialFingerprints"] = private_credential_fingerprints(result["_internal"]["credentialEntries"])
        print(json.dumps(output, sort_keys=True, separators=(",", ":")))
        return 0
    if args.command == "snapshot-stream":
        if args.approve_source_freeze != "APPROVE_SOURCE_FREEZE_1_4_8":
            raise ContinuityError("snapshot apply requires exact APPROVE_SOURCE_FREEZE_1_4_8")
        inventory = json.loads(args.inventory_file.read_text(encoding="utf-8"))
        metadata = json.loads(args.metadata_file.read_text(encoding="utf-8"))
        artifact, manifest, _value = create_snapshot_from_stream(
            sys.stdin.buffer, inventory, args.output_dir, args.passphrase_file,
            args.secret_artifact, args.secret_manifest, metadata,
        )
        print(f"COLD_SNAPSHOT=created\nCOLD_SNAPSHOT_ARTIFACT={artifact}\nCOLD_SNAPSHOT_MANIFEST={manifest}")
        return 0
    if args.command == "verify-snapshot":
        manifest = verify_snapshot(args.artifact, args.manifest, args.passphrase_file, args.secret_artifact, args.secret_manifest)
        print(f"COLD_SNAPSHOT=verified SHA256={manifest['artifactSha256']}")
        return 0
    if args.command == "restore-snapshot":
        if not args.apply:
            manifest = verify_snapshot(args.artifact, args.manifest, args.passphrase_file, args.secret_artifact, args.secret_manifest)
            owner_auth = manifest["secretBundle"]["credentialContinuity"]
            verify_restored_credentials(
                args.destination_root, args.secret_artifact, args.secret_manifest, args.passphrase_file,
                expected_owner=(owner_auth["ownerUid"], owner_auth["ownerGid"]),
            )
            print(f"OPENCLAW_STATE_RESTORE=PLAN MEMORY_SHA256={manifest['workspace']['memoryMdSha256']}")
            return 0
        backup = restore_snapshot(
            args.artifact, args.manifest, args.passphrase_file, args.secret_artifact, args.secret_manifest,
            args.destination_root, approval_token=args.approval_token, approved_replacements=set(args.approve_replace),
        )
        destination_inventory = public_inventory(collect_inventory(args.destination_root))
        workspace = destination_inventory["workspace"]
        state = destination_inventory["state"]
        sqlite = destination_inventory["sqlite"]
        sessions = destination_inventory["sessionState"]
        print(f"DEST_MEMORY_MD_SHA256={workspace['memoryMdSha256']}")
        print(f"DEST_MEMORY_TREE_SHA256={workspace['memoryTreeSha256']}")
        print(f"DEST_WORKSPACE_FILE_COUNT={workspace['fileCount']}")
        print(f"DEST_WORKSPACE_BYTES={workspace['totalBytes']}")
        print(f"DEST_IDENTITY_DB_SHA256={sqlite['identityDbSha256']}")
        print(f"DEST_IDENTITY_DB_INTEGRITY={sqlite['identityDbIntegrity']}")
        print(f"DEST_PUBG_DB_INTEGRITY={sqlite['pubgDbIntegrity']}")
        print(f"DEST_OPENCLAW_STATE_FILE_COUNT={state['fileCount']}")
        print(f"DEST_OPENCLAW_STATE_BYTES={state['totalBytes']}")
        print(f"DEST_SESSION_AND_JSONL_FILE_COUNT={sessions['sessionAndJsonlFileCount']}")
        print(f"DEST_TRANSCRIPT_FILE_COUNT={sessions['transcriptFileCount']}")
        print(f"OPENCLAW_STATE_RESTORE=verified ROLLBACK_CHECKPOINT={backup.name}")
        return 0
    if args.command == "process-probe":
        matches = process_probe()
        print(f"OPENCLAW_PROCESS_COUNT={len(matches)}")
        return 1 if matches else 0
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContinuityError as exc:
        print(f"CONTINUITY_ERROR={exc}", file=sys.stderr)
        raise SystemExit(1)
