#!/usr/bin/env python3
"""Encrypted, public-schema-only PostgreSQL backup and disposable restore rehearsal.

All database destinations are supplied through environment variables. The
restore command only creates a new, explicitly named disposable database; it
never drops or overwrites an existing database.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_SCHEMA = "pubg-saas-backup/v1"
DISPOSABLE_PREFIX = "pubg_saas_disposable_"
DISPOSABLE_MARKER = "pubg-saas-disposable-backup-restore-rehearsal/v1"
BACKUP_ARTIFACT_NAME = re.compile(r"pubg-saas-[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}\.dump\.age\Z")
CORE_TABLES = {
    "public.schema_migrations",
    "public.tenants",
    "public.teams",
    "public.matches",
}
PRIVATE_NAME_PARTS = ("openclaw", "kurisu", "sqlite", "9router")
COUNT_SQL = r"""
SELECT COALESCE(
  jsonb_object_agg(table_name, row_count ORDER BY table_name),
  '{}'::jsonb
)::text
FROM (
  SELECT t.table_schema || '.' || t.table_name AS table_name,
         COALESCE((xpath(
           '//c/text()',
           query_to_xml(
             format('SELECT count(*)::bigint AS c FROM %I.%I', t.table_schema, t.table_name),
             false, false, ''
           )
         ))[1]::text::bigint, 0) AS row_count
  FROM information_schema.tables AS t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
) AS counts;
"""


class OpsError(Exception):
    pass


def fail(message: str) -> "NoReturn":
    raise OpsError(message)


def outside_repo(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve(strict=False)
    try:
        inside = os.path.commonpath((str(REPO_ROOT), str(resolved))) == str(REPO_ROOT)
    except ValueError:
        inside = False
    if inside:
        fail(f"{label} must be outside the Git repository")
    return resolved


def minimal_environment() -> dict[str, str]:
    env = {
        key: value
        for key, value in os.environ.items()
        if key in {"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE"}
    }
    # Optional local rehearsal transport. The tool paths still default to the
    # operator host for scheduled production backups; these non-secret values
    # let the same safety-checked backup utility reach an isolated Compose PG
    # over `docker compose exec` without publishing PostgreSQL.
    for key in (
        "PUBG_SAAS_PG_EXEC_PROJECT",
        "PUBG_SAAS_PG_EXEC_COMPOSE_FILE",
        "PUBG_SAAS_PG_EXEC_ENV_FILE",
    ):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


def require_regular_external_file(value: str, label: str, *, private: bool = False) -> Path:
    if not value:
        fail(f"{label} path is required")
    raw_path = Path(value).expanduser()
    if raw_path.is_symlink():
        fail(f"{label} must not be a symlink")
    path = outside_repo(raw_path, label)
    try:
        info = path.stat()
    except OSError:
        fail(f"{label} file is missing or unreadable")
    if not stat.S_ISREG(info.st_mode):
        fail(f"{label} must be a regular file")
    if private and (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077):
        fail(f"{label} must be owned by the current user and have mode 0600 or stricter")
    return path


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"required environment variable is missing: {name}")
    return value


def pg_environment(url: str) -> tuple[dict[str, str], str]:
    """Convert a PostgreSQL URI into libpq environment without argv leakage."""
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.port:
            fail("database URL must be postgresql:// with an explicit host and port")
        database = unquote(parsed.path.lstrip("/"))
        username = unquote(parsed.username or "")
        if not database or not username:
            fail("database URL must include an explicit database and user")
        host = parsed.hostname
        port = parsed.port
    except (ValueError, UnicodeError):
        fail("database URL is invalid")

    env = minimal_environment()
    env.update(
        {
            "PGHOST": host,
            "PGPORT": str(port),
            "PGUSER": username,
            "PGDATABASE": database,
        }
    )
    if parsed.password is not None:
        env["PGPASSWORD"] = unquote(parsed.password)
    else:
        env.pop("PGPASSWORD", None)
    allowed_query_options = {
        "sslmode": "PGSSLMODE",
        "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT",
        "sslkey": "PGSSLKEY",
        "sslpassword": "PGSSLPASSWORD",
        "gssencmode": "PGGSSENCMODE",
        "channel_binding": "PGCHANNELBINDING",
        "connect_timeout": "PGCONNECT_TIMEOUT",
        "application_name": "PGAPPNAME",
        "target_session_attrs": "PGTARGETSESSIONATTRS",
    }
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        env_name = allowed_query_options.get(key)
        if env_name:
            env[env_name] = value
    return env, database


def run_tool(args: list[str], *, env: dict[str, str], stdin: Any = None) -> subprocess.CompletedProcess[str]:
    executable = shutil.which(args[0])
    if not executable:
        fail(f"required program is unavailable: {args[0]}")
    # Never include raw command arguments or libpq diagnostics: those can carry
    # paths and connection identity that should stay out of logs.
    result = subprocess.run(
        [executable, *args[1:]],
        env=env,
        stdin=stdin,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode:
        fail(f"{args[0]} failed (exit {result.returncode})")
    return result


def table_counts(env: dict[str, str], database: str, snapshot: str | None = None) -> dict[str, int]:
    if snapshot is not None and not re.fullmatch(r"[0-9A-Fa-f-]+", snapshot):
        fail("invalid PostgreSQL snapshot identifier")
    sql = COUNT_SQL
    if snapshot is not None:
        sql = (
            "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n"
            f"SET TRANSACTION SNAPSHOT '{snapshot}';\n"
            + COUNT_SQL
            + "\nCOMMIT;"
        )
    result = run_tool(
        [
            "psql",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "--dbname",
            database,
            "--command",
            sql,
        ],
        env=env,
    )
    try:
        counts = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        fail("PostgreSQL returned invalid public table counts")
    if not isinstance(counts, dict) or any(
        not isinstance(name, str) or not isinstance(count, int) or count < 0
        for name, count in counts.items()
    ):
        fail("PostgreSQL returned invalid public table counts")
    if not CORE_TABLES.issubset(counts):
        fail("database does not contain the required public PUBG SaaS tables")
    lowered_names = [name.lower() for name in counts]
    if any(part in name for name in lowered_names for part in PRIVATE_NAME_PARTS):
        fail("public schema contains a private runtime table name; refusing backup")
    return dict(sorted(counts.items()))


def start_exported_snapshot(env: dict[str, str], database: str) -> tuple[subprocess.Popen[str], str]:
    executable = shutil.which("psql")
    if not executable:
        fail("required program is unavailable: psql")
    process = subprocess.Popen(
        [executable, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "--dbname", database],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )
    assert process.stdin is not None and process.stdout is not None
    try:
        process.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSELECT pg_export_snapshot();\n")
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], 15)
        if not ready:
            fail("timed out opening a PostgreSQL backup snapshot")
        snapshot = process.stdout.readline().strip()
        if not re.fullmatch(r"[0-9A-Fa-f-]+", snapshot):
            fail("PostgreSQL did not return a valid exported snapshot")
        return process, snapshot
    except Exception:
        process.kill()
        process.wait(timeout=5)
        raise


def finish_exported_snapshot(process: subprocess.Popen[str], *, commit: bool) -> None:
    try:
        if process.stdin and not process.stdin.closed and process.poll() is None:
            process.stdin.write(("COMMIT;\n" if commit else "ROLLBACK;\n") + "\\q\n")
            process.stdin.flush()
            process.stdin.close()
        process.wait(timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        process.kill()
        process.wait(timeout=5)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_manifest(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        fail("manifest must be a regular file")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        fail("manifest is unreadable or invalid JSON")
    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        fail("unsupported backup manifest schema")
    if manifest.get("scope") != "postgres-public-schema-only" or manifest.get("encryption") != "age":
        fail("manifest does not describe the encrypted public PostgreSQL schema")
    if not isinstance(manifest.get("artifact"), str):
        fail("manifest artifact name is invalid")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("artifactSha256", ""))):
        fail("manifest checksum is invalid")
    if not re.fullmatch(r"[A-Za-z0-9_]{1,63}", str(manifest.get("sourceDatabase", ""))):
        fail("manifest source database identity is invalid")
    if any(part in manifest["sourceDatabase"].lower() for part in PRIVATE_NAME_PARTS):
        fail("manifest source database is not a public PUBG SaaS database")
    counts = manifest.get("publicTableCounts")
    if not isinstance(counts, dict) or not CORE_TABLES.issubset(counts):
        fail("manifest does not contain required public PUBG SaaS table counts")
    for name, count in counts.items():
        if not isinstance(name, str) or any(part in name.lower() for part in PRIVATE_NAME_PARTS):
            fail("manifest contains a non-public SaaS table name")
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            fail("manifest contains an invalid table count")
    if "snapshotRequestedAtUtc" in manifest:
        snapshot_requested = manifest.get("snapshotRequestedAtUtc")
        created_at_utc = manifest.get("createdAtUtc")
        if not isinstance(snapshot_requested, str) or not isinstance(created_at_utc, str):
            fail("manifest snapshot timestamp is invalid")
        try:
            snapshot_time = datetime.fromisoformat(snapshot_requested.replace("Z", "+00:00"))
            created_time = datetime.fromisoformat(created_at_utc.replace("Z", "+00:00"))
        except ValueError:
            fail("manifest snapshot timestamp is invalid")
        if snapshot_time.tzinfo is None or created_time.tzinfo is None:
            fail("manifest snapshot timestamps must include a timezone")
        if snapshot_time.astimezone(timezone.utc) > created_time.astimezone(timezone.utc):
            fail("manifest snapshot timestamp is after backup completion")
    return manifest


def validate_archive(artifact_value: str, manifest_value: str) -> tuple[Path, Path, dict[str, Any]]:
    artifact_input = Path(artifact_value).expanduser()
    manifest_input = Path(manifest_value).expanduser()
    if artifact_input.is_symlink() or manifest_input.is_symlink():
        fail("encrypted backup and manifest must not be symlinks")
    artifact = outside_repo(artifact_input, "encrypted backup")
    manifest_path = outside_repo(manifest_input, "backup manifest")
    if artifact.is_symlink() or not artifact.is_file():
        fail("encrypted backup must be a regular file")
    manifest = read_manifest(manifest_path)
    if manifest["artifact"] != artifact.name:
        fail("manifest does not describe the selected backup artifact")
    if sha256_file(artifact) != manifest["artifactSha256"]:
        fail("encrypted backup checksum does not match the manifest")
    if artifact.stat().st_size != manifest.get("artifactBytes"):
        fail("encrypted backup size does not match the manifest")
    return artifact, manifest_path, manifest


def decrypt_and_validate(artifact: Path, identity_file: Path, temp_dump: Path) -> None:
    env = minimal_environment()
    run_tool(
        ["age", "--decrypt", "--identity", str(identity_file), "--output", str(temp_dump), str(artifact)],
        env=env,
    )
    if not temp_dump.is_file() or temp_dump.stat().st_size == 0:
        fail("decrypted PostgreSQL archive is empty")
    listing = run_tool(["pg_restore", "--list", str(temp_dump)], env=env)
    if "TABLE DATA" not in listing.stdout and "TABLE" not in listing.stdout:
        fail("decrypted file is not a PostgreSQL custom archive")


def restore_list_without_public_schema(toc: str) -> str:
    lines = toc.splitlines(keepends=True)
    public_schema_entries = [
        index for index, line in enumerate(lines)
        if re.match(r"^\s*\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public(?:\s|$)", line)
    ]
    if len(public_schema_entries) != 1:
        fail("PostgreSQL archive must contain exactly one public schema entry")
    del lines[public_schema_entries[0]]
    return "".join(lines)


def recovery_access_sql(database: str) -> str:
    # validate_disposable_target restricts this identifier to lowercase ASCII
    # letters, digits and underscores before it reaches this function.
    quoted_database = f'"{database}"'
    return f"""
