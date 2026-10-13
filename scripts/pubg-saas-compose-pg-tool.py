#!/usr/bin/env python3
"""Run PostgreSQL client tools inside one isolated PUBG SaaS Compose PG.

Install temporary symlinks named psql, pg_dump, pg_restore, createdb and
dropdb in PATH, then set the three PUBG_SAAS_PG_EXEC_* variables. PostgreSQL
credentials travel through a short-lived pgpass file on the container's /tmp
tmpfs, never in Docker arguments or process listings. This is for local
rehearsals; scheduled recovery-host backups can keep using native PG tools.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


POSTGRES_IMAGE = (
    "postgres:18.1-bookworm@sha256:"
    "cc9f4143a8d2fa8cf3749d0cb4d26ecf2d53a77a2ac807e9ebd67ae22426221a"
)
TOOL_NAMES = {"psql", "pg_dump", "pg_restore", "createdb", "dropdb"}
PROJECT_PATTERN = re.compile(r"pubg-saas-(?:m2|local|test)-[a-z0-9][a-z0-9-]{0,55}\Z")


class ToolError(Exception):
    pass


def required_config(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ToolError(f"missing local Compose setting: {name}")
    return value


def compose_base() -> tuple[list[str], str]:
    project = required_config("PUBG_SAAS_PG_EXEC_PROJECT")
    if not PROJECT_PATTERN.fullmatch(project):
        raise ToolError("Compose project must use the pubg-saas-m2/local/test namespace")
    compose_file = Path(required_config("PUBG_SAAS_PG_EXEC_COMPOSE_FILE")).expanduser().resolve()
    env_file = Path(required_config("PUBG_SAAS_PG_EXEC_ENV_FILE")).expanduser().resolve()
    if not compose_file.is_file() or not env_file.is_file() or env_file.is_symlink():
        raise ToolError("local Compose files are unavailable")
    if os.name != "nt" and env_file.stat().st_mode & 0o077:
        raise ToolError("local Compose env file must be owner-only")
    base = [
        "docker", "compose", "--project-name", project,
        "--project-directory", str(compose_file.parent),
        "--env-file", str(env_file),
        "--file", str(compose_file),
    ]
    return base, project


def docker_json(args: list[str]) -> dict:
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode:
        raise ToolError("Docker inspection failed")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ToolError("Docker returned invalid inspection data") from error
    if isinstance(value, list) and len(value) == 1:
        value = value[0]
    if not isinstance(value, dict):
        raise ToolError("Docker returned invalid inspection data")
    return value


def verify_isolated_database(base: list[str], project: str) -> None:
    result = subprocess.run(
        [*base, "ps", "--all", "--quiet", "postgres"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    container_id = result.stdout.strip().splitlines()
    if result.returncode or len(container_id) != 1 or not container_id[0]:
        raise ToolError("the selected Compose project must have exactly one PostgreSQL container")
    container = docker_json(["docker", "inspect", container_id[0]])
    labels = container.get("Config", {}).get("Labels") or {}
    if (
        labels.get("com.docker.compose.project") != project
        or labels.get("com.docker.compose.service") != "postgres"
        or container.get("Config", {}).get("Image") != POSTGRES_IMAGE
        or not container.get("State", {}).get("Running")
    ):
        raise ToolError("refusing PostgreSQL outside the isolated PUBG SaaS Compose project")

    networks = (container.get("NetworkSettings", {}).get("Networks") or {})
    if not networks:
        raise ToolError("PostgreSQL must use an internal Compose network")
    for network_name in networks:
        network = docker_json(["docker", "network", "inspect", network_name])
        network_labels = network.get("Labels") or {}
        if (
            network_labels.get("com.docker.compose.project") != project
            or network.get("Internal") is not True
        ):
            raise ToolError("refusing PostgreSQL attached to a non-internal network")

    host_bindings = container.get("HostConfig", {}).get("PortBindings") or {}
    for bindings in host_bindings.values():
        for binding in bindings or []:
            if binding.get("HostIp") not in {"127.0.0.1", "::1"}:
                raise ToolError("refusing a PostgreSQL port published beyond loopback")

    volumes = [
        mount for mount in container.get("Mounts", [])
        if mount.get("Destination") == "/var/lib/postgresql" and mount.get("Type") == "volume"
    ]
    if len(volumes) != 1:
        raise ToolError("PostgreSQL must use one project-owned data volume")
    volume = docker_json(["docker", "volume", "inspect", volumes[0]["Name"]])
    if (volume.get("Labels") or {}).get("com.docker.compose.project") != project:
        raise ToolError("PostgreSQL data volume is not owned by this Compose project")


def pgpass_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("\n", "\\n").replace("\r", "\\r")


def connection_env() -> tuple[list[str], dict[str, str] | None]:
    user = os.environ.get("PGUSER", "")
    password = os.environ.get("PGPASSWORD")
    if not user and password is None:
        return [], None
    if not user or password is None:
        raise ToolError("local database operations require an explicit PostgreSQL user and password")
    host = os.environ.get("PGHOST", "")
    if host not in {"postgres", "localhost", "127.0.0.1", "::1"}:
        raise ToolError("local Compose PostgreSQL URL must name localhost or the postgres service")
    if os.environ.get("PGSSLMODE", "disable") not in {"disable", "prefer", "allow"}:
        raise ToolError("TLS options are unsupported by the local internal-network transport")
    database = os.environ.get("PGDATABASE", "") or "*"
    if any(character in user + database + password for character in "\x00\n\r"):
        raise ToolError("invalid local PostgreSQL credential characters")
    pass_path = f"/tmp/.pubg-saas-pgpass-{secrets.token_hex(8)}"
    record = ":".join(
        pgpass_escape(value) for value in ("127.0.0.1", "5432", database, user, password)
    ) + "\n"
    return [
        "--env", f"PGPASSFILE={pass_path}",
        "--env", "PGHOST=127.0.0.1",
        "--env", "PGPORT=5432",
        "--env", f"PGUSER={user}",
        "--env", f"PGDATABASE={database}",
        "--env", "PGSSLMODE=disable",
    ], {"path": pass_path, "record": record}


def compose_exec(base: list[str], extra_env: list[str], *args: str) -> list[str]:
    return [*base, "exec", "--no-TTY", *extra_env, "postgres", *args]


def put_passfile(base: list[str], pass_file: dict | None) -> None:
    if pass_file is None:
        return
    remote = pass_file["path"]
    command = compose_exec(
        base,
        [],
        "sh", "-c", 'umask 077; cat > "$1"', "pubg-saas-pg-tool", remote,
    )
    result = subprocess.run(
        command,
        input=pass_file["record"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ToolError("could not stage a temporary PostgreSQL credential file")


def remove_passfile(base: list[str], extra_env: list[str], pass_file: dict | None) -> None:
    if pass_file is None:
        return
    subprocess.run(
        compose_exec(base, extra_env, "rm", "-f", pass_file["path"]),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def run_pg_dump(base: list[str], extra_env: list[str], args: list[str]) -> int:
    output_path: str | None = None
    command_args: list[str] = []
    index = 0
    while index < len(args):
        value = args[index]
        if value in {"--file", "-f"}:
            if index + 1 >= len(args) or output_path is not None:
                raise ToolError("invalid pg_dump output file arguments")
            output_path = args[index + 1]
            index += 2
            continue
        if value.startswith("--file="):
            if output_path is not None:
                raise ToolError("invalid pg_dump output file arguments")
            output_path = value.split("=", 1)[1]
            index += 1
            continue
        command_args.append(value)
        index += 1
    command = compose_exec(base, extra_env, "pg_dump", *command_args)
    if output_path is not None:
        with open(output_path, "wb") as output:
            return subprocess.run(command, stdin=None, stdout=output, check=False).returncode
    return subprocess.run(command, stdin=None, stdout=sys.stdout.buffer, check=False).returncode


def run_pg_restore(base: list[str], extra_env: list[str], args: list[str]) -> int:
    archive_path, command_args, list_path = prepare_pg_restore_args(args)
    remote_list: str | None = None
    try:
        if list_path is not None:
            remote_list = f"/tmp/.pubg-saas-restore-{secrets.token_hex(8)}.list"
            with open(list_path, "rb") as source:
                result = subprocess.run(
                    compose_exec(
                        base, [], "sh", "-c", 'umask 077; cat > "$1"',
                        "pubg-saas-pg-tool", remote_list,
                    ),
                    stdin=source,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    check=False,
                )
            if result.returncode:
                raise ToolError("could not stage the PostgreSQL archive table list")
            command_args = [remote_list if value == "__REMOTE_LIST__" else value for value in command_args]
        command = compose_exec(base, extra_env, "pg_restore", *command_args)
        if archive_path == "-":
            return subprocess.run(command, stdin=None, stdout=None, check=False).returncode
        with open(archive_path, "rb") as archive:
            return subprocess.run(command, stdin=archive, stdout=None, check=False).returncode
    finally:
        if remote_list is not None:
            subprocess.run(
                compose_exec(base, [], "rm", "-f", remote_list),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )


def prepare_pg_restore_args(args: list[str]) -> tuple[str, list[str], str | None]:
    archive_path: str | None = None
    command_args: list[str] = []
    list_path: str | None = None
    index = 0
    while index < len(args):
        value = args[index]
        if value in {"--use-list", "-L"}:
            if index + 1 >= len(args) or list_path is not None:
                raise ToolError("invalid pg_restore list-file arguments")
            list_path = args[index + 1]
            command_args.extend([value, "__REMOTE_LIST__"])
            index += 2
            continue
        if value == "--list":
            command_args.append(value)
            index += 1
            continue
        if value in {"--role", "--dbname", "-d", "--host", "-h", "--port", "-p", "--username", "-U"}:
            if index + 1 >= len(args):
                raise ToolError("pg_restore is missing an option value")
            command_args.extend([value, args[index + 1]])
            index += 2
            continue
        if not value.startswith("-"):
            if archive_path is not None:
                raise ToolError("pg_restore accepts one archive input")
            archive_path = value
            index += 1
            continue
        command_args.append(value)
        index += 1
    if archive_path is None:
        archive_path = "-"
    return archive_path, command_args, list_path


def main() -> int:
    tool = Path(sys.argv[0]).name
    if tool not in TOOL_NAMES:
        print("invoke via a symlink named psql, pg_dump, pg_restore, createdb, or dropdb", file=sys.stderr)
        return 2
    try:
        base, project = compose_base()
        verify_isolated_database(base, project)
        extra_env, pass_file = connection_env()
        try:
            put_passfile(base, pass_file)
            args = sys.argv[1:]
            if tool == "pg_dump":
                return run_pg_dump(base, extra_env, args)
            if tool == "pg_restore":
                return run_pg_restore(base, extra_env, args)
            command = compose_exec(base, extra_env, tool, *args)
            return subprocess.run(command, stdin=None, stdout=None, check=False).returncode
        finally:
            remove_passfile(base, extra_env, pass_file)
    except (OSError, ToolError) as error:
        print(f"local PostgreSQL tool refused or failed: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
