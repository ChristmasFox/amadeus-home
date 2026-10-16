#!/usr/bin/env python3
"""Fixtureable Gate-Local candidate authorization and execution guards.

This module never creates authorization. Only devctl's interactive commands
may write the external 0600 approval and M2-clearance records.
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
    """Classify deploy-trigger scope. Shared or mixed changes never auto-apply."""
    if not paths:
        return "no_changes", None
    shared = any(path.startswith(SHARED_PREFIXES) for path in paths)
    gate = any(path.startswith(GATE_PREFIXES) for path in paths)
    lab = any(path.startswith(("plugins/", "apps/product-radar/", "integrations/openclaw/")) for path in paths)
    if shared:
        return ("mixed_lab_gate", "cross_product_change") if gate or lab else ("shared_package", "shared_package_change")
    if not gate:
        return ("lab_only", None) if lab else ("non_runtime", None)
    if lab:
        return "mixed_lab_gate", "cross_product_change"
    if any(path.startswith(("scripts/", ".github/")) for path in paths):
        return "gate_with_control_plane", "release_control_change"
    if any(path.startswith("packages/") for path in paths):
        return "shared_package", "shared_package_change"
    return "gate_only", None


def migration_risk(paths: list[str], repository: pathlib.Path) -> tuple[str, str | None]:
    migrations = [path for path in paths if path.startswith("apps/pubg-saas/src/infrastructure/postgres/migrations/")]
    if not migrations:
        return "reversible_app_candidate", None
    migration_files = [(repository / path) for path in migrations]
    if any(not path.is_file() or path.is_symlink() for path in migration_files):
        return "unreviewed_migration", "migration_source_missing_or_untrusted"
    try:
        sql = "\n".join(path.read_text(encoding="utf-8") for path in migration_files)
    except (OSError, UnicodeError):
        return "unreviewed_migration", "migration_source_missing_or_untrusted"
    if re.search(r"\bCREATE\s+EXTENSION\b|\bvector\s*\(|USING\s+vector\b", sql, re.IGNORECASE):
        return "pgvector_install", "separate_pgvector_authorization_required"
    if re.search(r"\bDROP\s+(?:TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|SCHEMA)\b|\bRENAME\s+(?:COLUMN|TO)\b", sql, re.IGNORECASE):
        return "destructive_schema", "separate_schema_authorization_required"
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
    expires = parse_time(approval.get("expiresAt"))
    issued = parse_time(approval.get("approvedAt"))
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not expires or not issued or issued > current or expires <= current:
        return False, "approval_expired_or_invalid"
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
    expires = parse_time(clearance.get("expiresAt"))
    evidence = clearance.get("acceptanceEvidenceRef")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if not issued or not expires or issued > current or expires <= current:
        return False, "m2_clearance_expired_or_invalid"
    if not isinstance(evidence, str) or not IDENTIFIER.fullmatch(evidence):
        return False, "m2_acceptance_evidence_missing"
    return True, "m2_cleared"


def preflight_candidate(
    *,
    approval: dict | None,
    clearance: dict | None,
    repository: pathlib.Path,
    paths: list[str],
    instance_id: str,
    bot_account_id: str,
    candidate_sha: str,
    facts: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, str]:
    scope, scope_reason = classify_changed_scope(paths)
    if scope != "gate_only":
        return {"status": "BLOCKED", "reason": scope_reason or scope}
    risk, risk_reason = migration_risk(paths, repository)
    if risk_reason:
        return {"status": "BLOCKED", "reason": risk_reason}
    allowed, reason = validate_approval(approval, repository=repository, instance_id=instance_id,
                                        bot_account_id=bot_account_id, risk=risk, now=now)
    if not allowed:
        status = "READY_FOR_AUTO_ENABLE" if reason == "approval_missing" else "BLOCKED_OPERATOR_AUTHORIZATION"
        return {"status": status, "reason": reason}
    cleared, reason = validate_m2_clearance(clearance, repository=repository, instance_id=instance_id,
                                            bot_account_id=bot_account_id, now=now)
    if not cleared:
        return {"status": "BLOCKED_OPERATOR_AUTHORIZATION", "reason": reason}
    if facts.get("targetTrusted") is not True or facts.get("instanceId") != instance_id:
        return {"status": "BLOCKED", "reason": "target_identity_untrusted"}
    if facts.get("botAccountId") != bot_account_id:
        return {"status": "BLOCKED", "reason": "bot_identity_mismatch"}
    if facts.get("activeGatewayCount") != 1 or facts.get("activeWorkerCount") != 1:
        return {"status": "BLOCKED", "reason": "dual_or_missing_runtime"}
    if facts.get("releaseInProgress") is True:
        return {"status": "BLOCKED", "reason": "release_in_progress"}
    if facts.get("runtimeDrift") is not False:
        return {"status": "BLOCKED", "reason": "runtime_drift_or_unknown"}
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
        result = {"status": "BLOCKED", "reason": "candidate_step_failed", "failedStep": current_step, "trace": trace}
        return audited(result)
