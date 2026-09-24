#!/usr/bin/env python3
"""Prepare OpenClaw Amadeus config and runtime-only secrets on CasaOS."""

from __future__ import annotations

import base64
import json
import os
import re
import secrets
import sys
import errno
from pathlib import Path


NON_OWNER_TOOL_ALLOWLIST = ["web_search", "web_fetch"]


def ensure_owner(path: Path, mode: int = 0o600) -> None:
    os.chmod(path, mode)
    os.chown(path, 1000, 1000)


def ensure_regular(path: Path, label: str) -> None:
    if path.is_symlink() or not path.is_file() or not path.read_bytes().strip():
        raise SystemExit(f"{label} is not a non-empty regular file: {path}")


def require_existing(target: Path, label: str, mode: int = 0o600) -> None:
    ensure_regular(target, label)
    ensure_owner(target, mode)


def write_if_missing(target: Path, content: bytes, label: str, mode: int = 0o600) -> None:
    if target.exists():
        ensure_regular(target, label)
        ensure_owner(target, mode)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)
    ensure_owner(target, mode)


def ensure_workspace_directory(workspace_dir: Path) -> bool:
    """Create a new runtime workspace without changing an existing one."""
    try:
        workspace_dir.mkdir(mode=0o700)
    except FileExistsError:
        if workspace_dir.is_symlink() or not workspace_dir.is_dir():
            raise SystemExit("runtime workspace path is not a real directory")
        return False
    ensure_owner(workspace_dir, 0o700)
    return True


def seed_workspace_missing_only(workspace_dir: Path, seeds: dict[str, bytes]) -> tuple[int, int]:
    """Install repository seeds only at absent paths; preserve every existing path."""
    ensure_workspace_directory(workspace_dir)
    created = 0
    preserved = 0
    for name, content in seeds.items():
        target = workspace_dir / name
        try:
            descriptor = os.open(
                target,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o644,
            )
        except FileExistsError:
            preserved += 1
            continue
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                preserved += 1
                continue
            raise
        created_stat = os.fstat(descriptor)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            ensure_owner(target, 0o644)
        except BaseException:
            # Remove only the inode this invocation created; never follow a link.
            try:
                current = target.lstat()
                if current.st_dev == created_stat.st_dev and current.st_ino == created_stat.st_ino:
                    target.unlink()
            except FileNotFoundError:
                pass
            raise
        created += 1
    return created, preserved


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
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


def set_env(lines: list[str], key: str, value: str) -> None:
    prefix = key + "="
    for index, line in enumerate(lines):
        normalized = line.strip()
        if normalized.startswith("export "):
            normalized = normalized[7:].lstrip()
        if normalized.startswith(prefix):
            lines[index] = prefix + value
            return
    lines.append(prefix + value)


def merge_preserved(config: dict, existing: dict) -> None:
    for key in ("commands", "meta", "security"):
        if key in existing:
            config[key] = existing[key]
    current_whatsapp = existing.get("channels", {}).get("whatsapp")
    if isinstance(current_whatsapp, dict):
        config.setdefault("channels", {}).setdefault("whatsapp", {}).update(current_whatsapp)


def valid_owner_targets(existing: dict) -> list[str]:
    values = existing.get("commands", {}).get("ownerAllowFrom", [])
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values if isinstance(value, (str, int)) and str(value).strip().startswith("whatsapp:")]


def owner_phone(owner_target: str) -> str:
    value = owner_target.strip()
    if not value.startswith("whatsapp:"):
        raise SystemExit("WhatsApp owner target must use the whatsapp:+e164 form")
    phone = value.split(":", 1)[1].strip()
    if not re.fullmatch(r"\+[1-9][0-9]{6,14}", phone):
        raise SystemExit("WhatsApp owner target is not a valid E.164 number")
    return phone


