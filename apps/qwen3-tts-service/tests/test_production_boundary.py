import json
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import production_boundary as boundary
import production_boundary_runtime as runtime
import analyze_production_boundary as analyzer


class ProductionBoundaryFixtureTest(unittest.TestCase):
    def test_fixture_manifest_has_two_exact_unicode_codepoint_fixtures_per_bucket(self):
        fixtures, digest = boundary.load_fixture_manifest()
        self.assertEqual(len(digest), 64)
        self.assertEqual(tuple(fixtures), boundary.HISTORICAL_LENGTHS)
        self.assertEqual(tuple(n for n in fixtures if n in boundary.LENGTHS), boundary.LENGTHS)
        for length, families in fixtures.items():
            self.assertEqual(set(families), {"A", "B"})
            for item in families.values():
                self.assertEqual(len(item["text"]), length)
                self.assertEqual(item["target_codepoints"], length)
                self.assertFalse(any(ch.isspace() for ch in item["text"]))
                self.assertTrue(item["text"].endswith("。"))


class ProductionBoundaryScheduleTest(unittest.TestCase):
    def test_five_cycle_schedule_is_reproducible_balanced_and_spread(self):
        a = boundary.matrix_schedule()
        b = boundary.matrix_schedule()
        self.assertEqual(a, b)
        self.assertEqual(len(a), 200)
        self.assertEqual(boundary.schedule_sha256(a), boundary.schedule_sha256(b))
        historical = boundary.historical_matrix_schedule()
        expected = [row for row in historical if row["length"] in boundary.LENGTHS]
        self.assertEqual([row["source_order_index"] for row in a],
                         [row["order_index"] for row in expected])
        self.assertEqual(boundary.schedule_sha256(historical),
                         "ccf30683b6b1cf0d6c7ce69ec9876466d1c09393857c220bafa4ffeed0141a3f")
        for length in boundary.LENGTHS:
            for family in ("A", "B"):
                selected = [r for r in a if r["length"] == length and r["family"] == family]
                self.assertEqual(len(selected), 10)
                self.assertEqual({r["cycle"] for r in selected}, set(range(5)))
                self.assertEqual({r["fixture_run_index"] for r in selected}, set(range(10)))

    def test_quantile_uses_type_7_linear_interpolation(self):
        self.assertEqual(boundary.quantile([], 0.5), None)
        self.assertEqual(boundary.quantile([1, 2, 3, 4], 0.5), 2.5)
        self.assertAlmostEqual(boundary.quantile(list(range(1, 21)), 0.95), 19.05)
        summary = boundary.summarize([1, 2, 3, 4])
        self.assertEqual(summary["n"], 4)
        self.assertEqual(summary["p50"], 2.5)
        self.assertAlmostEqual(summary["p95"], 3.85)
        self.assertEqual(summary["max"], 4.0)

    def test_production_log_parser_extracts_only_sanitized_numeric_fields(self):
        line = ("speech_synthesis_ok model=qwen3-tts-1.7b voice=kurisu-v1 format=mp3 input_chars=<=80 "
                "audio_ms=3000 queue_wait_ms=2.5 generate_or_model_ms=1000.0 "
                "decode_stage=inside_model_api wav_serialize_ms=20.0 engine_inside_lock_ms=1020.0 "
                "encode_ms=15 total_ms=1042 rtf=0.340")
        parsed = boundary.parse_service_log_line(line)
        self.assertEqual(parsed["audio_duration_ms"], 3000)
        self.assertEqual(parsed["generate_or_model_ms"], 1000.0)
        self.assertNotIn("text", parsed)

    def test_representative_selection_is_nearest_fixture_a_median_then_run_index(self):
        rows = [
            {"success": True, "family": "A", "fixture_run_index": i, "total_ms": value}
            for i, value in enumerate((90, 100, 110, 120, 130, 140, 150, 160, 170, 180))
        ]
        chosen = boundary.representative_a_sample(rows)
        self.assertEqual(chosen["fixture_run_index"], 4)
        rows[4]["total_ms"] = 135
        rows[5]["total_ms"] = 125
        chosen = boundary.representative_a_sample(rows)
        self.assertEqual(chosen["fixture_run_index"], 4)


