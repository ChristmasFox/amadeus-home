#!/usr/bin/env python3
"""Fixtureable Gate-Local candidate authorization and execution guards.

This module never creates authorization. Only explicit devctl commands may
write the external 0600 Gate approval and M2-clearance records. M2 clearance
is reserved for future formal releases; it does not gate local candidates.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import tempfile
import stat
from datetime import datetime, timezone
from typing import Any, Callable

APPROVAL_SCHEMA = "gate-local-auto-approval/v1"
CLEARANCE_SCHEMA = "gate-local-m2-clearance/v1"
GATE_PREFIXES = ("apps/pubg-saas/", "infra/pubg-saas/")
SHARED_PREFIXES = ("packages/pubg-domain/", "packages/presentation/", "packages/identity/")
RISK_CATEGORIES = {"reversible_app_candidate", "backward_compatible_schema"}
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")


def parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def validate_private_state(path: pathlib.Path, repository: pathlib.Path) -> tuple[dict | None, str]:
    """Read external owner-only state; return a fixed reason, never raw errors."""
    path = path.expanduser()
    repo = repository.resolve()
    try:
        if os.path.commonpath((str(repo), str(path.resolve(strict=False)))) == str(repo):
            return None, "state_inside_repository"
    except ValueError:
        return None, "state_path_invalid"
    if path.is_symlink() or not path.is_file():
        return None, "state_missing"
    parent = path.parent
    if parent.is_symlink() or not parent.is_dir():
        return None, "state_directory_invalid"
    try:
        info = path.stat()
        parent_mode = stat.S_IMODE(parent.stat().st_mode)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            return None, "state_permissions_invalid"
        if parent.stat().st_uid != os.getuid() or parent_mode & 0o077:
            return None, "state_directory_permissions_invalid"
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, json.JSONDecodeError):
        return None, "state_invalid"
    if not isinstance(value, dict):
        return None, "state_invalid"
    return value, "ok"


def write_private_state(path: pathlib.Path, repository: pathlib.Path, value: dict) -> None:
    path = path.expanduser()
    repo = repository.resolve()
    if os.path.commonpath((str(repo), str(path.resolve(strict=False)))) == str(repo):
        raise ValueError("state_inside_repository")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.parent.is_symlink() or not path.parent.is_dir():
        raise ValueError("state_directory_invalid")
    directory_stat = path.parent.stat()
    if directory_stat.st_uid != os.getuid() or stat.S_IMODE(directory_stat.st_mode) & 0o077:
        raise ValueError("state_directory_permissions_invalid")
    if path.is_symlink():
        raise ValueError("state_symlink_refused")
    payload = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    descriptor, temporary = tempfile.mkstemp(prefix=".gate-auto-", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def classify_changed_scope(paths: list[str]) -> tuple[str, str | None]:
    """Gate/shared runtime changes trigger Gate deployment, even in mixed commits."""
    if not paths:
        return "no_changes", None
    if any(path.startswith(GATE_PREFIXES + SHARED_PREFIXES) for path in paths):
        return "gate_only", None
    if any(path.startswith(("plugins/", "apps/product-radar/", "integrations/openclaw/")) for path in paths):
        return "lab_only", None
    return "non_runtime", None

def split_sql_statements(sql: str) -> list[str] | None:
    """Split PostgreSQL SQL without treating quoted/dollar-quoted semicolons as boundaries."""
    statements: list[str] = []
    current: list[str] = []
    single_quote = False
    double_quote = False
    dollar_quote: str | None = None
    line_comment = False
    block_depth = 0
    index = 0
    while index < len(sql):
        char = sql[index]
        next_char = sql[index + 1] if index + 1 < len(sql) else ""
        if line_comment:
            if char == "\n":
                current.append("\n")
                line_comment = False
            index += 1
            continue
        if block_depth:
            if char == "/" and next_char == "*":
                block_depth += 1
                index += 2
            elif char == "*" and next_char == "/":
                block_depth -= 1
                index += 2
            else:
                index += 1
            continue
        if dollar_quote:
            if sql.startswith(dollar_quote, index):
                current.append(dollar_quote)
                index += len(dollar_quote)
                dollar_quote = None
            else:
                current.append(char)
                index += 1
            continue
        if single_quote:
            current.append(char)
            if char == "\\" and next_char:
                current.append(next_char)
                index += 2
                continue
            if char == "'":
                if next_char == "'":
                    current.append(next_char)
                    index += 2
                    continue
                single_quote = False
            index += 1
            continue
        if double_quote:
            current.append(char)
            if char == '"':
                if next_char == '"':
                    current.append(next_char)
                    index += 2
                    continue
                double_quote = False
            index += 1
            continue
        if char == "-" and next_char == "-":
            line_comment = True
            current.append(" ")
            index += 2
            continue
        if char == "/" and next_char == "*":
            block_depth = 1
            current.append(" ")
            index += 2
            continue
        if char == "'":
            single_quote = True
            current.append(char)
            index += 1
            continue
        if char == '"':
            double_quote = True
            current.append(char)
            index += 1
            continue
        if char == "$":
            match = re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", sql[index:])
            if match:
                dollar_quote = match.group(0)
                current.append(dollar_quote)
                index += len(dollar_quote)
                continue
        if char == ";":
            statement = "".join(current).strip()
            if statement:
                statements.append(statement)
            current.clear()
            index += 1
            continue
        current.append(char)
        index += 1
    if single_quote or double_quote or dollar_quote or block_depth:
        return None
    tail = "".join(current).strip()
    if tail:
        statements.append(tail)
    return statements


def migration_risk(paths: list[str], repository: pathlib.Path) -> tuple[str, str | None]:
    """Stop actual destructive SQL; CI plus an encrypted backup covers normal migrations.

    Optional pgvector DDL is not in migrate.ts and is never run by this path.
    PostgreSQL's transactional migrator validates SQL instead of a regex allowlist.
    """
    migrations = [path for path in paths if path.startswith("apps/pubg-saas/src/infrastructure/postgres/migrations/")
                  and not path.endswith("/0025_gate_memory_pgvector.sql")]
    if not migrations:
        return "reversible_app_candidate", None
    for relative in migrations:
        path = pathlib.PurePosixPath(relative)
        if path.is_absolute() or any(part in {".", ".."} for part in path.parts):
            return "unreviewed_migration", "migration_source_missing_or_untrusted"
        file = repository.joinpath(*path.parts)
        parent = repository
        for part in path.parts:
            parent = parent / part
            if parent.is_symlink():
                return "unreviewed_migration", "migration_source_missing_or_untrusted"
        if not file.is_file():
            return "unreviewed_migration", "migration_source_missing_or_untrusted"
        try:
            statements = split_sql_statements(file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError):
            return "unreviewed_migration", "migration_source_missing_or_untrusted"
        if not statements:
            return "unreviewed_migration", "migration_sql_invalid_or_empty"
        for statement in statements:
            sql = re.sub(r"\s+", " ", statement).strip()
            if re.match(r"CREATE\s+EXTENSION\b", sql, re.I):
                return "extension_install", "separate_extension_authorization_required"
            if re.match(r"DROP\s+(?:TABLE|SCHEMA|DATABASE|TYPE)\b|TRUNCATE\b", sql, re.I):
                return "destructive_schema", "destructive_database_operation"
            if re.match(r"ALTER\s+TABLE\b", sql, re.I) and re.search(r"\bDROP\s+COLUMN\b", sql, re.I):
                return "destructive_schema", "destructive_database_operation"
            if re.match(r"DELETE\s+FROM\b", sql, re.I):
                return "destructive_schema", "destructive_database_operation"
            if re.match(r"UPDATE\s+\S+\s+SET\b", sql, re.I) and not re.search(r"\bWHERE\b", sql, re.I):
                return "destructive_schema", "unbounded_data_update"
            if re.match(r"GRANT\b|REVOKE\b|ALTER\s+SYSTEM\b", sql, re.I) or re.search(
                r"\bSECURITY\s+DEFINER\b", sql, re.I
            ):
                return "unreviewed_migration", "migration_security_change_requires_review"
            if re.match(r"(?:DROP\s+(?:INDEX|VIEW)|ALTER\s+TABLE|UPDATE|INSERT|MERGE|"
                        r"CREATE|COMMENT|DO|SELECT)\b", sql, re.I):
                continue
            return "unreviewed_migration", "migration_statement_not_allowlisted"
    return "backward_compatible_schema", None

def validate_approval(
    approval: dict | None,
    *,
    repository: pathlib.Path,
    instance_id: str,
    bot_account_id: str,
    risk: str,
    now: datetime | None = None,
) -> tuple[bool, str]:
    if approval is None:
        return False, "approval_missing"
    if approval.get("schema") != APPROVAL_SCHEMA:
        return False, "approval_schema_invalid"
    if approval.get("repository") != str(repository.resolve()):
        return False, "approval_checkout_mismatch"
    if approval.get("environment") != "gate-local":
        return False, "approval_environment_mismatch"
    if approval.get("instanceId") != instance_id or approval.get("botAccountId") != bot_account_id:
        return False, "approval_target_mismatch"
    issued = parse_time(approval.get("approvedAt"))
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    # Gate-Local approval is revoked explicitly. Ignore a legacy expiresAt
    # field so existing records do not silently lose their intended lifetime.
    if not issued or issued > current:
        return False, "approval_issued_at_invalid"
    categories = approval.get("riskCategories")
    if not isinstance(categories, list) or any(category not in RISK_CATEGORIES for category in categories):
        return False, "approval_risk_scope_invalid"
    if risk not in categories:
        return False, "risk_category_not_authorized"
    return True, "approved"


def validate_m2_clearance(
    clearance: dict | None,
    *,
    repository: pathlib.Path,
    instance_id: str,
    bot_account_id: str,
    now: datetime | None = None,
) -> tuple[bool, str]:
    if clearance is None:
        return False, "m2_pause_active"
    if clearance.get("schema") != CLEARANCE_SCHEMA:
        return False, "m2_clearance_schema_invalid"
    if clearance.get("repository") != str(repository.resolve()) or clearance.get("environment") != "gate-local":
        return False, "m2_clearance_scope_mismatch"
    if clearance.get("instanceId") != instance_id or clearance.get("botAccountId") != bot_account_id:
        return False, "m2_clearance_target_mismatch"
    issued = parse_time(clearance.get("clearedAt"))
    evidence = clearance.get("acceptanceEvidenceRef")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    # M2 clearance is revoked explicitly; legacy expiresAt fields are ignored.
    if not issued or issued > current:
        return False, "m2_clearance_issued_at_invalid"
    if not isinstance(evidence, str) or not IDENTIFIER.fullmatch(evidence):
        return False, "m2_acceptance_evidence_missing"
    return True, "m2_cleared"


def preflight_candidate(
    *,
    approval: dict | None,
    repository: pathlib.Path,
    paths: list[str],
    instance_id: str,
    bot_account_id: str,
    candidate_sha: str,
    facts: dict[str, Any],
    allow_reviewed_control_plane: bool = False,
    now: datetime | None = None,
) -> dict[str, str]:
    # The phase runner decides whether to automatically trigger Gate; a
    # direct candidate invocation must never be blocked by an arbitrary
    # changed-file category after the user explicitly selected Gate-Local.
    risk, risk_reason = migration_risk(paths, repository)
    if risk_reason:
        status = "BLOCKED_OPERATOR_AUTHORIZATION" if risk_reason.startswith("separate_") else "BLOCKED"
        return {"status": status, "reason": risk_reason}
    allowed, reason = validate_approval(approval, repository=repository, instance_id=instance_id,
                                        bot_account_id=bot_account_id, risk=risk,
                                        now=now)
    if not allowed:
        status = "READY_FOR_AUTO_ENABLE" if reason == "approval_missing" else "BLOCKED_OPERATOR_AUTHORIZATION"
        return {"status": status, "reason": reason}
    if facts.get("targetTrusted") is not True or facts.get("instanceId") != instance_id:
        return {"status": "BLOCKED", "reason": "target_identity_untrusted"}
    if facts.get("botAccountId") != bot_account_id:
        return {"status": "BLOCKED", "reason": "bot_identity_mismatch"}
    if facts.get("activeGatewayCount") != 1 or facts.get("activeWorkerCount") != 1:
        return {"status": "BLOCKED", "reason": "dual_or_missing_runtime"}
    if facts.get("releaseInProgress") is True:
        return {"status": "BLOCKED", "reason": "release_in_progress"}
    if facts.get("backupRecoverable") is not True:
        return {"status": "BLOCKED", "reason": "recoverable_backup_missing"}
    if facts.get("schemaCompatible") is not True:
        return {"status": "BLOCKED", "reason": "schema_incompatible_or_unknown"}
    if facts.get("requiresPgvector") is True and facts.get("pgvectorAvailable") is not True:
        return {"status": "BLOCKED_OPERATOR_AUTHORIZATION", "reason": "separate_pgvector_authorization_required"}
    if facts.get("activeSha") == candidate_sha:
        return {"status": "ALREADY_CURRENT", "reason": "candidate_sha_already_active"}
    return {"status": "READY", "reason": "all_preflight_gates_passed", "risk": risk}


def run_candidate_pipeline(operations: dict[str, Callable[[], Any]]) -> dict[str, Any]:
    """Execute one fixtureable candidate. Real adapters must supply each step."""
    required = ("build", "verify_target", "backup", "migrate", "switch", "health", "smoke", "notify", "audit", "rollback")
    if any(not callable(operations.get(name)) for name in required):
        return {"status": "BLOCKED", "reason": "candidate_adapter_incomplete"}
    trace: list[str] = []
    candidate: dict[str, Any] = {}
    checkpoint: Any = None
    previous: Any = None
    current_step = "build"

    def audited(result: dict[str, Any]) -> dict[str, Any]:
        try:
            operations["audit"]({**result, "candidate": candidate, "checkpoint": checkpoint, "previous": previous})
        except Exception:
            result["auditStatus"] = "failed"
        return result

    try:
        candidate = operations["build"]() or {}
        if not candidate.get("digest") or not candidate.get("sourceSha"):
            return audited({"status": "BLOCKED", "reason": "immutable_candidate_identity_missing", "trace": trace})
        trace.append("build")
        current_step = "verify_target"
        operations["verify_target"]()
        trace.append("verify_target")
        current_step = "backup"
        checkpoint = operations["backup"]()
        if not checkpoint or not checkpoint.get("recoverable"):
            return audited({"status": "BLOCKED", "reason": "recoverable_backup_missing", "trace": trace})
        trace.append("backup")
        current_step = "migrate"
        operations["migrate"]()
        trace.append("migrate")
        current_step = "switch"
        previous = operations["switch"]()
        trace.append("switch")
        current_step = "health"
        if operations["health"]() is not True or operations["smoke"]() is not True:
            try:
                current_step = "rollback"
                operations["rollback"]()
                trace.append("rollback")
                result = {"status": "ROLLED_BACK", "reason": "candidate_health_or_smoke_failed", "trace": trace}
            except Exception:
                result = {"status": "BLOCKED", "reason": "rollback_failed_manual_recovery_required", "trace": trace}
            return audited(result)
        trace.extend(("health", "smoke"))
        current_step = "notify"
        if operations["notify"]() is not True:
            result = {"status": "DEPLOYED_NOTIFICATION_FAILED", "reason": "private_test_notification_failed", "trace": trace}
            return audited(result)
        trace.append("notify")
        result = {"status": "DEPLOYED_AND_NOTIFIED", "reason": "candidate_healthy", "trace": trace}
        return audited(result)
    except Exception:
        # Once a checkpoint exists, a failed migrator/switch must restore the
        # previous application/configuration automatically. The SQL migrator is
        # transactional; only compatible migrations are allowed here.
        if checkpoint is not None and current_step in {"migrate", "switch", "health", "smoke"}:
            try:
                operations["rollback"]()
                trace.append("rollback")
                return audited({"status": "ROLLED_BACK", "reason": "candidate_step_failed",
                                "failedStep": current_step, "trace": trace})
            except Exception:
                return audited({"status": "BLOCKED", "reason": "rollback_failed_manual_recovery_required",
                                "failedStep": current_step, "trace": trace})
        return audited({"status": "BLOCKED", "reason": "candidate_step_failed",
                        "failedStep": current_step, "trace": trace})
