import importlib.util
import pathlib
import tempfile
import unittest
from datetime import datetime, timezone

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
        "riskCategories": ["reversible_app_candidate", "backward_compatible_schema"],
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
        "clearance": clearance(),
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
    def test_candidate_error_labels_keep_runtime_blocks_distinct_from_authorization(self):
        self.assertEqual(candidate.deployment_status(candidate.OperatorAuthorizationRequired("m2_pause_active")),
                         "BLOCKED_OPERATOR_AUTHORIZATION")
        self.assertEqual(candidate.deployment_status(candidate.CandidateError("runtime_drift_or_unknown")),
                         "BLOCKED")

    def test_gate_only_scope_and_product_separation(self):
        self.assertEqual(gate.classify_changed_scope(PATHS), ("gate_only", None))
        self.assertEqual(gate.classify_changed_scope(["plugins/amadeus/src/owner.ts"])[0], "lab_only")
        self.assertEqual(gate.classify_changed_scope(PATHS + ["plugins/amadeus/src/owner.ts"]),
                         ("mixed_lab_gate", "cross_product_change"))
        self.assertEqual(gate.classify_changed_scope(["packages/pubg-domain/src/index.ts"])[1],
                         "shared_package_change")
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

    def test_paused_or_wrong_scope_m2_clearance_blocks_apply(self):
        self.assertEqual(preflight(clearance=None)["reason"], "m2_pause_active")
        self.assertEqual(preflight(clearance=clearance(instanceId="other-instance"))["reason"],
                         "m2_clearance_target_mismatch")
        self.assertEqual(preflight(clearance=clearance(expiresAt="2026-10-16T11:59:00Z"))["status"], "READY")
        self.assertEqual(preflight(clearance=clearance(clearedAt="2026-10-16T12:01:00Z"))["reason"],
                         "m2_clearance_issued_at_invalid")

    def test_duplicate_sha_and_runtime_dual_bot_or_drift_stop(self):
        self.assertEqual(preflight(facts=facts(activeSha=SHA))["status"], "ALREADY_CURRENT")
        self.assertEqual(preflight(facts=facts(activeGatewayCount=2))["reason"], "dual_or_missing_runtime")
        self.assertEqual(preflight(facts=facts(botAccountId="other-bot"))["reason"], "bot_identity_mismatch")
        self.assertEqual(preflight(facts=facts(runtimeDrift=True))["reason"], "runtime_drift_or_unknown")
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

    def test_gate_migration_risk_never_auto_authorizes_pgvector_or_destructive_sql(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_fixture.sql"
            file_path = root / migration
            file_path.parent.mkdir(parents=True)
            file_path.write_text("CREATE EXTENSION vector;", encoding="utf-8")
            self.assertEqual(gate.migration_risk([migration], root),
                             ("pgvector_install", "separate_pgvector_authorization_required"))
            file_path.write_text("DROP TABLE gate_memory_entries;", encoding="utf-8")
            self.assertEqual(gate.migration_risk([migration], root),
                             ("destructive_schema", "separate_schema_authorization_required"))

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

    def test_migration_classifier_blocks_data_and_unreviewed_statements(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_risk.sql"
            file_path = root / migration
            file_path.parent.mkdir(parents=True)
            cases = (
                ("DELETE FROM gate_memory_entries;", ("data_migration", "separate_data_migration_authorization_required")),
                ("TRUNCATE gate_memory_entries;", ("destructive_schema", "separate_schema_authorization_required")),
                ("ALTER TABLE gate_memory_entries ALTER COLUMN content TYPE TEXT;",
                 ("destructive_schema", "separate_schema_authorization_required")),
                ("ALTER TABLE gate_memory_entries ADD COLUMN required_value TEXT NOT NULL DEFAULT 'x';",
                 ("destructive_schema", "separate_schema_authorization_required")),
                ("CREATE UNIQUE INDEX gate_memory_key_unique ON gate_memory_entries(memory_key);",
                 ("destructive_schema", "separate_schema_authorization_required")),
                ("SELECT 1;", ("unreviewed_migration", "migration_statement_not_allowlisted")),
                ("GRANT ALL ON gate_memory_entries TO public;",
                 ("unreviewed_migration", "migration_security_change_requires_review")),
                ("CREATE FUNCTION unsafe() RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN END $$;",
                 ("unreviewed_migration", "migration_function_requires_review")),
                ("CREATE EXTENSION pg_trgm;", ("extension_install", "separate_extension_authorization_required")),
                ("ALTER TABLE gate_memory_entries ADD COLUMN embedding extensions.vector;",
                 ("pgvector_install", "separate_pgvector_authorization_required")),
            )
            for sql, expected in cases:
                with self.subTest(sql=sql):
                    file_path.write_text(sql, encoding="utf-8")
                    self.assertEqual(gate.migration_risk([migration], root), expected)

    def test_candidate_authorization_blocks_include_recovery_steps(self):
        self.assertIn("gate-m2-clear", candidate.recovery_step("m2_pause_active"))
        self.assertIn("backup", candidate.recovery_step("separate_data_migration_authorization_required"))
        self.assertIn("failed step", candidate.recovery_step("candidate_step_failed"))
        self.assertIn("external audit", candidate.recovery_step("candidate_adapter_failed"))

    def test_preflight_requires_separate_authorization_for_data_migrations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            migration = "apps/pubg-saas/src/infrastructure/postgres/migrations/9999_data.sql"
            target = root / migration
            target.parent.mkdir(parents=True)
            target.write_text("UPDATE gate_memory_entries SET content='redacted';", encoding="utf-8")
            result = preflight(repository=root, paths=[migration])
        self.assertEqual(result["status"], "BLOCKED_OPERATOR_AUTHORIZATION")
        self.assertEqual(result["reason"], "separate_data_migration_authorization_required")

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
