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
spec = importlib.util.spec_from_file_location('fish_engine_under_test', SERVICE_DIR / 'fish_engine.py')
fish_engine = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = fish_engine
spec.loader.exec_module(fish_engine)


class Segment:
    def __init__(self, samples):
        self.audio = samples
        self.sample_rate = 44100


class FakeFishModel:
    sample_rate = 44100

    def __init__(self):
        self.prepared = 0
        self.calls = []

    def _prepare_reference_prompt(self, ref_audio, ref_text):
        self.prepared += 1
        return ['prompt'], ['tokens']

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        kwargs['ref_audio'] and self._prepare_reference_prompt(kwargs['ref_audio'], kwargs['ref_text'])
        return [Segment([0.0, 0.1]), Segment([-0.1])]


class FishModelClass:
    @classmethod
    def model_quant_predicate(cls, path, module):
        return False


class FakeArray(list):
    def reshape(self, *_):
        return self


class FakeNumpy(types.ModuleType):
    @staticmethod
    def asarray(value, dtype=None):
        return FakeArray(value)

    @staticmethod
    def concatenate(parts):
        return FakeArray(sum((list(part) for part in parts), []))


class FakeSoundFile:
    @staticmethod
    def write(stream, samples, rate, format):
        stream.write(b'RIFFfixtureWAVE' + bytes(len(samples)))


class FakeMx:
    cache_limit = None
    cleared = 0

    @classmethod
    def set_cache_limit(cls, value):
        cls.cache_limit = value

    @classmethod
    def clear_cache(cls):
        cls.cleared += 1


class FishEngineTest(unittest.TestCase):
    def test_clone_profile_reference_is_encoded_once_and_tags_pass_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            profile = Path(tmp) / 'kurisu-v1'; profile.mkdir()
            (profile / 'reference.wav').write_bytes(b'fixture')
            (profile / 'reference.txt').write_text('reference transcript', encoding='utf-8')
            model = FakeFishModel()
            captured = {}
            utils = types.ModuleType('mlx_audio.tts.utils')
            utils.load_model = lambda model_id: captured.setdefault('model_id', model_id) and model
            core_utils = types.ModuleType('mlx_audio.utils')
            core_utils.load_audio = lambda path, sample_rate: ('reference-array', sample_rate)
            fish_mod = types.ModuleType('mlx_audio.tts.models.fish_qwen3_omni.fish_speech')
            fish_mod.Model = FishModelClass
            mlx_core = types.ModuleType('mlx.core')
            mlx_core.set_cache_limit = FakeMx.set_cache_limit
            mlx_core.clear_cache = FakeMx.clear_cache
            mlx = types.ModuleType('mlx'); mlx.__path__ = []; mlx.core = mlx_core
            packages = {name: types.ModuleType(name) for name in (
                'mlx_audio', 'mlx_audio.tts', 'mlx_audio.tts.models', 'mlx_audio.tts.models.fish_qwen3_omni')}
            for package in packages.values():
                package.__path__ = []
            with patch.dict(sys.modules, {
                **packages, 'mlx': mlx, 'mlx.core': mlx_core, 'numpy': FakeNumpy('numpy'), 'soundfile': FakeSoundFile,
                'mlx_audio.tts.utils': utils, 'mlx_audio.utils': core_utils,
                'mlx_audio.tts.models.fish_qwen3_omni.fish_speech': fish_mod,
            }):
                engine = fish_engine.FishMlxEngine(profile, 'mlx-community/fish-audio-s2-pro-8bit')
                wav, rate, timing = engine.synthesize_timed('[angry] ふざけないで')
            self.assertEqual(captured['model_id'], 'mlx-community/fish-audio-s2-pro-8bit')
            self.assertEqual(rate, 44100)
            self.assertTrue(wav.startswith(b'RIFF'))
            self.assertEqual(model.calls[-1]['text'], '[angry] ふざけないで')
            self.assertEqual(model.calls[-1]['ref_text'], 'reference transcript')
            self.assertNotIn('instruct', model.calls[-1])
            # warm-up plus one request
            self.assertEqual(len(model.calls), 2)
            # the cached prompt path ran the codec for the fixed profile exactly once
            self.assertEqual(model.prepared, 1)
            self.assertTrue(FakeMx.cleared >= 2)
            self.assertEqual(FakeMx.cache_limit, 512 * 1024 * 1024)
            self.assertTrue(FishModelClass.model_quant_predicate('embeddings', object()))
            self.assertGreaterEqual(timing.engine_inside_lock_ms, 0)

    def test_missing_profile_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                fish_engine.FishMlxEngine(Path(tmp) / 'absent', 'model')


if __name__ == '__main__':
    unittest.main()
