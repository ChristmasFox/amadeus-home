#!/usr/bin/env python3
"""Offline fixtures for scripts/sync-main-deps.sh (fake pnpm / launchctl, a throwaway git checkout)."""

from __future__ import annotations

import os
import stat
import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "sync-main-deps.sh"


def run(root: Path, bin_dir: Path, *args: str, fail_install: bool = False) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update({"PNPM_BIN": str(bin_dir / "pnpm"), "LAUNCHCTL_BIN": str(bin_dir / "launchctl"),
                "FAKE_LOG": str(bin_dir / "calls.log"), "FAKE_FAIL": "1" if fail_install else "0"})
    return subprocess.run(["bash", str(SCRIPT), *args, str(root)], text=True, capture_output=True, env=env)


def calls(bin_dir: Path) -> list[str]:
    log = bin_dir / "calls.log"
    return log.read_text().splitlines() if log.exists() else []


with tempfile.TemporaryDirectory(prefix="sync-deps-") as tmp:
    tmp_path = Path(tmp)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name in ("pnpm", "launchctl"):
        fake = bin_dir / name
        fake.write_text(
            '#!/usr/bin/env bash\n'
            'echo "$(basename "$0") $*" >> "$FAKE_LOG"\n'
            'if [[ "$(basename "$0")" == pnpm && "$FAKE_FAIL" == 1 ]]; then exit 1; fi\n'
            'if [[ "$(basename "$0")" == pnpm ]]; then mkdir -p node_modules/.pnpm; fi\n'
        )
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    root = tmp_path / "checkout"
    (root / "apps/web").mkdir(parents=True)
    (root / "pnpm-lock.yaml").write_text("lock v1\n")
    (root / "pnpm-workspace.yaml").write_text("packages: [apps/*]\n")
    (root / "package.json").write_text('{"name":"root"}\n')
    (root / "apps/web/package.json").write_text('{"name":"web","dependencies":{"a":"1.0.0"}}\n')
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)

    # 1. nothing installed yet: it installs, with the frozen lockfile.
    first = run(root, bin_dir)
    assert first.returncode == 0, first.stderr
    assert "DEPS_SYNC=installed" in first.stdout
    assert calls(bin_dir) == ["pnpm install --frozen-lockfile"], calls(bin_dir)

    # 2. nothing changed: no second install.
    again = run(root, bin_dir)
    assert "DEPS_SYNC=up_to_date" in again.stdout and len(calls(bin_dir)) == 1

    # 3. a workspace package's dependency changed (the case that broke the PUBG site): it installs again.
    (root / "apps/web/package.json").write_text('{"name":"web","dependencies":{"a":"1.0.1"}}\n')
    changed = run(root, bin_dir)
    assert "DEPS_SYNC=installed" in changed.stdout and len(calls(bin_dir)) == 2

    # 4. the lockfile changed: installs again; and with --restart the service is restarted, after the install.
    (root / "pnpm-lock.yaml").write_text("lock v2\n")
    restarted = run(root, bin_dir, "--restart", "com.example.service")
    assert "DEPS_SYNC_RESTARTED=com.example.service" in restarted.stdout, restarted.stdout
    log = calls(bin_dir)
    assert log[2] == "pnpm install --frozen-lockfile" and log[3].startswith("launchctl kickstart -k gui/") and log[3].endswith("com.example.service")

    # 5. no restart when nothing was installed.
    quiet = run(root, bin_dir, "--restart", "com.example.service")
    assert "up_to_date" in quiet.stdout and len(calls(bin_dir)) == 4

    # 6. a failed install fails the script, leaves the stamp alone and does not restart anything; the next call retries.
    (root / "pnpm-lock.yaml").write_text("lock v3\n")
    bad = run(root, bin_dir, "--restart", "com.example.service", fail_install=True)
    assert bad.returncode != 0 and "DEPS_SYNC_RESTARTED" not in bad.stdout
    retry = run(root, bin_dir)
    assert retry.returncode == 0 and "DEPS_SYNC=installed" in retry.stdout

    # 7. node_modules missing entirely (a fresh checkout) installs even if a stamp somehow survives.
    subprocess.run(["rm", "-rf", str(root / "node_modules")], check=True)
    fresh = run(root, bin_dir)
    assert "DEPS_SYNC=installed" in fresh.stdout

    # 8. a stale lock directory from a dead run does not block it forever.
    lock_dir = root / "node_modules/.amadeus-deps-lock"
    lock_dir.mkdir()
    old = 1_600_000_000
    os.utime(lock_dir, (old, old))
    (root / "pnpm-lock.yaml").write_text("lock v4\n")
    stale = run(root, bin_dir)
    assert stale.returncode == 0 and "DEPS_SYNC=installed" in stale.stdout

print("sync-main-deps fixtures passed")
