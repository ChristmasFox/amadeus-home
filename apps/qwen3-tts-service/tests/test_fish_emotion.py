import http.client
import io
import json
import sys
import threading
import unittest
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import fish_emotion
import service

EMOTIONS = ('default', 'irritated', 'embarrassed', 'angry', 'sarcastic', 'soft', 'sad')


class PrepareTest(unittest.TestCase):
    def test_every_kurisu_emotion_has_a_mapping_and_only_default_is_empty(self):
        self.assertEqual(set(fish_emotion.EMOTION_TAGS), set(EMOTIONS))
        self.assertEqual(fish_emotion.EMOTION_TAGS['default'], '')
        for name in EMOTIONS[1:]:
            self.assertIn(fish_emotion.EMOTION_TAGS[name], fish_emotion.ALLOWED_INLINE)

    def test_emotion_becomes_a_leading_tag(self):
        self.assertEqual(fish_emotion.prepare('いい加減にして', 'angry'), ('[angry] いい加減にして', ['angry']))
        self.assertEqual(fish_emotion.prepare('そう', 'default'), ('そう', []))

    def test_inline_tags_are_allowlisted_deduplicated_and_capped(self):
        text, tags = fish_emotion.prepare('[Laughing] ふふっ[evil laugh]、[sigh] そう[sigh][whisper]ね[tsk]', 'default')
        self.assertEqual(tags, ['laughing', 'sigh', 'whisper'])
        self.assertEqual(text, '[laughing] ふふっ、[sigh] そう[whisper]ね')

    def test_unknown_tags_control_tokens_and_stray_brackets_never_survive(self):
        text, _ = fish_emotion.prepare('<|speaker:1|>[[x]] a [singing] b ] [ c', 'soft')
        self.assertNotIn('speaker', text)
        self.assertNotIn('singing', text)
        self.assertEqual(text.count('['), 1)
        self.assertTrue(text.startswith('[low voice] '))

    def test_model_tag_matching_the_emotion_is_not_doubled(self):
        text, tags = fish_emotion.prepare('[angry] 来なさい', 'angry')
        self.assertEqual((text, tags), ('[angry] 来なさい', ['angry']))

    def test_tag_only_or_unknown_style_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'invalid_input'):
            fish_emotion.prepare('[sigh]', 'default')
        with self.assertRaisesRegex(ValueError, 'unsupported_style'):
            fish_emotion.prepare('こんにちは', 'free-form prompt')


class RecordingEngine:
    def __init__(self):
        self.texts = []

    def synthesize_timed(self, text):
        self.texts.append(text)
        out = io.BytesIO()
        with wave.open(out, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000)
            wav.writeframes(b'\0\0' * 2400)
        return out.getvalue(), 24000, service.SynthesisTiming(1.0, 25.0, 2.0, 27.0)


class FishServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._engine_name = 'fish-s2-pro-mlx'
        cls.server = service.SpeechServer(('127.0.0.1', 0), 'x' * 32)
        cls.server.engine_name = cls._engine_name
        cls.server.model_id = service.FISH_MODEL_ID
        cls.server.engine = RecordingEngine()
        cls.server.state = 'ready'
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def post(self, body):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port)
        conn.request('POST', '/v1/audio/speech', json.dumps(body).encode(), {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + 'x' * 32})
        response = conn.getresponse()
        data = response.status, response.read()
        conn.close()
        return data

    def test_emotion_field_and_inline_tags_reach_the_engine_as_sanitized_text(self):
        base = {'model': 'amadeus-tts', 'voice': 'kurisu-v1', 'response_format': 'wav'}
        code, _ = self.post(base | {'input': '[sigh] もう、<|speaker:1|>[evil] 知らないわ', 'style': 'irritated'})
        self.assertEqual(code, 200)
        spoken = self.server.engine.texts[-1]
        self.assertTrue(spoken.startswith('[irritated tone] [sigh] もう、'))
        self.assertNotIn('evil', spoken)
        self.assertNotIn('speaker', spoken)
        code, payload = self.post(base | {'input': 'こんにちは', 'style': 'free-form prompt'})
        self.assertEqual((code, json.loads(payload)['error']['type']), (400, 'unsupported_style'))
        code, _ = self.post(base | {'input': 'こんにちは'})
        self.assertEqual(code, 200)
        self.assertEqual(self.server.engine.texts[-1], 'こんにちは')


if __name__ == '__main__':
    unittest.main()
