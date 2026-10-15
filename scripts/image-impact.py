#!/usr/bin/env python3
"""Conservatively map Git changes to the images that consume build inputs."""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOCKERFILES = {
    "openclaw": "infra/docker/casaos/openclaw/Dockerfile",
    "radar": "apps/product-radar/Dockerfile",
    "gate": "apps/pubg-saas/Dockerfile",
}
WORKSPACE_GLOBALS = {".dockerignore", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"}
IMAGE_ROOT_PACKAGES = {
    "openclaw": ("plugins/amadeus", "plugins/pubg"),
    "radar": ("apps/product-radar",),
    "gate": ("apps/pubg-saas",),
}


class AnalysisError(Exception):
    pass


def git_names(repo: Path, base: str, head: str) -> list[str]:
    changed: set[str] = set()
    commands = [
        ["git", "-C", str(repo), "diff", "--name-only", "--no-renames", f"{base}..{head}"],
        ["git", "-C", str(repo), "diff", "--name-only", "--no-renames", "HEAD"],
        ["git", "-C", str(repo), "diff", "--cached", "--name-only", "--no-renames"],
        ["git", "-C", str(repo), "ls-files", "--others", "--exclude-standard"],
    ]
    for command in commands:
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode:
            raise AnalysisError(result.stderr.strip() or "git diff failed")
        changed.update(line for line in result.stdout.splitlines() if line)
    return sorted(changed)


def logical_instructions(text: str) -> list[tuple[str, str]]:
    instructions: list[tuple[str, str]] = []
    pending = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        pending = f"{pending} {line[:-1].rstrip()}" if line.endswith("\\") else f"{pending} {line}"
        if line.endswith("\\"):
            continue
        match = re.match(r"^([A-Za-z]+)\s+(.*)$", pending.strip())
        if match:
            instructions.append((match.group(1).upper(), match.group(2).strip()))
        pending = ""
    if pending.strip():
        raise AnalysisError("Dockerfile ends with an incomplete continuation")
    return instructions


def copy_sources(argument: str) -> tuple[list[str], bool]:
    """Return local COPY sources and whether the instruction was understood."""
    try:
        if argument.startswith("["):
            parts = json.loads(argument)
            if not isinstance(parts, list) or len(parts) < 2 or not all(isinstance(x, str) for x in parts):
                return [], False
            words = parts
        else:
            words = shlex.split(argument, comments=True, posix=True)
    except (json.JSONDecodeError, ValueError):
        return [], False
    while words and words[0].startswith("--"):
        if words[0].startswith("--from="):
            return [], True
        words.pop(0)
    if len(words) < 2:
        return [], False
    sources = words[:-1]
    local_sources: list[str] = []
    for source in sources:
        if source.startswith(("http://", "https://", "git@")):
            continue
        if "$" in source or source.startswith("/"):
            return [], False
        local_sources.append(source.removeprefix("./").rstrip("/"))
    return local_sources, True


def docker_inputs(repo: Path, dockerfile: str) -> tuple[list[str], bool]:
    path = repo / dockerfile
    if not path.is_file():
        return [], False
    try:
        instructions = logical_instructions(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, AnalysisError):
        return [], False
    sources: list[str] = []
    understood = True
    for opcode, argument in instructions:
        if opcode in {"COPY", "ADD"}:
            local, ok = copy_sources(argument)
            sources.extend(local)
            understood &= ok
        elif opcode == "RUN" and "--mount=type=bind" in argument:
            mounts = re.findall(r"--mount=([^\s]+)", argument)
            for mount in mounts:
                fields = dict(
                    item.split("=", 1) for item in mount.split(",") if "=" in item
                )
                if fields.get("type") != "bind":
                    continue
                if fields.get("from"):
                    continue
                source = fields.get("source", fields.get("src"))
                if not source or "$" in source or source.startswith("/"):
                    understood = False
                else:
                    sources.append(source.removeprefix("./").rstrip("/"))
    return sources, understood and bool(sources)


def under(path: str, source: str) -> bool:
    if not source:
        return True
    if any(token in source for token in "*?["):
        if fnmatch.fnmatchcase(path, source):
            return True
        # Docker COPY globs can name a directory and copy its descendants.
        prefix = source.split("*", 1)[0].split("?", 1)[0].split("[", 1)[0].rstrip("/")
        return bool(prefix and (path == prefix or path.startswith(prefix + "/")))
    return path == source or path.startswith(source + "/")


def package_graph(repo: Path) -> tuple[dict[str, Path], dict[str, set[str]]]:
    by_name: dict[str, Path] = {}
    dependencies: dict[str, set[str]] = {}
    for manifest_path in repo.rglob("package.json"):
        if any(part in {"node_modules", ".git", "dist", "build", ".next"} for part in manifest_path.parts):
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
        name = manifest.get("name")
        if not isinstance(name, str):
            continue
        relative = manifest_path.parent.relative_to(repo).as_posix()
        by_name[name] = Path(relative)
        names: set[str] = set()
        for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
            entries = manifest.get(section, {})
            if isinstance(entries, dict):
                names.update(key for key, value in entries.items() if isinstance(value, str) and value.startswith("workspace:"))
        dependencies[name] = names
    return by_name, dependencies


def package_roots(repo: Path, target: str, by_name: dict[str, Path]) -> set[str]:
    result: set[str] = set()
    for package_dir in IMAGE_ROOT_PACKAGES[target]:
        manifest_path = repo / package_dir / "package.json"
        try:
            package_name = json.loads(manifest_path.read_text(encoding="utf-8")).get("name")
        except (OSError, UnicodeError, json.JSONDecodeError):
            raise AnalysisError(f"cannot read workspace root package: {package_dir}/package.json")
        if not isinstance(package_name, str) or package_name not in by_name:
            raise AnalysisError(f"workspace package is not indexed: {package_dir}")
        result.add(package_name)
    return result


def workspace_closure(repo: Path, target: str, by_name: dict[str, Path], dependencies: dict[str, set[str]]) -> set[Path]:
    pending = list(package_roots(repo, target, by_name))
    visited: set[str] = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        pending.extend(dependencies.get(name, set()) - visited)
    return {by_name[name] for name in visited if name in by_name}


def classify(repo: Path, target: str, changed: list[str]) -> tuple[str, list[str]]:
    if target not in DOCKERFILES:
        raise AnalysisError(f"unknown image target: {target}")
    dockerfile = DOCKERFILES[target]
    source_paths, parsed = docker_inputs(repo, dockerfile)
    if not parsed:
        return "UNKNOWN", [f"cannot prove complete build context for {dockerfile}"]

    reasons: list[str] = []
    try:
        by_name, dependencies = package_graph(repo)
        closure = workspace_closure(repo, target, by_name, dependencies)
    except AnalysisError as error:
        return "UNKNOWN", [str(error)]

    for path in changed:
        if path in WORKSPACE_GLOBALS:
            reasons.append(f"workspace/build global changed: {path}")
            continue
        if path == dockerfile or path.startswith(dockerfile + "/"):
            reasons.append(f"image Dockerfile input changed: {path}")
            continue
        if path == "scripts/image-impact.py":
            reasons.append("image impact analyzer changed; rebuild conservatively")
            continue
        if any(under(path, source) for source in source_paths):
            reasons.append(f"Dockerfile COPY/RUN input changed: {path}")
            continue
        package_owner = next((directory for directory in closure if under(path, directory.as_posix())), None)
        if package_owner is not None:
            reasons.append(f"workspace dependency changed: {path} ({package_owner})")
            continue
        if path.endswith("/package.json") or path == "package.json":
            reasons.append(f"unresolved package metadata change: {path}")
            return "UNKNOWN", reasons
    return ("REBUILD", reasons) if reasons else ("REUSE", ["no changed input is consumed by this image"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--target", choices=sorted(DOCKERFILES), required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--base", help="compare base..HEAD in Git")
    source.add_argument("--files", nargs="+", help="classify an explicit path fixture")
    args = parser.parse_args()
    repo = args.repo.resolve()
    try:
        changed = args.files if args.files is not None else git_names(repo, args.base, "HEAD")
        state, reasons = classify(repo, args.target, changed)
    except (AnalysisError, OSError) as error:
        print(f"IMAGE_IMPACT=UNKNOWN\nREASON={error}")
        return 0
    print(f"IMAGE_IMPACT={state}")
    for reason in reasons:
        print(f"REASON={reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
