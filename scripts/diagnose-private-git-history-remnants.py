#!/usr/bin/env python3
"""Read-only diagnostic of residual exact private text in an OFFLINE Git mirror.

Only aggregate counts leave this program. No literal values, paths, commit IDs,
replacement contents, or snippets are printed. Never runs git push or a rewrite.
"""
from __future__ import annotations

import collections
import pathlib
import subprocess
import sys

MAX_BYTES = 2_000_000


def fail(message: str) -> None:
    raise SystemExit("REMNANT_DIAGNOSTIC_ERROR=" + message)


def git(mirror: pathlib.Path, *args: str, stdin: bytes | None = None) -> bytes:
    return subprocess.run(
        ["git", "--git-dir=" + str(mirror), *args],
        input=stdin,
        capture_output=True,
        check=True,
    ).stdout


def classify_path(value: str) -> str:
    value = value.replace("\\", "/")
    if value.startswith(".agent/checkpoints/"):
        return "agent_checkpoints"
    if value.startswith(".agent/tasks/"):
        return "agent_tasks"
    if value.startswith("docs/"):
        return "documentation"
    if value.startswith("scripts/"):
        return "scripts"
    if value.startswith("infra/"):
        return "infrastructure"
    if value.startswith("apps/"):
        return "applications"
    if value.startswith("plugins/"):
        return "plugins"
    if value.startswith("packages/"):
        return "packages"
    if value.startswith("tests/"):
        return "tests"
    if value.startswith(".github/"):
        return "github_workflows"
    return "other"


def main() -> None:
    if len(sys.argv) != 3:
        fail("usage_requires_private_mirror_and_rules")
    mirror = pathlib.Path(sys.argv[1]).expanduser().resolve()
    rules = pathlib.Path(sys.argv[2]).expanduser().resolve()
    if not mirror.is_dir() or not rules.is_file() or rules.is_symlink():
        fail("invalid_private_inputs")
    try:
        if git(mirror, "remote").strip():
            fail("mirror_must_not_have_remote")
        if git(mirror, "rev-parse", "--is-bare-repository").strip() != b"true":
            fail("repository_must_be_bare")
    except subprocess.CalledProcessError:
        fail("invalid_local_git_mirror")

    original = []
    for line in rules.read_bytes().splitlines():
        if not line.startswith(b"literal:"):
            continue
        old = line[8:].split(b"==>", 1)[0]
        if old:
            original.append(old)
    if not original:
        fail("empty_private_literal_rules")

    objects = git(mirror, "rev-list", "--objects", "--all").decode(
        "utf-8", "replace"
    ).splitlines()
    seen: dict[str, str] = {}
    for line in objects:
        sha, _, path = line.partition(" ")
        seen.setdefault(sha, path)
    metadata = git(
        mirror,
        "cat-file",
        "--batch-check=%(objectname) %(objecttype) %(objectsize)",
        stdin=("\n".join(seen) + "\n").encode(),
    ).decode("ascii", "replace")

    blobs = []
    oversized = 0
    for line in metadata.splitlines():
        columns = line.split()
        if len(columns) != 3 or columns[1] != "blob":
            continue
        size = int(columns[2])
        if size > MAX_BYTES:
            oversized += 1
        else:
            blobs.append(columns[0])

    rule_counts = collections.Counter()
    group_counts = collections.Counter()
    shape_counts = collections.Counter()
    matching = 0
    for start in range(0, len(blobs), 24):
        sub = blobs[start:start + 24]
        raw = git(mirror, "cat-file", "--batch", stdin=("\n".join(sub) + "\n").encode())
        offset = 0
        for sha in sub:
            newline = raw.find(b"\n", offset)
            if newline < 0:
                fail("invalid_cat_file_batch")
            header = raw[offset:newline].split(b" ")
            if len(header) != 3 or header[1] != b"blob":
                fail("unexpected_git_object")
            length = int(header[2])
            payload = raw[newline + 1:newline + 1 + length]
            if len(payload) != length:
                fail("truncated_git_object")
            offset = newline + 1 + length + 1
            matches = [idx for idx, pattern in enumerate(original, 1) if pattern in payload]
            if not matches:
                continue
            matching += 1
            group_counts[classify_path(seen.get(sha, ""))] += 1
            shape_counts["binary_nul" if b"\0" in payload else "plain_text"] += 1
            for idx in matches:
                rule_counts[idx] += 1

    print("REMNANT_BLOBS_SCANNED=" + str(len(blobs)))
    print("REMNANT_MATCHED_BLOBS=" + str(matching))
    print("REMNANT_BINARY_NUL_BLOBS=" + str(shape_counts["binary_nul"]))
    print("REMNANT_PLAIN_TEXT_BLOBS=" + str(shape_counts["plain_text"]))
    print("REMNANT_OVERSIZED_BLOBS_NOT_SCANNED=" + str(oversized))
    for idx in range(1, len(original) + 1):
        print(f"REMNANT_RULE_{idx:02d}_BLOBS={rule_counts[idx]}")
    for group in (
        "agent_checkpoints", "agent_tasks", "documentation", "scripts",
        "infrastructure", "applications", "plugins", "packages",
        "tests", "github_workflows", "other",
    ):
        print("REMNANT_GROUP_" + group.upper() + "=" + str(group_counts[group]))
    print("REMNANT_PRIVATE_VALUES_PRINTED=false")
    print("REMNANT_REMOTE_PUSH=never")


if __name__ == "__main__":
    main()
