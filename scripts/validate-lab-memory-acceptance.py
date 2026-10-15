#!/usr/bin/env python3
"""Validate external P1 live-evidence before a formal Lab release."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


SOURCE_FILES = (
    "infra/docker/casaos/openclaw/Dockerfile",
    "integrations/openclaw/openclaw.json.example",
    "scripts/openclaw_prepare.py",
    "scripts/patch-openclaw-memory-core.mjs",
)
REQUIRED_CHECKS = (
    "pluginLoaded",
    "embeddingVerified",
    "keywordFtsVerified",
    "semanticKnnVerified",
    "hybridSearchVerified",
    "incrementalRefreshVerified",
    "restartPersistenceVerified",
    "dreamingRunVerified",
    "dreamingPersistenceVerified",
    "sessionIsolationVerified",
)


class AcceptanceError(Exception):
    pass


def validate(document: Any, repo: Path, head: str) -> None:
    if not isinstance(document, dict) or document.get("schema") != "lab-memory-acceptance/v1":
        raise AcceptanceError("unsupported Lab Memory Core acceptance schema")
    if document.get("status") != "LIVE_VERIFIED":
        raise AcceptanceError("P1 live evidence status is not LIVE_VERIFIED")
    source_sha = document.get("sourceCommit")
    if not isinstance(source_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise AcceptanceError("sourceCommit must be a full lowercase Git SHA")
    for field in ("evidenceRef", "embeddingModel"):
        if not isinstance(document.get(field), str) or not document[field].strip():
            raise AcceptanceError(f"{field} must be a non-secret evidence identifier")
        if re.search(r"(?i)(token|secret|password|api[_-]?key|bearer)", document[field]):
            raise AcceptanceError(f"{field} must be a non-secret evidence identifier")
    digest = document.get("runtimeImageDigest")
    if not isinstance(digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise AcceptanceError("runtimeImageDigest must be a sha256 digest")
    observed = document.get("observedAt")
    if not isinstance(observed, str):
        raise AcceptanceError("observedAt must be a timezone-aware timestamp")
    try:
        parsed = datetime.fromisoformat(observed.replace("Z", "+00:00"))
    except ValueError as error:
        raise AcceptanceError("observedAt must be a timezone-aware timestamp") from error
    if parsed.tzinfo is None:
        raise AcceptanceError("observedAt must include a timezone")
    checks = document.get("checks")
    if not isinstance(checks, dict):
        raise AcceptanceError("checks must be an object")
    failed = [key for key in REQUIRED_CHECKS if checks.get(key) is not True]
    if failed:
        raise AcceptanceError("required live checks are incomplete: " + ",".join(failed))
    ancestor = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", source_sha, head],
        capture_output=True,
        text=True,
        check=False,
    )
    if ancestor.returncode:
        raise AcceptanceError("accepted runtime source is not an ancestor of the proposed release source")
    changed = subprocess.run(
        ["git", "-C", str(repo), "diff", "--quiet", f"{source_sha}..{head}", "--", *SOURCE_FILES],
        capture_output=True,
        text=True,
        check=False,
    )
    if changed.returncode != 0:
        raise AcceptanceError("Memory Core runtime source changed after the accepted runtime source")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("acceptance", type=Path)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--head", default="HEAD")
    args = parser.parse_args()
    path = args.acceptance.expanduser()
    repo = args.repo.resolve()
    if path.is_symlink() or not path.is_file():
        print("LAB_MEMORY_ACCEPTANCE_ERROR=external evidence must be a regular non-symlink file", file=sys.stderr)
        return 2
    resolved = path.resolve()
    if resolved == repo or repo in resolved.parents:
        print("LAB_MEMORY_ACCEPTANCE_ERROR=evidence must remain outside Git", file=sys.stderr)
        return 2
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
        full_head = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--verify", f"{args.head}^{{commit}}"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        validate(document, repo, full_head)
    except (OSError, UnicodeError, json.JSONDecodeError, subprocess.CalledProcessError, AcceptanceError) as error:
        print(f"LAB_MEMORY_ACCEPTANCE_ERROR={error}", file=sys.stderr)
        return 2
    print(f"LAB_MEMORY_ACCEPTANCE=LIVE_VERIFIED sourceCommit={document['sourceCommit']} evidenceRef={document['evidenceRef']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
