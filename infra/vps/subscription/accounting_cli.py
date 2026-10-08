#!/usr/bin/env python3
"""Provision runtime-only subscription identities without printing credentials."""

from __future__ import annotations

import argparse
import copy
import grp
import ipaddress
import json
import os
import pwd
import re
import secrets
import shutil
import tempfile
from pathlib import Path
from urllib.parse import quote, urlencode

from accounting_store import (
    ACCOUNT_IDS,
    LABMEM_IDS,
    AccountingStore,
    LegacyCredentials,
    collect_active_subscription_token,
    parse_hysteria_legacy_password,
    parse_xray_legacy_uuid,
)


ALLOWED_FILES = ("qx.conf", "server.snippet", "clash.yaml", "shadowrocket.txt")


def _safe_text(value: str, label: str) -> str:
    value = value.strip()
    if not value or any(char in value for char in "\r\n\x00"):
        raise ValueError(f"{label} is invalid")
    return value


def _host_port(host: str, port: int = 2053) -> str:
    host = _safe_text(host, "server host")
    try:
        parsed = ipaddress.ip_address(host)
        if parsed.version == 6:
            host = f"[{host}]"
    except ValueError:
        if any(char.isspace() for char in host) or "/" in host or ":" in host:
            raise ValueError("server host is invalid")
    return f"{host}:{port}"


def read_legacy_credentials(
    *, caddyfile: str | Path, subscription_root: str | Path,
    hysteria_config: str | Path, xray_config: str | Path,
) -> LegacyCredentials:
    """Import the one currently routed legacy identity, without logging values."""
    token = collect_active_subscription_token(
        Path(caddyfile).read_text(encoding="utf-8"), subscription_root,
    )
    hy2_legacy_credential = parse_hysteria_legacy_password(Path(hysteria_config).read_text(encoding="utf-8"))
    client_uuid = parse_xray_legacy_uuid(Path(xray_config).read_text(encoding="utf-8"))
    return LegacyCredentials(token, hy2_legacy_credential, client_uuid)


