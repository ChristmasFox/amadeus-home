#!/usr/bin/env python3
"""Regression tests for seed-only OpenClaw workspace behavior."""

from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("openclaw_prepare", ROOT / "scripts/openclaw_prepare.py")
prepare = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = prepare
spec.loader.exec_module(prepare)
prepare.ensure_owner = lambda path, mode=0o600: os.chmod(path, mode)

seed_paths = {
    "AGENTS.md": ROOT / "integrations/openclaw/workspace-seed/AGENTS.seed.md",
    "SOUL.md": ROOT / "integrations/openclaw/workspace-seed/SOUL.seed.md",
    "USER.md": ROOT / "integrations/openclaw/workspace-seed/USER.seed.md",
    "MEMORY.md": ROOT / "integrations/openclaw/workspace-seed/MEMORY.seed.md",
}
seeds = {name: path.read_bytes() for name, path in seed_paths.items()}


def run_sync(workspace: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ, OPENCLAW_WORKSPACE_DIR=str(workspace))
    return subprocess.run(
        [sys.executable, str(ROOT / "scripts/openclaw-workspace-sync.py"), *arguments],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )


with tempfile.TemporaryDirectory(prefix="openclaw-workspace-test-") as temporary:
    base = Path(temporary)

    fresh = base / "fresh"
    created, preserved = prepare.seed_workspace_missing_only(fresh, seeds)
    assert (created, preserved) == (4, 0)
    assert {name: (fresh / name).read_bytes() for name in seeds} == seeds

    runtime = base / "runtime"
    runtime.mkdir(mode=0o751)
    existing_bytes = {}
    existing_modes = {}
    for index, name in enumerate(seeds):
        target = runtime / name
        content = f"restored runtime {name}\n".encode()
        target.write_bytes(content)
        target.chmod(0o600 + index)
        existing_bytes[name] = content
        existing_modes[name] = stat.S_IMODE(target.stat().st_mode)
    nested = runtime / "memory" / "2026-09-22.md"
    nested.parent.mkdir()
    nested.write_text("runtime-created memory must survive\n")
    workspace_mode = stat.S_IMODE(runtime.stat().st_mode)
    created, preserved = prepare.seed_workspace_missing_only(runtime, seeds)
    assert (created, preserved) == (0, 4)
    assert {name: (runtime / name).read_bytes() for name in seeds} == existing_bytes
    assert {name: stat.S_IMODE((runtime / name).stat().st_mode) for name in seeds} == existing_modes
    assert stat.S_IMODE(runtime.stat().st_mode) == workspace_mode
    assert nested.read_text() == "runtime-created memory must survive\n"

    symlink_workspace = base / "symlink-workspace"
    symlink_workspace.mkdir()
    link_target = base / "link-target.md"
    link_target.write_text("keep target\n")
    os.symlink(link_target, symlink_workspace / "SOUL.md")
    prepare.seed_workspace_missing_only(symlink_workspace, seeds)
    assert (symlink_workspace / "SOUL.md").is_symlink()
    assert os.readlink(symlink_workspace / "SOUL.md") == str(link_target)
    assert link_target.read_text() == "keep target\n"

    directory_workspace = base / "directory-workspace"
    directory_workspace.mkdir()
    runtime_directory = directory_workspace / "MEMORY.md"
    runtime_directory.mkdir()
    (runtime_directory / "keep.txt").write_text("keep runtime directory\n")
    prepare.seed_workspace_missing_only(directory_workspace, seeds)
    assert runtime_directory.is_dir()
    assert (runtime_directory / "keep.txt").read_text() == "keep runtime directory\n"

    workspace_target = base / "workspace-target"
    workspace_target.mkdir()
    workspace_link = base / "workspace-link"
    workspace_link.symlink_to(workspace_target, target_is_directory=True)
    try:
        prepare.seed_workspace_missing_only(workspace_link, seeds)
    except SystemExit:
        pass
    else:
        raise AssertionError("symlink runtime workspace must fail closed")
    assert list(workspace_target.iterdir()) == []

    plan_workspace = base / "sync-plan"
    plan_workspace.mkdir()
    (plan_workspace / "SOUL.md").write_text("runtime soul\n")
    before = (plan_workspace / "SOUL.md").read_bytes()
    planned = run_sync(plan_workspace)
    assert planned.returncode == 0, planned.stderr
    assert "SEED_SHA256=" in planned.stdout and "RUNTIME_SHA256=" in planned.stdout
    assert "runtime/SOUL.md" in planned.stdout and "seed/SOUL.md" in planned.stdout
    assert "SYNC_MODE=plan-only" in planned.stdout
    assert (plan_workspace / "SOUL.md").read_bytes() == before

    unapproved = run_sync(plan_workspace, "--apply")
    assert unapproved.returncode != 0
    assert (plan_workspace / "SOUL.md").read_bytes() == before

    bulk = run_sync(plan_workspace, "--apply", "--approve-file", "SOUL.md", "--approve-file", "USER.md")
    assert bulk.returncode != 0
    assert (plan_workspace / "SOUL.md").read_bytes() == before

    applied = run_sync(plan_workspace, "--apply", "--approve-file", "SOUL.md")
    assert applied.returncode == 0, applied.stderr
    assert "SYNC_APPLIED_FILE=SOUL.md" in applied.stdout
    assert (plan_workspace / "SOUL.md").read_bytes() == seeds["SOUL.md"]

print("OPENCLAW_WORKSPACE_SEED_TEST=passed")
