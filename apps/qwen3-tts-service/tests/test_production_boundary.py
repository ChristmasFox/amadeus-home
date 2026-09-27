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
        self.assertEqual(tuple(fixtures), boundary.LENGTHS)
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
        self.assertEqual(len(a), 260)
        self.assertEqual(boundary.schedule_sha256(a), boundary.schedule_sha256(b))
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
    def test_swap_confirmation_waits_for_slow_recovery_without_submitting_work(self):
        baseline = 10 * runtime.GIB
        used_values = [baseline + n * runtime.MIB for n in (700, 690, 680, 670, 660, 650, 640, 500)]
        initial = {
            "health": {"http_status": 200, "status": "ready"},
            "launchd": {"pid": 7},
            "process": {"physical_footprint_bytes": 3 * runtime.GIB},
            "swap": {"used_bytes": used_values[0], "free_bytes": 2 * runtime.GIB},
            "memory_pressure": {"free_percent": 70},
        }
        confirmations = [
            {
                "health": {"http_status": 200, "status": "ready"},
                "launchd": {"pid": 7},
                "process": {"physical_footprint_bytes": 3 * runtime.GIB},
                "swap": {"used_bytes": used, "free_bytes": 2 * runtime.GIB},
                "memory_pressure": {"free_percent": 70},
            }
            for used in used_values[1:]
        ]
        with mock.patch.object(runtime.time, "sleep") as sleep, \
                mock.patch.object(runtime, "runtime_snapshot", side_effect=confirmations):
            snapshot, reason = runtime.confirm_swap_stability(
                initial, expected_pid=7, baseline_swap_bytes=baseline)
        self.assertIsNone(reason)
        self.assertEqual(sleep.call_count, 7)
        self.assertEqual(snapshot["swap_growth_check"]["state"], "transient_recovered")
        self.assertEqual(runtime.SWAP_MAX_CONFIRMATION_WINDOWS, 12)

    def test_runtime_safety_guards_are_explicit_and_nonmutating(self):
        base = {
            "health": {"http_status": 200, "status": "ready"},
            "launchd": {"pid": 7},
            "process": {"physical_footprint_bytes": 3 * runtime.GIB},
            "swap": {"used_bytes": 100},
            "memory_pressure": {"free_percent": 70},
        }
        self.assertIsNone(runtime.safety_reason(base, expected_pid=7, baseline_swap_bytes=100))
        critical = {**base, "memory_pressure": {"free_percent": 9}}
        self.assertEqual(runtime.safety_reason(critical, expected_pid=7, baseline_swap_bytes=100),
                         "critical_memory_pressure_free_below_10_percent")
        restarted = {**base, "launchd": {"pid": 8}}
        self.assertEqual(runtime.safety_reason(restarted, expected_pid=7, baseline_swap_bytes=100),
                         "launchagent_pid_changed")
        low_swap = {**base, "swap": {"used_bytes": 100, "free_bytes": 512 * runtime.MIB - 1}}
        self.assertEqual(runtime.safety_reason(low_swap, expected_pid=7, baseline_swap_bytes=100),
                         "system_free_swap_below_512_mib_safety_guard")
        baseline = 10 * runtime.GIB
        self.assertEqual(runtime.swap_growth_state(baseline + 400 * runtime.MIB, baseline)[0], "below_guard")
        self.assertEqual(runtime.swap_growth_state(baseline + 600 * runtime.MIB, baseline)[0], "confirmation_required")
        self.assertEqual(runtime.swap_growth_state(baseline + 600 * runtime.MIB, baseline,
                                                   baseline + 400 * runtime.MIB)[0], "transient_recovered")
        self.assertEqual(runtime.swap_growth_state(baseline + 800 * runtime.MIB, baseline,
                                                   baseline + 600 * runtime.MIB)[0], "elevated_but_decreasing")
        self.assertEqual(runtime.swap_growth_state(baseline + 600 * runtime.MIB, baseline,
                                                   baseline + 600 * runtime.MIB)[0], "persistent_no_clear_decline")
        self.assertEqual(runtime.swap_growth_state(baseline + 2100 * runtime.MIB, baseline)[0], "immediate_stop")


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
