#!/usr/bin/env python3
"""Prepare external OpenClaw config and secret files on the CasaOS host."""

import base64
import json
import os
import re
import secrets
import sqlite3
import sys
from pathlib import Path


def ensure_owner(path: Path, mode: int = 0o600) -> None:
    os.chmod(path, mode)
    os.chown(path, 1000, 1000)


def write_secret_if_missing(path: Path, content: bytes) -> None:
    if path.exists():
        if path.is_symlink() or not path.is_file() or not path.read_bytes().strip():
            raise SystemExit("invalid external secret file: " + str(path))
        ensure_owner(path)
        return
    path.write_bytes(content)
    ensure_owner(path)


def read_env(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if separator:
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def set_env_line(lines: list[str], key: str, value: str) -> None:
    prefix = key + "="
    for index, line in enumerate(lines):
        normalized = line.strip()
        if normalized.startswith("export "):
            normalized = normalized[7:].lstrip()
        if normalized.startswith(prefix):
            lines[index] = prefix + value
            return
    lines.append(prefix + value)


def find_telegram_token(value: object) -> str | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if re.search(r"(?:^|[_-])token$", str(key), re.I):
                if isinstance(item, str) and ":" in item and len(item.strip()) >= 20:
                    return item.strip()
            found = find_telegram_token(item)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = find_telegram_token(item)
            if found:
                return found
    return None


def main() -> None:
    data_dir = Path(sys.argv[1])
    team_bytes = base64.b64decode(sys.argv[2])
    config_bytes = base64.b64decode(sys.argv[3])
    workspace = {
        "AGENTS.md": base64.b64decode(sys.argv[4]),
        "SOUL.md": base64.b64decode(sys.argv[5]),
        "USER.md": base64.b64decode(sys.argv[6]),
    }
    legacy_api = Path(sys.argv[7])
    langbot_db = Path(sys.argv[8])
    identity_file = Path(sys.argv[9])
    env_file = Path(sys.argv[10])

    config_dir = data_dir / "config"
    workspace_dir = data_dir / "workspace"
    pubg_data_dir = data_dir / "data"
    secrets_dir = data_dir / "secrets"
    for directory in [data_dir, config_dir, workspace_dir, pubg_data_dir, secrets_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    if legacy_api.is_symlink() or not legacy_api.is_file():
        raise SystemExit("legacy PUBG API key file is not a regular file")
    api_bytes = legacy_api.read_bytes()
    if not api_bytes.strip():
        raise SystemExit("legacy PUBG API key file is empty")
    api_target = secrets_dir / "pubg-api-key"
    if api_target.exists() and api_target.read_bytes() != api_bytes:
        raise SystemExit("existing OpenClaw PUBG API key differs from legacy source")
    write_secret_if_missing(api_target, api_bytes)

    team_target = secrets_dir / "pubg-team.json"
    if team_target.exists():
        if team_target.is_symlink() or not team_target.is_file():
            raise SystemExit("invalid external team config file")
        json.loads(team_target.read_text())
        ensure_owner(team_target)
    else:
        json.loads(team_bytes.decode())
        team_target.write_bytes(team_bytes)
        ensure_owner(team_target)

    telegram_target = secrets_dir / "telegram-bot-token"
    if telegram_target.exists():
        if telegram_target.is_symlink() or not telegram_target.is_file() or not telegram_target.read_text().strip():
            raise SystemExit("invalid external Telegram token file")
        ensure_owner(telegram_target)
    else:
        db = sqlite3.connect("file:" + str(langbot_db) + "?mode=ro", uri=True)
        rows = db.execute(
            "select adapter_config from bots where lower(adapter) = 'telegram' order by enable desc"
        ).fetchall()
        db.close()
        token = None
        for row in rows:
            try:
                token = find_telegram_token(json.loads(row[0]))
            except (TypeError, json.JSONDecodeError):
                continue
            if token:
                break
        if not token:
            raise SystemExit("Telegram token was not found in the legacy LangBot database")
        telegram_target.write_text(token + "\n")
        ensure_owner(telegram_target)

    old_identity = read_env(identity_file)
    env_values = read_env(env_file)
    owner = env_values.get("TELEGRAM_ALLOWED_USER_ID") or old_identity.get("TELEGRAM_ADMIN_USER_ID")
    if not owner or not re.fullmatch(r"[1-9][0-9]*", owner):
        raise SystemExit("a positive numeric TELEGRAM_ALLOWED_USER_ID is required")

    lines = env_file.read_text().splitlines() if env_file.is_file() else []
    gateway_token = env_values.get("OPENCLAW_GATEWAY_TOKEN", "").strip() or secrets.token_urlsafe(32)
    router_key = env_values.get("OPENCLAW_9ROUTER_API_KEY", "").strip() or "local"
    set_env_line(lines, "OPENCLAW_GATEWAY_TOKEN", gateway_token)
    set_env_line(lines, "OPENCLAW_9ROUTER_API_KEY", router_key)
    set_env_line(lines, "TELEGRAM_ALLOWED_USER_ID", owner)
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text("\n".join(lines) + "\n")
    ensure_owner(env_file)

    config = json.loads(config_bytes.decode())
    config["channels"]["telegram"]["allowFrom"] = [int(owner)]
    config_path = config_dir / "openclaw.json"
    temp_config = config_dir / "openclaw.json.codex-tmp"
    temp_config.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    ensure_owner(temp_config)
    os.replace(temp_config, config_path)

    for name, content in workspace.items():
        target = workspace_dir / name
        target.write_bytes(content)
        ensure_owner(target, 0o644)
    for base in [config_dir, workspace_dir, pubg_data_dir]:
        os.chown(base, 1000, 1000)
        for root, dirs, files in os.walk(base):
            for name in dirs + files:
                os.chown(Path(root) / name, 1000, 1000)
    print("EXTERNAL_CONFIG=prepared")
    print("TELEGRAM_ALLOWLIST=validated")
    print("SECRET_FILES=prepared")


if __name__ == "__main__":
    main()
