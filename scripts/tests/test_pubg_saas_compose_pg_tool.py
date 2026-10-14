import importlib.util
import io
import os
import subprocess
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "pubg-saas-compose-pg-tool.py"
SPEC = importlib.util.spec_from_file_location("pubg_saas_compose_pg_tool", SCRIPT)
TOOL = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(TOOL)

BACKUP_SCRIPT = Path(__file__).resolve().parents[1] / "pubg-saas-backup-restore.py"
BACKUP_SPEC = importlib.util.spec_from_file_location("pubg_saas_backup_restore_transport_test", BACKUP_SCRIPT)
BACKUP = importlib.util.module_from_spec(BACKUP_SPEC)
assert BACKUP_SPEC.loader is not None
BACKUP_SPEC.loader.exec_module(BACKUP)


class ComposePostgresToolTests(unittest.TestCase):
    def test_psql_adapter_forwards_standard_input(self):
        stdin = io.StringIO("BEGIN; SELECT pg_export_snapshot();\n")
        completed = subprocess.CompletedProcess(["psql"], 0)
        with (
            patch.object(TOOL, "compose_base", return_value=(["docker", "compose"], "pubg-saas-m2-test-01")),
            patch.object(TOOL, "verify_isolated_database"),
            patch.object(TOOL, "connection_env", return_value=([], None)),
            patch.object(TOOL, "put_passfile"),
            patch.object(TOOL, "remove_passfile"),
            patch.object(TOOL.sys, "argv", ["psql", "-X", "-qAt"]),
            patch.object(TOOL.sys, "stdin", stdin),
            patch.object(TOOL.subprocess, "run", return_value=completed) as run,
        ):
            self.assertEqual(TOOL.main(), 0)
        self.assertIs(run.call_args.kwargs["stdin"], stdin)

    def test_pgpass_escapes_delimiters_and_line_breaks(self):
        self.assertEqual(TOOL.pgpass_escape(r"a:b\c\nd\re"), r"a\:b\\c\\nd\\re")

    def test_pg_restore_parser_preserves_option_values_and_streams_archive(self):
        archive, args, list_file = TOOL.prepare_pg_restore_args(
            [
                "--use-list", "/tmp/restore.list",
                "--role", "pubg_migrator",
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--dbname", "pubg_saas_disposable_restore_01",
                "/tmp/public.dump",
            ]
        )
        self.assertEqual(archive, "/tmp/public.dump")
        self.assertEqual(list_file, "/tmp/restore.list")
        self.assertEqual(
            args,
            [
                "--use-list", "__REMOTE_LIST__",
                "--role", "pubg_migrator",
                "--no-owner",
                "--no-acl",
                "--exit-on-error",
                "--dbname", "pubg_saas_disposable_restore_01",
            ],
        )

    def test_pg_restore_list_uses_host_archive_as_stdin(self):
        archive, args, list_file = TOOL.prepare_pg_restore_args(["--list", "/tmp/public.dump"])
        self.assertEqual((archive, args, list_file), ("/tmp/public.dump", ["--list"], None))

    def test_compose_project_name_is_scoped_to_local_test_namespaces(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            compose = root / "compose.yaml"
            env_file = root / ".env"
            compose.write_text("services: {}\n")
            env_file.write_text("PUBG_SAAS_IMAGE=local/test\n")
            env_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
            base_env = {
                "PUBG_SAAS_PG_EXEC_PROJECT": "pubg-saas-m2-test-01",
                "PUBG_SAAS_PG_EXEC_COMPOSE_FILE": str(compose),
                "PUBG_SAAS_PG_EXEC_ENV_FILE": str(env_file),
            }
            with patch.dict(os.environ, base_env, clear=False):
                base, project = TOOL.compose_base()
            self.assertEqual(project, "pubg-saas-m2-test-01")
            self.assertIn("--env-file", base)

            invalid = {**base_env, "PUBG_SAAS_PG_EXEC_PROJECT": "production"}
            with patch.dict(os.environ, invalid, clear=False), self.assertRaises(TOOL.ToolError):
                TOOL.compose_base()

    def test_backup_tool_preserves_only_nonsecret_compose_transport_settings(self):
        values = {
            "PUBG_SAAS_PG_EXEC_PROJECT": "pubg-saas-m2-test-01",
            "PUBG_SAAS_PG_EXEC_COMPOSE_FILE": "/tmp/compose.yaml",
            "PUBG_SAAS_PG_EXEC_ENV_FILE": "/tmp/.env",
            "PUBG_SAAS_DATABASE_URL": "postgresql://secret@localhost/db",
        }
        with patch.dict(os.environ, values, clear=False):
            env = BACKUP.minimal_environment()
        self.assertEqual(env["PUBG_SAAS_PG_EXEC_PROJECT"], values["PUBG_SAAS_PG_EXEC_PROJECT"])
        self.assertNotIn("PUBG_SAAS_DATABASE_URL", env)

    def test_connection_password_is_sent_only_in_passfile_stdin(self):
        values = {
            "PGHOST": "postgres",
            "PGPORT": "5432",
            "PGUSER": "backup_user",
            "PGDATABASE": "pubg_saas",
            "PGPASSWORD": "secret:never-in-argv",
            "PGSSLMODE": "disable",
        }
        with patch.dict(os.environ, values, clear=False):
            args, pass_file = TOOL.connection_env()
        self.assertNotIn(values["PGPASSWORD"], " ".join(args))
        self.assertIn(r"secret\:never-in-argv", pass_file["record"])
        self.assertNotIn(values["PGPASSWORD"], pass_file["path"])

    def test_external_database_host_is_rejected(self):
        values = {
            "PGHOST": "production.example.net",
            "PGUSER": "backup_user",
            "PGDATABASE": "pubg_saas",
            "PGPASSWORD": "local-only",
        }
        with patch.dict(os.environ, values, clear=False), self.assertRaisesRegex(TOOL.ToolError, "localhost"):
            TOOL.connection_env()


if __name__ == "__main__":
    unittest.main()
