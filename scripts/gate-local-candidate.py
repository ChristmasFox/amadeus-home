#!/usr/bin/env python3
"""Protected Gate-Local image candidate adapter; never handles Gate-Prod."""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pathlib
import posixpath
import re
import shutil
import signal
import stat
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from gate_autopilot import (  # noqa: E402
    IDENTIFIER,
    classify_changed_scope,
    migration_risk,
    preflight_candidate,
    run_candidate_pipeline,
    validate_private_state,
)

POLICY_PATH = pathlib.Path.home() / ".config" / "amadeus" / "gate-local-auto-approval.json"
IMAGE_RE = re.compile(r"local/pubg-saas:git-([0-9a-f]{40})\Z")
COMPOSE_NAMES = {"compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"}
MIGRATION_PREFIX = "apps/pubg-saas/src/infrastructure/postgres/migrations/"
OPTIONAL_MIGRATION = "0025_gate_memory_pgvector.sql"
HOMEBREW_LIBPQ_BIN_CANDIDATES = (
    pathlib.Path("/opt/homebrew/opt/libpq/bin"),
    pathlib.Path("/usr/local/opt/libpq/bin"),
    pathlib.Path("/home/linuxbrew/.linuxbrew/opt/libpq/bin"),
)

class CandidateError(Exception):
    pass


class OperatorAuthorizationRequired(CandidateError):
    pass


def deployment_status(error: CandidateError) -> str:
    return "BLOCKED_OPERATOR_AUTHORIZATION" if isinstance(error, OperatorAuthorizationRequired) else "BLOCKED"


def recovery_step(reason: str) -> str:
    if reason.startswith("approval_"):
        return "review the external Gate-Local approval; create or renew it with pnpm devctl configure gate-auto-enable"
    if reason.startswith("m2_") or reason == "m2_pause_active":
        return "M2 clearance is not required for Gate-Local candidates; reserve gate-m2-clear for a future formal release and keep M2 state unchanged"
    return {
        "canary_test_tenant_not_unique": "add or identify exactly one existing Gate-Local test tenant marked test, fixture, or canary; no tenant ID was emitted and no deployment write occurred",
        "canary_test_tenant_unavailable": "verify the existing Gate-Local test tenant marker and bounded tenant identifier; no tenant ID was emitted and no deployment write occurred",
        "gateway_environment_checkpoint_failed": "verify Gate age recipient/identity files and retry; the candidate does not proceed without encrypted Gateway configuration backup",
        "gateway_environment_checkpoint_verify_failed": "verify the Gate age identity and encrypted Gateway checkpoint; the candidate does not proceed without a verified checkpoint",
        "database_rollback_failed": "keep the Gate services stopped, preserve the encrypted full-database checkpoint, and restore it with the guarded recovery procedure before restarting the prior app",
        "separate_pgvector_authorization_required": "prepare a separately authorized pgvector image/extension plan and verified Gate backup; this autopilot will not apply it",
        "separate_extension_authorization_required": "review the extension change with dedicated authorization and verified backup/restore evidence",
        "migration_statement_not_allowlisted": "review the migration statement manually and use a separately approved release path",
        "migration_sql_invalid_or_empty": "repair the migration SQL in the reviewed Git source and rerun the dry-run preflight",
        "migration_security_change_requires_review": "review the privilege change independently before selecting any release path",
        "migration_function_requires_review": "review the database function security and behavior before selecting any release path",
        "migration_source_missing_or_untrusted": "restore the changed migration from the reviewed Git commit and rerun source verification",
        "shared_package_change": "split the shared package update into a reviewed change and verify both Lab and Gate consumers",
        "no_changes": "commit the intended Gate source change and rerun the candidate preflight",
        "non_runtime": "review the changed paths; this candidate path only applies Gate runtime source",
        "lab_only": "route the change through the Lab release path; Gate autopilot will not apply it",
        "target_machine_scope_mismatch": "verify the Gate-Local machine in the external approval and keep it separate from the Lab machine",
        "target_machine_invalid": "select the configured Gate-Local machine from the host profile and renew the scoped Gate approval",
        "gate_target_overlaps_lab_machine": "configure a dedicated Gate-Local OrbStack machine, then renew the Gate approval",
        "target_bot_or_image_identity_untrusted": "verify the fixed Gate app path, Gate Bot account ID, and immutable active image on the selected target",
        "target_bot_identity_changed": "verify the Gate Bot binding and reissue the approval only after the intended target is confirmed",
        "target_identity_untrusted": "verify the Gate-Local target identity and active image against the external approval before retrying",
        "bot_identity_mismatch": "verify the Gate Bot account binding and reissue the approval only for the intended Bot",
        "target_compose_service_identity_invalid": "restore the reviewed Gate Compose service names and image references, then rerun target verification",
        "dual_or_missing_runtime": "inspect the Gate Gateway and Worker count for the selected Bot; resolve the duplicate or missing process before retrying",
        "active_runtime_not_running": "restore the single Gate Gateway and Worker to a healthy state before retrying the candidate",
        "target_gateway_container_missing": "verify the Gate Gateway service and target machine, then rerun the read-only target preflight",
        "compose_runtime_facts_invalid": "repair the Gate Compose/runtime inspection path and verify its fixed service identities",
        "schema_incompatible_or_unknown": "review the migration against the live compatible schema window in an isolated fixture before retrying",
        "release_in_progress": "wait for or reconcile the existing Gate release lock and audit before starting another candidate",
        "recoverable_backup_missing": "verify the external age recipients/identity and restore fixture; no migration or service switch was attempted",
        "backup_directory_missing": "restore the protected external Gate checkpoint directory with owner-only permissions",
        "backup_directory_symlink_refused": "replace the external checkpoint symlink with a real owner-only directory",
        "backup_directory_inside_repository": "move Gate release artifacts outside the checkout and retry the preflight",
        "backup_directory_unavailable": "restore access to the protected external Gate checkpoint directory and verify its owner",
        "backup_directory_permissions_invalid": "set the external Gate checkpoint directory to owner-only mode 0700 and verify its owner",
        "encrypted_database_checkpoint_failed": "check the Gate backup permissions, age configuration, and pg_dump health, then repeat the isolated restore rehearsal",
        "encrypted_database_checkpoint_verify_failed": "inspect the encrypted checkpoint and age identity, then repeat the isolated pg_restore listing before retrying",
        "candidate_host_tools_unavailable": "install or repair the required host-side Gate candidate tools, then rerun read-only verification",
        "candidate_image_transfer_failed": "check the Gate target transport and free space, then retry transfer of the immutable digest",
        "candidate_image_digest_mismatch": "discard the mismatched candidate and rebuild or transfer the image matching the recorded immutable digest",
        "immutable_candidate_digest_invalid": "rebuild the Gate image with a valid immutable digest and rerun candidate verification",
        "checkpoint_path_already_exists": "inspect the external checkpoint and audit for that candidate; use a new reviewed source commit for another attempt",
        "candidate_health_or_smoke_failed": "review the checkpoint and rollback audit, confirm the previous application is healthy, and diagnose the failed Gate health probe",
        "rollback_failed_manual_recovery_required": "use the external checkpoint to restore the previous Compose/env and follow the Gate application recovery runbook",
        "rollback_checkpoint_missing": "restore the protected previous Compose and environment checkpoint before attempting another candidate",
        "candidate_step_failed": "review the recorded failed step, checkpoint, and audit; reconcile schema and application state before retrying",
        "candidate_adapter_incomplete": "repair the Gate candidate adapter so every guarded build, backup, migration, switch, health, smoke, audit, notify, and rollback step is present",
        "immutable_candidate_identity_missing": "rebuild the candidate and record both its source commit and immutable image digest",
        "command_unavailable_or_timed_out": "verify the host release command and Gate-Local target health, then retry the blocked step",
        "command_failed": "inspect the fixed release command result and external checkpoint/audit, then repair the failing Gate preflight step",
        "source_sha_invalid": "restore a valid committed Git source state and rerun the Gate candidate preflight",
        "active_goal_state_unavailable": "restore the private devctl Goal state from the active checkout, then rerun the candidate preflight",
        "active_goal_base_invalid": "repair the active Goal base commit in devctl state using a valid Git commit, then rerun preflight",
        "active_image_source_lineage_invalid": "verify the active immutable image SHA is an ancestor of the candidate source and restore the matching Git commit before retrying",
        "apply_requires_clean_committed_source": "commit the reviewed Gate change and clean unrelated worktree edits before candidate apply",
        "external_release_file_missing": "restore the protected Gate release adapter files outside the repository",
        "release_file_inside_repository": "move Gate release secrets and adapter state outside the Git checkout",
        "external_release_file_unavailable": "restore access to the protected external Gate release adapter files",
        "external_release_file_untrusted": "review and restore the protected external Gate release adapter files with the expected owner and contents",
        "private_release_file_permissions_invalid": "set protected external Gate release files to owner-only permissions and verify their owner",
        "notification_hook_untrusted": "restore the approved Gate-private notification hook with its expected external path and permissions",
        "approval_reference_invalid": "check the approval reference against the external Gate-Local approval record and retry with the matching reference",
        "release_lock_symlink_refused": "remove the untrusted external Gate lock symlink after reviewing any active release, then retry",
        "private_test_notification_failed": "verify the Gate-private notification hook and deliver the recorded candidate status through the approved test channel",
        "cross_product_change": "split the Gate change from Lab/shared changes and review the two release paths separately",
    }.get(reason, "review the named preflight gate and external audit/checkpoint before retrying")


