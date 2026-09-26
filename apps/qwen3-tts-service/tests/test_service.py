import http.client
import io
import json
import importlib.util
import sys
import threading
import time
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service


class FakeEngine:
    def __init__(self):
        self.calls = 0

    def synthesize_timed(self, text):
        self.calls += 1
        out = io.BytesIO()
        with wave.open(out, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24000)
            wav.writeframes(b"\0\0" * 2400)
        return out.getvalue(), 24000, service.SynthesisTiming(1.0, 25.0, 2.0, 27.0)


class SpeechTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        cls.server.engine = FakeEngine()
        cls.server.state = "ready"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def request(self, method, path, data=None, token=True):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + "x" * 32
        conn.request(method, path, json.dumps(data).encode() if data is not None else None, headers)
        response = conn.getresponse()
        result = response.status, response.getheader("Content-Type"), response.read()
        conn.close()
        return result

    def test_health_readiness(self):
        self.assertEqual(self.request("GET", "/healthz")[0], 200)
        self.server.state = "warming_up"
        self.assertEqual(self.request("GET", "/healthz")[0], 503)
        self.server.state = "ready"

    def test_auth_and_voice(self):
        self.assertEqual(self.request("GET", "/v1/voices", token=False)[0], 401)
        self.assertEqual(json.loads(self.request("GET", "/v1/voices")[2])["data"][0]["id"], "kurisu-v1")

    def test_validation(self):
        base = {"model": service.MODEL_ID, "voice": service.VOICE_ID, "input": "你好世界"}
        for key, value, expected in (("voice", "other", "unknown_voice"), ("model", "other", "unknown_model"), ("input", "", "invalid_input"), ("input", "x"*1201, "invalid_input")):
            case = base | {key: value}
            code, _, payload = self.request("POST", "/v1/audio/speech", case)
            self.assertEqual(code, 400)
            self.assertEqual(json.loads(payload)["error"]["type"], expected)

    def test_unavailable_and_format(self):
        base = {"model": service.MODEL_ID, "voice": service.VOICE_ID, "input": "你好世界"}
        before = self.server.engine.calls
        code, _, body = self.request("POST", "/v1/audio/speech", base | {"response_format": "raw"})
        self.assertEqual(code, 400)
        self.assertEqual(json.loads(body)["error"]["type"], "unsupported_format")
        self.server.state = "failed"
        code, _, body = self.request("POST", "/v1/audio/speech", base)
        self.assertEqual(code, 503)
        self.assertEqual(json.loads(body)["error"]["type"], "provider_unavailable")
        self.server.state = "ready"
        self.assertEqual(self.server.engine.calls, before)

    @unittest.skipUnless(importlib.util.find_spec("imageio_ffmpeg"), "encoder dependency not installed")
    def test_encoded_audio(self):
        base = {"model": service.MODEL_ID, "voice": service.VOICE_ID, "input": "你好世界"}
        for fmt, mime, magic in (("mp3", "audio/mpeg", None), ("opus", "audio/ogg", b"OggS")):
            code, actual_mime, data = self.request("POST", "/v1/audio/speech", base | {"response_format": fmt})
            self.assertEqual((code, actual_mime), (200, mime))
            self.assertGreater(len(data), 100)
            if magic:
                self.assertTrue(data.startswith(magic))

    def test_audio(self):
        with self.assertLogs(service.LOG, level="INFO") as captured:
            code, mime, body = self.request("POST", "/v1/audio/speech", {"model": service.MODEL_ID, "voice": service.VOICE_ID, "input": "VOICE_PRIVACY_SENTINEL", "response_format": "wav"})
        self.assertEqual((code, mime), (200, "audio/wav"))
        self.assertTrue(body.startswith(b"RIFF"))
        timing = next(line for line in captured.output if "speech_synthesis_ok" in line)
        self.assertIn("input_chars=<=40", timing)
        self.assertIn("audio_ms=", timing)
        self.assertRegex(timing, r"queue_wait_ms=1\.[0-9]+")
        self.assertIn("generate_or_model_ms=25.0", timing)
        self.assertIn("decode_stage=inside_model_api", timing)
        self.assertIn("wav_serialize_ms=2.0", timing)
        self.assertIn("engine_inside_lock_ms=27.0", timing)
        self.assertIn("rtf=0.270", timing)
        self.assertIn("encode_ms=", timing)
        self.assertIn("total_ms=", timing)
        self.assertNotIn("VOICE_PRIVACY_SENTINEL", timing)



