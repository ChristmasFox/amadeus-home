#!/bin/sh
set -eu

if [ -z "${PUBG_SAAS_DATABASE_URL:-}" ] || [ -z "${PUBG_SAAS_DATABASE_PASSWORD_FILE:-}" ]; then
  echo "PUBG_SAAS_DATABASE_URL and PUBG_SAAS_DATABASE_PASSWORD_FILE are required" >&2
  exit 64
fi

export DATABASE_URL="$(node -e '
  const fs = require("node:fs");
  const url = new URL(process.env.PUBG_SAAS_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.password) process.exit(64);
  const password = fs.readFileSync(process.env.PUBG_SAAS_DATABASE_PASSWORD_FILE, "utf8").replace(/\r?\n$/, "");
  if (!password) process.exit(64);
  url.password = password;
  process.stdout.write(url.toString());
')"

exec "$@"
