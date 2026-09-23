#!/usr/bin/env python3
"""Fixture tests for sanitized state inventory and cold-snapshot integrity helpers."""

from __future__ import annotations

import json
import io
import hashlib
import os
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openclaw_continuity import (  # noqa: E402
    ContinuityError,
    authenticate_artifact,
    authenticate_manifest,
    check_source_stopped,
    collect_inventory,
    create_snapshot,
    create_snapshot_from_stream,
    continuity_projection,
    extract_archive_safely,
    private_credential_fingerprints,
    private_state_fingerprints,
    process_probe,
    public_inventory,
    restore_snapshot,
    validate_archive,
    verify_artifact_authentication,
    verify_restored_credentials,
    verify_snapshot,
    _snapshot_projection,
    _copy_tree_preserving_metadata,
    _verify_bundle_matches_inventory,
)
from openclaw_credentials_owner import (  # noqa: E402
    OPENCLAW_RUNTIME_GID,
    OPENCLAW_RUNTIME_UID,
    normalize_runtime_tree,
)
from skuld_secret_bundle_auth import seal as seal_secret_bundle  # noqa: E402


def make_sqlite(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as database:
        database.execute("CREATE TABLE state (value TEXT)")
        database.execute("INSERT INTO state VALUES ('fixture')")


def make_openclaw_session_store(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as database:
        database.execute("CREATE TABLE session_nodes (id TEXT)")
        database.executemany("INSERT INTO session_nodes VALUES (?)", [("s1",), ("s2",)])
        database.execute("CREATE TABLE transcript_events (id TEXT)")
        database.executemany("INSERT INTO transcript_events VALUES (?)", [("e1",), ("e2",), ("e3",)])
        database.execute("CREATE TABLE session_transcript_active_events (id TEXT)")
        database.executemany("INSERT INTO session_transcript_active_events VALUES (?)", [("e1",), ("e2",)])
        database.execute("CREATE TABLE session_transcript_archives (id TEXT)")
        database.execute("INSERT INTO session_transcript_archives VALUES ('a1')")
        database.execute("CREATE TABLE session_transcript_fts (text TEXT)")
        database.executemany("INSERT INTO session_transcript_fts VALUES (?)", [("c1",), ("c2",), ("c3",)])


def rewrite_tar_owners(source_stream: io.BytesIO, uid: int, gid: int) -> io.BytesIO:
    source_stream.seek(0)
    rewritten = io.BytesIO()
    with tarfile.open(fileobj=source_stream, mode="r:gz") as source_tar:
        with tarfile.open(fileobj=rewritten, mode="w:gz") as target_tar:
            for member in source_tar.getmembers():
                member.uid = uid
                member.gid = gid
                payload = source_tar.extractfile(member) if member.isfile() else None
                target_tar.addfile(member, payload)
    rewritten.seek(0)
    return rewritten


class pytest_raises:
    def __init__(self, exception):
        self.exception = exception

    def __enter__(self):
        return None

    def __exit__(self, exception_type, exception, traceback):
        if exception_type is None:
            raise AssertionError(f"expected {self.exception.__name__}")
        if not issubclass(exception_type, self.exception):
            return False
        return True


with tempfile.TemporaryDirectory(prefix="openclaw-continuity-test-") as temporary:
    base = Path(temporary)
    if os.geteuid() == 0:
        owner_source = base / "owner-source"
        (owner_source / "nested").mkdir(parents=True)
        (owner_source / "nested/state.json").write_text("owner fixture\n")
        (owner_source / "nested/state.json").chmod(0o640)
        (owner_source / "nested").chmod(0o750)
        remote_owner = (4242, 31337)
        for path in (owner_source / "nested/state.json", owner_source / "nested", owner_source):
            os.chown(path, *remote_owner, follow_symlinks=False)
        owner_destination = base / "owner-destination"
        _copy_tree_preserving_metadata(owner_source, owner_destination)
        assert (owner_destination.stat().st_uid, owner_destination.stat().st_gid) == remote_owner
        assert ((owner_destination / "nested").stat().st_uid, (owner_destination / "nested").stat().st_gid) == remote_owner
        copied_file = owner_destination / "nested/state.json"
        assert (copied_file.stat().st_uid, copied_file.stat().st_gid) == remote_owner
        assert (copied_file.stat().st_mode & 0o7777) == 0o640

    source = base / "source"
    for area in ("config", "workspace", "data", "notifications"):
        (source / area).mkdir(parents=True)

    (source / "config/agents/main/sessions").mkdir(parents=True)
    (source / "config/agents/main/transcripts").mkdir(parents=True)
    (source / "config/agents/main/sessions/session-index.jsonl").write_text('{"fixture":true}\n')
    (source / "config/agents/main/sessions/session-old.jsonl.deleted.fixture.zst").write_bytes(b"archive")
    (source / "config/agents/main/transcripts/transcript-private-id.jsonl").write_text("fixture transcript payload\n")
    (source / "config/cache/control-ui-assets").mkdir(parents=True)
    (source / "config/cache/control-ui-assets/session-sidebar.js").write_text("asset fixture\n")
    (source / "config/cache/control-ui-assets/transcript-search.js").write_text("asset fixture\n")
    npm_fixture = source / "config/npm/projects/wa/node_modules/session-helper.js"
    npm_fixture.parent.mkdir(parents=True)
    npm_fixture.write_text("asset fixture\n")
    make_openclaw_session_store(source / "config/agents/main/agent/openclaw-agent.sqlite")
    make_sqlite(source / "config/state.sqlite")
    os.symlink("/opt/openclaw/plugins", source / "config/plugin-link")

    for name in ("AGENTS.md", "SOUL.md", "USER.md"):
        (source / "workspace" / name).write_text(f"seed {name}\n")
    (source / "workspace/MEMORY.md").write_text("runtime memory payload\n")
    (source / "workspace/memory").mkdir()
    (source / "workspace/memory/day.md").write_text("private memory payload\n")

    make_sqlite(source / "data/identity.sqlite")
    make_sqlite(source / "data/pubg.sqlite")
    (source / "data/vps-state.json").write_text('{"fixture":true}\n')
    (source / "notifications/owner-event.json").write_text('{"status":"fixture"}\n')
    credentials = source / "config/credentials/whatsapp/secondary"
    credentials.mkdir(parents=True)
    (credentials / "session-private-peer.json").write_text("fixture credential payload\n")
    (credentials / "session-private-peer.json").chmod(0o600)

    owner_calls = []
    owner_entry_count = normalize_runtime_tree(
        source / "config/credentials",
        lambda path, uid, gid, *, follow_symlinks: owner_calls.append((path, uid, gid, follow_symlinks)),
    )
    assert owner_entry_count == len(owner_calls)
    assert owner_calls and all(uid == OPENCLAW_RUNTIME_UID and gid == OPENCLAW_RUNTIME_GID and not follow for _, uid, gid, follow in owner_calls)
    linked_credentials = base / "linked-credentials"
    (linked_credentials / "whatsapp").mkdir(parents=True)
    os.symlink("/tmp/not-a-credential", linked_credentials / "whatsapp/link")
    with pytest_raises(ValueError):
        normalize_runtime_tree(linked_credentials, lambda *_args, **_kwargs: None)

    original = collect_inventory(source)
    safe_json = json.dumps(public_inventory(original), sort_keys=True)
    assert "runtime memory payload" not in safe_json
    assert "private memory payload" not in safe_json
    assert "fixture transcript payload" not in safe_json
    assert "fixture credential payload" not in safe_json
    assert "session-private-peer" not in safe_json
    assert original["credentials"]["fileCount"] == 1
    fixture_owner = (
        (source / "config/credentials").stat().st_uid,
        (source / "config/credentials").stat().st_gid,
    )
    assert original["workspace"]["memoryMdSha256"]
    assert original["workspace"]["memoryTreeSha256"]
    assert original["sessionState"]["status"] == "verified"
    assert original["sessionState"]["sessionStoreCount"] == 1
    assert original["sessionState"]["sessionCount"] == 2
    assert original["sessionState"]["transcriptEventCount"] == 3
    assert original["sessionState"]["activeTranscriptEventCount"] == 2
    assert original["sessionState"]["transcriptArchiveCount"] == 1
    assert original["sessionState"]["transcriptSearchChunkCount"] == 3
    assert original["sessionState"]["sessionJsonlFileCount"] == 1
    assert original["sessionState"]["sessionArchiveFileCount"] == 1
    assert original["sessionState"]["transcriptFileCount"] == 1
    legacy_projection = _snapshot_projection({"schemaVersion": 2}, original)["sessionState"]
    assert legacy_projection == original["_internal"]["legacySessionState"]
    assert legacy_projection["sessionAndJsonlFileCount"] > original["sessionState"]["sessionJsonlFileCount"]
    assert original["sqlite"]["databaseCount"] == 4
    assert original["sqlite"]["identityDbIntegrity"] == "ok"
    assert original["sqlite"]["pubgDbIntegrity"] == "ok"
    assert set(original["state"]["treeSha256ByRoot"]) == {"config", "data", "notifications"}
    public_cli = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("openclaw_continuity.py")), "inventory", str(source)],
        check=True, capture_output=True, text=True,
    )
    public_cli_inventory = json.loads(public_cli.stdout)
    assert "_privateCredentialFingerprints" not in public_cli_inventory
    assert "session-private-peer" not in public_cli.stdout
    private_cli = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("openclaw_continuity.py")), "inventory", str(source), "--private-credential-fingerprints"],
        check=True, capture_output=True, text=True,
    )
    private_cli_inventory = json.loads(private_cli.stdout)
    assert len(private_cli_inventory["_privateCredentialFingerprints"]) == len(original["_internal"]["credentialEntries"])
    assert "session-private-peer" not in private_cli.stdout

    state_cli = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("openclaw_continuity.py")), "inventory", str(source), "--private-state-fingerprints"],
        check=True, capture_output=True, text=True,
    )
    private_state_cli = json.loads(state_cli.stdout)
    assert len(private_state_cli["_privateStateFingerprints"]) == len(original["_internal"]["stateEntries"])
    assert "session-index.jsonl" not in state_cli.stdout

    with pytest_raises(ContinuityError):
        check_source_stopped("running")
    check_source_stopped("exited")

    fake_proc = base / "proc-fixture"
    (fake_proc / "123").mkdir(parents=True)
    (fake_proc / "999").mkdir()
    (fake_proc / "998").mkdir()
    (fake_proc / "999/comm").write_text("node\n")
    (fake_proc / "999/cmdline").write_bytes(b"node\x00/app/openclaw/dist/index.js\x00gateway\x00")
    (fake_proc / "998/comm").write_text("node\n")
    (fake_proc / "998/cmdline").write_bytes(b"node\x00/app/other-service/index.js\x00")
    assert process_probe(fake_proc, current_pid=123) == [999]

    memory_file = source / "workspace/MEMORY.md"
    saved_memory = memory_file.read_bytes()
    memory_file.write_text("changed runtime memory\n")
    changed = collect_inventory(source)
    assert changed["workspace"]["memoryMdSha256"] != original["workspace"]["memoryMdSha256"]
    assert changed["workspace"]["memoryTreeSha256"] == original["workspace"]["memoryTreeSha256"]
    memory_file.write_bytes(saved_memory)

    archive = base / "state.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for area in ("config", "workspace", "data", "notifications"):
            for path in sorted((source / area).rglob("*")):
                relative = path.relative_to(source).as_posix()
                if relative == "config/credentials" or relative.startswith("config/credentials/"):
                    continue
                tar.add(path, arcname=relative, recursive=False)
            tar.add(source / area, arcname=area, recursive=False)
    assert validate_archive(archive)

    restored = base / "restored"
    extract_archive_safely(archive, restored)
    after = collect_inventory(restored, require_credentials=False)
    assert continuity_projection(after) == continuity_projection(original)
    source_file_mode = (source / "config/state.sqlite").stat().st_mode & 0o7777
    mode_probe = restored / "config/state.sqlite"
    mode_probe.chmod(source_file_mode ^ 0o100)
    archive_mode_overrides = {
        member.name.rstrip("/"): member.mode & 0o7777
        for member in validate_archive(archive)
    }
    normalized_after = collect_inventory(
        restored, require_credentials=False, mode_overrides=archive_mode_overrides
    )
    assert continuity_projection(normalized_after) == continuity_projection(original)
    assert not (restored / "config/credentials").exists()
    assert os.readlink(restored / "config/plugin-link") == "/opt/openclaw/plugins"

    traversal = base / "unsafe.tar.gz"
    with tarfile.open(traversal, "w:gz") as tar:
        info = tarfile.TarInfo("../../outside")
        info.size = 1
        tar.addfile(info, io.BytesIO(b"x"))
    with pytest_raises(ContinuityError):
        validate_archive(traversal)

    passphrase = base / "passphrase"
    passphrase.write_text("fixture-only-passphrase\n")
    passphrase.chmod(0o600)
    seal = authenticate_artifact(archive, passphrase)
    verify_artifact_authentication(archive, passphrase, seal)
    tampered = base / "tampered.tar.gz"
    tampered.write_bytes(archive.read_bytes() + b"changed")
    with pytest_raises(ContinuityError):
        verify_artifact_authentication(tampered, passphrase, seal)

    # Build an encrypted fixture secret bundle whose authenticated metadata binds
    # the provider credential tree kept outside the cold-state tar.
    secret_plain = base / "secret-fixture.tar.gz"
    credential_rel = "DATA/AppData/openclaw/config/credentials/whatsapp/secondary/session-private-peer.json"
    with tarfile.open(secret_plain, "w:gz") as secret_tar:
        credential_root = source / "config/credentials"
        for path in [credential_root, *sorted(credential_root.rglob("*"))]:
            relative = "DATA/AppData/openclaw/" + path.relative_to(source).as_posix()
            secret_tar.add(path, arcname="./" + relative, recursive=False)
    secret_artifact = base / "secrets.tar.enc"
    with secret_artifact.open("wb") as encrypted:
        result = subprocess.run(
            ["openssl", "enc", "-aes-256-cbc", "-salt", "-pbkdf2", "-iter", "200000", "-md", "sha256", "-in", str(secret_plain), "-pass", f"file:{passphrase}"],
            stdout=encrypted,
            stderr=subprocess.PIPE,
        )
    assert result.returncode == 0
    secret_manifest_path = base / "secrets.manifest.json"
    credential_file = source / "config/credentials/whatsapp/secondary/session-private-peer.json"
    secret_manifest_path.write_text(json.dumps({
        "schemaVersion": 2,
        "logicalIds": ["openclaw-runtime-credentials"],
        "files": [{
            "pathSha256": hashlib.sha256(credential_rel.encode()).hexdigest(),
            "pathScope": "openclaw-runtime-credentials",
            "size": credential_file.stat().st_size,
            "mode": format(credential_file.stat().st_mode & 0o777, "04o"),
        }],
    }))
    seal_secret_bundle(secret_artifact, secret_manifest_path, passphrase)

    # Equal counts/bytes cannot substitute for exact source credential path and content continuity.
    content_changed = base / "content-changed-source"
    shutil.copytree(source, content_changed, symlinks=True)
    changed_credential = content_changed / "config/credentials/whatsapp/secondary/session-private-peer.json"
    changed_credential.write_text("fixture credential PAYLOAD\n")
    changed_inventory = collect_inventory(content_changed)
    assert changed_inventory["credentials"]["fileCount"] == original["credentials"]["fileCount"]
    assert changed_inventory["credentials"]["totalBytes"] == original["credentials"]["totalBytes"]
    with pytest_raises(ContinuityError):
        _verify_bundle_matches_inventory(
            changed_inventory, secret_artifact, secret_manifest_path, passphrase, expected_owner=fixture_owner
        )

    path_changed = base / "path-changed-source"
    shutil.copytree(source, path_changed, symlinks=True)
    old_credential = path_changed / "config/credentials/whatsapp/secondary/session-private-peer.json"
    old_credential.rename(old_credential.with_name("session-other-peer.json"))
    path_inventory = collect_inventory(path_changed)
    assert path_inventory["credentials"]["fileCount"] == original["credentials"]["fileCount"]
    assert path_inventory["credentials"]["totalBytes"] == original["credentials"]["totalBytes"]
    with pytest_raises(ContinuityError):
        _verify_bundle_matches_inventory(
            path_inventory, secret_artifact, secret_manifest_path, passphrase, expected_owner=fixture_owner
        )

    mode_changed = base / "mode-changed-source"
    shutil.copytree(source, mode_changed, symlinks=True)
    (mode_changed / "config/credentials/whatsapp/secondary").chmod(0o700)
    mode_inventory = collect_inventory(mode_changed)
    assert mode_inventory["credentials"]["fileCount"] == original["credentials"]["fileCount"]
    assert mode_inventory["credentials"]["totalBytes"] == original["credentials"]["totalBytes"]
    with pytest_raises(ContinuityError):
        _verify_bundle_matches_inventory(
            mode_inventory, secret_artifact, secret_manifest_path, passphrase, expected_owner=fixture_owner
        )
    if fixture_owner != (1000, 1000):
        with pytest_raises(ContinuityError):
            _verify_bundle_matches_inventory(original, secret_artifact, secret_manifest_path, passphrase)

    # The production runner streams guest tar output straight into OpenSSL.
    tar_stream = io.BytesIO()
    with tarfile.open(fileobj=tar_stream, mode="w:gz") as streamed_tar:
        for area in ("config", "workspace", "data", "notifications"):
            for path in sorted((source / area).rglob("*")):
                relative = path.relative_to(source).as_posix()
                if relative == "config/credentials" or relative.startswith("config/credentials/"):
                    continue
                streamed_tar.add(path, arcname=relative, recursive=False)
            streamed_tar.add(source / area, arcname=area, recursive=False)
    tar_stream.seek(0)
    stream_snapshot_dir = base / "encrypted-output"
    metadata = {
        "sourceHost": "fixture-host",
        "sourceMachine": "fixture-machine",
        "amadeusVersion": "1.4.8",
        "gitCommit": "0123456789abcdef0123456789abcdef01234567",
        "openclawImage": "fixture/openclaw@sha256:fixture",
    }
    artifact_path, manifest_path, manifest = create_snapshot_from_stream(
        tar_stream,
        public_inventory(original) | {
            "_privateCredentialFingerprints": private_credential_fingerprints(original["_internal"]["credentialEntries"]),
            "_privateStateFingerprints": private_state_fingerprints(original["_internal"]["stateEntries"]),
        },
        stream_snapshot_dir,
        passphrase,
        secret_artifact,
        secret_manifest_path,
        metadata,
        expected_owner=fixture_owner,
    )
    assert artifact_path.is_file() and artifact_path.stat().st_mode & 0o777 == 0o600
    assert stream_snapshot_dir.stat().st_mode & 0o777 == 0o700
    safe_manifest = manifest_path.read_text()
    for private_text in (
        "runtime memory payload",
        "private memory payload",
        "fixture transcript payload",
        "fixture credential payload",
        "session-private-peer",
        hashlib.sha256(credential_rel.encode()).hexdigest(),
        hashlib.sha256("config/agents/main/sessions/session-index.jsonl".encode()).hexdigest(),
    ):
        assert private_text not in safe_manifest
    assert manifest["workspace"]["memoryMdSha256"] == original["workspace"]["memoryMdSha256"]
    assert manifest["workspace"]["memoryTreeSha256"] == original["workspace"]["memoryTreeSha256"]
    assert manifest["schemaVersion"] == 3
    assert manifest["secretBundle"]["credentialContinuity"]["recordCount"] == len(original["_internal"]["credentialEntries"])
    assert verify_snapshot(
        artifact_path, manifest_path, passphrase, secret_artifact, secret_manifest_path,
        expected_owner=fixture_owner,
    )["artifactSha256"] == manifest["artifactSha256"]
    legacy_manifest = dict(manifest)
    legacy_manifest["schemaVersion"] = 2
    legacy_manifest["sessionState"] = _snapshot_projection({"schemaVersion": 2}, original)["sessionState"]
    legacy_manifest_path = base / "legacy-v2.manifest.json"
    legacy_manifest_path.write_text(json.dumps(authenticate_manifest(legacy_manifest, passphrase)))
    assert verify_snapshot(
        artifact_path, legacy_manifest_path, passphrase, secret_artifact, secret_manifest_path,
        expected_owner=fixture_owner,
    )["artifactSha256"] == manifest["artifactSha256"]

    # A Mac verifier cannot chown its temporary extraction to the Linux guest UID.
    # Recreate the same source tree with distinct archive ownership and ensure the
    # authenticated tar headers, not the local extraction user, drive the digest.
    remote_owner = (4242, 31337)
    owner_overrides = {
        path.relative_to(source).as_posix(): remote_owner
        for area in ("config", "workspace", "data", "notifications")
        for path in (source / area, *(source / area).rglob("*"))
    }
    remote_inventory = collect_inventory(source, owner_overrides=owner_overrides)
    remote_private_fingerprints = private_credential_fingerprints(
        remote_inventory["_internal"]["credentialEntries"]
    )
    remote_stream_snapshot_dir = base / "remote-owner-encrypted-output"
    remote_artifact_path, remote_manifest_path, remote_manifest = create_snapshot_from_stream(
        rewrite_tar_owners(tar_stream, *remote_owner),
        public_inventory(remote_inventory) | {
            "_privateCredentialFingerprints": remote_private_fingerprints,
            "_privateStateFingerprints": private_state_fingerprints(remote_inventory["_internal"]["stateEntries"]),
        },
        remote_stream_snapshot_dir,
        passphrase,
        secret_artifact,
        secret_manifest_path,
        metadata,
        expected_owner=remote_owner,
    )
    assert verify_snapshot(
        remote_artifact_path, remote_manifest_path, passphrase, secret_artifact, secret_manifest_path,
        expected_owner=remote_owner,
    )["artifactSha256"] == remote_manifest["artifactSha256"]

    tree_artifact, tree_manifest, tree_value = create_snapshot(
        source,
        base / "tree-encrypted-output",
        passphrase,
        secret_artifact,
        secret_manifest_path,
        metadata,
        expected_owner=fixture_owner,
    )
    assert verify_snapshot(
        tree_artifact, tree_manifest, passphrase, secret_artifact, secret_manifest_path,
        expected_owner=fixture_owner,
    )["artifactSha256"] == tree_value["artifactSha256"]

    destination = base / "destination"
    shutil.copytree(source, destination, symlinks=True)
    old_destination_memory = destination / "workspace/MEMORY.md"
    old_destination_memory.write_text("pre-restore destination-only memory\n")
    original_workspace_hash = original["workspace"]["memoryTreeSha256"]
    with pytest_raises(ContinuityError):
        restore_snapshot(
            artifact_path, manifest_path, passphrase, secret_artifact, secret_manifest_path,
            destination, approval_token="", approved_replacements={"config", "workspace", "data", "notifications"},
        )
    with pytest_raises(ContinuityError):
        restore_snapshot(
            artifact_path, manifest_path, passphrase, secret_artifact, secret_manifest_path,
            destination, approval_token="APPROVE_AVALON_MOVE_1_4_8", approved_replacements={"workspace"},
        )
    rollback_checkpoint = restore_snapshot(
        artifact_path,
        manifest_path,
        passphrase,
        secret_artifact,
        secret_manifest_path,
        destination,
        approval_token="APPROVE_AVALON_MOVE_1_4_8",
        approved_replacements={"config", "workspace", "data", "notifications"},
        verify_runtime_state=False,
    )
    restored_inventory = collect_inventory(destination)
    assert restored_inventory["workspace"]["memoryMdSha256"] == original["workspace"]["memoryMdSha256"]
    assert restored_inventory["workspace"]["memoryTreeSha256"] == original_workspace_hash
    assert restored_inventory["sqlite"]["integrity"] == "passed"
    assert (destination / "config/credentials/whatsapp/secondary/session-private-peer.json").is_file()
    assert (rollback_checkpoint / "workspace/MEMORY.md").read_text() == "pre-restore destination-only memory\n"
    verify_restored_credentials(
        destination, secret_artifact, secret_manifest_path, passphrase, expected_owner=fixture_owner
    )
    restored_credential = destination / "config/credentials/whatsapp/secondary/session-private-peer.json"
    restored_credential.write_text("fixture credential PAYLOAD\n")
    with pytest_raises(ContinuityError):
        verify_restored_credentials(
            destination, secret_artifact, secret_manifest_path, passphrase, expected_owner=fixture_owner
        )

    bad_manifest = base / "changed.manifest.json"
    changed_manifest = json.loads(manifest_path.read_text())
    changed_manifest["sourceHost"] = "tampered-host"
    bad_manifest.write_text(json.dumps(changed_manifest))
    with pytest_raises(ContinuityError):
        verify_snapshot(artifact_path, bad_manifest, passphrase, secret_artifact, secret_manifest_path)

    changed_cipher = base / "changed.tar.gz.enc"
    changed_cipher.write_bytes(artifact_path.read_bytes() + b"tampered")
    with pytest_raises(ContinuityError):
        verify_snapshot(changed_cipher, manifest_path, passphrase, secret_artifact, secret_manifest_path)

print("OPENCLAW_CONTINUITY_FIXTURE_TEST=passed")