class SlowModel:
    def generate_voice_clone(self, **kwargs):
        time.sleep(0.025)
        return [b"samples"], 24000

class FakeSoundFile:
    def write(self, output, samples, rate, format):
        time.sleep(0.01)
        output.write(b"RIFF")

class TimingBoundaryTest(unittest.TestCase):
    def test_lock_wait_separate_from_generate_and_wav(self):
        engine = object.__new__(service.QwenEngine)
        engine._model = SlowModel()
        engine._sf = FakeSoundFile()
        engine._prompt = object()
        engine._language = "Auto"
        engine._lock = threading.Lock()
        engine._lock.acquire()
        def release():
            time.sleep(0.025)
            engine._lock.release()
        waiter = threading.Thread(target=release)
        waiter.start()
        try:
            _, _, timing = engine.synthesize_timed("safe fixture")
        finally:
            waiter.join()
        self.assertGreaterEqual(timing.queue_wait_ms, 15)
        self.assertGreaterEqual(timing.generate_or_model_ms, 20)
        self.assertGreaterEqual(timing.wav_serialize_ms, 8)
        self.assertAlmostEqual(timing.engine_inside_lock_ms, timing.generate_or_model_ms + timing.wav_serialize_ms, delta=1)

class BlockingEngine(FakeEngine):
    def __init__(self):
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()

    def synthesize_timed(self, text):
        self.entered.set()
        self.release.wait(2)
        return super().synthesize_timed(text)

class FailOnceEngine(FakeEngine):
    def __init__(self):
        super().__init__()
        self.failed = False

    def synthesize_timed(self, text):
        if not self.failed:
            self.failed = True
            raise RuntimeError("fixture_model_failure")
        return super().synthesize_timed(text)