def command(args: list[str], *, input_data: bytes | None = None, timeout: int = 1800) -> bytes:
    try:
        result = subprocess.run(args, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                check=False, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise CandidateError("command_unavailable_or_timed_out") from error
    if result.returncode:
        raise CandidateError("command_failed")
    return result.stdout


def path_with_libpq_pg_restore(
    path_value: str,
    candidates: tuple[pathlib.Path, ...] = HOMEBREW_LIBPQ_BIN_CANDIDATES,
) -> str:
    """Add a keg-only Homebrew libpq bin directory when pg_restore is not on PATH."""
    if shutil.which("pg_restore", path=path_value):
        return path_value
    entries = [entry for entry in path_value.split(os.pathsep) if entry]
    for bin_dir in candidates:
        executable = bin_dir / "pg_restore"
        if executable.is_file() and os.access(executable, os.X_OK):
            if str(bin_dir) not in entries:
                entries.insert(0, str(bin_dir))
            return os.pathsep.join(entries)
    return path_value


def text(args: list[str], *, timeout: int = 60) -> str:
    return command(args, timeout=timeout).decode("utf-8", errors="strict").strip()


def repo_sha() -> str:
    value = text(["git", "-C", str(ROOT), "rev-parse", "HEAD"])
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise CandidateError("source_sha_invalid")
    return value


def changed_paths() -> list[str]:
    """Goal state is optional for a direct candidate deploy.

    Migration completeness is decided independently using the active image
    source and the candidate Git tree, not this convenience change list.
    """
    state_path = ROOT / ".agent" / "runtime" / "goal-state.json"
    base = None
    if state_path.is_file() and not state_path.is_symlink():
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            selected = state.get("phaseBaseCommit") or state.get("baseCommit")
            if isinstance(selected, str) and re.fullmatch(r"[0-9a-f]{40}", selected):
                base = selected
        except (OSError, ValueError):
            pass
    args = ["diff", "--name-only", "-z", "--diff-filter=ACMDRT",
            (base + "...HEAD" if base else "HEAD~1...HEAD")]
    try:
        output = command(["git", "-C", str(ROOT), *args])
    except CandidateError:
        output = command(["git", "-C", str(ROOT), "show", "--pretty=format:", "--name-only", "-z", "HEAD"])
    return sorted({item.decode("utf-8", errors="surrogateescape")
                   for item in output.split(b"\0") if item})


def candidate_migration_paths(active_sha: str, candidate_sha: str, phase_paths: list[str]) -> list[str]:
    """Classify every migration between the deployed image source and candidate.

    Goal phase paths alone are insufficient: the active Gate image may predate
    migrations committed in an earlier phase. Refuse unknown or non-linear
    source lineage rather than silently treating those migrations as app-only.
    """
    if not re.fullmatch(r"[0-9a-f]{40}", active_sha) or not re.fullmatch(r"[0-9a-f]{40}", candidate_sha):
        raise CandidateError("active_image_source_lineage_invalid")
    try:
        command(["git", "-C", str(ROOT), "cat-file", "-e", active_sha + "^{commit}"])
        command(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", active_sha, candidate_sha])
        output = command([
            "git", "-C", str(ROOT), "diff", "--name-only", "-z", "--diff-filter=ACMDRT",
            active_sha + "..." + candidate_sha, "--", MIGRATION_PREFIX,
        ])
    except CandidateError as error:
        raise CandidateError("active_image_source_lineage_invalid") from error
    deployed_delta = [item.decode("utf-8", errors="surrogateescape")
                      for item in output.split(b"\0") if item]
    phase_migrations = [path for path in phase_paths if path.startswith(MIGRATION_PREFIX)]
    return sorted(set(deployed_delta + phase_migrations))


def migration_runner_ids(repository: pathlib.Path) -> set[str]:
    source = repository / "apps/pubg-saas/src/infrastructure/postgres/migrate.ts"
    try:
        content = source.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise CandidateError("migration_runner_inventory_invalid") from error
    match = re.search(r"const migrationIds\s*=\s*\[(.*?)\]\s*as const", content, re.DOTALL)
    if not match:
        raise CandidateError("migration_runner_inventory_invalid")
    ids = re.findall(r"['\"]([0-9]{4}_[a-z0-9_]+\.sql)['\"]", match.group(1))
    if not ids or len(ids) != len(set(ids)):
        raise CandidateError("migration_runner_inventory_invalid")
    return set(ids)


def migration_inventory(paths: list[str], repository: pathlib.Path) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Describe real runtime migrations; pgvector is optional and not executed."""
    ids = migration_runner_ids(repository)
    applied: list[dict[str, str]] = []
    excluded: list[dict[str, str]] = []
    for relative in sorted(set(path for path in paths if path.startswith(MIGRATION_PREFIX))):
        filename = pathlib.PurePosixPath(relative).name
        source = repository / relative
        if source.is_symlink() or not source.is_file():
            raise CandidateError("migration_source_missing_or_untrusted")
        risk, reason = migration_risk([relative], repository)
        if filename in ids:
            if reason and risk != "destructive_schema_warning":
                raise CandidateError(reason)
            applied.append({"path": relative, "riskCategory": risk})
        elif filename == OPTIONAL_MIGRATION:
            excluded.append({"path": relative, "execution": "excluded-from-migratePublicDatabase"})
        else:
            raise CandidateError("migration_not_in_runtime_runner")
    return applied, excluded


def verify_encrypted_database_backup(artifact: pathlib.Path, identity: pathlib.Path) -> int:
    """Verify full age authentication without persisting a plaintext dump."""
    if artifact.stat().st_size < 1024:
        raise CandidateError("encrypted_database_checkpoint_verify_failed")
    decrypt = subprocess.run(["age", "-d", "-i", str(identity), str(artifact)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                             check=False, timeout=1800)
    if decrypt.returncode != 0:
        raise CandidateError("encrypted_database_checkpoint_verify_failed")

    listing = subprocess.Popen(["age", "-d", "-i", str(identity), str(artifact)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert listing.stdout is not None
    restore = subprocess.Popen(["pg_restore", "--list"], stdin=listing.stdout,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    listing.stdout.close()
    listing_output, _ = restore.communicate(timeout=300)
    listing_status = restore.returncode
    age_status = listing.wait(timeout=300)
    if listing_status != 0 or age_status not in {0, -signal.SIGPIPE}:
        raise CandidateError("encrypted_database_checkpoint_verify_failed")
    entries = [line for line in listing_output.splitlines() if line and not line.startswith(b";")]
    if not entries:
        raise CandidateError("encrypted_database_checkpoint_verify_failed")
    return len(entries)


def save_encrypted_config_checkpoint(payload: bytes, artifact: pathlib.Path,
                                     recipients: pathlib.Path, identity: pathlib.Path) -> None:
    """Encrypt secret-bearing runtime config before it enters the external checkpoint."""
    try:
        with artifact.open("xb") as encrypted:
            os.fchmod(encrypted.fileno(), 0o600)
            result = subprocess.run(["age", "-R", str(recipients)], input=payload,
                                    stdout=encrypted, stderr=subprocess.DEVNULL,
                                    check=False, timeout=120)
        if result.returncode != 0 or artifact.stat().st_size < 64:
            raise CandidateError("gateway_environment_checkpoint_failed")
        verified = subprocess.run(["age", "-d", "-i", str(identity), str(artifact)],
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  check=False, timeout=120)
        if verified.returncode != 0 or verified.stdout != payload:
            raise CandidateError("gateway_environment_checkpoint_verify_failed")
    except (OSError, subprocess.SubprocessError) as error:
        raise CandidateError("gateway_environment_checkpoint_failed") from error


def restore_encrypted_database_backup(
    machine: str, layout: dict[str, str], artifact: pathlib.Path, identity: pathlib.Path,
) -> None:
    """Restore a verified encrypted checkpoint atomically without a plaintext file."""
    restore_shell = (
        'export PGPASSWORD="$(cat /run/secrets/pubg_postgres_superuser_password)"; '
        "exec pg_restore --single-transaction --clean --if-exists --no-owner --no-acl "
        "-U pubg_bootstrap -d pubg_saas"
    )
    target = ["orb", "-m", machine, "-u", "root", *compose_base(machine, layout),
              "exec", "--no-TTY", "postgres", "sh", "-c", restore_shell]
    decrypted = None
    restored = None
    try:
        decrypted = subprocess.Popen(["age", "-d", "-i", str(identity), str(artifact)],
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert decrypted.stdout is not None
        restored = subprocess.Popen(target, stdin=decrypted.stdout,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        decrypted.stdout.close()
        restore_status = restored.wait(timeout=1800)
        decrypt_status = decrypted.wait(timeout=60)
    except (OSError, subprocess.SubprocessError) as error:
        for process in (restored, decrypted):
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        raise CandidateError("database_rollback_failed") from error
    if restore_status != 0 or decrypt_status != 0:
        raise CandidateError("database_rollback_failed")


def select_existing_test_tenant(machine: str, layout: dict[str, str], bot_account_id: str) -> str:
    """Select one marked test tenant for the canary, returning its ID only in memory."""
    escaped_bot_id = bot_account_id.replace("'", "''")
    predicate = "(t.tenant_id ~* '(test|fixture|canary)' OR t.guild_id ~* '(test|fixture|canary)' " \
                "OR EXISTS (SELECT 1 FROM teams tm WHERE tm.tenant_id=t.tenant_id " \
                "AND tm.label ~* '(test|fixture|canary)'))"
    where = f"t.bot_account_id='{escaped_bot_id}' AND {predicate}"
    shell = (
        'export PGPASSWORD="$(cat /run/secrets/pubg_postgres_superuser_password)"; '
        'exec psql -XAtq -v ON_ERROR_STOP=1 -U pubg_bootstrap -d pubg_saas -c "$1"'
    )
    count_sql = f"SELECT COUNT(DISTINCT t.tenant_id) FROM tenants t WHERE {where}"
    count_output = remote_compose(machine, layout, "exec", "--no-TTY", "postgres", "sh", "-c", shell,
                                  "gate-canary-tenant-count", count_sql).decode("utf-8", errors="strict")
    if count_output.strip() != "1":
        raise CandidateError("canary_test_tenant_not_unique")
    tenant_sql = f"SELECT DISTINCT t.tenant_id FROM tenants t WHERE {where} ORDER BY t.tenant_id"
    tenant_output = remote_compose(machine, layout, "exec", "--no-TTY", "postgres", "sh", "-c", shell,
                                   "gate-canary-tenant-select", tenant_sql).decode("utf-8", errors="strict")
    return unique_test_tenant_id(count_output, tenant_output)


def set_remote_intelligence_canary(machine: str, gateway_env: str, tenant_id: str) -> None:
    """Enable the typed feature for one tenant, without emitting its identifier."""
    payload = json.dumps({"tenantId": tenant_id}, separators=(",", ":")).encode("utf-8")
    code = """import json,os,pathlib,re,stat,sys,tempfile
p=pathlib.Path(sys.argv[1])
v=json.loads(sys.stdin.read())
tid=v.get('tenantId','')
if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,127}',tid): sys.exit(2)
s=p.lstat()
if not stat.S_ISREG(s.st_mode) or stat.S_ISLNK(s.st_mode) or stat.S_IMODE(s.st_mode)!=0o600: sys.exit(3)
rows=p.read_text().splitlines()
keys={'GATE_PUBG_INTELLIGENCE_ENABLED':'1','GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS':tid}
for k,value in keys.items():
    ids=[i for i,x in enumerate(rows) if re.match(r'^\\s*'+re.escape(k)+r'\\s*=',x)]
    if len(ids)>1: sys.exit(4)
    if ids: rows[ids[0]]=k+'='+value
    else: rows.append(k+'='+value)
fd,t=tempfile.mkstemp(prefix='.gate-canary-',dir=p.parent)
os.fchmod(fd,0o600)
with os.fdopen(fd,'w') as f:
    f.write('\\n'.join(rows)+'\\n')
    f.flush()
    os.fsync(f.fileno())
os.replace(t,p)
"""
    remote(machine, "python3", "-c", code, gateway_env, input_data=payload)


def full_database_dump_shell() -> str:
    return (
        'export PGPASSWORD="$(cat /run/secrets/pubg_backup_password)"; '
        "exec pg_dump -Fc --no-owner --no-acl -U pubg_backup -d pubg_saas"
    )


def database_backup_required(risk: str, force_full_backup: bool) -> bool:
    """Every Gate-Local candidate starts with a verified full PostgreSQL backup."""
    return True


def unique_test_tenant_id(count_output: str, tenant_output: str) -> str:
    """Accept only one explicitly marked Gate-Local test tenant; never log its ID."""
    if count_output.strip() != "1":
        raise CandidateError("canary_test_tenant_not_unique")
    tenant_id = tenant_output.strip()
    if not IDENTIFIER.fullmatch(tenant_id):
        raise CandidateError("canary_test_tenant_unavailable")
    return tenant_id


def parse_candidate_command(args: list[str]) -> tuple[str, bool] | None:
    """Parse only the guarded apply command and its optional explicit PG dump."""
    if len(args) == 4 and args[:3] == ["candidate", "--apply", "--approval-ref"]:
        return args[3], False
    if (len(args) == 6 and args[:3] == ["candidate", "--apply", "--approval-ref"]
            and args[4:] == ["--database-backup", "full"]):
        return args[3], True
    return None


def clean_tree() -> None:
    if text(["git", "-C", str(ROOT), "status", "--porcelain"]):
        raise CandidateError("apply_requires_clean_committed_source")


def safe_external_file(value: Any, *, private: bool = False, executable: bool = False) -> pathlib.Path:
    if not isinstance(value, str) or not value:
        raise CandidateError("external_release_file_missing")
    raw = pathlib.Path(value).expanduser()
    try:
        resolved = raw.resolve(strict=True)
        if os.path.commonpath((str(ROOT.resolve()), str(resolved))) == str(ROOT.resolve()):
            raise CandidateError("release_file_inside_repository")
    except (OSError, ValueError) as error:
        raise CandidateError("external_release_file_unavailable") from error
    if raw.is_symlink() or not resolved.is_file() or resolved.stat().st_uid != os.getuid():
        raise CandidateError("external_release_file_untrusted")
    mode = stat.S_IMODE(resolved.stat().st_mode)
    if private and mode != 0o600:
        raise CandidateError("private_release_file_permissions_invalid")
    if executable and (not os.access(resolved, os.X_OK) or mode & 0o022):
        raise CandidateError("notification_hook_untrusted")
    return resolved


def private_directory(value: Any) -> pathlib.Path:
    if not isinstance(value, str) or not value:
        raise CandidateError("backup_directory_missing")
    raw = pathlib.Path(value).expanduser()
    if raw.is_symlink():
        raise CandidateError("backup_directory_symlink_refused")
    try:
        path = raw.resolve(strict=True)
        if os.path.commonpath((str(ROOT.resolve()), str(path))) == str(ROOT.resolve()):
            raise CandidateError("backup_directory_inside_repository")
    except (OSError, ValueError) as error:
        raise CandidateError("backup_directory_unavailable") from error
    info = path.stat()
    if not path.is_dir() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise CandidateError("backup_directory_permissions_invalid")
    return path


def remote(machine: str, *args: str, timeout: int = 60, input_data: bytes | None = None) -> bytes:
    return command(["orb", "-m", machine, "-u", "root", *args], input_data=input_data, timeout=timeout)


def remote_text(machine: str, *args: str, timeout: int = 60) -> str:
    return remote(machine, *args, timeout=timeout).decode("utf-8", errors="strict").strip()


def configured_lab_machine() -> str:
    script = 'source "$1"; amadeus_host_profile_load "$2"; printf "%s" "$ORBSTACK_MACHINE"'
    return text(["bash", "-c", script, "gate-candidate-host-profile",
                 str(ROOT / "scripts/host-profile.sh"), str(ROOT)], timeout=10)


def target_layout_from_labels(project: str, service: str, working_dir: str,
                              config_files: str) -> dict[str, str]:
    """Resolve only the active Gate Compose layout reported by Docker labels."""
    if service != "gateway" or not re.fullmatch(r"pubg-saas(?:-[a-z0-9][a-z0-9-]*)?", project):
        raise CandidateError("compose_runtime_facts_invalid")
    if not working_dir.startswith("/") or ".." in working_dir.split("/"):
        raise CandidateError("compose_runtime_facts_invalid")
    app_dir = pathlib.PurePosixPath(posixpath.normpath(working_dir))
    allowed_layout = (app_dir.name == "pubg-saas" and app_dir.parent.name == "infra") or (
        app_dir.name == "pubg-saas" and app_dir.parent.name == "apps"
    )
    files = [value for value in config_files.split(",") if value]
    if not allowed_layout or len(files) != 1:
        raise CandidateError("compose_runtime_facts_invalid")
    compose_file = pathlib.PurePosixPath(posixpath.normpath(files[0]))
    if (not compose_file.is_absolute() or ".." in files[0].split("/") or
            compose_file.parent != app_dir or compose_file.name not in COMPOSE_NAMES):
        raise CandidateError("compose_runtime_facts_invalid")
    app_path = str(app_dir)
    return {
        "project": project,
        "appDir": app_path,
        "composeFile": str(compose_file),
        "envFile": f"{app_path}/.env",
        "gatewayEnv": f"{app_path}/secrets/gateway.env",
    }


def discover_remote_layout(machine: str) -> dict[str, str]:
    gateways = remote_text(machine, "docker", "ps", "-q", "--filter",
                           "label=com.docker.compose.service=gateway").splitlines()
    if len(gateways) != 1:
        raise CandidateError("target_gateway_container_missing")
    label_format = "\n".join(
        '{{index .Config.Labels "' + name + '"}}'
        for name in ("com.docker.compose.project", "com.docker.compose.service",
                     "com.docker.compose.project.working_dir", "com.docker.compose.project.config_files")
    )
    labels = remote_text(machine, "docker", "inspect", "--format", label_format, gateways[0]).splitlines()
    if len(labels) != 4:
        raise CandidateError("compose_runtime_facts_invalid")
    return target_layout_from_labels(*labels)


def verify_remote_layout(machine: str, layout: dict[str, str]) -> None:
    code = (
        "import pathlib,stat,sys; app,compose,env,secrets,gateway=map(pathlib.Path,sys.argv[1:]); "
        "items=[(app,True,False),(compose,False,False),(env,False,True),"
        "(secrets,True,False),(gateway,False,True)]; "
        "[(lambda p,is_dir,private,s: (s.st_uid==0 and not stat.S_ISLNK(s.st_mode) and "
        "(stat.S_ISDIR(s.st_mode) if is_dir else stat.S_ISREG(s.st_mode)) and "
        "(not private or stat.S_IMODE(s.st_mode)==0o600)) or sys.exit(3))(p,is_dir,private,p.lstat()) "
        "for p,is_dir,private in items]"
    )
    remote(machine, "python3", "-c", code, layout["appDir"], layout["composeFile"],
           layout["envFile"], f'{layout["appDir"]}/secrets', layout["gatewayEnv"])


def compose_base(machine: str, layout: dict[str, str]) -> list[str]:
    return ["docker", "compose", "--project-name", layout["project"],
            "--project-directory", layout["appDir"], "--env-file", layout["envFile"],
            "--file", layout["composeFile"]]


def remote_compose(machine: str, layout: dict[str, str], *args: str,
                   timeout: int = 180, input_data: bytes | None = None) -> bytes:
    return remote(machine, *compose_base(machine, layout), *args, timeout=timeout, input_data=input_data)


def read_remote_value(machine: str, path: str, key: str) -> str:
    code = (
        "import pathlib,re,sys; p=pathlib.Path(sys.argv[1]); k=re.escape(sys.argv[2]); "
        "m=[x for x in p.read_text().splitlines() if re.match(r'^\\s*'+k+r'\\s*=',x)]; "
        "print(m[-1].split('=',1)[1].strip().strip('\\\"').strip(\"'\") if len(m)==1 else '')"
    )
    return remote(machine, "python3", "-c", code, path, key).decode("utf-8", errors="strict").strip()


def write_remote_file(machine: str, path: str, payload: bytes, mode: str = "0600") -> None:
    code = (
        "import os,pathlib,stat,sys,tempfile; p=pathlib.Path(sys.argv[1]); "
        "old=p.lstat(); (stat.S_ISREG(old.st_mode) and not stat.S_ISLNK(old.st_mode)) or sys.exit(3); "
        "d=p.parent; fd,t=tempfile.mkstemp(prefix='.gate-release-',dir=d); "
        "os.fchmod(fd,stat.S_IMODE(old.st_mode) if sys.argv[2]=='preserve' else int(sys.argv[2],8)); "
        "f=os.fdopen(fd,'wb'); f.write(sys.stdin.buffer.read()); f.flush(); os.fsync(f.fileno()); f.close(); "
        "os.replace(t,p)"
    )
    remote(machine, "python3", "-c", code, path, mode, input_data=payload)


def create_remote_private_temp(machine: str, payload: bytes, suffix: str) -> str:
    code = (
        "import os,pathlib,sys,tempfile; fd,p=tempfile.mkstemp(prefix='gate-egress-rollback-',"
        "suffix=sys.argv[1],dir='/tmp'); os.fchmod(fd,0o600); "
        "f=os.fdopen(fd,'wb'); f.write(sys.stdin.buffer.read()); f.flush(); os.fsync(f.fileno()); "
        "f.close(); print(p)"
    )
    value = remote(machine, "python3", "-c", code, suffix, input_data=payload).decode("utf-8", errors="strict").strip()
    if not value.startswith("/tmp/gate-egress-rollback-") or not value.endswith(suffix):
        raise CandidateError("egress_drift_reconciliation_failed")
    return value


def parse_compose_ps(output: bytes) -> list[dict[str, Any]]:
    raw = output.decode("utf-8", errors="strict").strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
        if isinstance(value, dict):
            return [value]
    except json.JSONDecodeError:
        pass
    rows = []
    for line in raw.splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise CandidateError("compose_runtime_facts_invalid") from error
        if not isinstance(row, dict):
            raise CandidateError("compose_runtime_facts_invalid")
        rows.append(row)
    return rows


def portable_image_identity(document: dict[str, Any]) -> str:
    """Hash the complete image config and layer identity across Docker daemons.

    Docker Engine versions can normalize an imported image's config JSON and
    therefore assign a different local image ID even when the imported image
    has the same platform, full config, and every rootfs layer digest.
    """
    config = document.get("Config")
    rootfs = document.get("RootFS")
    layers = rootfs.get("Layers") if isinstance(rootfs, dict) else None
    os_name = document.get("Os")
    architecture = document.get("Architecture")
    if (not isinstance(config, dict) or not isinstance(layers, list)
            or not layers or not all(isinstance(layer, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", layer)
                                     for layer in layers)
            or not isinstance(os_name, str) or not os_name
            or not isinstance(architecture, str) or not architecture):
        raise CandidateError("immutable_candidate_digest_invalid")
    identity = {
        "os": os_name,
        "architecture": architecture,
        "variant": document.get("Variant"),
        "config": config,
        "rootfsLayers": layers,
    }
    canonical = json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def runtime_facts(machine: str, policy: dict[str, Any], sha: str,
                  paths: list[str]) -> tuple[dict[str, Any], str, str, dict[str, str]]:
    """Protect the target identity; converge stale application images during rollout."""
    if not machine or machine != policy.get("orbstackMachine"):
        raise CandidateError("target_machine_scope_mismatch")
    if machine == configured_lab_machine():
        raise CandidateError("gate_target_overlaps_lab_machine")
    remote(machine, "docker", "info", "--format", "{{.ServerVersion}}")
    layout = discover_remote_layout(machine)
    verify_remote_layout(machine, layout)
    bot_id = read_remote_value(machine, layout["gatewayEnv"], "KOOK_BOT_ACCOUNT_ID")
    project = read_remote_value(machine, layout["envFile"], "PUBG_SAAS_COMPOSE_PROJECT")
    active_image = read_remote_value(machine, layout["envFile"], "PUBG_SAAS_IMAGE")
    image_match = IMAGE_RE.fullmatch(active_image)
    if bot_id != policy.get("botAccountId") or project != layout["project"] or not image_match:
        raise CandidateError("target_bot_or_image_identity_untrusted")
    rows = parse_compose_ps(remote_compose(machine, layout, "ps", "--all", "--format", "json"))
    by_service: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        name = str(row.get("Service", row.get("service", "")))
        if name:
            by_service.setdefault(name, []).append(row)
    for service in ("postgres", "egress-proxy", "gateway", "worker"):
        if len(by_service.get(service, [])) != 1:
            raise CandidateError("target_compose_service_identity_invalid")
    gateway_ids = remote_text(machine, "docker", "ps", "-q", "--filter",
                              "label=com.docker.compose.service=gateway").splitlines()
    worker_ids = remote_text(machine, "docker", "ps", "-q", "--filter",
                             "label=com.docker.compose.service=worker").splitlines()
    if len(gateway_ids) != 1 or len(worker_ids) != 1:
        raise CandidateError("dual_or_missing_runtime")
    needs_convergence = False
    for service in ("gateway", "worker", "egress-proxy"):
        ids = remote_text(machine, *compose_base(machine, layout), "ps", "--quiet", service).splitlines()
        if len(ids) != 1:
            raise CandidateError("target_compose_service_identity_invalid")
        current_image = remote_text(machine, "docker", "inspect", "--format", "{{.Config.Image}}", ids[0])
        if not IMAGE_RE.fullmatch(current_image):
            raise CandidateError("target_bot_or_image_identity_untrusted")
        if current_image != active_image:
            needs_convergence = True
        elif not needs_convergence:
            # The image tag may have been rebuilt in-place while a container
            # is still running an older image ID. Treat this as repairable.
            running_id = remote_text(machine, "docker", "inspect", "--format", "{{.Image}}", ids[0])
            tagged_id = remote_text(machine, "docker", "image", "inspect", "--format", "{{.Id}}", active_image)
            if running_id != tagged_id:
                needs_convergence = True
    migration_paths = candidate_migration_paths(image_match.group(1), sha, paths)
    risk, reason = migration_risk(migration_paths, ROOT)
    if reason and risk != "destructive_schema_warning":
        error = OperatorAuthorizationRequired if reason.startswith("separate_") else CandidateError
        raise error(reason)
    migration_inventory(migration_paths, ROOT)
    facts = {
        "targetTrusted": True,
        "instanceId": policy.get("instanceId"),
        "botAccountId": bot_id,
        "activeGatewayCount": len(gateway_ids),
        "activeWorkerCount": len(worker_ids),
        "releaseInProgress": False,
        "runtimeDrift": False,
        "needsConvergence": needs_convergence,
        "backupRecoverable": True,
        "schemaCompatible": True,
        "requiresPgvector": False,
        "pgvectorAvailable": False,
        "activeSha": image_match.group(1),
    }
    return facts, active_image, risk, layout


def restore_remote_files(machine: str, layout: dict[str, str], old_compose: bytes, old_env: bytes,
                         old_gateway_env: bytes) -> None:
    write_remote_file(machine, layout["composeFile"], old_compose, "0644")
    write_remote_file(machine, layout["envFile"], old_env, "preserve")
    write_remote_file(machine, layout["gatewayEnv"], old_gateway_env, "preserve")


def gate_apply(approval_ref: str, *, force_full_database_backup: bool = False) -> int:
    """Deploy the repo-authorized Gate-Local canary with a full database checkpoint."""
    policy, policy_reason = validate_private_state(POLICY_PATH, ROOT)
    if policy is None:
        raise OperatorAuthorizationRequired("approval_" + policy_reason)
    if approval_ref.startswith(("token", "secret", "password", "api-key")) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}", approval_ref):
        raise CandidateError("approval_reference_invalid")
    machine = policy.get("orbstackMachine")
    if not isinstance(machine, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", machine):
        raise CandidateError("target_machine_invalid")
    backup_root = private_directory(policy.get("backupRoot"))
    recipients = safe_external_file(policy.get("ageRecipientsFile"))
    identity = safe_external_file(policy.get("ageIdentityFile"), private=True)
    notify_hook = safe_external_file(policy.get("notificationHook"), executable=True)
    os.environ["PATH"] = path_with_libpq_pg_restore(os.environ.get("PATH", ""))
    if shutil.which("docker") is None or shutil.which("age") is None or shutil.which("pg_restore") is None:
        raise CandidateError("candidate_host_tools_unavailable")
    paths = changed_paths()
    sha = repo_sha()
    clean_tree()
    command(["git", "-C", str(ROOT), "diff", "--check"])
    # The Goal phase/CI already validated tests and the isolated PG fixture.
    # Never require a live PUBG test-database URL or rerun full CI to deploy.
    command(["pnpm", "check:secrets"], timeout=900)
    backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if stat.S_IMODE(backup_root.stat().st_mode) != 0o700:
        raise CandidateError("backup_directory_permissions_invalid")
    lock_path = POLICY_PATH.parent / ".gate-local-autopilot.lock"
    if lock_path.is_symlink():
        raise CandidateError("release_lock_symlink_refused")
    lock_fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    os.fchmod(lock_fd, 0o600)
    lock = os.fdopen(lock_fd, "a+")
    try:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise CandidateError("release_in_progress") from error
        facts, active_image, risk, layout = runtime_facts(machine, policy, sha, paths)
        decision = preflight_candidate(
            approval=policy, repository=ROOT, paths=paths,
            instance_id=str(policy.get("instanceId")), bot_account_id=str(policy.get("botAccountId")),
            candidate_sha=sha, facts=facts,
        )
        if decision["status"] == "ALREADY_CURRENT" and not facts.get("needsConvergence"):
            print("GATE_DEPLOYMENT=ALREADY_CURRENT source_candidate=" + sha[:12])
            return 0
        if decision["status"] not in {"READY", "ALREADY_CURRENT"}:
            error = OperatorAuthorizationRequired if decision["status"] == "BLOCKED_OPERATOR_AUTHORIZATION" else CandidateError
            raise error(decision["reason"])
        now = datetime.now(timezone.utc)
        version = json.loads((ROOT / "apps/pubg-saas/package.json").read_text(encoding="utf-8"))["version"]
        image = f"local/pubg-saas:git-{sha}"
        created = now.strftime("%Y%m%dT%H%M%SZ")
        checkpoint = backup_root / f"gate-local-{created}-{sha[:12]}"
        if checkpoint.exists() or checkpoint.is_symlink():
            raise CandidateError("checkpoint_path_already_exists")
        old_compose: bytes | None = None
        old_env: bytes | None = None
        old_gateway_env: bytes | None = None
        database_artifact: pathlib.Path | None = None
        canary_tenant_id: str | None = None
        state: dict[str, Any] = {"sourceSha": sha, "image": image, "activeImage": active_image,
                                 "approvalRef": approval_ref, "checkpoint": str(checkpoint), "risk": risk,
                                 "databaseBackupMode": "full", "canary": "single_marked_test_tenant"}

        def build() -> dict[str, Any]:
            build_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            command(["docker", "build", "--build-arg", f"OCI_SOURCE_REVISION={sha}",
                     "--build-arg", f"OCI_PRODUCT_VERSION={version}", "--build-arg",
                     f"OCI_BUILD_TIMESTAMP={build_time}", "-f", "apps/pubg-saas/Dockerfile", "-t", image, "."],
                    timeout=1800)
            try:
                image_document = json.loads(text(["docker", "image", "inspect", "--format", "{{json .}}", image]))
            except (CandidateError, json.JSONDecodeError) as error:
                raise CandidateError("immutable_candidate_digest_invalid") from error
            digest = portable_image_identity(image_document)
            if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
                raise CandidateError("immutable_candidate_digest_invalid")
            save = subprocess.Popen(["docker", "save", image], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            assert save.stdout is not None
            try:
                loaded = subprocess.run(["orb", "-m", machine, "-u", "root", "docker", "load"],
                                        stdin=save.stdout, stdout=subprocess.DEVNULL,
                                        stderr=subprocess.DEVNULL, check=False, timeout=900)
            except (OSError, subprocess.TimeoutExpired) as error:
                save.kill(); save.wait()
                raise CandidateError("candidate_image_transfer_failed") from error
            save.stdout.close()
            if loaded.returncode or save.wait() != 0:
                raise CandidateError("candidate_image_transfer_failed")
            return {"digest": digest, "sourceSha": sha, "image": image}

        def verify_target() -> None:
            nonlocal canary_tenant_id
            remote_compose(machine, layout, "config", "--quiet")
            current_bot = read_remote_value(machine, layout["gatewayEnv"], "KOOK_BOT_ACCOUNT_ID")
            if current_bot != policy.get("botAccountId"):
                raise CandidateError("target_bot_identity_changed")
            canary_tenant_id = select_existing_test_tenant(machine, layout, str(policy.get("botAccountId")))
            try:
                image_document = json.loads(remote_text(machine, "docker", "image", "inspect", "--format", "{{json .}}", image))
            except (CandidateError, json.JSONDecodeError) as error:
                raise CandidateError("candidate_image_digest_mismatch") from error
            state["targetImageId"] = image_document.get("Id")
            if portable_image_identity(image_document) != state.get("digest"):
                raise CandidateError("candidate_image_digest_mismatch")

        def backup() -> dict[str, Any]:
            nonlocal old_compose, old_env, old_gateway_env, database_artifact
            checkpoint.mkdir(mode=0o700)
            os.chmod(checkpoint, 0o700)
            old_compose = remote(machine, "cat", layout["composeFile"])
            old_env = remote(machine, "cat", layout["envFile"])
            old_gateway_env = remote(machine, "cat", layout["gatewayEnv"])
            for name, value in (("compose.before" + pathlib.PurePosixPath(layout["composeFile"]).suffix, old_compose),
                                ("compose.env.before", old_env)):
                path = checkpoint / name
                with path.open("xb") as output:
                    os.fchmod(output.fileno(), 0o600)
                    output.write(value)
            gateway_env_checkpoint = checkpoint / "gateway.env.before.age"
            save_encrypted_config_checkpoint(old_gateway_env, gateway_env_checkpoint, recipients, identity)
            database_artifact = checkpoint / "pubg-saas.dump.age"
            dump_cmd = [*compose_base(machine, layout), "exec", "--no-TTY", "postgres", "sh", "-c",
                        full_database_dump_shell()]
            dump = subprocess.Popen(["orb", "-m", machine, "-u", "root", *dump_cmd],
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            assert dump.stdout is not None
            try:
                with database_artifact.open("xb") as encrypted:
                    os.fchmod(encrypted.fileno(), 0o600)
                    age = subprocess.run(["age", "-R", str(recipients)], stdin=dump.stdout,
                                         stdout=encrypted, stderr=subprocess.DEVNULL, check=False, timeout=1800)
                dump.stdout.close()
                dump_status = dump.wait(timeout=60)
            except (OSError, subprocess.SubprocessError) as error:
                if dump.poll() is None:
                    dump.kill()
                dump.wait()
                raise CandidateError("encrypted_database_checkpoint_failed") from error
            if age.returncode or dump_status != 0 or database_artifact.stat().st_size < 1024:
                raise CandidateError("encrypted_database_checkpoint_failed")
            restore_entries = verify_encrypted_database_backup(database_artifact, identity)
            with database_artifact.open("rb") as backup_file:
                digest = hashlib.file_digest(backup_file, "sha256").hexdigest()
            metadata = {**state, "createdAt": now.isoformat(), "encryptedBackup": database_artifact.name,
                        "databaseScope": "full_database", "encryptedBackupBytes": database_artifact.stat().st_size,
                        "pgRestoreListEntries": restore_entries, "encryptedBackupSha256": digest,
                        "encryptedGatewayEnvironment": gateway_env_checkpoint.name,
                        "encryptedGatewayEnvironmentSha256": hashlib.sha256(
                            gateway_env_checkpoint.read_bytes()).hexdigest(),
                        "checkpointStatus": "verified_recoverable"}
            with (checkpoint / "checkpoint.json").open("x", encoding="utf-8") as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump(metadata, output, ensure_ascii=False, sort_keys=True)
                output.write("\n")
            return {"recoverable": True, "path": str(checkpoint)}

        def migrate() -> None:
            assert old_compose is not None and old_env is not None and old_gateway_env is not None
            assert canary_tenant_id is not None
            remote_compose(machine, layout, "stop", "gateway", "worker", timeout=300)
            write_remote_file(machine, layout["composeFile"],
                              (ROOT / "infra/pubg-saas/compose.yaml").read_bytes(), "0644")
            update_code = (
                "import os,pathlib,re,stat,sys,tempfile; p=pathlib.Path(sys.argv[1]); rows=p.read_text().splitlines(keepends=True); "
                "idx=[i for i,x in enumerate(rows) if re.match(r'^\\s*PUBG_SAAS_IMAGE\\s*=',x)]; "
                "len(idx)==1 or sys.exit(2); i=idx[0]; nl='\\n' if rows[i].endswith('\\n') else ''; rows[i]='PUBG_SAAS_IMAGE='+sys.argv[2]+nl; "
                "old=p.lstat(); (stat.S_ISREG(old.st_mode) and not stat.S_ISLNK(old.st_mode)) or sys.exit(3); "
                "fd,t=tempfile.mkstemp(prefix='.gate-release-',dir=p.parent); os.fchmod(fd,stat.S_IMODE(old.st_mode)); "
                "f=os.fdopen(fd,'w'); f.writelines(rows); f.flush(); os.fsync(f.fileno()); f.close(); os.replace(t,p)"
            )
            remote(machine, "python3", "-c", update_code, layout["envFile"], image)
            if risk == "destructive_schema_warning":
                print("!!! WARNING: destructive Gate-Local migration detected. A verified full encrypted PostgreSQL backup exists; "
                      "automatic apply will continue, and health failure restores the database, prior image and configuration. !!!",
                      flush=True)
            remote_compose(machine, layout, "run", "--rm", "migrate", timeout=1800)
            set_remote_intelligence_canary(machine, layout["gatewayEnv"], canary_tenant_id)

        def switch() -> dict[str, Any]:
            remote_compose(machine, layout, "up", "-d", "--no-build", "--force-recreate", "--wait",
                           "egress-proxy", "gateway", "worker", timeout=900)
            return {"image": image}

        def healthy() -> bool:
            try:
                current = parse_compose_ps(remote_compose(machine, layout, "ps", "--format", "json"))
            except Exception:
                return False
            states = {str(row.get("Service", row.get("service", ""))): str(row.get("Health", row.get("health", ""))).lower()
                      for row in current}
            try:
                canary_on = read_remote_value(machine, layout["gatewayEnv"], "GATE_PUBG_INTELLIGENCE_ENABLED") == "1"
                allowlist = read_remote_value(machine, layout["gatewayEnv"],
                                              "GATE_PUBG_INTELLIGENCE_CANARY_TENANT_IDS")
            except CandidateError:
                return False
            return (all(states.get(service) == "healthy" for service in ("postgres", "egress-proxy", "gateway", "worker"))
                    and canary_tenant_id is not None and canary_on and allowlist == canary_tenant_id)

        def smoke() -> bool:
            try:
                remote_compose(machine, layout, "exec", "--no-TTY", "gateway", "node", "-e",
                               "fetch('http://127.0.0.1:8082/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
                remote_compose(machine, layout, "exec", "--no-TTY", "worker", "node", "-e",
                               "fetch('http://127.0.0.1:8081/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
                return True
            except Exception:
                return False

        def rollback() -> None:
            if old_compose is None or old_env is None or old_gateway_env is None or database_artifact is None:
                raise CandidateError("rollback_checkpoint_missing")
            remote_compose(machine, layout, "stop", "gateway", "worker", timeout=300)
            restore_remote_files(machine, layout, old_compose, old_env, old_gateway_env)
            restore_encrypted_database_backup(machine, layout, database_artifact, identity)
            remote_compose(machine, layout, "up", "-d", "--no-build", "--wait", "egress-proxy", "gateway", "worker", timeout=900)

        def notify() -> bool:
            payload = {
                "event": "gate-local-candidate",
                "status": "healthy",
                "sourceSha": sha,
                "imageDigest": state.get("digest"),
                "checkpoint": str(checkpoint),
                "environment": "gate-local",
                "requiresHumanAcceptance": True,
            }
            try:
                result = subprocess.run([str(notify_hook)], input=(json.dumps(payload) + "\n").encode(),
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                        check=False, timeout=10)
                return result.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                return False

        def audit(result: dict[str, Any]) -> None:
            payload = {"schema": "gate-local-candidate-audit/v1", "observedAt": datetime.now(timezone.utc).isoformat(),
                       "sourceSha": sha, "approvalRef": approval_ref, "instanceId": policy.get("instanceId"),
                       "environment": "gate-local", "risk": risk, "runtimeChanges": state, "result": result}
            audit_path = checkpoint / "audit.json" if checkpoint.is_dir() else (
                backup_root / f"gate-local-precheckpoint-failure-{created}-{sha[:12]}.json"
            )
            mode = "w" if checkpoint.is_dir() else "x"
            with audit_path.open(mode, encoding="utf-8") as output:
                os.fchmod(output.fileno(), 0o600)
                json.dump(payload, output, ensure_ascii=False, sort_keys=True)
                output.write("\n")

        state.update({"digest": None})
        def build_and_record() -> dict[str, Any]:
            value = build()
            state["digest"] = value["digest"]
            return value

        result = run_candidate_pipeline({"build": build_and_record, "verify_target": verify_target,
                                         "backup": backup, "migrate": migrate, "switch": switch,
                                         "health": healthy, "smoke": smoke, "notify": notify,
                                         "audit": audit, "rollback": rollback})
        print("GATE_DEPLOYMENT=" + result["status"] + " source_candidate=" + sha[:12])
        print("GATE_DEPLOYMENT_REASON=" + result["reason"])
        if result["status"] in {"DEPLOYED_AND_NOTIFIED", "DEPLOYED_NOTIFICATION_FAILED"}:
            print("GATE_PUBG_INTELLIGENCE_CANARY=enabled allowlist_count=1 tenant_id=redacted")
        if result.get("failedStep"):
            print("GATE_DEPLOYMENT_FAILED_STEP=" + str(result["failedStep"]))
        if result["status"] not in {"DEPLOYED_AND_NOTIFIED", "ALREADY_CURRENT"}:
            print("GATE_DEPLOYMENT_NEXT=" + recovery_step(result["reason"]))
        print("GATE_CHECKPOINT=" + (str(checkpoint) if checkpoint.is_dir() else "not-created"))
        if not checkpoint.is_dir():
            print("GATE_AUDIT_PATH=" + str(backup_root / f"gate-local-precheckpoint-failure-{created}-{sha[:12]}.json"))
        if result.get("auditStatus") == "failed":
            print("GATE_AUDIT=FAILED manual evidence review required")
        return 0 if result["status"] in {"DEPLOYED_AND_NOTIFIED", "DEPLOYED_NOTIFICATION_FAILED", "ALREADY_CURRENT"} else 2
    finally:
        lock.close()


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] in {"--help", "-h"}:
        print("Usage: gate-local-candidate.py candidate --apply --approval-ref <id> [--database-backup full]")
        return 0
    parsed = parse_candidate_command(args)
    if parsed is None:
        print("GATE_DEPLOYMENT=BLOCKED reason=invalid_candidate_command", file=sys.stderr)
        return 2
    approval_ref, force_full_database_backup = parsed
    try:
        return gate_apply(approval_ref, force_full_database_backup=force_full_database_backup)
    except OperatorAuthorizationRequired as error:
        print("GATE_DEPLOYMENT=" + deployment_status(error) + " reason=" + str(error), file=sys.stderr)
        print("GATE_DEPLOYMENT_NEXT=" + recovery_step(str(error)), file=sys.stderr)
        return 2
    except CandidateError as error:
        print("GATE_DEPLOYMENT=" + deployment_status(error) + " reason=" + str(error), file=sys.stderr)
        print("GATE_DEPLOYMENT_NEXT=" + recovery_step(str(error)), file=sys.stderr)
        return 2
    except Exception:
        print("GATE_DEPLOYMENT=BLOCKED reason=candidate_adapter_failed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