def generate_stats_secret(path: str | Path, *, group_id: int | None = None) -> None:
    """Create one protected Hysteria Stats API secret without returning it."""
    target = Path(path)
    target.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    mode = 0o640 if group_id is not None else 0o600
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        if group_id is not None:
            os.fchown(descriptor, -1, group_id)
        stream = os.fdopen(descriptor, "w", encoding="utf-8", closefd=True)
        descriptor = -1
        with stream:
            stream.write(secrets.token_urlsafe(32) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(target, mode)
        if group_id is not None:
            os.chown(target, -1, group_id)
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            target.unlink()
        except FileNotFoundError:
            pass
        raise


def replace_yaml_top_level_section(text: str, section: str, replacement: str) -> str:
    """Replace one top-level YAML mapping block, preserving every other line."""
    lines = text.splitlines()
    starts = [
        index for index, line in enumerate(lines)
        if re.match(r"^[A-Za-z][A-Za-z0-9_-]*:\s*(?:#.*)?$", line)
    ]
    target = [index for index in starts if lines[index].split(":", 1)[0] == section]
    if len(target) > 1:
        raise ValueError("candidate Hysteria config has a duplicate section")
    if target:
        start = target[0]
        end = next((index for index in starts if index > start), len(lines))
        lines[start:end] = replacement.rstrip("\n").splitlines()
    else:
        if lines and lines[-1].strip():
            lines.append("")
        lines.extend(replacement.rstrip("\n").splitlines())
    return "\n".join(lines).rstrip() + "\n"


def render_hysteria_candidate(source: str | Path, output: str | Path, stats_secret_file: str | Path, *, caddy_group_id: int | None = None) -> None:
    source_path = Path(source)
    original = source_path.read_text(encoding="utf-8")
    parse_hysteria_legacy_password(original)  # Require the expected compatibility baseline.
    stats_secret = Path(stats_secret_file).read_text(encoding="utf-8").strip()
    if not stats_secret or any(char in stats_secret for char in "\r\n\x00"):
        raise ValueError("Hysteria stats secret is unavailable")
    auth = """auth:
  type: http
  http:
    url: http://127.0.0.1:18796/auth
"""
    stats = """trafficStats:
  listen: "127.0.0.1:19999"
  secret: """ + json.dumps(stats_secret) + "\n"
    candidate = replace_yaml_top_level_section(original, "auth", auth)
    candidate = replace_yaml_top_level_section(candidate, "trafficStats", stats)
    _write_atomic(Path(output), candidate, mode=0o640, group_id=caddy_group_id)


def render_xray_candidate(
    source: str | Path, output: str | Path, store: AccountingStore, *, xray_group_id: int | None = None,
) -> None:
    """Add stable per-account VLESS emails while preserving the current listener and Reality config."""
    try:
        config = json.loads(Path(source).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError("source Xray config is invalid") from error
    if not isinstance(config, dict) or not isinstance(config.get("inbounds"), list):
        raise ValueError("source Xray config is invalid")
    accounts = store.account_records_for_runtime()
    if {str(row["account_id"]) for row in accounts} != set(ACCOUNT_IDS):
        raise ValueError("account-store is not fully initialized")
    by_id = {str(row["account_id"]): row for row in accounts}
    legacy_uuid = str(by_id["legacy"]["vless_uuid"])
    vless_inbounds = [
        inbound for inbound in config["inbounds"]
        if isinstance(inbound, dict) and inbound.get("protocol") == "vless" and str(inbound.get("port")) == "2053"
    ]
    if len(vless_inbounds) != 1:
        raise ValueError("expected one existing VLESS listener on port 2053")
    inbound = vless_inbounds[0]
    settings = inbound.get("settings")
    clients = settings.get("clients") if isinstance(settings, dict) else None
    if not isinstance(clients, list) or not all(isinstance(row, dict) for row in clients):
        raise ValueError("existing VLESS clients are invalid")
    legacy_matches = [row for row in clients if row.get("id") == legacy_uuid]
    if len(legacy_matches) != 1:
        raise ValueError("protected legacy VLESS identity does not match source config")
    emails = {str(row.get("email")): row for row in clients if row.get("email") is not None}
    existing_legacy_email = emails.get("legacy-vless")
    if existing_legacy_email is not None and existing_legacy_email.get("id") != legacy_uuid:
        raise ValueError("legacy VLESS email is already assigned to another identity")
    legacy_client = legacy_matches[0]
    legacy_client["email"] = "legacy-vless"
    for account_id in LABMEM_IDS:
        email = f"{account_id}.vless"
        credential = str(by_id[account_id]["vless_uuid"])
        existing_by_email = next((row for row in clients if row.get("email") == email), None)
        existing_by_uuid = next((row for row in clients if row.get("id") == credential), None)
        if existing_by_email is not None:
            if existing_by_email.get("id") != credential:
                raise ValueError("Labmem VLESS email is already assigned to another identity")
            if existing_by_email.get("level", 0) != legacy_client.get("level", 0) or existing_by_email.get("flow") != legacy_client.get("flow"):
                raise ValueError("Labmem VLESS client settings differ from the legacy listener baseline")
            continue
        if existing_by_uuid is not None:
            raise ValueError("Labmem VLESS credential is already assigned to another identity")
        candidate_client = {
            key: copy.deepcopy(legacy_client[key])
            for key in ("level", "flow") if key in legacy_client
        }
        candidate_client["id"] = credential
        candidate_client["email"] = email
        clients.append(candidate_client)

    stats = config.setdefault("stats", {})
    if not isinstance(stats, dict):
        raise ValueError("existing Xray stats configuration is invalid")
    policy = config.setdefault("policy", {})
    if not isinstance(policy, dict):
        raise ValueError("existing Xray policy is invalid")
    levels = policy.setdefault("levels", {})
    if not isinstance(levels, dict):
        raise ValueError("existing Xray policy levels are invalid")
    managed_emails = {"legacy-vless", *(f"{account_id}.vless" for account_id in LABMEM_IDS)}
    for client in clients:
        if client.get("email") not in managed_emails:
            continue
        level = client.get("level", 0)
        if isinstance(level, bool) or not isinstance(level, int) or level < 0:
            raise ValueError("managed Xray client level is invalid")
        user_policy = levels.setdefault(str(level), {})
        if not isinstance(user_policy, dict):
            raise ValueError("managed Xray level policy is invalid")
        user_policy["statsUserUplink"] = True
        user_policy["statsUserDownlink"] = True
        user_policy["statsUserOnline"] = True
    desired_api = {"tag": "api", "listen": "127.0.0.1:10085", "services": ["StatsService"]}
    current_api = config.get("api")
    if current_api is not None and current_api != desired_api:
        raise ValueError("existing Xray API conflicts with the loopback StatsService candidate")
    config["api"] = desired_api
    output_text = json.dumps(config, indent=2, ensure_ascii=False) + "\n"
    _write_atomic(Path(output), output_text, mode=0o640, group_id=xray_group_id)


def render_qx_line(account: dict[str, object], config: dict[str, object]) -> str:
    server = _host_port(str(config["vless_server"]))
    return (
        f"vless={server}, method=none, password={account['vless_uuid']}, obfs=over-tls, "
        f"obfs-host={config['reality_server_name']}, reality-base64-pubkey={config['reality_public_key']}, "
        f"reality-hex-shortid={config['reality_short_id']}, vless-flow=xtls-rprx-vision, "
        f"fast-open=false, udp-relay=false, server_check_url=http://www.apple.com/generate_204, "
        f"tag=Amadeus-{account['account_id']}-Reality"
    )


def render_clash(account: dict[str, object], config: dict[str, object]) -> str:
    # The existing Clash policy is HY2-only. JSON strings are valid YAML scalars.
    return "\n".join([
        "proxies:",
        f"  - name: {json.dumps('Amadeus-HY2-' + str(account['account_id']), ensure_ascii=False)}",
        "    type: hysteria2",
        f"    server: {json.dumps(str(config['hy2_server']), ensure_ascii=False)}",
        "    port: 2053",
        f"    password: {json.dumps(str(account['hy2_secret']), ensure_ascii=False)}",
        f"    sni: {json.dumps(str(config['hy2_sni']), ensure_ascii=False)}",
        "    skip-cert-verify: false",
        "    alpn:",
        "      - h3",
        "",
    ])


def render_shadowrocket(account: dict[str, object], config: dict[str, object]) -> str:
    hy2_host = _host_port(str(config["hy2_server"]))
    vless_host = _host_port(str(config["vless_server"]))
    hy2_label = quote(f"Amadeus-{account['account_id']}-HY2", safe="")
    hy2_query = urlencode({"sni": str(config["hy2_sni"]), "insecure": "0", "alpn": "h3"})
    hy2_uri = f"hysteria2://{quote(str(account['hy2_secret']), safe='')}@{hy2_host}/?{hy2_query}#{hy2_label}"
    vless_query = urlencode({
        "encryption": "none",
        "security": "reality",
        "sni": str(config["reality_server_name"]),
        "pbk": str(config["reality_public_key"]),
        "sid": str(config["reality_short_id"]),
        "type": "tcp",
        "flow": "xtls-rprx-vision",
    })
    vless_label = quote(f"Amadeus-{account['account_id']}-Reality", safe="")
    vless_uri = f"vless://{account['vless_uuid']}@{vless_host}?{vless_query}#{vless_label}"
    return f"{hy2_uri}\n{vless_uri}\n"


def render_subscription_files(account: dict[str, object], config: dict[str, object]) -> dict[str, str]:
    qx = render_qx_line(account, config) + "\n"
    return {
        "qx.conf": qx,
        "server.snippet": qx,
        "clash.yaml": render_clash(account, config),
        "shadowrocket.txt": render_shadowrocket(account, config),
    }


def render_caddy_matcher(records: list[dict[str, object]]) -> str:
    """Render only exact token/file paths; no filesystem or directory route."""
    paths = [
        f"/{record['subscription_token']}/{filename}"
        for record in records if record.get("enabled")
        for filename in ALLOWED_FILES
    ]
    if len(paths) != len(ACCOUNT_IDS) * len(ALLOWED_FILES):
        raise ValueError("account-store does not contain the exact active identity set")
    if len(set(paths)) != len(paths):
        raise ValueError("account-store contains duplicate subscription paths")
    return "\n".join([
        "@subscription path " + " ".join(paths),
        "handle @subscription {",
        "    reverse_proxy 127.0.0.1:8787",
        "}",
        "",
    ])


def _write_atomic(path: Path, content: str, *, mode: int, group_id: int | None = None) -> None:
    path.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        if group_id is not None:
            os.fchown(fd, -1, group_id)
        stream = os.fdopen(fd, "w", encoding="utf-8", closefd=True)
        fd = -1
        with stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        os.chmod(path, mode)
        if group_id is not None:
            os.chown(path, -1, group_id)
    finally:
        if fd >= 0:
            os.close(fd)
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def render_new_accounts(
    *, store: AccountingStore, subscription_root: str | Path,
    caddy_fragment: str | Path, config: dict[str, object], caddy_group_id: int | None = None,
) -> None:
    records = store.account_records_for_runtime()
    if {str(row["account_id"]) for row in records} != set(ACCOUNT_IDS):
        raise ValueError("account-store is not fully initialized")
    root = Path(subscription_root)
    root.mkdir(mode=0o750, parents=True, exist_ok=True)
    if any((root / str(row["subscription_token"])).exists() for row in records if row["account_id"] in LABMEM_IDS):
        raise FileExistsError("a Labmem subscription directory already exists; refusing to overwrite credentials")

    staging = Path(tempfile.mkdtemp(prefix=".amadeus-accounting-", dir=root))
    os.chmod(staging, 0o700)
    try:
        staged_directories: list[tuple[Path, Path]] = []
        for account in records:
            account_id = str(account["account_id"])
            if account_id not in LABMEM_IDS:
                continue  # The existing legacy directory is deliberately untouched.
            directory = staging / str(account["subscription_token"])
            directory.mkdir(mode=0o750)
            os.chmod(directory, 0o750)
            if caddy_group_id is not None:
                os.chown(directory, -1, caddy_group_id)
            for filename, content in render_subscription_files(account, config).items():
                _write_atomic(directory / filename, content, mode=0o640, group_id=caddy_group_id)
            staged_directories.append((directory, root / str(account["subscription_token"])))
        caddy_content = render_caddy_matcher(records)
        for staged, target in staged_directories:
            os.replace(staged, target)
            os.chmod(target, 0o750)
            if caddy_group_id is not None:
                os.chown(target, -1, caddy_group_id)
        _write_atomic(Path(caddy_fragment), caddy_content, mode=0o640, group_id=caddy_group_id)
    except Exception:
        # Staged data includes secrets and is removed without showing its path.
        shutil.rmtree(staging, ignore_errors=True)
        raise
    else:
        shutil.rmtree(staging, ignore_errors=True)


def _bootstrap(args: argparse.Namespace) -> None:
    store = AccountingStore(args.db)
    legacy = read_legacy_credentials(
        caddyfile=args.caddyfile,
        subscription_root=args.subscription_root,
        hysteria_config=args.hysteria_config,
        xray_config=args.xray_config,
    )
    store.initialize_accounts(legacy)
    if args.service_user:
        account = pwd.getpwnam(args.service_user)
        os.chown(args.db, account.pw_uid, account.pw_gid)
        os.chmod(args.db, 0o600)
    print("ACCOUNTING_ACCOUNTS_READY=6; LABMEM_IDENTITIES=5; CREDENTIAL_VALUES=withheld")


def _render(args: argparse.Namespace) -> None:
    store = AccountingStore(args.db)
    config: dict[str, object] = {
        "vless_server": args.vless_server,
        "hy2_server": args.hy2_server,
        "hy2_sni": args.hy2_sni,
        "reality_server_name": args.reality_server_name,
        "reality_public_key": args.reality_public_key,
        "reality_short_id": args.reality_short_id,
    }
    for key in config:
        config[key] = _safe_text(str(config[key]), key)
    render_new_accounts(
        store=store,
        subscription_root=args.subscription_root,
        caddy_fragment=args.caddy_fragment,
        config=config,
        caddy_group_id=grp.getgrnam(args.caddy_group).gr_gid,
    )
    print("LABMEM_SUBSCRIPTION_FILES_READY=5; FORMAT_FILES_READY=20; TOKEN_VALUES=withheld; CREDENTIAL_VALUES=withheld")


def _generate_stats_secret(args: argparse.Namespace) -> None:
    generate_stats_secret(args.output, group_id=grp.getgrnam(args.service_group).gr_gid)
    print("HY2_STATS_SECRET_READY=1; SECRET_VALUE=withheld")


def _render_hysteria(args: argparse.Namespace) -> None:
    render_hysteria_candidate(
        args.source_config,
        args.output,
        args.stats_secret_file,
        caddy_group_id=grp.getgrnam(args.caddy_group).gr_gid,
    )
    print("HYSTERIA_ACCOUNTING_CANDIDATE_READY=1; SECRET_VALUE=withheld")


def _render_xray(args: argparse.Namespace) -> None:
    store = AccountingStore(args.db)
    render_xray_candidate(
        args.source_config, args.output, store,
        xray_group_id=grp.getgrnam(args.xray_group).gr_gid,
    )
    print("XRAY_ACCOUNTING_CANDIDATE_READY=1; CLIENT_CREDENTIALS=withheld")


def _migrate_hysteria_directions(args: argparse.Namespace) -> None:
    store = AccountingStore(args.db)
    changed = store.migrate_hysteria_direction_to_client_perspective()
    print("HY2_DIRECTION_MIGRATION=" + ("applied" if changed else "already_applied"))


def _migrate_legacy_vless_baseline(args: argparse.Namespace) -> None:
    store = AccountingStore(args.db)
    changed = store.backfill_legacy_vless_t0_baseline(
        expected_upload=args.expected_upload,
        expected_download=args.expected_download,
    )
    print("LEGACY_VLESS_T0_BASELINE=" + ("applied" if changed else "already_applied"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Runtime-only Amadeus Gateway account provisioning")
    subparsers = parser.add_subparsers(dest="command", required=True)
    bootstrap = subparsers.add_parser("bootstrap", help="import legacy identity and create the five Labmem identities")
    bootstrap.add_argument("--db", required=True)
    bootstrap.add_argument("--caddyfile", required=True)
    bootstrap.add_argument("--subscription-root", required=True)
    bootstrap.add_argument("--hysteria-config", required=True)
    bootstrap.add_argument("--xray-config", required=True)
    bootstrap.add_argument("--service-user", help="change the protected database owner to the accounting service user")
    bootstrap.set_defaults(run=_bootstrap)
    render = subparsers.add_parser("render", help="write protected Labmem subscriptions and a bounded Caddy matcher")
    render.add_argument("--db", required=True)
    render.add_argument("--subscription-root", required=True)
    render.add_argument("--caddy-fragment", required=True)
    render.add_argument("--caddy-group", default="caddy")
    render.add_argument("--vless-server", required=True)
    render.add_argument("--hy2-server", required=True)
    render.add_argument("--hy2-sni", required=True)
    render.add_argument("--reality-server-name", required=True)
    render.add_argument("--reality-public-key", required=True)
    render.add_argument("--reality-short-id", required=True)
    render.set_defaults(run=_render)
    stats_secret = subparsers.add_parser("generate-stats-secret", help="create one mode-protected Hysteria Traffic Stats API secret")
    stats_secret.add_argument("--output", required=True)
    stats_secret.add_argument("--service-group", default="amadeus-accounting")
    stats_secret.set_defaults(run=_generate_stats_secret)
    hysteria = subparsers.add_parser("render-hysteria", help="write an accounting-enabled Hysteria candidate without changing the source file")
    hysteria.add_argument("--source-config", required=True)
    hysteria.add_argument("--output", required=True)
    hysteria.add_argument("--stats-secret-file", required=True)
    hysteria.add_argument("--caddy-group", default="caddy")
    hysteria.set_defaults(run=_render_hysteria)
    xray = subparsers.add_parser("render-xray", help="write an Xray accounting candidate without changing the source config")
    xray.add_argument("--db", required=True)
    xray.add_argument("--source-config", required=True)
    xray.add_argument("--output", required=True)
    xray.add_argument("--xray-group", default="xray")
    xray.set_defaults(run=_render_xray)
    hysteria_migration = subparsers.add_parser("migrate-hysteria-directions", help="correct stored tx/rx directions once")
    hysteria_migration.add_argument("--db", required=True)
    hysteria_migration.set_defaults(run=_migrate_hysteria_directions)
    legacy_vless_migration = subparsers.add_parser(
        "migrate-legacy-vless-baseline",
        help="backfill a verified legacy VLESS T0 baseline without claiming prior traffic",
    )
    legacy_vless_migration.add_argument("--db", required=True)
    legacy_vless_migration.add_argument("--expected-upload", required=True, type=int)
    legacy_vless_migration.add_argument("--expected-download", required=True, type=int)
    legacy_vless_migration.set_defaults(run=_migrate_legacy_vless_baseline)
    for command_parser in (bootstrap, render, stats_secret, hysteria, xray, hysteria_migration, legacy_vless_migration):
        command_parser.add_argument("--apply", action="store_true", help="perform the runtime file/database write; default is dry-run")
    args = parser.parse_args()
    if not args.apply:
        command = args.command.replace("-", "_").upper()
        print(f"PLAN_{command}=no_changes; APPLY_REQUIRED=1")
        return 0
    try:
        args.run(args)
        return 0
    except Exception as error:  # Do not print exception text, which may contain runtime paths or values.
        print(f"ACCOUNTING_OPERATION_FAILED={type(error).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
