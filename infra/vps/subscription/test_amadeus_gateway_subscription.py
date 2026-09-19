#!/usr/bin/env python3

from __future__ import annotations

import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import urlopen
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from amadeus_gateway_subscription import (  # noqa: E402
    SubscriptionServer,
    UsageSnapshot,
    _subscription_target,
    subscription_userinfo,
    usage_summary,
)


class FakeUsageProvider:
    def __init__(self, snapshot: UsageSnapshot | None) -> None:
        self.snapshot_value = snapshot

    def snapshot(self) -> UsageSnapshot | None:
        return self.snapshot_value


class SubscriptionResponderTests(unittest.TestCase):
    def test_usage_provider_sends_gateway_user_agent_and_persists_sample(self) -> None:
        class FakeResponse:
            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self, _limit: int) -> bytes:
                return b'{"error": 0, "data_counter": 300, "plan_monthly_data": 1000}'

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            credentials = root / "credentials.json"
            credentials.write_text('{"veid":"test-veid","apiKey":"test-key"}\n', encoding="utf-8")
            state = root / "usage-state.json"
            with patch("amadeus_gateway_subscription.urlopen", return_value=FakeResponse()) as opener:
                from amadeus_gateway_subscription import UsageProvider

                snapshot = UsageProvider("https://example.invalid/v1", credentials, state).snapshot()
                self.assertIsNotNone(snapshot)
                self.assertFalse(snapshot.stale if snapshot else True)
                request = opener.call_args.args[0]
                self.assertEqual(request.get_header("User-agent"), "AmadeusGatewaySubscription/1")
            self.assertTrue(state.is_file())

    def test_usage_headers_use_vps_aggregate_and_derive_remaining(self) -> None:
        reset = datetime.now(timezone.utc) + timedelta(days=5)
        snapshot = UsageSnapshot(used_bytes=300, total_bytes=1000, reset_at=reset, checked_at=datetime.now(timezone.utc))
        self.assertIn("download=300", subscription_userinfo(snapshot))
        self.assertIn("total=1000", subscription_userinfo(snapshot))
        self.assertIn("remainingBytes=700", usage_summary(snapshot))
        self.assertIn("status=fresh", usage_summary(snapshot))

    def test_target_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "token").mkdir()
            (root / "token" / "qx.conf").write_text("vless=test\n", encoding="utf-8")
            target, name = _subscription_target(root, "/token/qx.conf")
            self.assertEqual(target.name, "qx.conf")
            self.assertEqual(name, "qx.conf")
            with self.assertRaises(FileNotFoundError):
                _subscription_target(root, "/../qx.conf")

    def test_existing_url_returns_same_body_and_uniform_filename(self) -> None:
        snapshot = UsageSnapshot(42, 100, None, datetime.now(timezone.utc))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "test-token").mkdir()
            (root / "test-token" / "clash.yaml").write_bytes(b"proxies:\n")
            server = SubscriptionServer(
                ("127.0.0.1", 0),
                root,
                FakeUsageProvider(snapshot),  # type: ignore[arg-type]
                "amadeus-gateway",
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with urlopen(f"http://127.0.0.1:{server.server_port}/test-token/clash.yaml", timeout=2) as response:
                    self.assertEqual(response.read(), b"proxies:\n")
                    self.assertEqual(response.headers["Content-Disposition"], 'inline; filename="amadeus-gateway"')
                    self.assertIn("download=42", response.headers["Subscription-Userinfo"])
                    self.assertIn("remainingBytes=58", response.headers["X-Amadeus-Gateway-Usage"])
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_missing_subscription_returns_404(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            server = SubscriptionServer(
                ("127.0.0.1", 0),
                Path(directory),
                FakeUsageProvider(None),  # type: ignore[arg-type]
                "amadeus-gateway",
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                with self.assertRaises(HTTPError) as context:
                    urlopen(f"http://127.0.0.1:{server.server_port}/missing/qx.conf", timeout=2)
                self.assertEqual(context.exception.code, 404)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