class ProductionBoundarySafetyTest(unittest.TestCase):
    def snapshot(self, *, memory=70, footprint=3 * runtime.GIB,
                 swap_used=10 * runtime.GIB, swap_free=2 * runtime.GIB,
                 disk_free=100 * runtime.GIB, pid=7, runs=1, route=True,
                 health_status="ready", http_status=200):
        return {
            "health": {"http_status": http_status, "status": health_status},
            "launchd": {"pid": pid, "runs": runs},
            "process": {"physical_footprint_bytes": footprint,
                        "physical_footprint_peak_bytes": 19 * runtime.GIB},
            "swap": {"used_bytes": swap_used, "free_bytes": swap_free},
            "memory_pressure": {"free_percent": memory},
            "startup_disk": {"available_bytes": disk_free},
            "host_route_ready": route,
        }

    def test_warning_swap_pauses_but_stable_host_resumes_with_evidence(self):
        baseline = 10 * runtime.GIB
        initial = self.snapshot(swap_used=baseline + 700 * runtime.MIB)
        confirmations = [
            self.snapshot(swap_used=baseline + 690 * runtime.MIB),
            self.snapshot(swap_used=baseline + 680 * runtime.MIB),
        ]
        with mock.patch.object(runtime.time, "sleep") as sleep, \
                mock.patch.object(runtime, "runtime_snapshot", side_effect=confirmations):
            result, reason = runtime.confirm_swap_stability(
                initial, expected_pid=7, baseline_swap_bytes=baseline,
                expected_runs=1)
        self.assertIsNone(reason)
        self.assertEqual(sleep.call_count, 2)
        check = result["swap_growth_check"]
        self.assertEqual(check["state"], "stable_or_recovering_elevated_swap")
        self.assertEqual(check["confirmation_count"], 2)
        self.assertEqual(len(check["confirmation_snapshots"]), 2)
        self.assertFalse(check["system_swap_is_standalone_stop"])
        self.assertEqual(runtime.SWAP_MAX_CONFIRMATION_WINDOWS, 6)

    def test_low_free_swap_alone_is_warning_not_hard_stop(self):
        baseline = 10 * runtime.GIB
        low_free = self.snapshot(swap_used=baseline, swap_free=400 * runtime.MIB)
        self.assertIsNone(runtime.safety_reason(
            low_free, expected_pid=7, baseline_swap_bytes=baseline, expected_runs=1))
        confirmations = [self.snapshot(swap_used=baseline, swap_free=400 * runtime.MIB) for _ in range(2)]
        with mock.patch.object(runtime.time, "sleep"), \
                mock.patch.object(runtime, "runtime_snapshot", side_effect=confirmations):
            result, reason = runtime.confirm_swap_stability(
                low_free, expected_pid=7, baseline_swap_bytes=baseline, expected_runs=1)
        self.assertIsNone(reason)
        self.assertEqual(result["swap_growth_check"]["state"], "stable_or_recovering_elevated_swap")

    def test_acknowledged_stable_swap_does_not_repause_until_material_worsening(self):
        control_baseline = 10 * runtime.GIB
        acknowledged_used = control_baseline + 1200 * runtime.MIB
        snapshot = self.snapshot(swap_used=acknowledged_used + 400 * runtime.MIB,
                                 swap_free=900 * runtime.MIB)
        with mock.patch.object(runtime.time, "sleep") as sleep:
            result, reason = runtime.confirm_swap_stability(
                snapshot, expected_pid=7, baseline_swap_bytes=control_baseline,
                expected_runs=1, warning_reference_used_bytes=acknowledged_used,
                warning_reference_free_bytes=1024 * runtime.MIB)
        self.assertIsNone(reason)
        self.assertEqual(sleep.call_count, 0)
        self.assertEqual(result["swap_growth_check"]["state"], "no_new_warning")

        worsened = self.snapshot(swap_used=acknowledged_used + 512 * runtime.MIB,
                                 swap_free=900 * runtime.MIB)
        confirmations = [
            self.snapshot(swap_used=acknowledged_used + 520 * runtime.MIB,
                          swap_free=890 * runtime.MIB),
            self.snapshot(swap_used=acknowledged_used + 515 * runtime.MIB,
                          swap_free=895 * runtime.MIB),
        ]
        with mock.patch.object(runtime.time, "sleep") as sleep, \
                mock.patch.object(runtime, "runtime_snapshot", side_effect=confirmations):
            result, reason = runtime.confirm_swap_stability(
                worsened, expected_pid=7, baseline_swap_bytes=control_baseline,
                expected_runs=1, warning_reference_used_bytes=acknowledged_used,
                warning_reference_free_bytes=1024 * runtime.MIB)
        self.assertIsNone(reason)
        self.assertEqual(sleep.call_count, 2)
        self.assertEqual(result["swap_growth_check"]["state"], "stable_or_recovering_elevated_swap")

    def test_acknowledged_low_free_swap_only_reconfirms_after_128_mib_drop(self):
        baseline = 10 * runtime.GIB
        acknowledged_free = 400 * runtime.MIB
        unchanged = self.snapshot(swap_used=baseline + 800 * runtime.MIB,
                                  swap_free=acknowledged_free)
        with mock.patch.object(runtime.time, "sleep") as sleep:
            result, reason = runtime.confirm_swap_stability(
                unchanged, expected_pid=7, baseline_swap_bytes=baseline,
                expected_runs=1, warning_reference_used_bytes=baseline + 800 * runtime.MIB,
                warning_reference_free_bytes=acknowledged_free)
        self.assertIsNone(reason)
        self.assertEqual(sleep.call_count, 0)
        self.assertEqual(result["swap_growth_check"]["state"], "no_new_warning")

    def test_large_swap_growth_requires_memory_or_footprint_corroboration(self):
        baseline = 10 * runtime.GIB
        large_delta = baseline + 2100 * runtime.MIB
        stable_host = self.snapshot(swap_used=large_delta, memory=70, footprint=3 * runtime.GIB)
        self.assertIsNone(runtime.safety_reason(
            stable_host, expected_pid=7, baseline_swap_bytes=baseline, expected_runs=1))
        self.assertEqual(runtime.swap_growth_state(large_delta, baseline)[0],
                         "large_growth_requires_pressure_corroboration")
        memory_distress = self.snapshot(swap_used=large_delta, memory=20)
        self.assertEqual(runtime.safety_reason(
            memory_distress, expected_pid=7, baseline_swap_bytes=baseline, expected_runs=1),
            "large_swap_growth_with_memory_distress")
        footprint_distress = self.snapshot(swap_used=large_delta, footprint=18 * runtime.GIB)
        self.assertEqual(runtime.safety_reason(
            footprint_distress, expected_pid=7, baseline_swap_bytes=baseline, expected_runs=1),
            "large_swap_growth_with_memory_distress")

    def test_non_swap_hard_stops_include_memory_footprint_pid_runs_route_and_health(self):
        base = self.snapshot()
        baseline_swap = base["swap"]["used_bytes"]
        kwargs = {"expected_pid": 7, "baseline_swap_bytes": baseline_swap, "expected_runs": 1}
        self.assertIsNone(runtime.safety_reason(base, **kwargs))
        cases = (
            (self.snapshot(memory=10), "critical_memory_pressure_free_at_or_below_10_percent"),
            (self.snapshot(footprint=20 * runtime.GIB), "physical_footprint_reached_20_gib_safety_guard"),
            (self.snapshot(pid=8), "launchagent_pid_changed"),
            (self.snapshot(runs=2), "launchagent_restart_count_changed"),
            (self.snapshot(route=False), "9router_host_tts_route_unhealthy"),
            (self.snapshot(health_status="unreachable", http_status=None), "health_not_ready"),
            (self.snapshot(disk_free=19 * runtime.GIB,
                           swap_used=baseline_swap + 600 * runtime.MIB),
             "startup_disk_free_below_20_gib_with_swap_warning"),
        )
        for snapshot, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(runtime.safety_reason(snapshot, **kwargs), expected)

    def test_three_snapshot_admission_gate_checks_stable_live_control(self):
        snapshots = [
            self.snapshot(memory=74, swap_used=6 * runtime.GIB + n * 10 * runtime.MIB)
            for n in (0, 1, 2)
        ]
        self.assertIsNone(runtime.admission_baseline_reason(snapshots))
        self.assertEqual(runtime.admission_baseline_reason(snapshots[:2]),
                         "admission_requires_three_snapshots")
        changed = [dict(s) for s in snapshots]
        changed[2] = {**changed[2], "launchd": {"pid": 8, "runs": 2}}
        self.assertEqual(runtime.admission_baseline_reason(changed),
                         "admission_launchagent_changed")
        swap_rising = [self.snapshot(swap_used=6 * runtime.GIB + n * 100 * runtime.MIB) for n in range(3)]
        self.assertEqual(runtime.admission_baseline_reason(swap_rising),
                         "admission_swap_not_stable_or_declining")

