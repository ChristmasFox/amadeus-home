#!/usr/bin/env python3
"""Dry-run, idempotency, customization-preservation and drift guards."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/update-openclaw-user-language.py"
OLD = "- Prefer Simplified Chinese."
NEW = "- Prefer Japanese replies by default; switch to Simplified Chinese only when explicitly requested."

with tempfile.TemporaryDirectory() as tmp:
    workspace = Path(tmp)
    target = workspace / "USER.md"
    original = f"# User preferences\n\n{OLD}\n- Keep my private custom setting.\n"
    target.write_text(original)
    env = {**os.environ, "OPENCLAW_WORKSPACE_DIR": tmp}
    def run(*args):
        return subprocess.run([sys.executable, str(SCRIPT), *args], env=env, text=True, capture_output=True)
    plan = run()
    assert plan.returncode == 0 and "USER_LANGUAGE=would-update" in plan.stdout
    assert target.read_text() == original
    applied = run("--apply")
    assert applied.returncode == 0, applied.stderr
    assert target.read_text() == original.replace(OLD, NEW)
    assert "USER_LANGUAGE=already-japanese" in run("--apply").stdout
    target.write_text("# User preferences\n- Custom language preference\n")
    refused = run("--apply")
    assert refused.returncode != 0 and "refusing overwrite" in refused.stderr
    target.unlink()
    target.symlink_to(workspace / "custom.md")
    assert run("--apply").returncode != 0
print("OPENCLAW_USER_LANGUAGE_MIGRATION=passed")
