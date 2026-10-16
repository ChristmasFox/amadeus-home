import importlib.util
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
import io
from contextlib import redirect_stdout
from datetime import datetime, timezone
from unittest.mock import patch

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "gate_autopilot.py"
spec = importlib.util.spec_from_file_location("gate_autopilot", MODULE_PATH)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
CANDIDATE_PATH = pathlib.Path(__file__).resolve().parents[1] / "gate-local-candidate.py"
candidate_spec = importlib.util.spec_from_file_location("gate_local_candidate", CANDIDATE_PATH)
candidate = importlib.util.module_from_spec(candidate_spec)
candidate_spec.loader.exec_module(candidate)


NOW = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
REPO = pathlib.Path("/fixture/repo")
INSTANCE = "gate-local-fixture"
BOT = "fixture-bot-01"
SHA = "a" * 40
PATHS = ["apps/pubg-saas/src/gateway.ts"]


def approval(**changes):
    return {
        "schema": gate.APPROVAL_SCHEMA,
        "repository": str(REPO),
        "environment": "gate-local",
        "instanceId": INSTANCE,
        "botAccountId": BOT,
        "riskCategories": ["reversible_app_candidate", "backward_compatible_schema", "destructive_schema_warning"],
        "approvedAt": "2026-10-01T00:00:00Z",
        **changes,
    }


def clearance(**changes):
    return {
        "schema": gate.CLEARANCE_SCHEMA,
        "repository": str(REPO),
        "environment": "gate-local",
        "instanceId": INSTANCE,
        "botAccountId": BOT,
        "acceptanceEvidenceRef": "m2-acceptance-fixture-01",
        "clearedAt": "2026-10-15T00:00:00Z",
        **changes,
    }


def facts(**changes):
    return {
        "targetTrusted": True,
        "instanceId": INSTANCE,
        "botAccountId": BOT,
        "activeGatewayCount": 1,
        "activeWorkerCount": 1,
        "releaseInProgress": False,
        "runtimeDrift": False,
        "backupRecoverable": True,
        "schemaCompatible": True,
        "requiresPgvector": False,
        "pgvectorAvailable": False,
        "activeSha": "b" * 40,
        **changes,
    }


def preflight(**changes):
    args = {
        "approval": approval(),
        "repository": REPO,
        "paths": PATHS,
        "instance_id": INSTANCE,
        "bot_account_id": BOT,
        "candidate_sha": SHA,
        "facts": facts(),
        "now": NOW,
    }
    args.update(changes)
    return gate.preflight_candidate(**args)


def operations(**overrides):
    calls = []
    values = {
        "build": lambda: calls.append("build") or {"digest": "sha256:" + "c" * 64, "sourceSha": SHA},
        "verify_target": lambda: calls.append("verify_target"),
        "backup": lambda: calls.append("backup") or {"recoverable": True},
        "migrate": lambda: calls.append("migrate"),
        "switch": lambda: calls.append("switch") or {"image": "previous"},
        "health": lambda: calls.append("health") or True,
        "smoke": lambda: calls.append("smoke") or True,
        "notify": lambda: calls.append("notify") or True,
        "audit": lambda result: calls.append("audit"),
        "rollback": lambda: calls.append("rollback"),
    }
    values.update(overrides)
    return values, calls


