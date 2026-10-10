#!/usr/bin/env python3
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from traffic_fuse import CAP_BYTES, WARNING_BYTES, TrafficFuseStore, TrafficSample
from tc_helper import FuseConfig, plan_apply, plan_release, verify_apply, verify_release


def sample(at: str, provider: int | None, *, rx: int | None = None, tx: int | None = None, status: str = "ok", interface: str | None = "wan0") -> TrafficSample:
    return TrafficSample(datetime.fromisoformat(at.replace("Z", "+00:00")), provider, status, "billing-a", rx, tx, interface, "boot-a")


class TrafficFuseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = TrafficFuseStore(Path(self.tmp.name) / "state.sqlite3", local_calibrated=True, calibration_version="cal-v1")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_exact_warning_once_and_cap_requires_verified_apply(self) -> None:
        first = self.store.record_sample(sample("2026-10-10T00:00:00Z", 0, rx=0, tx=0))
        self.assertEqual(first["coverage"], "partial_coverage")
        warned = self.store.record_sample(sample("2026-10-10T00:01:00Z", WARNING_BYTES, rx=WARNING_BYTES, tx=0))
        self.assertEqual(warned["state"], "WARNED")
        self.assertEqual([e["eventType"] for e in warned["events"]], ["warning"])
        capped_desired = self.store.record_sample(sample("2026-10-10T00:02:00Z", CAP_BYTES, rx=CAP_BYTES, tx=0))
        self.assertEqual(capped_desired["state"], "PROTECTING")
        self.assertEqual([e["eventType"] for e in capped_desired["events"]], ["warning"])
        applied = self.store.apply_result("2026-10-10", success=True, kernel_state="owned")
        self.assertEqual(applied["state"], "CAPPED")
        self.assertEqual([e["eventType"] for e in applied["events"]], ["warning", "engaged"])
        again = self.store.record_sample(sample("2026-10-10T00:03:00Z", CAP_BYTES + 1, rx=CAP_BYTES + 1, tx=0))
        self.assertEqual(again["state"], "CAPPED")
        self.assertEqual(len(again["events"]), 2)

    def test_provider_reset_is_partial_and_does_not_uncap(self) -> None:
        self.store.record_sample(sample("2026-10-10T00:00:00Z", 0, rx=0, tx=0))
        self.store.record_sample(sample("2026-10-10T00:01:00Z", CAP_BYTES, rx=CAP_BYTES, tx=0))
        self.store.apply_result("2026-10-10", success=True)
        after_reset = self.store.record_sample(sample("2026-10-10T01:00:00Z", 10, rx=10, tx=10))
        self.assertEqual(after_reset["state"], "CAPPED")
        self.assertEqual(after_reset["coverage"], "partial_coverage")

    def test_new_shanghai_day_does_not_carry_previous_delta(self) -> None:
        self.store.record_sample(sample("2026-10-10T15:59:00Z", 0, rx=0, tx=0))  # 23:59 Shanghai
        self.store.record_sample(sample("2026-10-10T16:00:00Z", 1_000, rx=1_000, tx=1_000))  # next day
        snapshot = self.store.public_snapshot(day="2026-10-11")
        self.assertEqual(snapshot["providerBytes"], 0)
        self.assertEqual(snapshot["localWanBytes"], 0)
        self.assertEqual(snapshot["state"], "NORMAL")

    def test_boundary_delta_is_split_and_marked_partial(self) -> None:
        self.store.record_sample(sample("2026-10-10T15:59:30Z", 100, rx=100, tx=0))
        self.store.record_sample(sample("2026-10-10T16:00:30Z", 200, rx=200, tx=0))
        previous = self.store.public_snapshot(day="2026-10-10")
        current = self.store.public_snapshot(day="2026-10-11")
        self.assertEqual(previous["providerBytes"] + current["providerBytes"], 100)
        self.assertEqual(previous["coverage"], "partial_coverage")
        self.assertEqual(current["coverage"], "partial_coverage")

    def test_dry_unknown_source_is_degraded(self) -> None:
        uncalibrated = TrafficFuseStore(Path(self.tmp.name) / "uncalibrated.sqlite3")
        result = uncalibrated.record_sample(sample("2026-10-10T00:00:00Z", None, rx=0, tx=0, status="unknown"))
        self.assertEqual(result["state"], "DEGRADED")
        self.assertEqual(result["effectiveBytes"], None)

    def test_calibrated_local_wan_guard_can_trigger_without_provider_sample(self) -> None:
        self.store.record_sample(sample("2026-10-10T00:00:00Z", 0, rx=0, tx=0))
        result = self.store.record_sample(sample("2026-10-10T00:01:00Z", None, rx=CAP_BYTES, tx=0, status="error"))
        self.assertEqual(result["state"], "PROTECTING")
        self.assertEqual(result["sourceStatus"], "local_wan_estimate")
        self.assertEqual(result["effectiveBytes"], CAP_BYTES)

    def test_release_event_is_visible_in_new_day_snapshot(self) -> None:
        self.store.record_sample(sample("2026-10-10T15:59:00Z", 0, rx=0, tx=0))
        self.store.record_sample(sample("2026-10-10T16:00:00Z", CAP_BYTES, rx=CAP_BYTES, tx=0))
        self.store.record_sample(sample("2026-10-10T17:00:00Z", CAP_BYTES * 2, rx=CAP_BYTES * 2, tx=0))
        # The protected day is 2026-10-11 in Shanghai for the 16:00Z sample.
        self.store.apply_result("2026-10-11", success=True)
        released = self.store.release("2026-10-11", success=True, observed_at=datetime.fromisoformat("2026-10-11T16:00:00+00:00"))
        self.assertEqual(released["day"], "2026-10-12")
        self.assertEqual(released["operationStatus"], "released")
        self.assertEqual([event["eventType"] for event in released["events"]][-1], "released")

    def test_restart_preserves_meter_and_event_idempotence(self) -> None:
        path = Path(self.tmp.name) / "state.sqlite3"
        self.store.record_sample(sample("2026-10-10T00:00:00Z", 0, rx=0, tx=0))
        self.store.record_sample(sample("2026-10-10T00:01:00Z", WARNING_BYTES, rx=WARNING_BYTES, tx=0))
        reopened = TrafficFuseStore(path, local_calibrated=True, calibration_version="cal-v1")
        snapshot = reopened.public_snapshot(day="2026-10-10")
        self.assertEqual(snapshot["state"], "WARNED")
        self.assertEqual(len(snapshot["events"]), 1)
        reopened.record_sample(sample("2026-10-10T00:02:00Z", WARNING_BYTES + 1, rx=WARNING_BYTES + 1, tx=0))
        self.assertEqual(len(reopened.public_snapshot(day="2026-10-10")["events"]), 1)

    def test_previous_release_finds_latest_protected_day_after_offline_gap(self) -> None:
        # The two samples span one complete Shanghai calendar day.  The
        # resulting protection belongs to 2026-10-10 even though the second
        # poll is observed at the following midnight.
        self.store.record_sample(sample("2026-10-09T16:00:00Z", 0, rx=0, tx=0))
        self.store.record_sample(sample("2026-10-10T16:00:00Z", CAP_BYTES, rx=CAP_BYTES, tx=0))
        self.store.apply_result("2026-10-10", success=True)

        self.assertEqual(self.store.latest_protected_day("2026-10-13"), "2026-10-10")
        self.assertIsNone(self.store.latest_protected_day("2026-10-10"))


