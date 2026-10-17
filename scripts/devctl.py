#!/usr/bin/env python3
"""Small, dependency-free Goal executor: state and affected validation.

Gate-Local's protected host approval is repo-wide across linked worktrees.
Runtime changes still go through the guarded release adapters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from gate_autopilot import (  # noqa: E402
    APPROVAL_SCHEMA as GATE_APPROVAL_SCHEMA,
    CLEARANCE_SCHEMA as GATE_CLEARANCE_SCHEMA,
    IDENTIFIER as GATE_IDENTIFIER,
    validate_approval as validate_gate_approval,
    validate_private_state as validate_gate_private_state,
    write_private_state as write_gate_private_state,
)

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / ".agent" / "runtime" / "goal-state.json"
GATE_LOCAL_POLICY = pathlib.Path.home() / ".config" / "amadeus" / "gate-local-auto-approval.json"
GATE_M2_CLEARANCE = pathlib.Path.home() / ".config" / "amadeus" / "gate-local-m2-clearance.json"
GATE_AUTO_ENABLE_FIELDS = (
    "GATE_LOCAL_INSTANCE_ID",
    "GATE_LOCAL_BOT_ACCOUNT_ID",
    "GATE_LOCAL_ORBSTACK_MACHINE",
    "GATE_LOCAL_BACKUP_ROOT",
    "GATE_LOCAL_AGE_RECIPIENTS_FILE",
    "GATE_LOCAL_AGE_IDENTITY_FILE",
    "GATE_LOCAL_NOTIFICATION_HOOK",
)
SENSITIVE = (
    ".github/", "infra/", "scripts/deploy-", "scripts/release-",
    "scripts/host-profile", "scripts/patch-", "scripts/migrate-",
    "scripts/backup", "scripts/pubg-saas-backup", "scripts/notify-owner",
    "scripts/goal-", "scripts/devctl", "integrations/openclaw/openclaw.json",
    "integrations/openclaw/workspace/AGENTS.md", "VERSION", "RELEASE_NOTES.md",
    "apps/pubg-saas/src/infrastructure/postgres/migrations/",
)
SOURCE_ROOTS = ("plugins/", "packages/pubg-domain/", "packages/presentation/", "packages/identity/",
                "apps/product-radar/", "integrations/openclaw/")
LEVELS = ("edit", "task", "phase", "release")


def die(msg: str) -> None:
    raise SystemExit("DEVCTL_ERROR=" + msg)


def git(*args: str) -> str:
    p = subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)
    if p.returncode:
        die("git " + " ".join(args[:2]) + " failed: " + p.stderr.strip()[:240])
    return p.stdout.strip()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def checksum(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def protected_write(path: pathlib.Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = (json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    fd, tmp = tempfile.mkstemp(prefix=".devctl-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), 0o600)
            f.write(payload)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def safe_read(path: pathlib.Path) -> dict:
    if path.is_symlink() or not path.is_file():
        die("state missing or symlink: " + str(path))
    if stat.S_IMODE(path.stat().st_mode) & 0o077:
        die("state is not private (require mode 0600): " + str(path))
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        die("invalid state format")
    return data


def state() -> dict:
    return safe_read(STATE)


def scope_paths(base: str) -> list[str]:
    # Compare all committed changes since Goal start and working-tree changes,
    # even after a Codex commit makes a plain 'git diff HEAD' empty.
    commands = (
        ["git", "-C", str(ROOT), "diff", "--name-only", "-z", "--diff-filter=ACMDRT", base + "...HEAD"],
        ["git", "-C", str(ROOT), "diff", "--name-only", "-z", "--diff-filter=ACMDRT", "HEAD"],
        ["git", "-C", str(ROOT), "ls-files", "--others", "--exclude-standard", "-z"],
    )
    names = set()
    for command in commands:
        p = subprocess.run(command, capture_output=True)
        if p.returncode:
            die("cannot collect changed files: " + p.stderr.decode(errors="replace")[:160])
        names.update(s.decode(errors="surrogateescape") for s in p.stdout.split(b"\0") if s)
    return sorted(names)


def scope_kind(paths: list[str]) -> tuple[bool, bool, str]:
    """Return Lab affected, Gate affected, and auto-Lab eligibility.

    Unsafe deployment is not permission to skip tests. Tests and candidate
    selection are separate decisions.
    """
    lab = any(p.startswith(SOURCE_ROOTS) for p in paths)
    gate = any(p.startswith(("apps/pubg-saas/", "packages/agent-memory/", "packages/pubg-domain/", "packages/presentation/", "packages/identity/")) for p in paths)
    if not lab:
        return lab, gate, "not-affected"
    # Workspace prompts and Skills are runtime inputs, even when Markdown.
    runtime = [p for p in paths if p.startswith(SOURCE_ROOTS) and
               not p.endswith((".json.example", "README.md")) and
               (not p.endswith(".md") or p.startswith((
                   "integrations/openclaw/workspace/", "plugins/pubg/skills/",
                   "plugins/amadeus/skills/")))]
    if not runtime:
        return lab, gate, "no-runtime-change"
    if any(p.startswith(SENSITIVE) or p in {"VERSION", "RELEASE_NOTES.md"} for p in paths):
        return lab, gate, "requires-separate-review"
    if all(p.startswith("apps/product-radar/") for p in runtime):
        return lab, gate, "radar-only-requires-review"
    if not all(p.startswith(SOURCE_ROOTS) or p.startswith(("docs/", ".agent/")) or p in {"AGENTS.md", ".gitignore"} for p in paths):
        return lab, gate, "mixed-or-unknown-scope"
    return lab, gate, "eligible"


def fingerprint(paths: list[str], level: str, base: str) -> str:
    # Hash real worktree contents and the full HEAD, not a user-supplied cache
    # key. Changes to dependencies or test definitions invalidate reuse.
    common = ("pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json",
              "scripts/developer-workflow.sh", "scripts/devctl.py", "scripts/run-check.sh",
              "docs/VALIDATION_MATRIX.md", "AGENTS.md")
    entries = []
    for path in sorted(set(paths).union(common)):
        target = ROOT / path
        if target.is_symlink():
            entries.append([path, "symlink"])
        elif target.is_file():
            entries.append([path, checksum(target.read_bytes())])
        else:
            entries.append([path, "missing"])
    return checksum(json.dumps([level, base, git("rev-parse", "HEAD"), sys.version, entries]).encode())


def goal_blocks_deploy(data: dict) -> bool:
    """Preserve explicit runtime stops embedded in historical Goals."""
    path = ROOT / data.get("goalPath", "")
    if not path.is_file() or path.is_symlink():
        return True
    content = path.read_text(encoding="utf-8")
    blockers = (r"RUNTIME_APPLY_NOT_AUTHORIZED", r"runtime.apply.not.authorized",
                r"未经.{0,32}授权.{0,50}(?:部署|重启|--apply)",
                r"不得.{0,32}(?:部署|重启|--apply)",
                r"不执行.{0,32}(?:部署|发布)",
                r"no (?:production |live )?(?:deploy|apply) without",
                r"separate (?:explicit )?authorization.*(?:deploy|restart)")
    return any(re.search(pattern, content, re.IGNORECASE) for pattern in blockers)


def gate_policy() -> tuple[dict | None, str]:
    return validate_gate_private_state(GATE_LOCAL_POLICY, ROOT)


def gate_auto_status() -> tuple[str, str]:
    policy, state_reason = gate_policy()
    if policy is None:
        return ("disabled" if state_reason == "state_missing" else "misconfigured", state_reason)
    instance_id = policy.get("instanceId", "")
    bot_account_id = policy.get("botAccountId", "")
    active, approval_reason = validate_gate_approval(
        policy, repository=ROOT, instance_id=instance_id,
        bot_account_id=bot_account_id, risk="reversible_app_candidate",
    )
    if not active:
        return "disabled", approval_reason
    return "enabled", "ready_for_candidate_preflight"


def external_gate_path(value: str, label: str, *, directory: bool = False,
                       required_mode: int | None = None, executable: bool = False) -> pathlib.Path:
    raw = pathlib.Path(value).expanduser()
    if raw.is_symlink():
        die(label + " must not be a symlink")
    try:
        resolved = raw.resolve(strict=True)
        if os.path.commonpath((str(ROOT.resolve()), str(resolved))) == str(ROOT.resolve()):
            die(label + " must be outside the Git checkout")
        info = resolved.stat()
    except (OSError, ValueError):
        die(label + " is unavailable")
    if info.st_uid != os.getuid():
        die(label + " must be owned by the current user")
    if directory:
        if (not resolved.is_dir() or stat.S_IMODE(info.st_mode) != 0o700
                or not os.access(resolved, os.W_OK | os.X_OK)):
            die(label + " must exist as an owner-only directory with mode 0700")
    elif not resolved.is_file():
        die(label + " must be a regular external file")
    elif not os.access(resolved, os.R_OK):
        die(label + " must be readable by the current user")
    if required_mode is not None and stat.S_IMODE(info.st_mode) != required_mode:
        die(label + " has invalid permissions")
    if executable and (not os.access(resolved, os.X_OK) or info.st_mode & 0o022):
        die(label + " must be executable and not group/world writable")
    return resolved


def gate_auto_enable_document(environment: dict[str, str], lab_machine: str) -> dict:
    missing = [key for key in GATE_AUTO_ENABLE_FIELDS if not environment.get(key, "").strip()]
    if missing:
        raise ValueError("missing required Gate-Local configuration: " + ", ".join(missing))
    instance_id = environment["GATE_LOCAL_INSTANCE_ID"].strip()
    bot_account_id = environment["GATE_LOCAL_BOT_ACCOUNT_ID"].strip()
    machine = environment["GATE_LOCAL_ORBSTACK_MACHINE"].strip()
    if not GATE_IDENTIFIER.fullmatch(instance_id) or not GATE_IDENTIFIER.fullmatch(bot_account_id):
        raise ValueError("Gate-Local instance and Bot IDs must use bounded non-secret identifiers")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", machine):
        raise ValueError("OrbStack machine name is invalid")
    if machine == lab_machine:
        raise ValueError("Gate-Local must use an OrbStack machine separate from the Lab host profile")
    backup_path = external_gate_path(environment["GATE_LOCAL_BACKUP_ROOT"].strip(),
                                     "Gate backup directory", directory=True)
    recipients_path = external_gate_path(environment["GATE_LOCAL_AGE_RECIPIENTS_FILE"].strip(),
                                         "Gate age recipients file")
    identity_path = external_gate_path(environment["GATE_LOCAL_AGE_IDENTITY_FILE"].strip(),
                                       "Gate age identity file", required_mode=0o600)
    notify_path = external_gate_path(environment["GATE_LOCAL_NOTIFICATION_HOOK"].strip(),
                                    "Gate-private notification hook", executable=True)
    if notify_path.name in {"notify-owner.sh", "codex-notify.sh"}:
        raise ValueError("Gate-private notification hook must not use a Lab notification path")
    current = datetime.now(timezone.utc)
    common_dir = subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "--path-format=absolute", "--git-common-dir"],
        capture_output=True, text=True, check=False,
    )
    if common_dir.returncode != 0 or not common_dir.stdout.strip():
        raise ValueError("Gate-Local repository identity is unavailable")
    return {
        "schema": GATE_APPROVAL_SCHEMA,
        "repository": str(ROOT.resolve()),
        "repositoryCommonDir": str(pathlib.Path(common_dir.stdout.strip()).resolve()),
        "environment": "gate-local",
        "instanceId": instance_id,
        "botAccountId": bot_account_id,
        "orbstackMachine": machine,
        "backupRoot": str(backup_path),
        "ageRecipientsFile": str(recipients_path.resolve()),
        "ageIdentityFile": str(identity_path.resolve()),
        "notificationHook": str(notify_path.resolve()),
        "riskCategories": ["reversible_app_candidate", "backward_compatible_schema",
                           "destructive_schema_warning"],
        "approvedAt": current.isoformat(),
    }


def gate_auto_enable() -> None:
    try:
        document = gate_auto_enable_document(os.environ, configured_lab_machine())
    except ValueError as error:
        die(str(error))
    try:
        write_gate_private_state(GATE_LOCAL_POLICY, ROOT, document)
    except (OSError, ValueError):
        die("could not create protected Gate-Local authorization state")
    print("GATE_AUTO_ENABLED=true scope=gate-local risks=reversible_app_candidate,backward_compatible_schema,destructive_schema_warning")
    print("GATE_AUTO_M2_CLEARANCE=not_required_for_local_candidates; formal_release_only")


def gate_auto_disable() -> None:
    existing = []
    for path in (GATE_LOCAL_POLICY, GATE_M2_CLEARANCE):
        if path.is_symlink():
            die("refusing symlink in Gate-Local authorization state")
        if path.exists():
            _, state_reason = validate_gate_private_state(path, ROOT)
            if state_reason != "ok":
                die("Gate-Local authorization state is not protected: " + state_reason)
            existing.append(path)
    for path in existing:
        path.unlink()
    print("GATE_AUTO_ENABLED=false")
    print("GATE_AUTO_M2_CLEARANCE=false")


def configured_lab_machine() -> str:
    script = 'source "$1"; amadeus_host_profile_load "$2"; printf "%s" "$ORBSTACK_MACHINE"'
    try:
        result = subprocess.run(
            ["bash", "-c", script, "devctl-host-profile", str(ROOT / "scripts/host-profile.sh"), str(ROOT)],
            capture_output=True, text=True, check=False, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        die("cannot resolve the Lab OrbStack machine from the host profile")
    machine = result.stdout.strip()
    if result.returncode or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", machine):
        die("cannot resolve the Lab OrbStack machine from the host profile")
    return machine


def gate_m2_clear() -> None:
    if not sys.stdin.isatty():
        die("M2 pause clearance requires an interactive local terminal")
    policy, reason = gate_policy()
    if policy is None:
        die("Gate-Local auto approval is not active: " + reason)
    allowed, reason = validate_gate_approval(
        policy, repository=ROOT, instance_id=policy.get("instanceId", ""),
        bot_account_id=policy.get("botAccountId", ""), risk="reversible_app_candidate",
    )
    if not allowed:
        die("Gate-Local auto approval is not active: " + reason)
    print("This records M2 human acceptance for a future formal release; it does not change or resume M2.")
    if input("Type CLEAR GATE M2 PAUSE: ") != "CLEAR GATE M2 PAUSE":
        die("operator did not clear the Gate M2 pause")
    evidence = input("M2 human acceptance evidence reference (non-secret): ").strip()
    if not GATE_IDENTIFIER.fullmatch(evidence):
        die("M2 acceptance evidence reference is required")
    document = gate_m2_clearance_document(policy, evidence)
    try:
        write_gate_private_state(GATE_M2_CLEARANCE, ROOT, document)
    except (OSError, ValueError):
        die("could not create protected Gate M2 clearance state")
    print("GATE_AUTO_M2_CLEARANCE=recorded scope=gate-local formal-release-only; revoke with gate-m2-revoke or gate-auto-disable")


def gate_m2_clearance_document(policy: dict, evidence: str) -> dict:
    return {
        "schema": GATE_CLEARANCE_SCHEMA,
        "repository": str(ROOT.resolve()),
        "environment": "gate-local",
        "instanceId": policy["instanceId"],
        "botAccountId": policy["botAccountId"],
        "acceptanceEvidenceRef": evidence,
        "clearedAt": datetime.now(timezone.utc).isoformat(),
    }


def gate_m2_revoke() -> None:
    if GATE_M2_CLEARANCE.is_symlink():
        die("refusing symlink in Gate-Local M2 clearance state")
    if GATE_M2_CLEARANCE.exists():
        _, state_reason = validate_gate_private_state(GATE_M2_CLEARANCE, ROOT)
        if state_reason != "ok":
            die("Gate-Local M2 clearance state is not protected: " + state_reason)
        GATE_M2_CLEARANCE.unlink()
    print("GATE_AUTO_M2_CLEARANCE=false")


def execute(command: list[str], label: str, dry_run: bool) -> None:
    print("CHECK=" + label + " COMMAND=" + " ".join(command), flush=True)
    if dry_run:
        return
    subprocess.run(command, cwd=ROOT, check=True)


PACKAGE_DIRS = (
    ("apps/pubg-saas/", "@agent/pubg-saas"),
    ("packages/agent-memory/", "@agent/memory"),
    ("plugins/amadeus/", "@agent/amadeus-plugin"),
    ("plugins/pubg/", "@agent/pubg-plugin"),
    ("packages/pubg-domain/", "@agent/pubg-domain"),
    ("packages/presentation/", "@agent/presentation"),
    ("packages/identity/", "@agent/identity"),
    ("apps/product-radar/", "@agent/product-radar"),
)


def affected_package(path: str) -> tuple[str, str] | None:
    for prefix, package in PACKAGE_DIRS:
        if path.startswith(prefix):
            return prefix, package
    return None


def tests_for_task(paths: list[str]) -> list[tuple[str, list[str]]]:
    # Avoid package-wide tests while editing. A deterministic phase gate later
    # runs affected package suites, so absent sibling tests are not a pass claim.
    result: list[tuple[str, list[str]]] = []
    seen = set()
    for path in paths:
        target = ROOT / path
        if path.endswith(".py") and target.is_file():
            cmd = ["python3", "-m", "py_compile", path]
        elif path.endswith(".sh") and target.is_file():
            cmd = ["bash", "-n", path]
        elif path.endswith((".mjs", ".cjs")) and target.is_file():
            cmd = ["node", "--check", path]
        else:
            continue
        if tuple(cmd) not in seen:
            seen.add(tuple(cmd))
            result.append(("syntax:" + path, cmd))
    # Executing one changed test file is much cheaper than a package suite.
    for path in paths:
        item = affected_package(path)
        if not item or "/tests/" not in path or not path.endswith(".test.ts"):
            continue
        prefix, package = item
        cmd = ["pnpm", "--filter", package, "exec", "tsx", "--test", path[len(prefix):]]
        if tuple(cmd) not in seen:
            seen.add(tuple(cmd))
            result.append(("focused:" + path, cmd))
    return result


def typechecks_for_task(paths: list[str]) -> list[tuple[str, list[str]]]:
    packages = sorted({x[1] for path in paths if (x := affected_package(path))
                       and "/src/" in path})
    return [("typecheck:" + name, ["pnpm", "--filter", name, "typecheck"])
            for name in packages]


def check(level: str, data: dict, dry_run: bool = False) -> None:
    base = data["baseCommit"] if level == "release" else data.get("phaseBaseCommit", data["baseCommit"])
    paths = scope_paths(base)
    key = fingerprint(paths, level, base)
    if level in ("edit", "task") and data.get("checks", {}).get(level) == key and not dry_run:
        print("CHECK_REUSED=" + level + " input=" + key[:12])
        return
    if level == "release":
        lab, gate, _ = scope_kind(paths)
        if not paths:
            print("NO_CHANGED_FILES=1")
            return
        if lab:
            execute(["bash", "scripts/release-lab.sh", "verify"], "lab-release", dry_run)
        if gate:
            execute(["bash", "scripts/release-gate.sh", "verify"], "gate-release", dry_run)
        if not lab and not gate:
            execute(["pnpm", "check:architecture"], "architecture", dry_run)
        execute(["pnpm", "check:secrets"], "secrets", dry_run)
    elif level == "phase":
        if paths:
            execute(["bash", "scripts/developer-workflow.sh", "--run", "--files", *paths], "affected-phase", dry_run)
        execute(["pnpm", "check:secrets"], "secrets", dry_run)
    else:
        execute(["git", "diff", "--check"], "diff", dry_run)
        for label, cmd in tests_for_task(paths):
            execute(cmd, label, dry_run)
        if level == "task":
            for label, cmd in typechecks_for_task(paths):
                execute(cmd, label, dry_run)
            if paths:
                print("TASK_SCOPE=focused checks and affected typecheck; phase performs dependency regression")
    if not dry_run:
        data.setdefault("checks", {})[level] = key
        data["lastCheckAt"] = now()
        protected_write(STATE, data)
    print("CHECK_RESULT=" + ("DRY_RUN" if dry_run else "PASSED") + " level=" + level)


def goal_start(file: str) -> None:
    path = (ROOT / file).resolve()
    try:
        relative = path.relative_to(ROOT).as_posix()
    except ValueError:
        die("Goal must be inside repository")
    if not path.is_file() or path.suffix.lower() != ".md":
        die("Goal must be an existing Markdown document")
    rev = checksum(path.read_bytes())
    if STATE.exists():
        old = state()
        if old.get("goalPath") == relative and old.get("goalSha256") == rev:
            print("GOAL_RESUMED=" + relative)
            goal_status()
            return
        archive = STATE.parent / "archive" / (now().replace(":", "-") + ".json")
        protected_write(archive, old)
    data = {"goalPath": relative, "goalSha256": rev,
            "baseCommit": git("rev-parse", "HEAD"),
            "phaseBaseCommit": git("rev-parse", "HEAD"), "phase": "P0",
            "nextAction": "identify first uncompleted acceptance item",
            "completedPhases": [], "checks": {}, "deployments": {},
            "startedAt": now()}
    protected_write(STATE, data)
    print("GOAL_STARTED=" + relative + " base=" + data["baseCommit"][:12])
    print("GOAL_CONTEXT=read current phase only; do not repeatedly read the full Goal")


def goal_status() -> None:
    data = state()
    current = ROOT / data["goalPath"]
    modified = not current.is_file() or checksum(current.read_bytes()) != data["goalSha256"]
    info = {"goal": data["goalPath"], "phase": data["phase"],
            "next": data.get("nextAction"), "completed": data["completedPhases"],
            "changedFiles": len(scope_paths(data.get("phaseBaseCommit", data["baseCommit"]))),
            "goalTotalChanged": len(scope_paths(data["baseCommit"])),
            "goalChanged": modified,
            "lastDeployed": data.get("deployments", {}).get("lab")}
    print(json.dumps(info, ensure_ascii=False, separators=(",", ":")))
    if modified:
        print("GOAL_CHANGED=review changed clauses before continuing")


def finish_phase(phase: str, dry_run: bool) -> None:
    data = state()
    if phase != data["phase"]:
        die("phase does not match current Goal state")
    check("phase", data, dry_run=dry_run)
    paths = scope_paths(data.get("phaseBaseCommit", data["baseCommit"]))
    lab, gate, reason = scope_kind(paths)
    source = git("rev-parse", "HEAD")
    if dry_run:
        print("PHASE_PLAN=lab:" + reason + " gate:" + str(gate))
        return
    if git("status", "--porcelain"):
        die("commit verified source before completing phase; no deployment attempted")
    if checksum((ROOT / data["goalPath"]).read_bytes()) != data["goalSha256"]:
        die("Goal changed: review amended acceptance requirements before phase exit")
    if lab:
        print("LAB_DEPLOYMENT=AFTER_MAIN_MERGE ci=required release=automatic")
    if gate:
        gate_status, gate_reason = gate_auto_status()
        if gate_status == "disabled" and gate_reason == "state_missing":
            print("GATE_DEPLOYMENT=READY_FOR_AUTO_ENABLE source_candidate=" + source[:12])
            print("GATE_DEPLOYMENT_NEXT=pnpm devctl configure gate-auto-enable")
        elif gate_status == "enabled":
            execute(["bash", "scripts/release-gate.sh", "candidate", "--apply",
                     "--approval-ref", "devctl:" + source[:12]], "gate-local-candidate", False)
            print("GATE_DEPLOYMENT=CANDIDATE_FINISHED source_candidate=" + source[:12])
        else:
            print("GATE_DEPLOYMENT=BLOCKED_OPERATOR_AUTHORIZATION reason=" + gate_reason +
                  " source_candidate=" + source[:12])
    data["completedPhases"].append(phase)
    data["phaseBaseCommit"] = source
    data["checks"] = {}
    data["phase"] = "P" + str(int(phase[1:]) + 1)
    data["nextAction"] = "read current phase acceptance criteria and implement"
    data["lastPhaseCompletedAt"] = now()
    protected_write(STATE, data)
    print("PHASE_COMPLETED=" + phase)


def main() -> None:
    p = argparse.ArgumentParser(description="Goal-state and affected verification wrapper; no background daemon")
    sub = p.add_subparsers(dest="command", required=True)
    goal = sub.add_parser("goal")
    gs = goal.add_subparsers(dest="operation", required=True)
    gs.add_parser("start").add_argument("file")
    gs.add_parser("status")
    cp = gs.add_parser("set-next")
    cp.add_argument("text", nargs="+")
    done = gs.add_parser("finish-phase")
    done.add_argument("phase")
    done.add_argument("--dry-run", action="store_true")
    check_p = sub.add_parser("check")
    check_p.add_argument("--level", choices=LEVELS, required=True)
    check_p.add_argument("--dry-run", action="store_true")
    configure = sub.add_parser("configure")
    configure.add_argument("option", choices=[
        "gate-auto-enable", "gate-auto-disable",
        "gate-m2-clear", "gate-m2-revoke", "status",
    ])
    args = p.parse_args()
    if args.command == "goal":
        if args.operation == "start":
            goal_start(args.file)
        elif args.operation == "status":
            goal_status()
        elif args.operation == "set-next":
            data = state()
            data["nextAction"] = " ".join(args.text)[:220]
            protected_write(STATE, data)
            goal_status()
        elif args.operation == "finish-phase":
            finish_phase(args.phase, args.dry_run)
    elif args.command == "check":
        check(args.level, state(), args.dry_run)
    else:
        if args.option == "status":
            print("LAB_AUTO_RELEASE_POLICY=after-main-merge-ci")
            gate_state, gate_reason = gate_auto_status()
            print("GATE_AUTO_STATUS=" + gate_state)
            print("GATE_AUTO_REASON=" + gate_reason)
            print("GATE_M2_CLEARANCE_SCOPE=formal-release-only")
        elif args.option == "gate-auto-enable":
            gate_auto_enable()
        elif args.option == "gate-auto-disable":
            gate_auto_disable()
        elif args.option == "gate-m2-clear":
            gate_m2_clear()
        elif args.option == "gate-m2-revoke":
            gate_m2_revoke()
        else:
            die("unsupported configuration option")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        die("check or controlled release failed (exit " + str(exc.returncode) + ")")
