from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import http.client
import json
from pathlib import Path
import secrets
import stat
import threading
import tempfile
import unittest

from debug_ui import (
    DebugHTTPServer,
    MODEL_ID,
    host_is_lan,
    is_lan_ip,
    validate_generation_payload,
)


class FakeBridgeHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []
    expected_token = ""
    post_status = 200
    png_data = b"\x89PNG\r\n\x1a\nqwen-test-image"

    def log_message(self, format: str, *args) -> None:
        return

    def respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        self.requests.append({"method": "GET", "path": self.path, "authorization": self.headers.get("Authorization")})
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.respond(401, {"error": {"type": "unauthorized"}})
        elif self.path == "/health":
            self.respond(200, {"status": "ready", "model": MODEL_ID, "state": "idle"})
        else:
            self.respond(200, {"data": [{"id": MODEL_ID}]})

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self.requests.append({
            "method": "POST",
            "path": self.path,
            "authorization": self.headers.get("Authorization"),
            "content_type": self.headers.get("Content-Type"),
            "body": body,
        })
        if self.headers.get("Authorization") != f"Bearer {self.expected_token}":
            self.respond(401, {"error": {"type": "unauthorized"}})
        elif self.post_status != 200:
            self.respond(self.post_status, {"error": {"type": "qwen_timeout", "message": "qwen_timeout"}})
        else:
            self.respond(200, {
                "created": 1,
                "data": [{"b64_json": base64.b64encode(self.png_data).decode("ascii")}],
                "model": MODEL_ID,
            })


