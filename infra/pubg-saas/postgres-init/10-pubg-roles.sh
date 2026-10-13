#!/usr/bin/env bash
set -Eeuo pipefail

export PUBG_SAAS_MIGRATOR_PASSWORD="$(cat /run/secrets/pubg_migrator_password)"
export PUBG_SAAS_APP_PASSWORD="$(cat /run/secrets/pubg_app_password)"
export PUBG_SAAS_BACKUP_PASSWORD="$(cat /run/secrets/pubg_backup_password)"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password PUBG_SAAS_MIGRATOR_PASSWORD
\getenv app_password PUBG_SAAS_APP_PASSWORD
\getenv backup_password PUBG_SAAS_BACKUP_PASSWORD

SELECT format('CREATE ROLE pubg_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'migrator_password') \gexec
SELECT format('CREATE ROLE pubg_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'app_password') \gexec
SELECT format('CREATE ROLE pubg_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', :'backup_password') \gexec

GRANT CONNECT ON DATABASE pubg_saas TO pubg_migrator, pubg_app, pubg_backup;
GRANT USAGE, CREATE ON SCHEMA public TO pubg_migrator;
GRANT USAGE ON SCHEMA public TO pubg_app, pubg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pubg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pubg_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO pubg_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO pubg_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO pubg_backup;
SQL

unset PUBG_SAAS_MIGRATOR_PASSWORD PUBG_SAAS_APP_PASSWORD PUBG_SAAS_BACKUP_PASSWORD