class GateAutopilotContracts(unittest.TestCase):
    def test_candidate_explicitly_requests_verified_full_postgres_backup(self):
        self.assertEqual(candidate.parse_candidate_command([
            "candidate", "--apply", "--approval-ref", "r5-gate-canary", "--database-backup", "full",
        ]), ("r5-gate-canary", True))
        self.assertEqual(candidate.parse_candidate_command([
            "candidate", "--apply", "--approval-ref", "r5-gate-canary",
        ]), ("r5-gate-canary", False))
        self.assertIsNone(candidate.parse_candidate_command([
            "candidate", "--apply", "--approval-ref", "r5-gate-canary", "--database-backup", "plain",
        ]))
        self.assertTrue(candidate.database_backup_required("reversible_app_candidate", False))
        self.assertTrue(candidate.database_backup_required("reversible_app_candidate", True))
        self.assertTrue(candidate.database_backup_required("backward_compatible_schema", False))

    def test_full_backup_rollback_preserves_postgres_owners_and_acl_metadata(self):
        dump = candidate.full_database_dump_shell()
        restore = candidate.full_database_restore_shell()
        self.assertIn("pg_dump -Fc", dump)
        self.assertNotIn("--no-owner", dump)
        self.assertNotIn("--no-acl", dump)
        self.assertIn("pg_restore --single-transaction --clean --if-exists", restore)
        self.assertNotIn("--no-owner", restore)
        self.assertNotIn("--no-acl", restore)

    def test_canary_tenant_selection_requires_one_marked_identifier(self):
        self.assertEqual(candidate.unique_test_tenant_id("1\n", "fixture-canary-01\n"), "fixture-canary-01")
        with self.assertRaisesRegex(candidate.CandidateError, "canary_test_tenant_not_unique"):
            candidate.unique_test_tenant_id("2\n", "fixture-canary-01\n")
        with self.assertRaisesRegex(candidate.CandidateError, "canary_test_tenant_unavailable"):
            candidate.unique_test_tenant_id("1\n", "not a tenant id\n")

    def test_live_canary_selector_uses_read_only_query_and_does_not_print_the_tenant_id(self):
        output = io.StringIO()
        with patch.object(candidate, "remote_compose", side_effect=[b"1\n", b"fixture-canary-01\n"]) as query:
            with redirect_stdout(output):
                tenant_id = candidate.select_existing_test_tenant("gate-ci-fixture", {}, BOT)
        self.assertEqual(tenant_id, "fixture-canary-01")
        self.assertEqual(output.getvalue(), "")
        self.assertIn("SELECT COUNT(DISTINCT t.tenant_id)", query.call_args_list[0].args[-1])
        self.assertIn("SELECT DISTINCT t.tenant_id", query.call_args_list[1].args[-1])

    def test_live_canary_selector_accepts_the_only_gate_local_tenant_when_unmarked(self):
        output = io.StringIO()
        with patch.object(candidate, "remote_compose", side_effect=[b"0\n", b"1\n", b"fixture-local-01\n"]) as query:
            with redirect_stdout(output):
                tenant_id = candidate.select_existing_test_tenant("gate-ci-fixture", {}, BOT)
        self.assertEqual(tenant_id, "fixture-local-01")
        self.assertEqual(output.getvalue(), "")
        self.assertIn("COUNT(DISTINCT t.tenant_id)", query.call_args_list[1].args[-1])
        self.assertIn("WHERE t.bot_account_id=", query.call_args_list[2].args[-1])

    def test_live_canary_selector_refuses_multiple_unmarked_gate_local_tenants(self):
        output = io.StringIO()
        with patch.object(candidate, "remote_compose", side_effect=[b"0\n", b"2\n"]) as query:
            with redirect_stdout(output):
                with self.assertRaisesRegex(candidate.CandidateError, "canary_test_tenant_not_unique"):
                    candidate.select_existing_test_tenant("gate-ci-fixture", {}, BOT)
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(query.call_count, 2)

    def test_canary_environment_writer_sends_tenant_id_only_on_stdin(self):
        output = io.StringIO()
        tenant_id = "fixture-canary-01"
        with patch.object(candidate, "remote") as remote:
            with redirect_stdout(output):
                candidate.set_remote_intelligence_canary("gate-ci-fixture", "/safe/gateway.env", tenant_id)
        self.assertEqual(output.getvalue(), "")
        self.assertNotIn(tenant_id, " ".join(remote.call_args.args))
        self.assertIn(tenant_id, remote.call_args.kwargs["input_data"].decode("utf-8"))

    def test_keg_only_homebrew_libpq_is_added_when_pg_restore_is_not_on_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            bin_dir = pathlib.Path(temporary) / "libpq" / "bin"
            bin_dir.mkdir(parents=True)
            executable = bin_dir / "pg_restore"
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o755)

            with patch.object(candidate.shutil, "which", return_value=None):
                path = candidate.path_with_libpq_pg_restore("/usr/bin", (bin_dir,))

        self.assertEqual(path.split(os.pathsep, 1)[0], str(bin_dir))

    def test_existing_pg_restore_path_is_preserved(self):
        with tempfile.TemporaryDirectory() as temporary:
            bin_dir = pathlib.Path(temporary)
            executable = bin_dir / "pg_restore"
            executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            executable.chmod(0o755)

            with patch.object(candidate.shutil, "which", return_value=str(executable)):
                path = candidate.path_with_libpq_pg_restore(str(bin_dir), (pathlib.Path("/missing"),))

        self.assertEqual(path, str(bin_dir))

    def test_gate_target_layout_is_discovered_from_active_compose_labels(self):
        layout = candidate.target_layout_from_labels(
            "pubg-saas-public", "gateway",
            "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas",
            "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas/compose.yaml",
        )
        self.assertEqual(layout["project"], "pubg-saas-public")
        self.assertEqual(layout["appDir"], "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas")
        self.assertEqual(layout["composeFile"],
                         "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas/compose.yaml")
        self.assertEqual(layout["envFile"],
                         "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas/.env")

    def test_remote_compose_labels_decode_as_output_not_command_arguments(self):
        app_dir = "/var/tmp/pubg-saas-live-0fefe78/repo/infra/pubg-saas"
        labels = f"pubg-saas-public\ngateway\n{app_dir}\n{app_dir}/compose.yaml\n".encode()
        with patch.object(candidate, "remote", side_effect=[b"gateway-container-id\n", labels]) as remote:
            layout = candidate.discover_remote_layout("pubg-saas-m2-clean")
        self.assertEqual(layout["appDir"], app_dir)
        self.assertEqual(layout["composeFile"], app_dir + "/compose.yaml")
        self.assertEqual(remote.call_count, 2)

    def test_gate_target_layout_rejects_untrusted_compose_labels(self):
        invalid = (
            ("lab", "gateway", "/var/tmp/repo/infra/pubg-saas", "/var/tmp/repo/infra/pubg-saas/compose.yaml"),
            ("pubg-saas", "worker", "/var/tmp/repo/infra/pubg-saas", "/var/tmp/repo/infra/pubg-saas/compose.yaml"),
            ("pubg-saas", "gateway", "/var/tmp/repo/infra/pubg-saas", "/tmp/other/compose.yaml"),
            ("pubg-saas", "gateway", "/var/tmp/repo/infra/pubg-saas", "/var/tmp/repo/infra/pubg-saas/../compose.yaml"),
            ("pubg-saas", "gateway", "/var/tmp/repo/infra/pubg-saas", "/var/tmp/repo/infra/pubg-saas/compose.yaml,/tmp/extra.yaml"),
        )
        for labels in invalid:
            with self.subTest(labels=labels):
                with self.assertRaises(candidate.CandidateError):
                    candidate.target_layout_from_labels(*labels)

    def test_candidate_error_labels_keep_runtime_blocks_distinct_from_authorization(self):
        self.assertEqual(candidate.deployment_status(candidate.OperatorAuthorizationRequired("m2_pause_active")),
                         "BLOCKED_OPERATOR_AUTHORIZATION")
        self.assertEqual(candidate.deployment_status(candidate.CandidateError("runtime_drift_or_unknown")),
                         "BLOCKED")

    def test_gate_and_shared_changes_trigger_rollout(self):
        self.assertEqual(gate.classify_changed_scope(PATHS), ("gate_only", None))
        self.assertEqual(gate.classify_changed_scope(["plugins/amadeus/src/owner.ts"])[0], "lab_only")
        self.assertEqual(gate.classify_changed_scope(PATHS + ["plugins/amadeus/src/owner.ts"]),
                         ("gate_only", None))
        self.assertEqual(gate.classify_changed_scope(["packages/pubg-domain/src/index.ts"]),
                         ("gate_only", None))
        self.assertEqual(gate.classify_changed_scope(["docs/GATE_MEMORY.md"])[0], "non_runtime")

    def test_missing_approval_fails_closed_and_legacy_expiry_is_ignored(self):
        self.assertEqual(preflight(approval=None)["status"], "READY_FOR_AUTO_ENABLE")
        self.assertEqual(preflight(approval=approval(expiresAt="2026-10-16T11:59:00Z"))["status"], "READY")
        self.assertEqual(preflight(approval=approval(botAccountId="other-bot"))["reason"],
                         "approval_target_mismatch")
        self.assertEqual(preflight(approval=approval(repository="/other/checkout"))["reason"],
                         "approval_checkout_mismatch")
        self.assertEqual(preflight(approval=approval(approvedAt="2026-10-16T12:01:00Z"))["reason"],
                         "approval_issued_at_invalid")

    def test_gate_approval_matches_linked_worktrees_by_git_common_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            primary = root / "primary"
            linked = root / "linked"
            primary.mkdir()
            subprocess.run(["git", "init", "-q", str(primary)], check=True)
            subprocess.run(["git", "-C", str(primary), "config", "user.name", "Fixture"], check=True)
            subprocess.run(["git", "-C", str(primary), "config", "user.email", "fixture@example.invalid"], check=True)
            (primary / "seed").write_text("fixture\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(primary), "add", "seed"], check=True)
            subprocess.run(["git", "-C", str(primary), "commit", "-qm", "fixture"], check=True)
            subprocess.run(["git", "-C", str(primary), "worktree", "add", "-q", "--detach", str(linked)], check=True)
            approved = approval(repository=str(primary))
            self.assertEqual(
                gate.validate_approval(approved, repository=linked, instance_id=INSTANCE,
                                       bot_account_id=BOT, risk="reversible_app_candidate", now=NOW),
                (True, "approved"),
            )
            unrelated = root / "unrelated"
            subprocess.run(["git", "init", "-q", str(unrelated)], check=True)
            self.assertEqual(
                gate.validate_approval(approved, repository=unrelated, instance_id=INSTANCE,
                                       bot_account_id=BOT, risk="reversible_app_candidate", now=NOW)[1],
                "approval_checkout_mismatch",
            )

    def test_paused_m2_without_clearance_does_not_block_safe_candidate(self):
        self.assertEqual(preflight()["status"], "READY")
        self.assertEqual(
            gate.validate_m2_clearance(None, repository=REPO, instance_id=INSTANCE,
                                       bot_account_id=BOT, now=NOW),
            (False, "m2_pause_active"),
        )
        self.assertEqual(
            gate.validate_m2_clearance(clearance(), repository=REPO, instance_id=INSTANCE,
                                       bot_account_id=BOT, now=NOW),
            (True, "m2_cleared"),
        )

    def test_portable_image_identity_ignores_docker_id_normalization_but_binds_full_config_and_layers(self):
        host = {
            "Id": "sha256:" + "a" * 64,
            "Os": "linux",
            "Architecture": "arm64",
            "Variant": "v8",
            "Config": {"Env": ["NODE_ENV=production"], "Labels": {"revision": SHA}},
            "RootFS": {"Layers": ["sha256:" + "b" * 64, "sha256:" + "c" * 64]},
        }
        imported = {**host, "Id": "sha256:" + "d" * 64}
        self.assertEqual(candidate.portable_image_identity(host), candidate.portable_image_identity(imported))
        changed_config = {**host, "Config": {**host["Config"], "Labels": {"revision": "e" * 40}}}
        changed_layer = {**host, "RootFS": {"Layers": ["sha256:" + "f" * 64, "sha256:" + "c" * 64]}}
        self.assertNotEqual(candidate.portable_image_identity(host), candidate.portable_image_identity(changed_config))
        self.assertNotEqual(candidate.portable_image_identity(host), candidate.portable_image_identity(changed_layer))
        with self.assertRaises(candidate.CandidateError):
            candidate.portable_image_identity({**host, "Architecture": ""})

    def test_migration_inventory_excludes_only_the_optional_pgvector_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration_dir = root / "apps/pubg-saas/src/infrastructure/postgres/migrations"
            migration_dir.mkdir(parents=True)
            (root / "apps/pubg-saas/src/infrastructure/postgres/migrate.ts").write_text(
                "const migrationIds = ['0041_add.sql'] as const;", encoding="utf-8",
            )
            (migration_dir / "0041_add.sql").write_text("CREATE TABLE gate_fixture(id INTEGER);", encoding="utf-8")
            (migration_dir / candidate.OPTIONAL_MIGRATION).write_text(
                "CREATE EXTENSION vector;", encoding="utf-8",
            )
            applied, excluded = candidate.migration_inventory([
                "apps/pubg-saas/src/infrastructure/postgres/migrations/0041_add.sql",
                "apps/pubg-saas/src/infrastructure/postgres/migrations/0025_gate_memory_pgvector.sql",
            ], root)
        self.assertEqual([row["path"] for row in applied], [
            "apps/pubg-saas/src/infrastructure/postgres/migrations/0041_add.sql",
        ])
        self.assertEqual([row["path"] for row in excluded], [
            "apps/pubg-saas/src/infrastructure/postgres/migrations/0025_gate_memory_pgvector.sql",
        ])
        self.assertEqual(excluded[0]["execution"], "excluded-from-migratePublicDatabase")

    def test_protected_database_checkpoint_dumps_the_whole_database(self):
        command = candidate.full_database_dump_shell()
        self.assertIn("pg_dump -Fc", command)
        self.assertIn("-d pubg_saas", command)
        self.assertNotIn("-n public", command)
        self.assertNotIn("--schema=public", command)

    def test_duplicate_sha_and_runtime_dual_bot_or_drift_stop(self):
        self.assertEqual(preflight(facts=facts(activeSha=SHA))["status"], "ALREADY_CURRENT")
        self.assertEqual(preflight(facts=facts(activeGatewayCount=2))["reason"], "dual_or_missing_runtime")
        self.assertEqual(preflight(facts=facts(botAccountId="other-bot"))["reason"], "bot_identity_mismatch")
        self.assertEqual(preflight(facts=facts(runtimeDrift=True))["status"], "READY")
        self.assertEqual(preflight(facts=facts(releaseInProgress=True))["reason"], "release_in_progress")

    def test_backup_schema_vector_and_target_gates_fail_closed(self):
        self.assertEqual(preflight(facts=facts(backupRecoverable=False))["reason"], "recoverable_backup_missing")
        self.assertEqual(preflight(facts=facts(schemaCompatible=False))["reason"], "schema_incompatible_or_unknown")
        self.assertEqual(preflight(facts=facts(requiresPgvector=True, pgvectorAvailable=False))["reason"],
                         "separate_pgvector_authorization_required")
        self.assertEqual(preflight(facts=facts(targetTrusted=False))["reason"], "target_identity_untrusted")

    def test_missing_changed_migration_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            result = gate.migration_risk(
                ["apps/pubg-saas/src/infrastructure/postgres/migrations/0042_missing.sql"], root,
            )
        self.assertEqual(result, ("unreviewed_migration", "migration_source_missing_or_untrusted"))

    def test_candidate_migration_delta_uses_active_image_source(self):
        migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/0022_scoped_agent_conversation.sql"
        with patch.object(candidate, "command", side_effect=[b"", b"", migration.encode() + b"\0"]) as run:
            self.assertEqual(candidate.candidate_migration_paths("b" * 40, "a" * 40, []), [migration])
        self.assertEqual(run.call_count, 3)

    def test_candidate_migration_delta_fails_closed_for_unknown_lineage(self):
        with patch.object(candidate, "command", side_effect=candidate.CandidateError("command_failed")):
            with self.assertRaisesRegex(candidate.CandidateError, "active_image_source_lineage_invalid"):
                candidate.candidate_migration_paths("b" * 40, "a" * 40, [])

    def test_symlinked_changed_migration_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            target = root / "actual.sql"
            target.write_text("CREATE TABLE example(id INTEGER);\n", encoding="utf-8")
            migration = root / "apps/pubg-saas/src/infrastructure/postgres/migrations/0042_link.sql"
            migration.parent.mkdir(parents=True)
            migration.symlink_to(target)
            result = gate.migration_risk(
                ["apps/pubg-saas/src/infrastructure/postgres/migrations/0042_link.sql"], root,
            )
        self.assertEqual(result, ("unreviewed_migration", "migration_source_missing_or_untrusted"))

    def test_symlinked_migration_parent_and_path_traversal_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            outside = root / "outside"
            outside.mkdir()
            (outside / "0042_link.sql").write_text("CREATE TABLE example(id INTEGER);\n", encoding="utf-8")
            postgres = root / "apps/pubg-saas/src/infrastructure/postgres"
            postgres.parent.mkdir(parents=True)
            postgres.symlink_to(outside, target_is_directory=True)
            linked = "apps/pubg-saas/src/infrastructure/postgres/migrations/0042_link.sql"
            self.assertEqual(gate.migration_risk([linked], root),
                             ("unreviewed_migration", "migration_source_missing_or_untrusted"))
            escaped = linked + "/../../../../../../../../outside/0042_link.sql"
            self.assertEqual(gate.migration_risk([escaped], root),
                             ("unreviewed_migration", "migration_source_missing_or_untrusted"))

    def test_pipeline_orders_backup_before_migration_and_switch(self):
        ops, calls = operations()
        result = gate.run_candidate_pipeline(ops)
        self.assertEqual(result["status"], "DEPLOYED_AND_NOTIFIED")
        self.assertLess(calls.index("backup"), calls.index("migrate"))
        self.assertLess(calls.index("migrate"), calls.index("switch"))
        self.assertLess(calls.index("health"), calls.index("smoke"))
        self.assertLess(calls.index("smoke"), calls.index("notify"))
        self.assertEqual(calls[-1], "audit")

    def test_backup_failure_never_migrates_or_switches(self):
        ops, calls = operations()
        ops["backup"] = lambda: calls.append("backup") or {"recoverable": False}
        result = gate.run_candidate_pipeline(ops)
        self.assertEqual(result["reason"], "recoverable_backup_missing")
        self.assertNotIn("migrate", calls)
        self.assertNotIn("switch", calls)
        self.assertIn("audit", calls)

    def test_health_failure_rolls_back_and_reports_rollback_failure(self):
        ops, calls = operations()
        ops["health"] = lambda: calls.append("health") or False
        result = gate.run_candidate_pipeline(ops)
        self.assertEqual(result["status"], "ROLLED_BACK")
        self.assertIn("rollback", calls)
        ops, _ = operations(health=lambda: False, rollback=lambda: (_ for _ in ()).throw(RuntimeError()))
        result = gate.run_candidate_pipeline(ops)
        self.assertEqual(result["reason"], "rollback_failed_manual_recovery_required")

    def test_notification_failure_is_explicit_and_candidate_is_not_called_live_verified(self):
        ops, calls = operations()
        ops["notify"] = lambda: calls.append("notify") or False
        result = gate.run_candidate_pipeline(ops)
        self.assertEqual(result["status"], "DEPLOYED_NOTIFICATION_FAILED")
        self.assertNotIn("LIVE_VERIFIED", result["status"])
        self.assertIn("audit", calls)

    def test_gate_migration_risk_warns_for_destructive_sql_but_blocks_pgvector(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_fixture.sql"
            file_path = root / migration
            file_path.parent.mkdir(parents=True)
            file_path.write_text("CREATE EXTENSION vector;", encoding="utf-8")
            self.assertEqual(gate.migration_risk([migration], root),
                             ("extension_install", "separate_extension_authorization_required"))
            file_path.write_text("DROP TABLE gate_memory_entries;", encoding="utf-8")
            self.assertEqual(gate.migration_risk([migration], root),
                             ("destructive_schema_warning", "destructive_database_operation_warning_only"))

    def test_migration_classifier_allows_additive_schema_and_preserves_dollar_bodies(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_additive.sql"
            file_path = root / migration
            file_path.parent.mkdir(parents=True)
            file_path.write_text(
                """-- Punctuation in comments must not become executable SQL.
                CREATE TABLE gate_fixture (id UUID PRIMARY KEY);
                CREATE INDEX idx_gate_fixture_id ON gate_fixture(id);
                CREATE FUNCTION gate_fixture_noop() RETURNS VOID LANGUAGE plpgsql AS $body$
                BEGIN
                  PERFORM 1;
                  PERFORM 2;
                END;
                $body$;
                """,
                encoding="utf-8",
            )
            self.assertEqual(gate.migration_risk([migration], root), ("backward_compatible_schema", None))

    def test_destructive_migrations_warn_while_privilege_or_unknown_sql_stays_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_fixture.sql"
            file_path = root / migration
            file_path.parent.mkdir(parents=True)
            safe = (
                "CREATE UNIQUE INDEX idx_fixture ON gate_memory_entries(memory_key);",
                "ALTER TABLE gate_memory_entries ADD COLUMN flag TEXT DEFAULT 'x';",
                "CREATE FUNCTION fixture() RETURNS int LANGUAGE SQL AS $$ SELECT 1 $$;",
            )
            for sql in safe:
                with self.subTest(sql=sql):
                    file_path.write_text(sql)
                    self.assertEqual(gate.migration_risk([migration], root), ("backward_compatible_schema", None))
            warned = (
                "UPDATE gate_memory_entries SET content='new' WHERE memory_id='123';",
                "DELETE FROM gate_memory_entries;",
                "DROP TABLE gate_memory_entries;",
                "DROP INDEX idx_gate_memory_entries;",
                "TRUNCATE gate_memory_entries;",
                "UPDATE gate_memory_entries SET content='gone';",
                "ALTER TABLE gate_memory_entries DROP COLUMN content;",
                "ALTER TABLE gate_memory_entries DROP CONSTRAINT old_check;",
                "MERGE INTO gate_memory_entries USING src ON true WHEN MATCHED THEN DELETE;",
            )
            for sql in warned:
                with self.subTest(sql=sql):
                    file_path.write_text(sql)
                    self.assertEqual(gate.migration_risk([migration], root),
                                     ("destructive_schema_warning", "destructive_database_operation_warning_only"))
            blocked = (
                ("CREATE EXTENSION pg_trgm;", "separate_extension_authorization_required"),
                ("GRANT ALL ON gate_memory_entries TO public;", "migration_security_change_requires_review"),
            )
            for sql, reason in blocked:
                with self.subTest(sql=sql):
                    file_path.write_text(sql)
                    self.assertEqual(gate.migration_risk([migration], root)[1], reason)

    def test_destructive_candidate_requires_scoped_authorization_and_reports_backup_warning(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_fixture.sql"
            source = root / migration
            source.parent.mkdir(parents=True)
            source.write_text("DROP TABLE gate_fixture;", encoding="utf-8")
            result = gate.preflight_candidate(
                approval=approval(repository=str(root)), repository=root, paths=[migration],
                instance_id=INSTANCE, bot_account_id=BOT, candidate_sha=SHA, facts=facts(), now=NOW,
            )
            self.assertEqual(result["status"], "READY")
            self.assertEqual(result["risk"], "destructive_schema_warning")
            self.assertEqual(result["reason"], "destructive_migration_warning_backup_required")

    def test_current_gate_memory_migrations_have_explicit_risk_profiles(self):
        root = MODULE_PATH.parent.parent
        paths = [f"apps/pubg-saas/src/infrastructure/postgres/migrations/{n:04d}_{name}.sql"
                 for n, name in (
                     (22, "scoped_agent_conversation"), (23, "kook_conversation_checkpoints"),
                     (24, "gate_memory_embedding_jobs"), (26, "gate_memory_retrieval_metadata"),
                     (27, "gate_memory_write_receipts"), (28, "gate_memory_consolidation"),
                     (29, "gate_memory_index_generations"))]
        self.assertEqual(gate.migration_risk(paths[:-1], root), ("backward_compatible_schema", None))
        self.assertEqual(gate.migration_risk(paths[-1:], root),
                         ("destructive_schema_warning", "destructive_database_operation_warning_only"))
        applied, _ = candidate.migration_inventory(paths, root)
        self.assertEqual(len(applied), 7)
        self.assertEqual(applied[-1]["riskCategory"], "destructive_schema_warning")

    def test_candidate_authorization_blocks_include_recovery_steps(self):
        self.assertIn("not required", candidate.recovery_step("m2_pause_active"))
        self.assertIn("failed step", candidate.recovery_step("candidate_step_failed"))
        self.assertIn("external audit", candidate.recovery_step("candidate_adapter_failed"))

    def test_external_state_is_private_and_mode_checked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            checkout = root / "repo"
            checkout.mkdir()
            private = root / "private"
            private.mkdir(mode=0o700)
            state_path = private / "approval.json"
            gate.write_private_state(state_path, checkout, {"schema": gate.APPROVAL_SCHEMA})
            self.assertEqual(state_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(gate.validate_private_state(state_path, checkout)[1], "ok")
            state_path.chmod(0o644)
            self.assertEqual(gate.validate_private_state(state_path, checkout)[1], "state_permissions_invalid")


if __name__ == "__main__":
    unittest.main()