class TcPlannerTests(unittest.TestCase):
    def test_foreign_root_is_never_overwritten(self) -> None:
        with self.assertRaises(RuntimeError):
            plan_apply(FuseConfig("wan0"), [{"kind": "fq_codel", "handle": "0:"}])
        with self.assertRaises(RuntimeError):
            plan_release(FuseConfig("wan0"), [{"kind": "cake", "handle": "1:"}])

    def test_owned_plan_is_fixed_and_shared(self) -> None:
        commands = plan_apply(FuseConfig("wan0", 2222), [{"kind": "htb", "handle": "1a:"}])
        joined = " ".join(" ".join(command) for command in commands)
        self.assertIn("rate 2mbit", joined)
        self.assertIn("dst_port 2222", joined)
        self.assertIn("protocol ipv6", joined)
        self.assertNotIn("50mbit", joined)
        self.assertEqual(plan_release(FuseConfig("wan0"), [{"kind": "htb", "handle": "1a:"}]), [["tc", "qdisc", "del", "dev", "wan0", "root"]])
        self.assertTrue(verify_apply([{"kind": "htb", "handle": "1a:"}]))
        self.assertTrue(verify_release([]))
        self.assertFalse(verify_release([{"kind": "htb", "handle": "1a:"}]))


if __name__ == "__main__":
    unittest.main()
