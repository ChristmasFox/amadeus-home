import hashlib
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from argparse import Namespace
from datetime import datetime, timedelta, timezone
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

    def write_prune_pair(self, *, created_at, basename):
        artifact = self.root / f"{basename}.dump.age"
        payload = f"synthetic encrypted bytes: {basename}".encode()
        artifact.write_bytes(payload)
        manifest = self.root / f"{basename}.manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema": OPS.MANIFEST_SCHEMA,
                    "createdAtUtc": created_at.isoformat(),
                    "sourceDatabase": "pubg_saas_test",
                    "scope": "postgres-public-schema-only",
                    "encryption": "age",
                    "artifact": artifact.name,
                    "artifactSha256": hashlib.sha256(payload).hexdigest(),
                    "artifactBytes": len(payload),
                    "publicTableCounts": {
                        "public.schema_migrations": 10,
                        "public.tenants": 2,
                        "public.teams": 3,
                        "public.matches": 11,
                    },
                }
            ),
            encoding="utf-8",
        )
        timestamp = created_at.timestamp()
        os.utime(artifact, (timestamp, timestamp))
        os.utime(manifest, (timestamp, timestamp))
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

    def test_restore_toc_omits_only_the_preexisting_public_schema_creation(self):
        toc = (
            "; PostgreSQL archive TOC\n"
            "4; 2615 2200 SCHEMA - public pg_database_owner\n"
            "42; 1259 9001 TABLE public teams pubg_migrator\n"
            "43; 0 0 COMMENT - SCHEMA public pg_database_owner\n"
        )
        restored = OPS.restore_list_without_public_schema(toc)
        self.assertNotIn("SCHEMA - public", restored)
        self.assertIn("TABLE public teams", restored)
        self.assertIn("COMMENT - SCHEMA public", restored)

    def test_restore_toc_rejects_missing_or_duplicate_public_schema_entry(self):
        for toc in (
            "; no schema creation\n42; 1259 9001 TABLE public teams pubg_migrator\n",
            "4; 2615 2200 SCHEMA - public owner\n5; 2615 2200 SCHEMA - public owner\n",
        ):
            with self.subTest(toc=toc), self.assertRaisesRegex(OPS.OpsError, "exactly one public schema"):
                OPS.restore_list_without_public_schema(toc)

    def test_restored_roles_keep_runtime_dml_and_migration_boundaries(self):
        sql = OPS.recovery_access_sql("pubg_saas_disposable_clean_host_01")
        self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES", sql)
        self.assertIn("TO pubg_app", sql)
        self.assertIn("ALTER DEFAULT PRIVILEGES FOR ROLE pubg_migrator", sql)
        self.assertNotIn("GRANT CREATE ON SCHEMA public TO pubg_app", sql)

    def test_retention_removes_expired_matching_pairs_and_keeps_recent_backups(self):
        now = datetime.now(timezone.utc)
        expired = self.write_prune_pair(
            created_at=now - timedelta(days=8),
            basename="pubg-saas-20261006T120000Z-0123abcd",
        )
        recent = self.write_prune_pair(
            created_at=now - timedelta(days=2),
            basename="pubg-saas-20261012T120000Z-fedcba98",
        )
        args = Namespace(
            output_dir=str(self.root),
            confirm_output_dir=str(self.root),
            retention_days=7,
            apply=True,
        )
        output = io.StringIO()
        with redirect_stdout(output):
            OPS.command_prune(args)
        self.assertIn("REMOVED_PAIRS=1", output.getvalue())
        self.assertFalse(expired[0].exists())
        self.assertFalse(expired[1].exists())
        self.assertTrue(recent[0].exists())
        self.assertTrue(recent[1].exists())

    def test_retention_requires_apply_exact_directory_and_at_least_seven_days(self):
        base = {
            "output_dir": str(self.root),
            "confirm_output_dir": str(self.root),
            "retention_days": 7,
            "apply": False,
        }
        with self.assertRaisesRegex(OPS.OpsError, "pass --apply"):
            OPS.command_prune(Namespace(**base))
        with self.assertRaisesRegex(OPS.OpsError, "between 7 and"):
            OPS.command_prune(Namespace(**{**base, "apply": True, "retention_days": 6}))
        with self.assertRaisesRegex(OPS.OpsError, "exactly match"):
            OPS.command_prune(Namespace(**{**base, "apply": True, "confirm_output_dir": str(self.root / "other")}))

    def test_retention_preserves_expired_artifact_with_invalid_checksum(self):
        old = datetime.now(timezone.utc) - timedelta(days=8)
        pair = self.write_prune_pair(
            created_at=old,
            basename="pubg-saas-20261006T120000Z-bad0cafe",
        )
        pair[0].write_bytes(b"corrupted encrypted archive")
        os.utime(pair[0], (old.timestamp(), old.timestamp()))
        args = Namespace(
            output_dir=str(self.root),
            confirm_output_dir=str(self.root),
            retention_days=7,
            apply=True,
        )
        with self.assertRaisesRegex(OPS.OpsError, "checksum"):
            OPS.command_prune(args)
        self.assertTrue(pair[0].exists())
        self.assertTrue(pair[1].exists())

    def test_repository_paths_are_rejected_for_backup_artifacts(self):
        with self.assertRaisesRegex(OPS.OpsError, "outside the Git repository"):
            OPS.outside_repo(OPS.REPO_ROOT / "private-fixture.age", "encrypted backup")


if __name__ == "__main__":
    unittest.main()
