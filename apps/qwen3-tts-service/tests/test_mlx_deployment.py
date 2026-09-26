import importlib.util
import json
import plistlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


renderer = load('tts_plist_renderer', ROOT / 'infra/macos/render-qwen3-tts-plist.py')
assets = load('tts_mlx_assets', ROOT / 'infra/macos/verify-qwen3-mlx-assets.py')
CONFIG = json.loads((ROOT / 'infra/macos/qwen3-tts-engine.json').read_text())
TEMPLATE = ROOT / 'infra/macos/com.amadeus.qwen3-tts.plist.example'


class PlistRenderTest(unittest.TestCase):
    def test_explicit_single_backend_preserves_a_profile(self):
        with tempfile.TemporaryDirectory() as tmp:
            base, voice, log, mlx = (Path(tmp) / x for x in ('base','A','log','mlx'))
            for engine in ('mps', 'mlx'):
                parsed = plistlib.loads(renderer.render(TEMPLATE, base, voice, log, mlx, engine))
                env = parsed['EnvironmentVariables']
                self.assertEqual(env['AMADEUS_TTS_ENGINE'], engine)
                self.assertEqual(env['AMADEUS_TTS_VOICE_DIR'], str(voice))
                self.assertEqual(parsed['ProcessType'], 'Interactive')
                self.assertEqual(parsed['ProgramArguments'][0], str((base if engine == 'mps' else mlx) / 'venv/bin/python'))
                self.assertEqual(env['AMADEUS_TTS_MLX_MODEL_PATH'], str(mlx / 'model-8bit') if engine == 'mlx' else '')
            with self.assertRaisesRegex(ValueError, 'unsupported_tts_engine'):
                renderer.render(TEMPLATE, base, voice, log, mlx, 'auto-fallback')


class ProtectedMlxAssetsTest(unittest.TestCase):
    def test_checksum_manifest_and_revision_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.chmod(0o700)
            source = root / 'mlx-audio';source.mkdir(mode=0o700)
            model = root / 'model-8bit';model.mkdir(mode=0o700)
            tokenizer = model / 'speech_tokenizer';tokenizer.mkdir(mode=0o700)
            python = root / 'venv/bin/python';python.parent.mkdir(parents=True);python.write_text('fixture');python.chmod(0o700)
            for path in (model / 'config.json', model / 'model.safetensors', tokenizer / 'model.safetensors'):
                path.write_bytes(b'private-fixture');path.chmod(0o600)
            versions = {'mlx-audio': CONFIG['mlxPackageVersion'], **CONFIG['mlxDependencies']}
            def fake_check(command, text):
                if command[0] == 'git' and 'rev-parse' in command:return CONFIG['mlxSourceRevision'] + '\n'
                if command[0] == 'git' and 'status' in command:return ''
                return json.dumps(versions) + '\n'
            with patch.object(assets.subprocess, 'check_output', side_effect=fake_check):
                expected = assets.preflight(root, CONFIG)
                manifest = root / 'asset-manifest.json'
                manifest.write_text(json.dumps(expected));manifest.chmod(0o600)
                assets.verify_manifest(root, expected)
                (model / 'model.safetensors').write_bytes(b'changed')
                with self.assertRaisesRegex(ValueError, 'mlx_asset_manifest_mismatch'):
                    assets.verify_manifest(root, assets.preflight(root, CONFIG))
