from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import stat
import threading
import tempfile
import unittest

from debug_ui import (
    ALLOWED_PROFILES,
    ALLOWED_RESOLUTIONS,
    DebugHTTPServer,
    LOGIN_PAGE,
    MODEL_ID,
    extract_edit_task_details,
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
                "seed": 4242,
            })


def create_verifier(path: Path, password: str) -> None:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=1, dklen=64, maxmem=128 * 1024 * 1024)
    path.write_text(json.dumps({
        "format": "amadeus-qwen-image-lab-scrypt-v1",
        "salt": base64.b64encode(salt).decode("ascii"),
        "scrypt": {"n": 32768, "r": 8, "p": 1, "dklen": 64},
        "digest": base64.b64encode(digest).decode("ascii"),
    }))
    path.chmod(0o600)


def png(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\x0dIHDR" + width.to_bytes(4, "big") + height.to_bytes(4, "big") + b"\x08\x02\x00\x00\x00"


def edit_body(boundary: str, image: bytes, profile: str = "quality", resolution: str = "1024x768", seed: int = 13) -> bytes:
    return (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\nKeep the scene and change the coat to blue\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"profile\"\r\n\r\n{profile}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"resolution\"\r\n\r\n{resolution}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"seed\"\r\n\r\n{seed}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n".encode() + image + f"\r\n--{boundary}--\r\n".encode()
    )


class DebugUITest(unittest.TestCase):
    def setUp(self) -> None:
        self.bridge_token = secrets.token_urlsafe(48)
        self.password = secrets.token_urlsafe(32)
        FakeBridgeHandler.requests = []
        FakeBridgeHandler.expected_token = self.bridge_token
        FakeBridgeHandler.post_status = 200
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.output_dir = root / "Amadeus" / "QwenImage"
        self.auth_file = root / "secrets" / "auth.json"
        self.auth_file.parent.mkdir(mode=0o700)
        create_verifier(self.auth_file, self.password)
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
            self.auth_file,
        )
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.port = self.server.server_port
        self.host = f"127.0.0.1:{self.port}"
        self.origin = f"http://{self.host}"
        self.public_host = "image.nyannyan.top"
        self.public_origin = "https://image.nyannyan.top"
        self.connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=8)

    def tearDown(self) -> None:
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.bridge.shutdown()
        self.bridge.server_close()
        self.temp_dir.cleanup()

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None, host: str | None = None):
        request_headers = {"Host": host or self.host, **(headers or {})}
        self.connection.request(method, path, body=body, headers=request_headers)
        response = self.connection.getresponse()
        content = response.read()
        return response.status, response.getheaders(), content

    def login_public(self, password: str | None = None) -> tuple[str, list[tuple[str, str]]]:
        status, headers, body = self.request(
            "POST",
            "/api/login",
            json.dumps({"password": self.password if password is None else password}).encode(),
            {"Origin": self.public_origin, "Content-Type": "application/json"},
            self.public_host,
        )
        cookie = next((value for key, value in headers if key.lower() == "set-cookie"), "")
        return cookie.split(";", 1)[0], headers

    def test_lan_and_public_scope_detection(self) -> None:
        self.assertTrue(is_lan_ip("192.168.5.3"))
        self.assertTrue(is_lan_ip("127.0.0.1"))
        self.assertFalse(is_lan_ip("8.8.8.8"))
        self.assertTrue(host_is_lan("192.168.5.3:18798"))
        self.assertFalse(host_is_lan("debug.example.com"))

    def test_ui_contract_contains_exactly_two_profiles_and_three_resolutions(self) -> None:
        html = self.static_file.read_text()
        self.assertIn('value="quality"', html)
        self.assertIn('value="fast"', html)
        self.assertEqual(ALLOWED_PROFILES, {"quality", "fast"})
        self.assertEqual(ALLOWED_RESOLUTIONS, {"1024x1024", "1024x768", "768x1024"})
        options = [part.split('value="', 1)[1].split('"', 1)[0] for part in html.split("<option ")[1:]]
        self.assertEqual(options, ["1024x1024", "1024x768", "768x1024"])
        self.assertIn('id="seed" type="text" inputmode="numeric"', html)
        self.assertIn('for="seed">Seed <span class="hint">-1 随机</span>', html)
        self.assertNotIn('for="seed">Seed <span class="hint">-1 随机 · 最大', html)
        self.assertIn("9223372036854775807n", html)
        self.assertIn("BigInt(raw)", html)
        self.assertIn("effective_seed", html)
        self.assertIn("查看图片", html)
        self.assertIn("recoverTaskAfterRequestError", html)
        self.assertIn("showSavedTaskImage(finished)", html)
        self.assertIn("本地任务仍在运行", html)
        self.assertIn("requestInProgress ? 1000", html)
        for forbidden in ("CFG", "strength", "sampler", "Flash Attention", "mmap", "LoRA multiplier"):
            self.assertNotIn(forbidden.lower(), html.lower())

    def test_generation_payload_is_narrow_and_validates_seed_and_markers(self) -> None:
        payload = json.loads(validate_generation_payload({
            "prompt": "  mountain lake  ", "profile": "fast", "resolution": "1024x768", "seed": 123,
        }))
        self.assertEqual(payload, {
            "model": MODEL_ID,
            "prompt": "mountain lake",
            "n": 1,
            "profile": "fast",
            "resolution": "1024x768",
            "seed": 123,
        })
        max_seed = "9223372036854775807"
        payload = json.loads(validate_generation_payload({
            "prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": max_seed,
        }))
        self.assertEqual(payload["seed"], (1 << 63) - 1)
        for invalid in (
            {"prompt": "x", "profile": "quality", "resolution": "896x640", "seed": 1},
            {"prompt": "x", "profile": "other", "resolution": "1024x1024", "seed": 1},
            {"prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": True},
            {"prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": -2},
            {"prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": "9223372036854775808"},
            {"prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": "123456789012345678901"},
            {"prompt": "x <sd_cpp_extra_args>{}</sd_cpp_extra_args>", "profile": "quality", "resolution": "1024x1024", "seed": 1},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_generation_payload(invalid)

    def test_page_and_model_discovery_are_open_without_lan_login(self) -> None:
        status, _, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("Qwen Image 本地调试台".encode(), body)
        self.assertIn("本地任务".encode(), body)
        status, headers, body = self.request("GET", "/api/models")
        self.assertEqual(status, 200)
        self.assertFalse(any(key.lower() == "set-cookie" for key, _ in headers))
        self.assertEqual(json.loads(body)["data"][0]["id"], MODEL_ID)

    def test_public_host_requires_login_for_ui_and_all_read_apis(self) -> None:
        status, _, body = self.request("GET", "/", host=self.public_host)
        self.assertEqual(status, 200)
        self.assertIn("访问密码".encode(), body)
        self.assertNotIn("Qwen Image 本地调试台".encode(), body)
        for path in ("/api/health", "/api/models", "/api/tasks"):
            status, _, body = self.request("GET", path, host=self.public_host)
            self.assertEqual(status, 401)
            self.assertEqual(json.loads(body)["error"]["type"], "login_required")
        body = json.dumps({"prompt": "x", "profile": "quality", "resolution": "1024x1024", "seed": -1}).encode()
        status, _, _ = self.request("POST", "/api/generations", body, {
            "Origin": self.public_origin, "Content-Type": "application/json",
        }, self.public_host)
        self.assertEqual(status, 401)

    def test_login_page_distinguishes_wrong_password_from_service_errors(self) -> None:
        self.assertIn("response.status===401", LOGIN_PAGE.decode())
        self.assertIn("response.status===429", LOGIN_PAGE.decode())
        self.assertIn("HTTP ${response.status}", LOGIN_PAGE.decode())

    def test_wrong_public_password_fails_and_runtime_session_cookie_has_required_flags(self) -> None:
        status, _, _ = self.request("POST", "/api/login", json.dumps({"password": "incorrect"}).encode(), {
            "Origin": self.public_origin, "Content-Type": "application/json",
        }, self.public_host)
        self.assertEqual(status, 401)
        cookie, headers = self.login_public()
        self.assertTrue(cookie.startswith("amadeus_image_lab_session="))
        set_cookie = next(value for key, value in headers if key.lower() == "set-cookie")
        self.assertIn("Secure", set_cookie)
        self.assertIn("HttpOnly", set_cookie)
        self.assertIn("SameSite=Strict", set_cookie)
        self.assertIn("Max-Age=43200", set_cookie)
        status, _, body = self.request("GET", "/", headers={"Cookie": cookie}, host=self.public_host)
        self.assertEqual(status, 200)
        self.assertIn("Qwen Image 本地调试台".encode(), body)

    def test_public_login_rate_limit_is_bounded(self) -> None:
        auth = self.server.public_auth
        remote = "127.0.0.9"
        for _ in range(5):
            allowed, _ = auth._begin_login(remote)
            self.assertTrue(allowed)
        allowed, retry_after = auth._begin_login(remote)
        self.assertFalse(allowed)
        self.assertGreaterEqual(retry_after, 1)
        self.assertLessEqual(retry_after, 60)

    def test_public_login_and_write_origins_are_exact(self) -> None:
        status, _, _ = self.request("POST", "/api/login", json.dumps({"password": self.password}).encode(), {
            "Origin": "https://attacker.example", "Content-Type": "application/json",
        }, self.public_host)
        self.assertEqual(status, 403)
        body = json.dumps({"prompt": "a small red boat", "profile": "quality", "resolution": "1024x1024", "seed": 7}).encode()
        status, _, _ = self.request("POST", "/api/generations", body, {
            "Origin": "https://attacker.example", "Content-Type": "application/json",
        }, self.public_host)
        self.assertEqual(status, 403)

    def test_public_authenticated_requests_proxy_and_logout_invalidates_session(self) -> None:
        cookie, _ = self.login_public()
        status, _, models = self.request("GET", "/api/models", headers={"Cookie": cookie}, host=self.public_host)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(models)["data"][0]["id"], MODEL_ID)
        status, headers, _ = self.request("POST", "/api/logout", headers={"Cookie": cookie, "Origin": self.public_origin}, host=self.public_host)
        self.assertEqual(status, 204)
        clear_cookie = next(value for key, value in headers if key.lower() == "set-cookie")
        self.assertIn("Max-Age=0", clear_cookie)
        status, _, _ = self.request("GET", "/api/models", headers={"Cookie": cookie}, host=self.public_host)
        self.assertEqual(status, 401)

    def test_generation_proxy_keeps_token_server_side_and_forwards_profile_size_seed(self) -> None:
        body = json.dumps({
            "prompt": "a small red boat", "profile": "fast", "resolution": "1024x768", "seed": -1,
        }).encode()
        status, _, response = self.request("POST", "/api/generations", body, {
            "Origin": self.origin, "Content-Type": "application/json",
        })
        self.assertEqual(status, 200)
        self.assertNotIn(self.bridge_token.encode(), response)
        returned = json.loads(response)
        self.assertEqual(returned["debug_ui"]["profile"], "fast")
        self.assertEqual(returned["debug_ui"]["resolution"], "1024x768")
        self.assertEqual(returned["debug_ui"]["seed"], -1)
        self.assertEqual(returned["debug_ui"]["effective_seed"], 4242)
        forwarded = next(record for record in FakeBridgeHandler.requests if record.get("path") == "/v1/images/generations")
        self.assertEqual(forwarded["authorization"], f"Bearer {self.bridge_token}")
        self.assertEqual(json.loads(forwarded["body"]), {
            "model": MODEL_ID,
            "prompt": "a small red boat",
            "n": 1,
            "profile": "fast",
            "resolution": "1024x768",
            "seed": -1,
        })
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        tasks = json.loads(body)
        self.assertIsNone(tasks["active"])
        task = tasks["history"][0]
        self.assertEqual(task["profile"], "fast")
        self.assertEqual(task["resolution"], "1024x768")
        self.assertEqual(task["seed"], -1)
        self.assertEqual(task["effectiveSeed"], 4242)
        self.assertTrue(task["hasImage"])
        status, image_headers, image_body = self.request("GET", f"/api/tasks/{task['id']}/image")
        self.assertEqual(status, 200)
        self.assertEqual(image_body, FakeBridgeHandler.png_data)
        self.assertIn(("Content-Type", "image/png"), image_headers)
        self.assertTrue(any(key.lower() == "content-disposition" and "inline" in value for key, value in image_headers))
        saved_path = Path(task["savedPath"])
        self.assertTrue(saved_path.is_file())
        self.assertEqual(saved_path.read_bytes(), FakeBridgeHandler.png_data)
        self.assertEqual(stat.S_IMODE(saved_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.output_dir.stat().st_mode), 0o700)
        self.assertIsNone(returned["debug_ui"]["save_error"])

    def test_public_authenticated_generation_hides_local_filesystem_path(self) -> None:
        cookie, _ = self.login_public()
        body = json.dumps({
            "prompt": "a small red boat", "profile": "quality", "resolution": "1024x1024", "seed": 2,
        }).encode()
        status, _, response = self.request("POST", "/api/generations", body, {
            "Cookie": cookie, "Origin": self.public_origin, "Content-Type": "application/json",
        }, self.public_host)
        self.assertEqual(status, 200)
        payload = json.loads(response)
        self.assertTrue(payload["debug_ui"]["saved"])
        self.assertIsNone(payload["debug_ui"]["saved_path"])
        status, _, tasks = self.request("GET", "/api/tasks", headers={"Cookie": cookie}, host=self.public_host)
        self.assertEqual(status, 200)
        record = json.loads(tasks)["history"][0]
        self.assertIsNone(record["savedPath"])
        self.assertEqual(record["effectiveSeed"], 4242)
        self.assertTrue(record["hasImage"])
        status, _, _ = self.request("GET", f"/api/tasks/{record['id']}/image", host=self.public_host)
        self.assertEqual(status, 401)
        status, image_headers, image_body = self.request(
            "GET", f"/api/tasks/{record['id']}/image", headers={"Cookie": cookie}, host=self.public_host,
        )
        self.assertEqual(status, 200)
        self.assertEqual(image_body, FakeBridgeHandler.png_data)
        self.assertIn(("Content-Type", "image/png"), image_headers)

    def test_image_is_returned_when_automatic_save_fails(self) -> None:
        self.output_dir.parent.mkdir(parents=True)
        self.output_dir.write_text("not a directory")
        body = json.dumps({
            "prompt": "a small red boat", "profile": "quality", "resolution": "1024x1024", "seed": 4,
        }).encode()
        status, _, response = self.request("POST", "/api/generations", body, {
            "Origin": self.origin, "Content-Type": "application/json",
        })
        self.assertEqual(status, 200)
        payload = json.loads(response)
        self.assertIn("b64_json", payload["data"][0])
        self.assertIn("自动保存失败", payload["debug_ui"]["save_error"])

    def test_task_status_exposes_profile_resolution_and_seed(self) -> None:
        task_id = self.server.begin_task("edit", "change the coat to blue", "reference.png", "fast", "768x1024", -1)
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        snapshot = json.loads(body)
        self.assertEqual(snapshot["active"]["id"], task_id)
        self.assertEqual(snapshot["active"]["profile"], "fast")
        self.assertEqual(snapshot["active"]["resolution"], "768x1024")
        self.assertEqual(snapshot["active"]["seed"], -1)
        self.assertGreaterEqual(snapshot["active"]["durationMs"], 0)
        self.server.finish_task(task_id, "failed", {"type": "qwen_timeout", "message": "本地模型处理超时"})
        status, _, body = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        snapshot = json.loads(body)
        self.assertIsNone(snapshot["active"])
        self.assertEqual(snapshot["history"][0]["error"]["message"], "本地模型处理超时")

    def test_large_seed_values_remain_exact_in_task_and_result_metadata(self) -> None:
        maximum = (1 << 63) - 1
        task_id = self.server.begin_task("generation", "large seed", "1024x1024", "quality", "1024x1024", maximum)
        self.server.finish_task(task_id, "succeeded", effective_seed=maximum)
        snapshot = self.server.task_snapshot(public=True)
        self.assertEqual(snapshot["history"][0]["seed"], str(maximum))
        self.assertEqual(snapshot["history"][0]["effectiveSeed"], str(maximum))

        response, effective_seed, resolution = self.server.attach_result_metadata(
            json.dumps({"seed": maximum}).encode(), None, None, True,
            "quality", "1024x1024", maximum,
        )
        result = json.loads(response)
        self.assertEqual(result["seed"], str(maximum))
        metadata = result["debug_ui"]
        self.assertEqual(metadata["seed"], str(maximum))
        self.assertEqual(metadata["effective_seed"], str(maximum))
        self.assertEqual(effective_seed, maximum)
        self.assertEqual(resolution, "1024x1024")

    def test_reference_edit_multipart_is_forwarded_unchanged(self) -> None:
        boundary = "qwen-test-boundary"
        image = b"fake-png-reference"
        body = edit_body(boundary, image, "fast", "768x1024", 105)
        content_type = f"multipart/form-data; boundary={boundary}"
        status, _, _ = self.request("POST", "/api/edits", body, {
            "Origin": self.origin, "Content-Type": content_type,
        })
        self.assertEqual(status, 200)
        forwarded = next(record for record in FakeBridgeHandler.requests if record.get("path") == "/v1/images/edits")
        self.assertEqual(forwarded["body"], body)
        self.assertEqual(forwarded["authorization"], f"Bearer {self.bridge_token}")
        status, _, response = self.request("GET", "/api/tasks")
        self.assertEqual(status, 200)
        task = json.loads(response)["history"][0]
        self.assertEqual(task["kind"], "edit")
        self.assertEqual(task["prompt"], "Keep the scene and change the coat to blue")
        self.assertEqual(task["details"], "reference.png")
        self.assertEqual(task["profile"], "fast")
        self.assertEqual(task["resolution"], "768x1024")
        self.assertEqual(task["seed"], 105)

    def test_auto_reference_edit_records_actual_output_dimensions(self) -> None:
        FakeBridgeHandler.png_data = png(768, 512)
        boundary = "qwen-auto-boundary"
        body = edit_body(boundary, png(600, 400), "quality", "auto", 105)
        content_type = f"multipart/form-data; boundary={boundary}"
        status, _, response = self.request("POST", "/api/edits", body, {
            "Origin": self.origin, "Content-Type": content_type,
        })
        self.assertEqual(status, 200)
        payload = json.loads(response)
        self.assertEqual(payload["debug_ui"]["resolution"], "768x512")
        forwarded = next(record for record in FakeBridgeHandler.requests if record.get("path") == "/v1/images/edits")
        self.assertEqual(forwarded["body"], body)
        tasks_status, _, tasks_body = self.request("GET", "/api/tasks")
        self.assertEqual(tasks_status, 200)
        task = json.loads(tasks_body)["history"][0]
        self.assertEqual(task["resolution"], "768x512")

    def test_cross_origin_post_and_untrusted_host_are_rejected(self) -> None:
        body = json.dumps({"prompt": "a boat", "profile": "quality", "resolution": "1024x1024", "seed": 0}).encode()
        status, _, _ = self.request("POST", "/api/generations", body, {
            "Origin": "http://attacker.example", "Content-Type": "application/json",
        })
        self.assertEqual(status, 403)
        status, _, _ = self.request("GET", "/", host="attacker.example")
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