class DebugUITest(unittest.TestCase):
    def setUp(self) -> None:
        self.bridge_token = secrets.token_urlsafe(48)
        FakeBridgeHandler.requests = []
        FakeBridgeHandler.expected_token = self.bridge_token
        FakeBridgeHandler.post_status = 200
        self.temp_dir = tempfile.TemporaryDirectory()
        self.output_dir = Path(self.temp_dir.name) / "Amadeus" / "QwenImage"
        self.bridge = ThreadingHTTPServer(("127.0.0.1", 0), FakeBridgeHandler)
        self.bridge_thread = threading.Thread(target=self.bridge.serve_forever, daemon=True)
        self.bridge_thread.start()
        self.static_file = Path(__file__).with_name("debug-ui.html")
        self.server = DebugHTTPServer(
            ("127.0.0.1", 0),
            f"http://127.0.0.1:{self.bridge.server_port}",
            self.bridge_token,
            self.static_file,
            self.output_dir,
        )
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.port = self.server.server_port
        self.host = f"127.0.0.1:{self.port}"
        self.origin = f"http://{self.host}"
        self.connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=4)

    def tearDown(self) -> None:
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.bridge.shutdown()
        self.bridge.server_close()
        self.temp_dir.cleanup()

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None):
        request_headers = {"Host": self.host, **(headers or {})}
        self.connection.request(method, path, body=body, headers=request_headers)
        response = self.connection.getresponse()
        content = response.read()
        return response.status, response.getheaders(), content

    def test_lan_address_policy_rejects_public_sources_and_hosts(self) -> None:
        self.assertTrue(is_lan_ip("192.168.5.3"))
        self.assertTrue(is_lan_ip("127.0.0.1"))
        self.assertFalse(is_lan_ip("8.8.8.8"))
        self.assertTrue(host_is_lan("192.168.5.3:18798"))
        self.assertFalse(host_is_lan("debug.example.com"))

    def test_generation_payload_is_fixed_to_one_supported_local_image(self) -> None:
        payload = json.loads(validate_generation_payload({"prompt": "  mountain lake  ", "size": "768x768"}))
        self.assertEqual(payload["model"], MODEL_ID)
        self.assertEqual(payload["prompt"], "mountain lake")
        self.assertEqual(payload["n"], 1)
        for invalid in (
            {"prompt": "x", "size": []},
            {"prompt": "x", "size": "2048x2048"},
            {"prompt": "x", "size": "768x768", "n": 2},
            {"prompt": " ", "size": "768x768"},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_generation_payload(invalid)

    def test_page_and_model_discovery_are_open_to_lan(self) -> None:
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("Qwen Image 本地调试台".encode(), body)
        self.assertIn("本地任务".encode(), body)
        self.assertIn("/api/tasks".encode(), body)
        status, headers, body = self.request("GET", "/api/models")
        self.assertEqual(status, 200)
        self.assertFalse(any(key.lower() == "set-cookie" for key, _ in headers))
        self.assertEqual(json.loads(body)["data"][0]["id"], MODEL_ID)

    def test_generation_proxy_keeps_bridge_token_server_side(self) -> None:
        body = json.dumps({"prompt": "a small red boat", "size": "768x768"}).encode()
        status, _, response = self.request(
            "POST",
            "/api/generations",
            body,
            {"Origin": self.origin, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        self.assertNotIn(self.bridge_token.encode(), response)
        forwarded = next(record for record in FakeBridgeHandler.requests if record.get("path") == "/v1/images/generations")
        self.assertEqual(forwarded["authorization"], f"Bearer {self.bridge_token}")
        self.assertEqual(json.loads(forwarded["body"]), {
            "model": MODEL_ID,
            "prompt": "a small red boat",
            "n": 1,
            "size": "768x768",
            "output_format": "png",
        })
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        tasks = json.loads(body)
        self.assertIsNone(tasks["active"])
        self.assertEqual(tasks["history"][0]["kind"], "generation")
        self.assertEqual(tasks["history"][0]["prompt"], "a small red boat")
        self.assertEqual(tasks["history"][0]["status"], "succeeded")
        self.assertGreaterEqual(tasks["history"][0]["durationMs"], 0)
        saved_path = Path(tasks["history"][0]["savedPath"])
        self.assertTrue(saved_path.is_file())
        self.assertEqual(saved_path.read_bytes(), FakeBridgeHandler.png_data)
        self.assertEqual(stat.S_IMODE(saved_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.output_dir.stat().st_mode), 0o700)
        save_result = json.loads(response)["debug_ui"]
        self.assertEqual(save_result["saved_path"], str(saved_path))
        self.assertIsNone(save_result["save_error"])

    def test_image_is_returned_when_automatic_save_fails(self) -> None:
        self.output_dir.parent.mkdir(parents=True)
        self.output_dir.write_text("not a directory")
        body = json.dumps({"prompt": "a small red boat", "size": "768x768"}).encode()
        status, _, response = self.request(
            "POST",
            "/api/generations",
            body,
            {"Origin": self.origin, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 200)
        payload = json.loads(response)
        self.assertIn("b64_json", payload["data"][0])
        self.assertIn("自动保存失败", payload["debug_ui"]["save_error"])
        status, _, tasks = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        record = json.loads(tasks)["history"][0]
        self.assertEqual(record["status"], "succeeded")
        self.assertIsNone(record["savedPath"])
        self.assertIn("自动保存失败", record["saveError"])

    def test_task_status_exposes_active_elapsed_time_and_failure_summary(self) -> None:
        task_id = self.server.begin_task("edit", "change the coat to blue", "reference.png")
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        snapshot = json.loads(body)
        self.assertEqual(snapshot["active"]["id"], task_id)
        self.assertEqual(snapshot["active"]["status"], "running")
        self.assertGreaterEqual(snapshot["active"]["durationMs"], 0)

        self.server.finish_task(task_id, "failed", {"type": "qwen_timeout", "message": "本地模型处理超时"})
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        snapshot = json.loads(body)
        self.assertIsNone(snapshot["active"])
        self.assertEqual(snapshot["history"][0]["status"], "failed")
        self.assertEqual(snapshot["history"][0]["error"]["message"], "本地模型处理超时")

    def test_failed_model_response_is_recorded_with_safe_failure_hint(self) -> None:
        FakeBridgeHandler.post_status = 504
        body = json.dumps({"prompt": "a small red boat", "size": "768x768"}).encode()
        status, _, _ = self.request(
            "POST",
            "/api/generations",
            body,
            {"Origin": self.origin, "Content-Type": "application/json"},
        )
        self.assertEqual(status, 504)
        status, _, response = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        task = json.loads(response)["history"][0]
        self.assertEqual(task["status"], "failed")
        self.assertEqual(task["error"]["type"], "qwen_timeout")
        self.assertEqual(task["error"]["message"], "本地模型处理超时")

    def test_reference_edit_multipart_is_forwarded_unchanged(self) -> None:
        boundary = "qwen-test-boundary"
        image = b"fake-png-reference"
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nKeep the scene, change the coat to blue\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n".encode() + image + f"\r\n--{boundary}--\r\n".encode()
        )
        status, _, _ = self.request(
            "POST",
            "/api/edits",
            body,
            {"Origin": self.origin, "Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        self.assertEqual(status, 200)
        forwarded = next(record for record in FakeBridgeHandler.requests if record.get("path") == "/v1/images/edits")
        self.assertEqual(forwarded["body"], body)
        self.assertEqual(forwarded["authorization"], f"Bearer {self.bridge_token}")
        status, _, response = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        task = json.loads(response)["history"][0]
        self.assertEqual(task["kind"], "edit")
        self.assertEqual(task["prompt"], "Keep the scene, change the coat to blue")
        self.assertEqual(task["details"], "reference.png")

    def test_cross_origin_post_and_untrusted_host_are_rejected(self) -> None:
        body = json.dumps({"prompt": "a small red boat", "size": "768x768"}).encode()
        status, _, _ = self.request(
            "POST",
            "/api/generations",
            body,
            {"Origin": "http://attacker.example", "Content-Type": "application/json"},
        )
        self.assertEqual(status, 403)
        status, _, _ = self.request("GET", "/", headers={"Host": "attacker.example"})
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
