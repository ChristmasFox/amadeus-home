"""Build an isolated pinned OpenClaw CLI tree with source-owned patches applied."""

from __future__ import annotations

from pathlib import Path
import shutil
import subprocess


def patch_pinned_runtime_tree(source_dist: Path, destination: Path, root: Path) -> Path:
    """Patch a temporary 2026.9.4 tree so CLI validation sees the image schema."""
    destination.mkdir(parents=True)
    shutil.copytree(source_dist / "extensions", destination / "extensions")
    patched_prefixes = ("session-ingestion-", "dreaming-phases-", "session-backfill-")
    for item in source_dist.iterdir():
        if item.name == "extensions" or item.name.startswith(patched_prefixes):
            continue
        (destination / item.name).symlink_to(item.resolve(), target_is_directory=item.is_dir())
    for pattern in ("session-ingestion-*.mjs", "dreaming-phases-*.mjs", "session-backfill-*.mjs"):
        for item in source_dist.glob(pattern):
            shutil.copy2(item, destination / item.name)
    manager_runtime = source_dist / "extensions/memory-core/manager-runtime.js"
    shutil.copy2(manager_runtime, destination / "extensions/memory-core/manager-runtime.js")
    patch = subprocess.run(
        ["node", str(root / "scripts/patch-openclaw-memory-core.mjs"), "--core-root", str(destination), "--apply"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    if "backfill_peer_filter=ready" not in patch.stdout:
        raise AssertionError("pinned OpenClaw patch did not report the session-backfill admission gate")
    subprocess.run(
        ["node", str(root / "scripts/patch-openclaw-memory-core.mjs"), "--core-root", str(destination), "--apply"],
        cwd=root,
        capture_output=True,
        text=True,
        check=True,
    )
    targets = [destination / "extensions/memory-core/manager-runtime.js"]
    targets.extend(destination.glob("session-ingestion-*.mjs"))
    targets.extend(destination.glob("session-backfill-*.mjs"))
    for target in targets:
        subprocess.run(["node", "--check", str(target)], cwd=root, capture_output=True, text=True, check=True)
    return destination / "extensions"
