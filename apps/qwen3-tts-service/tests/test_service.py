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
        self.assertIn("queue_wait_ms=1.0", timing)
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

if __name__ == "__main__":
    unittest.main()
