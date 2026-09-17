#!/usr/bin/env python3
"""Disable only the legacy Telegram/PUBG records after a checkpoint exists."""

import sqlite3
import sys
from pathlib import Path


def main() -> None:
    langbot_db, n8n_db, radar_compose, telegram_uuid = sys.argv[1:5]
    conn = sqlite3.connect(langbot_db)
    target = conn.execute(
        "select uuid from bots where uuid = ? and lower(adapter) = 'telegram'",
        (telegram_uuid,),
    ).fetchone()
    if not target:
        conn.close()
        raise SystemExit("selected legacy Telegram bot is missing")
    telegram = conn.execute("update bots set enable = 0 where uuid = ?", (telegram_uuid,))
    plugins = conn.execute(
        "update plugin_settings set enabled = 0 where plugin_name in ('pubg-stats', 'kurisu-gateway')"
    )
    remaining = conn.execute(
        "select count(*) from bots where uuid = ? and lower(adapter) = 'telegram' and enable != 0",
        (telegram_uuid,),
    ).fetchone()[0]
    conn.commit()
    conn.close()
    if remaining:
        raise SystemExit("legacy Telegram bot could not be disabled")

    workflow_ids = [
        "pubg-data-gateway-v3-20260902",
        "pubg-query-gateway-v2-20260901",
        "pubg-sync-matches-v2-20260901",
        "pubg-sync-matches-v3-20260902",
        "pubg-daily-stats-20260830",
        "681f9db4-6666-4e58-aa6a-7ecc86316182",
    ]
    conn = sqlite3.connect(n8n_db)
    placeholders = ",".join("?" for _ in workflow_ids)
    rows = conn.execute(
        "select id from workflow_entity where id in (" + placeholders + ")", workflow_ids
    ).fetchall()
    found = {row[0] for row in rows}
    missing = [item for item in workflow_ids if item not in found]
    if missing:
        conn.close()
        raise SystemExit("legacy PUBG workflow missing: " + ",".join(missing))
    conn.execute(
        "update workflow_entity set active = 0 where id in (" + placeholders + ")", workflow_ids
    )
    active = conn.execute(
        "select count(*) from workflow_entity where id in (" + placeholders + ") and active != 0",
        workflow_ids,
    ).fetchone()[0]
    conn.commit()
    conn.close()
    if active:
        raise SystemExit("legacy PUBG n8n workflows remain active")
    radar_path = Path(radar_compose)
    if not radar_path.is_file():
        raise SystemExit("Product Radar compose file is missing: " + radar_compose)
    content = radar_path.read_text()
    lines = []
    owner_replaced = False
    removed_legacy_lines = 0
    for line in content.splitlines(keepends=True):
        if "PRODUCT_RADAR_NOTIFICATION_OWNER:" in line:
            indent = line[:len(line) - len(line.lstrip())]
            newline = "\n" if line.endswith("\n") else ""
            lines.append(indent + "PRODUCT_RADAR_NOTIFICATION_OWNER: disabled" + newline)
            owner_replaced = True
        elif "PRODUCT_RADAR_KURISU_" in line or "kurisu_notification_secret" in line:
            removed_legacy_lines += 1
        else:
            lines.append(line)
    if not owner_replaced:
        raise SystemExit("Product Radar compose has no notification owner setting")
    retired_content = "".join(lines)
    if "PRODUCT_RADAR_KURISU_" in retired_content or "/kurisu/notifications" in retired_content:
        raise SystemExit("Product Radar compose still references the retired Kurisu notification endpoint")
    temp_path = radar_path.with_name(radar_path.name + ".codex-tmp")
    temp_path.write_text(retired_content)
    temp_path.chmod(0o644)
    temp_path.replace(radar_path)
    print("LEGACY_TELEGRAM=disabled selected_bot=%s bots=%s plugins=%s" % (telegram_uuid, telegram.rowcount, plugins.rowcount))
    print("LEGACY_N8N=disabled workflows=%s" % len(rows))
    print("LEGACY_RADAR=disabled owner_lines=%s removed_legacy_lines=%s" % (int(owner_replaced), removed_legacy_lines))


if __name__ == "__main__":
    main()
