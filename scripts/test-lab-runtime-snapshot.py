#!/usr/bin/env python3
"""Keep Lab runtime snapshot queries bounded and shell-free."""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "lab_runtime_snapshot", ROOT / "scripts" / "lab-runtime-snapshot.py"
)
assert SPEC and SPEC.loader
snapshot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(snapshot)

original_subprocess_run = snapshot.subprocess.run
commands: list[list[str]] = []


def fake_command(command, **kwargs):
    commands.append(command)
    assert kwargs.get("timeout") == snapshot.QUERY_TIMEOUT_SECONDS
    return subprocess.CompletedProcess(command, 0, "d" * 64 + "  /protected/file\n", "")


snapshot.subprocess.run = fake_command
try:
    assert snapshot.config_digest("nyannyan", "/DATA/AppData/openclaw/config/openclaw.json") == "sha256:" + "d" * 64
    assert snapshot.compose_digest("nyannyan", "/var/lib/casaos/apps/openclaw/docker-compose.yml") == "sha256:" + "d" * 64
finally:
    snapshot.subprocess.run = original_subprocess_run

assert commands == [
    ["orb", "-m", "nyannyan", "-u", "root", "sha256sum", "--", "/DATA/AppData/openclaw/config/openclaw.json"],
    ["orb", "-m", "nyannyan", "-u", "root", "sha256sum", "--", "/var/lib/casaos/apps/openclaw/docker-compose.yml"],
]


def timed_out_command(command, **kwargs):
    raise subprocess.TimeoutExpired(command, kwargs["timeout"])


snapshot.subprocess.run = timed_out_command
try:
    try:
        snapshot.run(["orb", "-m", "nyannyan", "-u", "root", "sha256sum", "--", "/protected/file"])
    except RuntimeError as error:
        assert str(error) == "read-only Lab runtime query timed out"
    else:
        raise AssertionError("Lab runtime snapshot timeout did not fail closed")
finally:
    snapshot.subprocess.run = original_subprocess_run

print("LAB_RUNTIME_SNAPSHOT_TEST=passed direct_sha256=verified timeout=bounded")
