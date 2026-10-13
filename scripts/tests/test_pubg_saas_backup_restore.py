import hashlib
import importlib.util
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "pubg-saas-backup-restore.py"
SPEC = importlib.util.spec_from_file_location("pubg_saas_backup_restore", SCRIPT)
OPS = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(OPS)


class BackupRestoreSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pubg-saas-ops-fixture-")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def write_archive_and_manifest(self, *, counts=None, source="pubg_saas_test"):
        artifact = self.root / "fixture.dump.age"
        payload = b"synthetic encrypted bytes; no database fixture"
        artifact.write_bytes(payload)
        manifest = self.root / "fixture.manifest.json"
        table_counts = counts or {
            "public.schema_migrations": 10,
            "public.tenants": 2,
            "public.teams": 3,
            "public.matches": 11,
        }
        manifest.write_text(
            json.dumps(
                {
                    "schema": OPS.MANIFEST_SCHEMA,
                    "sourceDatabase": source,
                    "scope": "postgres-public-schema-only",
                    "encryption": "age",
                    "artifact": artifact.name,
                    "artifactSha256": hashlib.sha256(payload).hexdigest(),
                    "artifactBytes": len(payload),
                    "publicTableCounts": table_counts,
                }
            ),
            encoding="utf-8",
        )
        return artifact, manifest

    def test_connection_uri_is_moved_to_libpq_environment_not_arguments(self):
        env, database = OPS.pg_environment(
            "postgresql://backup_user:never-log-this@localhost:55432/pubg_saas_test?sslmode=require"
        )
        self.assertEqual(database, "pubg_saas_test")
        self.assertEqual(env["PGHOST"], "localhost")
        self.assertEqual(env["PGPORT"], "55432")
        self.assertEqual(env["PGUSER"], "backup_user")
        self.assertEqual(env["PGPASSWORD"], "never-log-this")
        self.assertEqual(env["PGSSLMODE"], "require")
        self.assertNotIn("PUBG_SAAS_DATABASE_URL", env)
        self.assertNotIn("PUBG_SAAS_RESTORE_ADMIN_URL", env)

    def test_archive_checksum_and_counts_validate_from_synthetic_fixture(self):
        artifact, manifest = self.write_archive_and_manifest()
        resolved_artifact, resolved_manifest, values = OPS.validate_archive(str(artifact), str(manifest))
        self.assertEqual(resolved_artifact, artifact.resolve())
        self.assertEqual(resolved_manifest, manifest.resolve())
        self.assertEqual(values["publicTableCounts"]["public.teams"], 3)

    def test_modified_archive_is_rejected_by_checksum(self):
        artifact, manifest = self.write_archive_and_manifest()
        artifact.write_bytes(b"tampered synthetic bytes")
        with self.assertRaisesRegex(OPS.OpsError, "checksum"):
            OPS.validate_archive(str(artifact), str(manifest))

    def test_manifest_rejects_private_runtime_schema_names(self):
        artifact, manifest = self.write_archive_and_manifest(
            counts={
                "public.schema_migrations": 10,
                "public.tenants": 2,
                "public.teams": 3,
                "public.matches": 11,
                "public.openclaw_state": 1,
            }
        )
        with self.assertRaisesRegex(OPS.OpsError, "non-public SaaS"):
            OPS.validate_archive(str(artifact), str(manifest))

    def test_private_runtime_database_identity_is_rejected(self):
        artifact, manifest = self.write_archive_and_manifest(source="private_openclaw")
        with self.assertRaisesRegex(OPS.OpsError, "source database"):
            OPS.validate_archive(str(artifact), str(manifest))

    def test_disposable_target_requires_namespace_and_exact_confirmation(self):
        name = "pubg_saas_disposable_clean_host_01"
        OPS.validate_disposable_target(name, name)
        with self.assertRaisesRegex(OPS.OpsError, "exactly match"):
            OPS.validate_disposable_target(name, "pubg_saas_disposable_other")
        with self.assertRaisesRegex(OPS.OpsError, "disposable namespace"):
            OPS.validate_disposable_target("pubg_saas_production", "pubg_saas_production")

    def test_restore_requires_apply_before_any_connection_or_mutation(self):
        args = Namespace(apply=False)
        with self.assertRaisesRegex(OPS.OpsError, "pass --apply"):
            OPS.command_restore(args)

    def test_repository_paths_are_rejected_for_backup_artifacts(self):
        with self.assertRaisesRegex(OPS.OpsError, "outside the Git repository"):
            OPS.outside_repo(OPS.REPO_ROOT / "private-fixture.age", "encrypted backup")


if __name__ == "__main__":
    unittest.main()
