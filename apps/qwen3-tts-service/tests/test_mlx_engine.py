import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
SERVICE_DIR = ROOT / 'apps/qwen3-tts-service'
sys.path.insert(0, str(SERVICE_DIR))
MODULE_PATH = SERVICE_DIR / 'mlx_engine.py'
spec = importlib.util.spec_from_file_location('mlx_engine_under_test', MODULE_PATH)
mlx_engine = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mlx_engine
spec.loader.exec_module(mlx_engine)

class Generated:
    audio = [0.0, 0.1, -0.1]
    sample_rate = 24000

class FakeModel:
    def __init__(self):
        self.calls = []
    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return [Generated()]

class FakeSoundFile:
    @staticmethod
    def write(stream, samples, rate, format):
        stream.write(b'RIFFfixtureWAVE')

class MlxBaselineTest(unittest.TestCase):
    def test_pure_icl_uses_canonical_pair_and_auto_language_without_style_controls(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            profile = root / 'kurisu-v1'; profile.mkdir()
            (profile / 'reference.wav').write_bytes(b'operator-profile-fixture')
            (profile / 'reference.txt').write_text('reference transcript fixture', encoding='utf-8')
            model_path = root / 'model-8bit'; model_path.mkdir()
            (model_path / 'config.json').write_text('{}')
            model = FakeModel()
            utils = types.ModuleType('mlx_audio.tts.utils')
            utils.load_model = lambda path: model
            mlx_audio = types.ModuleType('mlx_audio')
            mlx_audio.__path__ = []
            mlx_tts = types.ModuleType('mlx_audio.tts')
            mlx_tts.__path__ = []
            with patch.dict(sys.modules, {
                'numpy': types.SimpleNamespace(asarray=lambda value: value),
                'soundfile': FakeSoundFile,
                'mlx_audio': mlx_audio,
                'mlx_audio.tts': mlx_tts,
                'mlx_audio.tts.utils': utils,
            }):
                engine = mlx_engine.QwenMlxEngine(profile, model_path)
                engine.synthesize_timed('baseline fixture')
            self.assertEqual(len(model.calls), 2)  # readiness warmup, then requested synthesis
            call = model.calls[-1]
            self.assertEqual(call['text'], 'baseline fixture')
            self.assertEqual(call['ref_audio'], str(profile / 'reference.wav'))
            self.assertEqual(call['ref_text'], 'reference transcript fixture')
            self.assertEqual(call['lang_code'], 'auto')
            self.assertEqual(call['verbose'], False)
            self.assertEqual(set(call), {'text', 'ref_audio', 'ref_text', 'lang_code', 'verbose'})

if __name__ == '__main__':
    unittest.main()