def owner_tool_policy_keys(phone: str) -> list[str]:
    digits = phone.removeprefix("+")
    return [
        f"e164:{phone}",
        f"e164:{digits}",
        f"id:{phone}",
        f"id:{digits}",
        f"id:{digits}@s.whatsapp.net",
        f"channel:whatsapp:{phone}",
        f"channel:whatsapp:{digits}",
        f"channel:whatsapp:{digits}@s.whatsapp.net",
    ]


def main() -> None:
    if len(sys.argv) != 8:
        raise SystemExit("usage: openclaw_prepare.py DATA_DIR CONFIG_B64 TEAM_B64 AGENTS_SEED_B64 SOUL_SEED_B64 USER_SEED_B64 MEMORY_SEED_B64")
    data_dir = Path(sys.argv[1])
    config_template = json.loads(base64.b64decode(sys.argv[2]).decode())
    team_bytes = base64.b64decode(sys.argv[3])
    workspace = {
        "AGENTS.md": base64.b64decode(sys.argv[4]),
        "SOUL.md": base64.b64decode(sys.argv[5]),
        "USER.md": base64.b64decode(sys.argv[6]),
        "MEMORY.md": base64.b64decode(sys.argv[7]),
    }
    config_dir = data_dir / "config"
    workspace_dir = data_dir / "workspace"
    pubg_data_dir = data_dir / "data"
    longbridge_sdk_tokens = pubg_data_dir / "longbridge-sdk-home" / ".longbridge" / "openapi" / "tokens"
    secrets_dir = data_dir / "secrets"
    outbox_dir = data_dir / "notifications"
    for directory in (data_dir, config_dir, pubg_data_dir, secrets_dir, outbox_dir):
        directory.mkdir(parents=True, exist_ok=True)
        os.chown(directory, 1000, 1000)
        os.chmod(directory, 0o700)
    longbridge_sdk_tokens.mkdir(parents=True, exist_ok=True)
    for directory in (pubg_data_dir / "longbridge-sdk-home", pubg_data_dir / "longbridge-sdk-home" / ".longbridge", pubg_data_dir / "longbridge-sdk-home" / ".longbridge" / "openapi", longbridge_sdk_tokens):
        os.chown(directory, 1000, 1000)
        os.chmod(directory, 0o700)
    for token_file in longbridge_sdk_tokens.iterdir():
        if token_file.is_file() and not token_file.is_symlink():
            ensure_owner(token_file, 0o600)
    ensure_workspace_directory(workspace_dir)

    existing_config_path = config_dir / "openclaw.json"
    existing_config: dict = {}
    if existing_config_path.is_file():
        existing_config = json.loads(existing_config_path.read_text())

    api_target = secrets_dir / "pubg-api-key"
    require_existing(api_target, "PUBG API key")

    team_target = secrets_dir / "pubg-team.json"
    if team_target.exists():
        ensure_regular(team_target, "PUBG team config")
        json.loads(team_target.read_text())
        ensure_owner(team_target)
    else:
        json.loads(team_bytes.decode())
        write_if_missing(team_target, team_bytes, "PUBG team config")

    require_existing(secrets_dir / "telegram-bot-token", "Telegram token")
    require_existing(secrets_dir / "kook-bot-token", "KOOK token")
    require_existing(secrets_dir / "mac-ssh-key", "Mac SSH key")
    require_existing(secrets_dir / "mac-host-agent-token", "MacHostAgent token")
    require_existing(secrets_dir / "longbridge-client-id", "Longbridge OAuth client id")
    kiwivm_credentials = secrets_dir / "kiwivm-credentials.json"
    require_existing(kiwivm_credentials, "KiwiVM credentials")
    try:
        credentials = json.loads(kiwivm_credentials.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit("KiwiVM credentials are not valid JSON") from exc
    if not isinstance(credentials, dict) or not str(credentials.get("veid", "")).strip() or not str(credentials.get("apiKey", credentials.get("api_key", ""))).strip():
        raise SystemExit("KiwiVM credentials require veid and apiKey")
    require_existing(secrets_dir / "vps-readonly-ssh-key", "VPS read-only SSH key")
    require_existing(secrets_dir / "vps-ssh-known-hosts", "VPS SSH known-hosts file")

    owner_candidates = valid_owner_targets(existing_config)
    owner_target = secrets_dir / "owner-whatsapp-target"
    if owner_target.exists():
        ensure_regular(owner_target, "WhatsApp owner target")
        current_owner = owner_target.read_text().strip()
        if owner_candidates and current_owner != owner_candidates[0]:
            raise SystemExit("existing WhatsApp owner target differs from OpenClaw ownerAllowFrom")
        ensure_owner(owner_target)
    elif len(owner_candidates) != 1:
        raise SystemExit("exactly one whatsapp:* OpenClaw ownerAllowFrom entry is required")
    else:
        write_if_missing(owner_target, (owner_candidates[0] + "\n").encode(), "WhatsApp owner target")

    env_path = data_dir / "openclaw.env"
    env_values = read_env(env_path)
    env_lines = env_path.read_text().splitlines() if env_path.is_file() else []
    set_env(env_lines, "OPENCLAW_GATEWAY_TOKEN", env_values.get("OPENCLAW_GATEWAY_TOKEN", "").strip() or secrets.token_urlsafe(32))
    if not env_values.get("OPENCLAW_9ROUTER_API_KEY", "").strip():
        set_env(env_lines, "OPENCLAW_9ROUTER_API_KEY", "local")
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("\n".join(env_lines) + "\n")
    ensure_owner(env_path)

    config = dict(config_template)
    if config.get("tools", {}).get("profile") != "full":
        raise SystemExit('OpenClaw Amadeus deployment requires tools.profile="full" for the owner agent')
    merge_preserved(config, existing_config)
    current_allow = existing_config.get("channels", {}).get("telegram", {}).get("allowFrom", [])
    if not isinstance(current_allow, list) or not current_allow:
        raise SystemExit("OpenClaw Telegram allowFrom is empty; refuse to widen identity scope")
    config.setdefault("channels", {}).setdefault("telegram", {})["allowFrom"] = current_allow
    owner_target_value = owner_candidates[0] if owner_candidates else owner_target.read_text().strip()
    config.setdefault("commands", {})["ownerAllowFrom"] = [owner_target_value]

    tools = config.setdefault("tools", {})
    tools["toolsBySender"] = {"*": {"allow": NON_OWNER_TOOL_ALLOWLIST}}
    for key in owner_tool_policy_keys(owner_phone(owner_target_value)):
        tools["toolsBySender"][key] = {"allow": ["*"]}

    whatsapp = config.setdefault("channels", {}).setdefault("whatsapp", {})
    phone = owner_phone(owner_target_value)
    whatsapp["dmPolicy"] = "open"
    whatsapp["allowFrom"] = ["*"]
    whatsapp["configWrites"] = False
    accounts = whatsapp.get("accounts")
    if isinstance(accounts, dict):
        for account in accounts.values():
            if isinstance(account, dict):
                account["dmPolicy"] = "open"
                account["allowFrom"] = ["*"]
                account["configWrites"] = False
    groups = whatsapp.setdefault("groups", {})
    for group in groups.values():
        if isinstance(group, dict):
            group.pop("tools", None)
            group.pop("toolsBySender", None)

    temporary = config_dir / "openclaw.json.codex-tmp"
    temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    ensure_owner(temporary)
    os.replace(temporary, config_dir / "openclaw.json")

    seeded, preserved = seed_workspace_missing_only(workspace_dir, workspace)

    print("EXTERNAL_CONFIG=prepared")
    print("OWNER_TARGET=validated")
    print("TELEGRAM_ALLOWLIST=preserved")
    print("SECRET_FILES=prepared")
    print("SEED_MISSING_ONLY=yes")
    print("RUNTIME_WORKSPACE_PRESERVED=yes")
    print(f"WORKSPACE_SEEDS_CREATED={seeded}")
    print(f"WORKSPACE_PATHS_PRESERVED={preserved}")


if __name__ == "__main__":
    main()
