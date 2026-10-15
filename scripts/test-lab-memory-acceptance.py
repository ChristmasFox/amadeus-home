#!/usr/bin/env python3
"""Synthetic negative and positive checks for the P1 formal-release guard."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("memory_acceptance", ROOT / "scripts/validate-lab-memory-acceptance.py")
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


with tempfile.TemporaryDirectory(prefix="memory-acceptance-") as temporary:
    root = Path(temporary)
    repo = root / "repo"
    repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "config", "user.email", "codex@example.invalid")
    git(repo, "config", "user.name", "codex")
    for filename in module.SOURCE_FILES:
        path = repo / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("source fixture\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "accepted memory runtime")
    source_sha = git(repo, "rev-parse", "HEAD")
    accepted = {
        "schema": "lab-memory-acceptance/v1",
        "status": "LIVE_VERIFIED",
        "sourceCommit": source_sha,
        "runtimeImageDigest": "sha256:" + "f" * 64,
        "embeddingModel": "provider/model-id",
        "observedAt": "2026-10-15T08:00:00Z",
        "evidenceRef": "checkpoint/memory-acceptance-01",
        "checks": {name: True for name in module.REQUIRED_CHECKS},
    }
    module.validate(accepted, repo, source_sha)
    incomplete = {**accepted, "checks": {**accepted["checks"], "dreamingPersistenceVerified": False}}
    try:
        module.validate(incomplete, repo, source_sha)
    except module.AcceptanceError as error:
        assert "dreamingPersistenceVerified" in str(error)
    else:
        raise AssertionError("missing Dreaming persistence evidence unexpectedly passed")
    assert module.validate
    path = repo / module.SOURCE_FILES[-1]
    path.write_text("changed memory policy\n", encoding="utf-8")
    git(repo, "add", ".")
    git(repo, "commit", "-qm", "memory patch changed")
    new_head = git(repo, "rev-parse", "HEAD")
    try:
        module.validate(accepted, repo, new_head)
    except module.AcceptanceError as error:
        assert "runtime source changed" in str(error)
    else:
        raise AssertionError("changed Memory Core source unexpectedly retained old acceptance")

print("LAB_MEMORY_ACCEPTANCE_TEST=passed live-checks=required source-drift=blocked")
