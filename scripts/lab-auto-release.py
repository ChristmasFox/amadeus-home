#!/usr/bin/env python3
"""Deploy Lab main runtime changes without a GitHub CI gate."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from typing import Any

REPOSITORY = "ChristmasFox/amadeus-home"
REMOTE = "origin"
BRANCH = "main"
LABEL = "com.amadeus.lab-auto-release"
STATE_ROOT = Path.home() / ".local/state/amadeus/lab-auto-release"
RELEASE_STATE_ROOT = Path.home() / ".local/state/amadeus/releases"
BACKUP_ROOT = Path("/Volumes/Avalon/backups/operation-skuld")
CHECKPOINT_ROOT = BACKUP_ROOT / "deploy"
WORKTREE_NAME = "release-worktree"
CHECK_INTERVAL_SECONDS = 120
MAX_DEPLOY_ATTEMPTS = 3
LAB_PATH_PREFIXES = (
    "plugins/amadeus/",
    "plugins/pubg/",
    "packages/presentation/",
    "packages/pubg-domain/",
    "packages/pubg-intelligence/",
    "integrations/openclaw/",
    "infra/docker/casaos/openclaw/",
)
LAB_PATH_FILES = {
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "scripts/deploy-openclaw.sh", "scripts/openclaw_prepare.py",
}



class AutomationError(RuntimeError):
    pass


def git(root: Path, *args: str, check: bool = True, capture: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(root), *args], text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if check and result.returncode:
        detail = (result.stderr or "").strip()
        raise AutomationError(f"git {args[0]} failed ({result.returncode})" + (f": {detail}" if detail else ""))
    return (result.stdout or "").strip()


def command(args: list[str], *, cwd: Path, env: dict[str, str] | None = None,
            capture: bool = True, timeout: int = 60) -> str:
    result = subprocess.run(
        args, cwd=cwd, env=env, text=True, timeout=timeout,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if result.returncode:
        raise AutomationError(f"{Path(args[0]).name} failed ({result.returncode})")
    return (result.stdout or "").strip()


def ensure_private_dir(path: Path) -> None:
    if path.is_symlink():
        raise AutomationError(f"protected state path is a symlink: {path}")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path, 0o700)
    if path.stat().st_mode & 0o077:
        raise AutomationError(f"protected state directory permissions are too broad: {path}")


def load_state() -> dict[str, Any] | None:
    path = STATE_ROOT / "state.json"
    if not path.exists():
        return None
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise AutomationError("Lab auto-release state must be a regular mode-0600 file")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "lab-main-auto-release/v1":
        raise AutomationError("Lab auto-release state schema is unsupported")
    return data


def save_state(data: dict[str, Any]) -> None:
    ensure_private_dir(STATE_ROOT)
    destination = STATE_ROOT / "state.json"
    fd, temporary_name = tempfile.mkstemp(prefix=".state.", dir=STATE_ROOT)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def fetch_main(root: Path) -> str:
    git(root, "fetch", "--prune", REMOTE, BRANCH, "--tags")
    return git(root, "rev-parse", f"{REMOTE}/{BRANCH}")


def is_ancestor(root: Path, ancestor: str, descendant: str) -> bool:
    return subprocess.run(
        ["git", "-C", str(root), "merge-base", "--is-ancestor", ancestor, descendant],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def lab_source_changes(root: Path, previous_sha: str, current_sha: str) -> list[str]:
    if previous_sha == current_sha:
        return []
    if not is_ancestor(root, previous_sha, current_sha):
        raise AutomationError("last processed Lab main commit is not an ancestor of current main")
    raw = git(root, "diff", "--name-only", f"{previous_sha}..{current_sha}")
    paths = [path for path in raw.splitlines() if path]
    return [
        path for path in paths
        if path in LAB_PATH_FILES or any(path == prefix or path.startswith(prefix) for prefix in LAB_PATH_PREFIXES)
    ]


def managed_worktree(root: Path, *, refresh: bool) -> Path:
    ensure_private_dir(STATE_ROOT)
    worktree = STATE_ROOT / WORKTREE_NAME
    if worktree.is_symlink():
        raise AutomationError("managed release worktree path must not be a symlink")
    if worktree.exists():
        if git(root, "-C", str(worktree), "rev-parse", "--is-inside-work-tree") != "true":
            raise AutomationError("managed release worktree path is not a Git worktree")
        if git(worktree, "status", "--porcelain"):
            raise AutomationError("managed release worktree has unexpected changes")
        if refresh:
            git(worktree, "checkout", "--detach", f"{REMOTE}/{BRANCH}")
        return worktree
    git(root, "worktree", "add", "--detach", str(worktree), f"{REMOTE}/{BRANCH}")
    return worktree


def checkout_for_sha(root: Path, sha: str) -> Path:
    worktree = managed_worktree(root, refresh=False)
    current = git(worktree, "rev-parse", "HEAD")
    if current != sha:
        if git(worktree, "status", "--porcelain"):
            raise AutomationError("release worktree is dirty; refusing to reset it")
        git(worktree, "checkout", "--detach", sha)
    return worktree


def release_version_from_commit(root: Path, sha: str) -> str | None:
    subject = git(root, "show", "-s", "--format=%s", sha)
    prefix = "chore(lab): release v"
    if not subject.startswith(prefix):
        return None
    version = subject.removeprefix(prefix)
    if not all(part.isdecimal() for part in version.split(".")) or len(version.split(".")) != 3:
        return None
    return version


def release_note_summary(paths: list[str]) -> str:
    if any(path.startswith(("apps/pubg-intelligence-lab/", "packages/pubg-intelligence/",
                            "docs/research/pubg-intelligence/")) for path in paths):
        return "PUBG Intelligence Lab 研究体验与证据链更新。"
    if any(path.startswith(("plugins/pubg/", "packages/pubg-domain/")) for path in paths):
        return "PUBG 查询与比赛数据分析能力更新。"
    if any(path.startswith(("plugins/amadeus/", "integrations/openclaw/")) for path in paths):
        return "Lab 对话与工具运行能力更新。"
    return "Lab 发布流程与运行可靠性更新。"


def write_release_notes(path: Path, version: str, summary: str) -> None:
    path.write_text(
        f"# Amadeus {version}\n\n"
        f"- {summary}\n",
        encoding="utf-8",
    )


def push_main(root: Path) -> None:
    result = subprocess.run(["git", "-C", str(root), "push", REMOTE, "HEAD:refs/heads/main"], text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode == 0:
        return
    if "timed out" in (result.stderr or "").lower() or "timeout" in (result.stderr or "").lower():
        retry = subprocess.run(
            ["git", "-C", str(root), "-c", "http.proxy=http://127.0.0.1:7897", "push", REMOTE, "HEAD:refs/heads/main"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if retry.returncode == 0:
            return
    raise AutomationError(f"automated Lab release version push failed ({result.returncode})")


def prepare_release(root: Path, source_sha: str, state: dict[str, Any]) -> dict[str, Any] | None:
    tree = checkout_for_sha(root, source_sha)
    version = release_version_from_commit(root, source_sha)
    if version is None:
        bump_output = command(["bash", "scripts/amadeus-version.sh", "bump", "patch"], cwd=tree)
        for line in bump_output.splitlines():
            if line.startswith("VERSION="):
                version = line.removeprefix("VERSION=")
                break
    if version is None:
        raise AutomationError("automatic Lab version bump produced no version")
    source_parent = git(tree, "rev-parse", f"{source_sha}^")
    source_paths = git(tree, "diff", "--name-only", f"{source_parent}..{source_sha}").splitlines()
    write_release_notes(tree / "RELEASE_NOTES.md", version, release_note_summary(source_paths))
    command(["bash", "scripts/amadeus-version.sh", "check"], cwd=tree)
    git(tree, "add", "VERSION", "RELEASE_NOTES.md")
    changed = subprocess.run(["git", "-C", str(tree), "diff", "--cached", "--quiet"])
    if changed.returncode == 0:
        raise AutomationError("automatic Lab version commit contains no changes")
    git(tree, "-c", "user.name=github-actions[bot]", "-c",
        "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        "commit", "-m", f"chore(lab): release v{version}")
    release_sha = git(tree, "rev-parse", "HEAD")
    try:
        push_main(tree)
    except AutomationError:
        # A concurrent main merge can win the fast-forward race. The next poll
        # will check its CI and create one release commit for the new main tip.
        git(tree, "fetch", REMOTE, BRANCH)
        remote_main = git(tree, "rev-parse", f"{REMOTE}/{BRANCH}")
        if not is_ancestor(tree, release_sha, remote_main):
            return None
    git(tree, "fetch", REMOTE, BRANCH, "--tags")
    state["pending"] = {
        "sourceSha": source_sha,
        "releaseSha": release_sha,
        "version": version,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
        "deployed": False,
    }
    save_state(state)
    return state["pending"]


def discover_pending(root: Path, main_sha: str) -> dict[str, Any] | None:
    if release_version_from_commit(root, main_sha) is None:
        return None
    return {
        "sourceSha": git(root, "rev-parse", f"{main_sha}^"),
        "releaseSha": main_sha,
        "version": release_version_from_commit(root, main_sha),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "attempts": 0,
        "deployed": False,
    }


def deployment_environment(sha: str) -> dict[str, str]:
    env = os.environ.copy()
    env.update({
        "ORBSTACK_MACHINE": env.get("ORBSTACK_MACHINE", "nyannyan"),
        "EXTERNAL_STORAGE_ROOT": env.get("EXTERNAL_STORAGE_ROOT", "/Volumes/Avalon"),
        "SKULD_BACKUP_ROOT": env.get("SKULD_BACKUP_ROOT", str(BACKUP_ROOT)),
        "PUBG_TELEMETRY_ARCHIVE_HOST_DIR": env.get(
            "PUBG_TELEMETRY_ARCHIVE_HOST_DIR", str(Path.home() / ".local/share/amadeus/pubg-telemetry-archive")
        ),
        "AMAD_RELEASE_STATE_DIR": str(RELEASE_STATE_ROOT),
        "LAB_AUTOMATION_VERIFIED_MAIN_SHA": sha,
    })
    return env


def deploy_pending(root: Path, pending: dict[str, Any]) -> dict[str, Any]:
    tree = checkout_for_sha(root, str(pending["releaseSha"]))
    env = deployment_environment(str(pending["releaseSha"]))
    ensure_private_dir(RELEASE_STATE_ROOT)
    log_dir = STATE_ROOT / "logs"
    ensure_private_dir(log_dir)
    log_path = log_dir / f"deploy-{str(pending['releaseSha'])[:12]}.log"
    result = subprocess.run(
        ["bash", "scripts/deploy-openclaw.sh", "--apply", "--auto-release", "--build-openclaw"],
        cwd=tree, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=21600,
    )
    log_path.write_text(result.stdout or "", encoding="utf-8")
    os.chmod(log_path, 0o600)
    if result.returncode:
        raise AutomationError(f"Lab deployment failed and rollback was requested; evidence: {log_path}")
    lines = (result.stdout or "").splitlines()
    values: dict[str, str] = {}
    for key in ("CHECKPOINT", "OPENCLAW_IMAGE"):
        for line in reversed(lines):
            if line.startswith(key + "="):
                values[key] = line.split("=", 1)[1]
                break
    if not values.get("CHECKPOINT") or not values.get("OPENCLAW_IMAGE"):
        raise AutomationError(f"Lab deployment succeeded without checkpoint/image evidence: {log_path}")
    return {"image": values["OPENCLAW_IMAGE"], "checkpoint": values["CHECKPOINT"], "log": str(log_path)}


def ensure_release_manifest(root: Path, pending: dict[str, Any]) -> None:
    deployment = pending.get("deployment") or {}
    checkpoint = str(deployment.get("checkpoint", ""))
    if not checkpoint:
        raise AutomationError("deployed Lab release has no protected checkpoint reference")
    tree = checkout_for_sha(root, str(pending["releaseSha"]))
    env = deployment_environment(str(pending["releaseSha"]))
    runtime_path = STATE_ROOT / f"runtime-{str(pending['releaseSha'])[:12]}.json"
    snapshot = command(["python3", "scripts/lab-runtime-snapshot.py", "--service", "openclaw"], cwd=tree,
                       env=env, timeout=120)
    runtime_path.write_text(snapshot + "\n", encoding="utf-8")
    os.chmod(runtime_path, 0o600)
    manifest_path = RELEASE_STATE_ROOT / f"lab-lab-maintainer-{str(pending['releaseSha'])[:12]}-released.json"
    if manifest_path.exists():
        deployment["manifest"] = str(manifest_path)
        pending["deployment"] = deployment
        return
    command([
        "python3", "scripts/release-state.py", "compose",
        "--product", "lab", "--environment", "lab-maintainer", "--status", "released",
        "--version", str(pending["version"]), "--git-sha", str(pending["releaseSha"]),
        "--runtime", str(runtime_path), "--checkpoint-ref", checkpoint,
        "--actor", "lab-main-auto-release", "--approval-ref", "main-ci:" + str(pending["releaseSha"])[:12],
        "--validation-ref", checkpoint + "/validation",
        "--release-tag", "lab/v" + str(pending["version"]), "--output", str(manifest_path), "--apply",
    ], cwd=tree, env=env, timeout=120)
    deployment["manifest"] = str(manifest_path)
    pending["deployment"] = deployment


def publish_release(root: Path, pending: dict[str, Any], deployment: dict[str, str]) -> None:
    tree = checkout_for_sha(root, str(pending["releaseSha"]))
    tag = f"lab/v{pending['version']}"
    existing = git(tree, "rev-parse", "--verify", f"refs/tags/{tag}", check=False)
    if existing:
        existing_sha = git(tree, "rev-list", "-n", "1", tag)
        if existing_sha != pending["releaseSha"]:
            raise AutomationError(f"refusing to move existing product tag {tag}")
    else:
        git(tree, "tag", "-a", tag, pending["releaseSha"], "-m", f"Lab {pending['version']} release")
    result = subprocess.run(["git", "-C", str(tree), "push", REMOTE, f"refs/tags/{tag}"],
                           text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode and ("timed out" in (result.stderr or "").lower() or "timeout" in (result.stderr or "").lower()):
        result = subprocess.run(["git", "-C", str(tree), "-c", "http.proxy=http://127.0.0.1:7897",
                                 "push", REMOTE, f"refs/tags/{tag}"], text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise AutomationError(f"Lab product tag push failed ({result.returncode})")
    release_exists = subprocess.run(["gh", "release", "view", tag, "--repo", REPOSITORY],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not release_exists:
        command(["gh", "release", "create", tag, "--repo", REPOSITORY,
                 "--title", f"Lab v{pending['version']}", "--notes-file", str(tree / "RELEASE_NOTES.md")],
                cwd=tree, timeout=120)
    pending["deployed"] = True
    pending["deployment"] = deployment
    pending["releasedAt"] = datetime.now(timezone.utc).isoformat()


def release_once(root: Path) -> None:
    ensure_private_dir(STATE_ROOT)
    lock_path = STATE_ROOT / ".lock"
    if lock_path.is_symlink():
        raise AutomationError("Lab auto-release lock path must not be a symlink")
    descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    if os.fstat(descriptor).st_mode & 0o077:
        os.close(descriptor)
        raise AutomationError("Lab auto-release lock must have mode 0600")
    lock = os.fdopen(descriptor, "r+")
    try:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        print("LAB_AUTO_RELEASE=already_running")
        return
    try:
        source_root = root
        main_sha = fetch_main(source_root)
        state = load_state()
        if state is None:
            state = {"schema": "lab-main-auto-release/v1", "baselineSha": main_sha,
                     "lastProcessedMainSha": main_sha, "pending": None}
            save_state(state)
            print("LAB_AUTO_RELEASE=initialized")
            return
        worktree = managed_worktree(source_root, refresh=True)
        # Always execute the worker version from current main. The LaunchAgent
        # may still point to the worktree that was used to install it.
        worker = worktree / "scripts/lab-auto-release.py"
        current_script = Path(__file__).resolve()
        if worker.is_file() and worker.resolve() != current_script and os.environ.get("LAB_AUTO_RELEASE_MANAGED") != "1":
            env = os.environ.copy()
            env["LAB_AUTO_RELEASE_MANAGED"] = "1"
            output = command([sys.executable, str(worker), "once"], cwd=worktree, env=env, timeout=21600)
            if output:
                print(output)
            return
        if os.environ.get("LAB_AUTO_RELEASE_MANAGED") == "1":
            source_root = worktree
            main_sha = git(source_root, "rev-parse", f"{REMOTE}/{BRANCH}")
        pending = state.get("pending")
        if pending is None:
            release_version = release_version_from_commit(source_root, main_sha)
            if release_version is not None and not state.get("lastProcessedMainSha") == main_sha:
                pending = discover_pending(source_root, main_sha)
                state["pending"] = pending
                save_state(state)
            elif main_sha == state.get("lastProcessedMainSha"):
                print("LAB_AUTO_RELEASE=up_to_date")
                return
            else:
                previous_sha = str(state.get("lastProcessedMainSha", state.get("baselineSha", "")))
                if not lab_source_changes(source_root, previous_sha, main_sha):
                    state["lastProcessedMainSha"] = main_sha
                    save_state(state)
                    print("LAB_AUTO_RELEASE=ignored_no_lab_changes sha=" + main_sha[:12])
                    return
                pending = prepare_release(source_root, main_sha, state)
                if pending is None:
                    print("LAB_AUTO_RELEASE=retry_release_preparation sha=" + main_sha[:12])
                    return
                print(f"LAB_RELEASE_COMMIT={pending['releaseSha'][:12]} VERSION={pending['version']}")
                return
        if pending is None:
            return
        release_sha = str(pending["releaseSha"])
        # GitHub checks never hold a personal Lab release.
        if not pending.get("deployed"):
            if int(pending.get("attempts", 0)) >= MAX_DEPLOY_ATTEMPTS:
                print("LAB_AUTO_RELEASE=deployment_stopped_after_rollbacks sha=" + release_sha[:12])
                return
            pending["attempts"] = int(pending.get("attempts", 0)) + 1
            pending["lastAttemptAt"] = datetime.now(timezone.utc).isoformat()
            state["pending"] = pending
            save_state(state)
            try:
                deployment = deploy_pending(source_root, pending)
            except AutomationError as exc:
                print("LAB_AUTO_RELEASE=deployment_failed sha=" + release_sha[:12] + " detail=" + str(exc))
                return
            pending["deployed"] = True
            pending["deployment"] = deployment
            state["pending"] = pending
            save_state(state)
            print("LAB_AUTO_RELEASE=live_verified sha=" + release_sha[:12])
        try:
            ensure_release_manifest(source_root, pending)
            state["pending"] = pending
            save_state(state)
        except AutomationError as exc:
            print("LAB_AUTO_RELEASE=manifest_pending sha=" + release_sha[:12] + " detail=" + str(exc))
            return
        publish_release(source_root, pending, pending.get("deployment", {}))
        state["lastProcessedMainSha"] = release_sha
        state["pending"] = None
        save_state(state)
        print(f"LAB_AUTO_RELEASE=released sha={release_sha[:12]} version={pending['version']}")
    finally:
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        lock.close()


def install(root: Path, baseline_sha: str | None) -> None:
    if subprocess.run(["hostname", "-s"], text=True, capture_output=True).stdout.strip() != "Amadeus-M204":
        raise AutomationError("Lab auto-release timer can only be installed on M204")
    main_sha = fetch_main(root)
    baseline_sha = baseline_sha or main_sha
    if not is_ancestor(root, baseline_sha, main_sha):
        raise AutomationError("Lab timer baseline must be an ancestor of current main")
    ensure_private_dir(STATE_ROOT)
    if load_state() is None:
        save_state({"schema": "lab-main-auto-release/v1", "baselineSha": baseline_sha,
                    "lastProcessedMainSha": baseline_sha, "pending": None})
    launch_agents = Path.home() / "Library/LaunchAgents"
    launch_agents.mkdir(parents=True, exist_ok=True)
    plist_path = launch_agents / f"{LABEL}.plist"
    if plist_path.is_symlink():
        raise AutomationError("Lab auto-release LaunchAgent path must not be a symlink")
    timer_root = managed_worktree(root, refresh=True)
    logs = Path.home() / "Library/Logs/Amadeus"
    logs.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(logs, 0o700)
    env = {
        "HOME": str(Path.home()),
        "PATH": "/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "ORBSTACK_MACHINE": "nyannyan",
        "EXTERNAL_STORAGE_ROOT": "/Volumes/Avalon",
        "SKULD_BACKUP_ROOT": str(BACKUP_ROOT),
        "PUBG_TELEMETRY_ARCHIVE_HOST_DIR": str(Path.home() / ".local/share/amadeus/pubg-telemetry-archive"),
        "AMAD_RELEASE_STATE_DIR": str(RELEASE_STATE_ROOT),
    }
    # GitHub may only be reachable through a local proxy; the timer inherits the one set at install time.
    for name in ("https_proxy", "http_proxy", "all_proxy", "no_proxy", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"):
        if os.environ.get(name):
            env[name] = os.environ[name]
    document = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(timer_root / "scripts/lab-auto-release.py"), "once"],
        "WorkingDirectory": str(timer_root),
        "EnvironmentVariables": env,
        "StartInterval": CHECK_INTERVAL_SECONDS,
        "RunAtLoad": True,
        "StandardOutPath": str(logs / "lab-auto-release.log"),
        "StandardErrorPath": str(logs / "lab-auto-release-error.log"),
    }
    with plist_path.open("wb") as stream:
        plistlib.dump(document, stream)
    os.chmod(plist_path, 0o600)
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    command(["launchctl", "bootstrap", domain, str(plist_path)], cwd=root)
    print("LAB_AUTO_RELEASE_TIMER=installed interval_seconds=" + str(CHECK_INTERVAL_SECONDS))
    print("LAB_AUTO_RELEASE_BASELINE=" + baseline_sha[:12])


def uninstall() -> None:
    plist_path = Path.home() / f"Library/LaunchAgents/{LABEL}.plist"
    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{LABEL}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    plist_path.unlink(missing_ok=True)
    print("LAB_AUTO_RELEASE_TIMER=removed state_and_backups=preserved")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("once", "install", "uninstall", "status"))
    parser.add_argument("--baseline-sha")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.operation == "install":
        install(root, args.baseline_sha)
    elif args.operation == "uninstall":
        uninstall()
    elif args.operation == "status":
        state = load_state()
        if state is None:
            print("LAB_AUTO_RELEASE_STATE=missing")
        else:
            pending = state.get("pending") or {}
            print("LAB_AUTO_RELEASE_STATE=ready")
            print("LAST_PROCESSED_MAIN_SHA=" + str(state.get("lastProcessedMainSha", "unknown"))[:12])
            if pending:
                print("PENDING_RELEASE_SHA=" + str(pending.get("releaseSha", "unknown"))[:12])
                print("PENDING_RELEASE_VERSION=" + str(pending.get("version", "unknown")))
    else:
        release_once(root)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AutomationError, OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
        print("LAB_AUTO_RELEASE=error detail=" + str(exc), file=sys.stderr)
        raise SystemExit(1)