class ProductionBoundaryReportTest(unittest.TestCase):
    def test_related_attempt_is_verified_and_warmups_stay_out_of_primary_statistics(self):
        _, fixture_sha = boundary.load_fixture_manifest()
        schedule = boundary.matrix_schedule()
        schedule_sha = boundary.schedule_sha256(schedule)
        invariants = {
            "control_id": boundary.CONTROL_ID,
            "git_commit": "commit",
            "version": "1.6.2",
            "service_source_sha256": "service-sha",
            "engine_source_config_sha256": "engine-sha",
            "engine": "mlx",
            "voice_profile_id": "kurisu-v1",
            "language": "Auto",
            "launchd_process_type": "Interactive",
            "response_format": "mp3",
            "workers": 1,
            "pending_slots": 1,
            "pending_start_timeout_s": 5,
            "openclaw_external_timeout_ms": 120000,
            "max_text_codepoints": 1200,
        }
        primary_run = {"control_id": boundary.CONTROL_ID}
        primary_control = {**invariants}
        snapshot = {
            "swap": {"used_bytes": 1000},
            "memory_pressure": {"free_percent": 70},
            "launchd": {"pid": 7},
        }
        with tempfile.TemporaryDirectory() as temp:
            related = Path(temp) / "related"
            related.mkdir(mode=0o700)
            run = {"control_id": boundary.CONTROL_ID, "fixture_manifest_sha256": fixture_sha,
                   "schedule_sha256": schedule_sha, "created_utc": "2026-09-26T00:00:00+00:00",
                   "safety_stop_guards": {"swap_growth_confirmation_window_s": 30,
                                          "swap_growth_max_confirmation_windows": 4,
                                          "swap_free_immediate_stop_bytes": 512 * runtime.MIB}}
            control = {**invariants, "fixture_manifest_sha256": fixture_sha,
                       "schedule_sha256": schedule_sha,
                       "runtime": {**snapshot, "swap": {"used_bytes": 1000}}}
            warmup_row = {
                "success": True, "total_ms": 6500.0,
                "host_before": {"swap": {"used_bytes": 1000}, "memory_pressure": {"free_percent": 70}},
                "host_after": {
                    "swap": {"used_bytes": 700 * runtime.MIB + 1000},
                    "memory_pressure": {"free_percent": 66},
                    "swap_growth_check": {"initial_delta_bytes": 700 * runtime.MIB,
                                          "confirmed_deltas_bytes": [700 * runtime.MIB, 500 * runtime.MIB],
                                          "confirmation_memory_free_percent": [68, 69]},
                },
            }
            anchor_row = {
                "success": True, "total_ms": 7000.0,
                "host_before": {"swap": {"used_bytes": 1000, "free_bytes": 800 * runtime.MIB},
                                "memory_pressure": {"free_percent": 70}},
                "host_after": {"swap": {"used_bytes": 900 * runtime.MIB + 1000,
                                          "free_bytes": 400 * runtime.MIB},
                               "memory_pressure": {"free_percent": 69}},
            }
            values = {
                "run-manifest.json": run,
                "control-manifest.json": control,
                "schedule.json": schedule,
                "phase-warmup.complete.json": {"phase": "warmup", "status": "complete"},
                "phase-anchor-pre.complete.json": {"phase": "anchor-pre", "status": "stopped",
                                                    "reason": "system_free_swap_below_256_mib_safety_guard"},
                "warmup.jsonl": warmup_row,
                "anchors/samples.jsonl": anchor_row,
            }
            for name, value in values.items():
                path = related / name
                path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if name.endswith(".jsonl"):
                    path.write_text(json.dumps(value) + "\n")
                else:
                    path.write_text(json.dumps(value))
                path.chmod(0o600)
            summary = analyzer.summarize_related_attempt(related, primary_run, primary_control,
                                                         fixture_sha, schedule_sha)
        self.assertTrue(summary["production_control_invariants_verified"])
        self.assertEqual(summary["warmup"]["successful_endpoint_ms_excluded"], [6500.0])
        self.assertEqual(summary["resource_observations"]["max_observed_swap_growth_bytes"], 900 * runtime.MIB)
        self.assertEqual(summary["resource_observations"]["min_memory_free_percent"], 66)
        self.assertEqual(summary["resource_observations"]["min_observed_swap_free_bytes"], 400 * runtime.MIB)
        self.assertEqual(summary["anchor_pre_attempts"], 1)
        self.assertEqual(summary["anchor_pre_successful_samples"], 1)
        self.assertEqual(summary["anchor_pre_successful_endpoint_ms_excluded"], [7000.0])
        self.assertEqual(summary["matrix_attempts"], 0)
        self.assertNotIn("percentiles", summary["warmup"])
        self.assertEqual(summary["stop_reason"], "system_free_swap_below_256_mib_safety_guard")
        self.assertEqual(summary["safety_stop_guards"]["swap_growth_max_confirmation_windows"], 4)
        self.assertEqual(summary["stop_marker_discrepancy"]["run_manifest_threshold_bytes"], 512 * runtime.MIB)

    def test_incomplete_buckets_never_get_fabricated_percentiles(self):
        _, fixture_sha = boundary.load_fixture_manifest()
        schedule = boundary.matrix_schedule()
        schedule_sha = boundary.schedule_sha256(schedule)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            root.chmod(0o700)
            run = {"fixture_manifest_sha256": fixture_sha, "schedule_sha256": schedule_sha,
                   "schedule_seed": boundary.SCHEDULE_SEED}
            control = {"fixture_manifest_sha256": fixture_sha, "schedule_sha256": schedule_sha}
            matrix = {"buckets": {str(n): {"status": "not_probed_after_stop", "attempts": 0, "success": 0}
                                   for n in boundary.LENGTHS}}
            matrix["buckets"]["25"] = {"status": "safety-incomplete", "attempts": 1, "success": 0,
                                        "reason": "synthetic_test_stop"}
            values = (("run-manifest.json", run), ("control-manifest.json", control),
                      ("schedule.json", schedule), ("matrix-summary.json", matrix),
                      ("probe-summary.json", {"passed_lengths": [], "buckets": {"25": {"status": "safety-incomplete"}}}))
            for name, value in values:
                path = root / name
                path.write_text(json.dumps(value))
                path.chmod(0o600)
            report, markdown = analyzer.build_document(root)
        first = report["matrix_buckets"][0]
        self.assertIsNone(first["metrics"]["total_ms"]["p50"])
        self.assertEqual(first["successful_samples"], 0)
        self.assertIn("not reported", markdown)
        self.assertIn("synthetic_test_stop", markdown)


if __name__ == "__main__":
    unittest.main()