REVOKE CONNECT ON DATABASE {quoted_database} FROM PUBLIC;
GRANT CONNECT ON DATABASE {quoted_database} TO pubg_migrator, pubg_app, pubg_backup;
GRANT USAGE, CREATE ON SCHEMA public TO pubg_migrator;
GRANT USAGE ON SCHEMA public TO pubg_app, pubg_backup;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pubg_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pubg_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pubg_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pubg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pubg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pubg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO pubg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO pubg_backup;
"""


def command_backup(args: argparse.Namespace) -> None:
    source_env, source_database = pg_environment(required_env("PUBG_SAAS_DATABASE_URL"))
    if any(part in source_database.lower() for part in PRIVATE_NAME_PARTS):
        fail("source database identity is not a public PUBG SaaS database")
    recipient_file = require_regular_external_file(args.recipients_file, "age recipients file")
    recipient_text = recipient_file.read_text(encoding="utf-8").strip()
    if not recipient_text or not any(line.strip().startswith("age1") for line in recipient_text.splitlines()):
        fail("age recipients file must contain at least one age1 public recipient")
    output_input = Path(args.output_dir).expanduser()
    if output_input.is_symlink():
        fail("backup output directory must not be a symlink")
    output_dir = outside_repo(output_input, "backup output directory")
    output_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    if output_dir.is_symlink() or not output_dir.is_dir():
        fail("backup output must be a real directory")
    if stat.S_IMODE(output_dir.stat().st_mode) & 0o077:
        fail("backup output directory must have owner-only permissions (mode 0700)")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    nonce = os.urandom(4).hex()
    basename = f"pubg-saas-{stamp}-{nonce}.dump.age"
    final_artifact = output_dir / basename
    manifest_path = output_dir / f"pubg-saas-{stamp}-{nonce}.manifest.json"
    if final_artifact.exists() or manifest_path.exists():
        fail("refusing to overwrite an existing backup artifact or manifest")
    temp_root = Path(tempfile.mkdtemp(prefix=".pubg-saas-backup-", dir=output_dir))
    os.chmod(temp_root, 0o700)
    plain_dump = temp_root / "public.dump"
    encrypted_dump = temp_root / basename
    artifact_created = False
    manifest_created = False
    backup_complete = False
    try:
        # This precedes PostgreSQL's exported-snapshot request and therefore
        # gives operators a conservative upper bound for backup-point age.
        snapshot_requested_at = datetime.now(timezone.utc)
        snapshot_session, snapshot = start_exported_snapshot(source_env, source_database)
        snapshot_ok = False
        try:
            counts = table_counts(source_env, source_database, snapshot)
            run_tool(
                [
                    "pg_dump",
                    "--format=custom",
                    "--no-owner",
                    "--no-acl",
                    "--schema=public",
                    f"--snapshot={snapshot}",
                    "--file",
                    str(plain_dump),
                    "--dbname",
                    source_database,
                ],
                env=source_env,
            )
            snapshot_ok = True
        finally:
            finish_exported_snapshot(snapshot_session, commit=snapshot_ok)
        if not plain_dump.is_file() or plain_dump.stat().st_size == 0:
            fail("pg_dump did not produce a non-empty public-schema archive")
        run_tool(
            ["age", "--encrypt", "--recipients-file", str(recipient_file), "--output", str(encrypted_dump), str(plain_dump)],
            env=minimal_environment(),
        )
        if not encrypted_dump.is_file() or encrypted_dump.stat().st_size == 0:
            fail("age did not produce an encrypted archive")
        digest = sha256_file(encrypted_dump)
        manifest = {
            "schema": MANIFEST_SCHEMA,
            "createdAtUtc": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
            "snapshotRequestedAtUtc": snapshot_requested_at.isoformat(timespec="microseconds"),
            "sourceDatabase": source_database,
            "scope": "postgres-public-schema-only",
            "snapshot": "shared-pg-exported-snapshot",
            "encryption": "age",
            "artifact": basename,
            "artifactSha256": digest,
            "artifactBytes": encrypted_dump.stat().st_size,
            "publicTableCounts": counts,
        }
        os.chmod(encrypted_dump, 0o600)
        os.link(encrypted_dump, final_artifact)
        artifact_created = True
        encrypted_dump.unlink()
        manifest_tmp = temp_root / "manifest.json"
        manifest_tmp.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        os.chmod(manifest_tmp, 0o600)
        manifest_fd = os.open(manifest_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        manifest_created = True
        with os.fdopen(manifest_fd, "w", encoding="utf-8") as target:
            target.write(manifest_tmp.read_text(encoding="utf-8"))
        backup_complete = True
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
        if not backup_complete:
            if artifact_created:
                final_artifact.unlink(missing_ok=True)
            if manifest_created:
                manifest_path.unlink(missing_ok=True)
    print(f"PUBG_SAAS_BACKUP=passed\nARTIFACT={final_artifact}\nMANIFEST={manifest_path}\nSHA256={digest}")


def command_verify(args: argparse.Namespace) -> None:
    artifact, _, manifest = validate_archive(args.artifact, args.manifest)
    identity = require_regular_external_file(args.identity_file, "age identity", private=True)
    temp_root = Path(tempfile.mkdtemp(prefix="pubg-saas-verify-", dir=os.environ.get("TMPDIR", "/tmp")))
    os.chmod(temp_root, 0o700)
    try:
        plain_dump = temp_root / "public.dump"
        decrypt_and_validate(artifact, identity, plain_dump)
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
    print(
        "PUBG_SAAS_BACKUP_VERIFY=passed\n"
        f"SOURCE_DATABASE={manifest['sourceDatabase']}\n"
        f"PUBLIC_TABLES={len(manifest['publicTableCounts'])}\n"
        f"SHA256={manifest['artifactSha256']}"
    )


def validate_disposable_target(name: str, confirmation: str) -> None:
    if len(name) > 63 or not re.fullmatch(r"pubg_saas_disposable_[a-z0-9_]+", name):
        fail(f"target database must use the {DISPOSABLE_PREFIX}<label> disposable namespace")
    if confirmation != name:
        fail("explicit --confirm-disposable-target must exactly match the target name")


def admin_database_exists(env: dict[str, str], target_database: str) -> bool:
    escaped = target_database.replace("'", "''")
    result = run_tool(
        [
            "psql",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "--command",
            f"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = '{escaped}')",
        ],
        env=env,
    )
    return result.stdout.strip() == "t"


def command_restore(args: argparse.Namespace) -> None:
    if not args.apply:
        fail("restore is write-capable; pass --apply and the exact disposable-target guard")
    validate_disposable_target(args.target_database, args.confirm_disposable_target)
    artifact, _, manifest = validate_archive(args.artifact, args.manifest)
    if args.target_database == manifest["sourceDatabase"]:
        fail("restore target must differ from the source database")
    identity = require_regular_external_file(args.identity_file, "age identity", private=True)
    admin_env, _ = pg_environment(required_env("PUBG_SAAS_RESTORE_ADMIN_URL"))
    if admin_database_exists(admin_env, args.target_database):
        fail("disposable target already exists; restore never overwrites or drops a database")

    temp_root = Path(tempfile.mkdtemp(prefix="pubg-saas-restore-", dir=os.environ.get("TMPDIR", "/tmp")))
    os.chmod(temp_root, 0o700)
    try:
        plain_dump = temp_root / "public.dump"
        restore_list = temp_root / "restore.list"
        decrypt_and_validate(artifact, identity, plain_dump)
        toc = run_tool(["pg_restore", "--list", str(plain_dump)], env=minimal_environment()).stdout
        restore_list.write_text(restore_list_without_public_schema(toc), encoding="utf-8")
        os.chmod(restore_list, 0o600)
        run_tool(["createdb", "--template=template0", "--owner=pubg_migrator", args.target_database], env=admin_env)
        run_tool(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "--command", f"COMMENT ON DATABASE {args.target_database} IS '{DISPOSABLE_MARKER}'"],
            env={**admin_env, "PGDATABASE": args.target_database},
        )
        target_env = {**admin_env, "PGDATABASE": args.target_database}
        run_tool(
            ["pg_restore", "--use-list", str(restore_list), "--role=pubg_migrator", "--no-owner", "--no-acl", "--exit-on-error", "--dbname", args.target_database, str(plain_dump)],
            env=target_env,
        )
        run_tool(
            ["psql", "-X", "-v", "ON_ERROR_STOP=1", "--command", recovery_access_sql(args.target_database)],
            env=target_env,
        )
        restored_counts = table_counts(target_env, args.target_database)
        if restored_counts != manifest["publicTableCounts"]:
            fail("restored public table counts differ from the encrypted backup manifest")
    except Exception:
        # Keep a created database for forensic inspection after a failed restore;
        # it is marked as disposable and can only be removed by the guarded cleanup command.
        raise
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
    print(
        "PUBG_SAAS_RESTORE=passed\n"
        f"TARGET_DATABASE={args.target_database}\n"
        f"TARGET_MARKER={DISPOSABLE_MARKER}\n"
        f"PUBLIC_TABLES={len(restored_counts)}\n"
        f"COUNT_MATCHED_TABLES={len(restored_counts)}"
    )


def command_cleanup(args: argparse.Namespace) -> None:
    if not args.apply:
        fail("cleanup is destructive; pass --apply and the exact disposable-target guard")
    validate_disposable_target(args.target_database, args.confirm_disposable_target)
    admin_env, _ = pg_environment(required_env("PUBG_SAAS_RESTORE_ADMIN_URL"))
    escaped = args.target_database.replace("'", "''")
    result = run_tool(
        [
            "psql",
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "--command",
            "SELECT COALESCE(shobj_description(oid, 'pg_database'), '') "
            f"FROM pg_database WHERE datname = '{escaped}'",
        ],
        env=admin_env,
    )
    if result.stdout.strip() != DISPOSABLE_MARKER:
        fail("cleanup target is missing or lacks the exact PUBG SaaS disposable marker")
    run_tool(["dropdb", args.target_database], env=admin_env)
    print(f"PUBG_SAAS_DISPOSABLE_CLEANUP=passed\nTARGET_DATABASE={args.target_database}")


def command_prune(args: argparse.Namespace) -> None:
    if not args.apply:
        fail("backup retention is destructive; pass --apply and the exact output-directory guard")
    if args.retention_days < 7 or args.retention_days > 3650:
        fail("backup retention must be between 7 and 3650 days")
    output_input = Path(args.output_dir).expanduser()
    if output_input.is_symlink():
        fail("backup output directory must not be a symlink")
    output_dir = outside_repo(output_input, "backup output directory")
    if not output_dir.is_dir() or output_dir.is_symlink():
        fail("backup output directory must already exist")
    if stat.S_IMODE(output_dir.stat().st_mode) & 0o077:
        fail("backup output directory must have owner-only permissions (mode 0700)")
    confirmed_dir = Path(args.confirm_output_dir).expanduser().resolve(strict=False)
    if confirmed_dir != output_dir:
        fail("explicit --confirm-output-dir must exactly match the backup output directory")

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.retention_days)
    pairs: list[tuple[Path, Path]] = []
    for manifest_path in sorted(output_dir.glob("pubg-saas-*.manifest.json")):
        if manifest_path.is_symlink() or not manifest_path.is_file():
            fail("backup retention found a non-regular manifest; refusing cleanup")
        manifest = read_manifest(manifest_path)
        artifact_name = manifest["artifact"]
        if not BACKUP_ARTIFACT_NAME.fullmatch(artifact_name):
            fail("backup retention found an unexpected artifact name; refusing cleanup")
        expected_manifest = artifact_name.removesuffix(".dump.age") + ".manifest.json"
        if manifest_path.name != expected_manifest:
            fail("backup retention found a mismatched artifact/manifest pair; refusing cleanup")
        artifact_path = output_dir / artifact_name
        if artifact_path.is_symlink() or not artifact_path.is_file():
            fail("backup retention found a missing or non-regular artifact; refusing cleanup")
        try:
            created_at = datetime.fromisoformat(str(manifest["createdAtUtc"]).replace("Z", "+00:00"))
        except (KeyError, TypeError, ValueError):
            fail("backup retention found an invalid manifest timestamp; refusing cleanup")
        if created_at.tzinfo is None:
            fail("backup retention found a timezone-free manifest timestamp; refusing cleanup")
        artifact_stat = artifact_path.stat()
        manifest_stat = manifest_path.stat()
        if (
            created_at.astimezone(timezone.utc) < cutoff
            and artifact_stat.st_mtime < cutoff.timestamp()
            and manifest_stat.st_mtime < cutoff.timestamp()
        ):
            validate_archive(str(artifact_path), str(manifest_path))
            pairs.append((artifact_path, manifest_path))

    removed_bytes = 0
    for artifact_path, manifest_path in pairs:
        removed_bytes += artifact_path.stat().st_size + manifest_path.stat().st_size
        artifact_path.unlink()
        manifest_path.unlink()
    print(f"PUBG_SAAS_BACKUP_PRUNE=passed REMOVED_PAIRS={len(pairs)} REMOVED_BYTES={removed_bytes}")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("backup", help="create encrypted public-schema PostgreSQL backup")
    backup.add_argument("--recipients-file", required=True, help="external age public-recipient file")
    backup.add_argument("--output-dir", required=True, help="external backup directory; never defaults inside Git")
    backup.set_defaults(handler=command_backup)
    verify = commands.add_parser("verify", help="verify checksum, decryptability, and pg_restore archive structure")
    verify.add_argument("--artifact", required=True)
    verify.add_argument("--manifest", required=True)
    verify.add_argument("--identity-file", required=True, help="external, owner-only age identity file")
    verify.set_defaults(handler=command_verify)
    restore = commands.add_parser("restore", help="create a new guarded disposable database from an encrypted backup")
    restore.add_argument("--artifact", required=True)
    restore.add_argument("--manifest", required=True)
    restore.add_argument("--identity-file", required=True)
    restore.add_argument("--target-database", required=True)
    restore.add_argument("--confirm-disposable-target", required=True, help="must exactly repeat --target-database")
    restore.add_argument("--apply", action="store_true", help="required acknowledgement for database creation")
    restore.set_defaults(handler=command_restore)
    cleanup = commands.add_parser("cleanup", help="drop only a database with this tool's exact disposable marker")
    cleanup.add_argument("--target-database", required=True)
    cleanup.add_argument("--confirm-disposable-target", required=True)
    cleanup.add_argument("--apply", action="store_true", help="required acknowledgement for disposable database deletion")
    cleanup.set_defaults(handler=command_cleanup)
    prune = commands.add_parser("prune", help="remove only expired encrypted backup/manifest pairs")
    prune.add_argument("--output-dir", required=True, help="owner-only external encrypted backup directory")
    prune.add_argument("--confirm-output-dir", required=True, help="must exactly match the resolved output directory")
    prune.add_argument("--retention-days", type=int, default=7)
    prune.add_argument("--apply", action="store_true", help="required acknowledgement for backup deletion")
    prune.set_defaults(handler=command_prune)
    return root


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        args.handler(args)
    except OpsError as error:
        print(f"PUBG_SAAS_OPS_ERROR={error}", file=sys.stderr)
        return 1
    except OSError:
        print("PUBG_SAAS_OPS_ERROR=local filesystem operation failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
