#!/usr/bin/env python3
"""Small, dependency-free Goal executor: state, affected validation and Lab candidate handoff.

Never grants itself permission to deploy. An operator must enable a protected,
repository-bound local approval once. All actual runtime changes still go
through scripts/release-lab.sh and its immutable-image/backup/health gates.
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

ROOT = pathlib.Path(__file__).resolve().parent.parent
STATE = ROOT / ".agent" / "runtime" / "goal-state.json"
LOCAL_POLICY = pathlib.Path.home() / ".config" / "amadeus" / "lab-auto-approval.json"
SENSITIVE = (
    ".github/", "infra/", "scripts/deploy-", "scripts/release-",
    "scripts/host-profile", "scripts/patch-", "scripts/migrate-",
    "scripts/backup", "scripts/pubg-saas-backup", "scripts/notify-owner",
    "scripts/goal-", "scripts/devctl", "integrations/openclaw/openclaw.json",
    "integrations/openclaw/workspace/AGENTS.md", "VERSION", "RELEASE_NOTES.md",
    "apps/pubg-saas/src/infrastructure/postgres/migrations/",
)
SOURCE_ROOTS = ("plugins/", "packages/", "apps/product-radar/", "integrations/openclaw/")
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
    lab = any(p.startswith(("plugins/", "packages/", "apps/product-radar/", "integrations/openclaw/")) for p in paths)
    gate = any(p.startswith(("apps/pubg-saas/", "packages/pubg-domain/", "packages/presentation/", "packages/identity/")) for p in paths)
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
    """Honor explicit restrictions in historical Goals until reviewed.

    This deliberately errs toward a false positive: a Goal should no longer
    embed runtime authorization paragraphs in the first place.
    """
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


def approval_active() -> bool:
    if not LOCAL_POLICY.exists():
        return False
    try:
        doc = safe_read(LOCAL_POLICY)
        return doc.get("repo") == str(ROOT) and doc.get("labCandidateAuto") is True
    except (ValueError, SystemExit, OSError):
        return False


def execute(command: list[str], label: str, dry_run: bool) -> None:
    print("CHECK=" + label + " COMMAND=" + " ".join(command), flush=True)
    if dry_run:
        return
    subprocess.run(command, cwd=ROOT, check=True)


PACKAGE_DIRS = (
    ("apps/pubg-saas/", "@agent/pubg-saas"),
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


def live_lab_matches(source: str, paths: list[str]) -> bool:
    # Optional safe read: failure is unknown, never silently treated as healthy.
    services = ["openclaw"]
    if any(p.startswith("packages/presentation/") for p in paths):
        services.append("product-radar")
    try:
        p = subprocess.run(["python3", "scripts/lab-runtime-snapshot.py",
                            *[arg for service in services for arg in ("--service", service)]],
                           cwd=ROOT, capture_output=True, timeout=30)
        if p.returncode:
            return False
        actual = json.loads(p.stdout).get("services", [])
        return len(actual) == len(services) and all(
            row.get("service") in services and row.get("gitSha") == source
            and row.get("state") == "running" and row.get("health") == "healthy"
            for row in actual
        )
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


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
    if reason == "eligible" and goal_blocks_deploy(data):
        reason = "legacy-goal-runtime-restriction"
    source = git("rev-parse", "HEAD")
    if dry_run:
        print("PHASE_PLAN=lab:" + reason + " gate:" + str(gate))
        return
    if git("status", "--porcelain"):
        die("commit verified source before completing phase; no deployment attempted")
    if checksum((ROOT / data["goalPath"]).read_bytes()) != data["goalSha256"]:
        die("Goal changed: review amended acceptance requirements before phase exit")
    if lab and reason == "eligible" and data.get("deployments", {}).get("lab") != source:
        if approval_active():
            if live_lab_matches(source, paths):
                print("LAB_CANDIDATE=ALREADY_CURRENT source=" + source[:12])
            else:
                # Never mint tags, alter Gate or bypass the existing
                # release/checkpoint/health/rollback and owner notification path.
                execute(["bash", "scripts/release-lab.sh", "candidate", "--apply",
                         "--approval-ref", "devctl:" + source[:12]], "lab-candidate", False)
                print("LAB_CANDIDATE=DEPLOYED_AND_NOTIFIED source=" + source[:12])
            data.setdefault("deployments", {})["lab"] = source
            # Persist successful deployment before any later phase bookkeeping;
            # a crash must not reapply the same known-good source.
            protected_write(STATE, data)
        else:
            print("LAB_CANDIDATE=PENDING_ONE_TIME_LOCAL_APPROVAL; no runtime change")
    elif lab:
        print("LAB_CANDIDATE=SKIPPED reason=" + reason)
    if gate:
        print("GATE_DEPLOYMENT=NOT_AUTHORIZED source_candidate=" + source[:12])
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
    configure.add_argument("option", choices=["lab-auto-enable", "lab-auto-disable", "status"])
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
            print("LAB_AUTO_ENABLED=" + str(approval_active()).lower())
        elif args.option == "lab-auto-disable":
            if LOCAL_POLICY.exists():
                LOCAL_POLICY.unlink()
            print("LAB_AUTO_ENABLED=false")
        else:
            if not sys.stdin.isatty():
                die("one-time Lab approval requires an interactive local terminal")
            print("One-time authorization: automatically deploy reversible Lab candidates after phase checks.")
            print("This may restart OpenClaw; database migrations, network, secrets, Gate and formal tags stay excluded.")
            if input("Type ENABLE LAB AUTO to authorize: ") != "ENABLE LAB AUTO":
                die("operator declined Lab auto approval")
            protected_write(LOCAL_POLICY, {"repo": str(ROOT), "labCandidateAuto": True,
                                           "approvedAt": now()})
            print("LAB_AUTO_ENABLED=true")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        die("check or controlled release failed (exit " + str(exc.returncode) + ")")