class QueueSafetyTest(unittest.TestCase):
    def test_bounded_queue_rejects_full_and_cancels_stale_waiter(self):
        server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        engine = BlockingEngine()
        server.engine = engine
        server.state = "ready"
        previous = service.QUEUE_START_TIMEOUT_S
        service.QUEUE_START_TIMEOUT_S = 0.05
        completed = []
        first = threading.Thread(target=lambda: completed.append(server.inference.submit("first")))
        second_errors = []
        second = threading.Thread(target=lambda: self._submit_error(server, second_errors))
        try:
            first.start()
            self.assertTrue(engine.entered.wait(1))
            second.start()
            # Wait until the second job is actually pending; avoid scheduling races.
            deadline = time.monotonic() + 1
            while server.inference.pending.qsize() != 1 and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertEqual(server.inference.pending.qsize(), 1)
            with self.assertRaises(service.TtsBusyError):
                server.inference.submit("third")
            second.join(1)
            self.assertFalse(second.is_alive())
            self.assertEqual(len(second_errors), 1)
            self.assertIsInstance(second_errors[0], service.TtsBusyError)
            engine.release.set()
            first.join(1)
            self.assertFalse(first.is_alive())
            self.assertEqual(engine.calls, 1, "expired queued request must not synthesize")
            self.assertEqual(len(completed), 1)
        finally:
            engine.release.set()
            first.join(2)
            second.join(2)
            service.QUEUE_START_TIMEOUT_S = previous
            server.server_close()
        self.assertFalse(server.inference.thread.is_alive())

    @staticmethod
    def _submit_error(server, errors):
        try:
            server.inference.submit("second")
        except Exception as exc:
            errors.append(exc)

    def test_http_queue_full_returns_503_tts_busy(self):
        server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        engine = BlockingEngine()
        server.engine = engine
        server.state = "ready"
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        previous = service.QUEUE_START_TIMEOUT_S
        service.QUEUE_START_TIMEOUT_S = 0.2
        results = []
        def request():
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            body = json.dumps({"model": service.MODEL_ID, "voice": service.VOICE_ID,
                               "input": "safe fixture", "response_format": "wav"}).encode()
            conn.request("POST", "/v1/audio/speech", body,
                         {"Authorization": "Bearer " + "x" * 32, "Content-Type": "application/json"})
            response = conn.getresponse()
            results.append((response.status, response.read()))
            conn.close()
        first = threading.Thread(target=request)
        second = threading.Thread(target=request)
        try:
            first.start()
            self.assertTrue(engine.entered.wait(1))
            second.start()
            deadline = time.monotonic() + 1
            while server.inference.pending.qsize() != 1 and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertEqual(server.inference.pending.qsize(), 1)
            request()
            self.assertTrue(any(status == 503 and json.loads(body)["error"]["type"] == "tts_busy"
                                for status, body in results))
            second.join(2)
            self.assertFalse(second.is_alive())
        finally:
            engine.release.set()
            first.join(3)
            second.join(3)
            server.shutdown()
            server.server_close()
            serving.join(2)
            service.QUEUE_START_TIMEOUT_S = previous
        self.assertEqual(engine.calls, 1)
        self.assertFalse(server.inference.thread.is_alive())

    def test_model_failure_fails_closed_and_worker_recovers_next_request(self):
        server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        server.engine = FailOnceEngine()
        server.state = "ready"
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        serving.start()
        def request():
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
            body = json.dumps({"model": service.MODEL_ID, "voice": service.VOICE_ID,
                               "input": "safe fixture", "response_format": "wav"}).encode()
            conn.request("POST", "/v1/audio/speech", body,
                         {"Authorization": "Bearer " + "x" * 32, "Content-Type": "application/json"})
            response = conn.getresponse()
            result = response.status, response.read()
            conn.close()
            return result
        try:
            with self.assertLogs(service.LOG, level="ERROR") as captured:
                failed_status, failed_body = request()
            self.assertEqual(failed_status, 503)
            self.assertEqual(json.loads(failed_body)["error"]["type"], "synthesis_failed")
            self.assertNotIn("safe fixture", " ".join(captured.output))
            success_status, success_body = request()
            self.assertEqual(success_status, 200)
            self.assertTrue(success_body.startswith(b"RIFF"))
            self.assertTrue(server.inference.thread.is_alive())
        finally:
            server.shutdown()
            server.server_close()
            serving.join(2)
        self.assertFalse(server.inference.thread.is_alive())

    def test_close_cancels_queued_request_and_returns_promptly(self):
        server = service.SpeechServer(("127.0.0.1", 0), "x" * 32)
        engine = BlockingEngine()
        server.engine = engine
        server.state = "ready"
        first = threading.Thread(target=lambda: server.inference.submit("first"))
        errors = []
        second = threading.Thread(target=lambda: self._submit_error(server, errors))
        first.start()
        self.assertTrue(engine.entered.wait(1))
        second.start()
        deadline = time.monotonic() + 1
        while server.inference.pending.qsize() != 1 and time.monotonic() < deadline:
            time.sleep(0.001)
        try:
            self.assertEqual(server.inference.pending.qsize(), 1)
            started = time.monotonic()
            server.server_close()
            self.assertLess(time.monotonic() - started, 1)
            second.join(1)
            self.assertFalse(second.is_alive())
            self.assertIsInstance(errors[0], service.TtsBusyError)
            with self.assertRaises(service.TtsBusyError):
                server.inference.submit("after-close")
        finally:
            engine.release.set()
            first.join(2)
            second.join(2)
        server.inference.thread.join(1)
        self.assertFalse(server.inference.thread.is_alive())

if __name__ == "__main__":
    unittest.main()
