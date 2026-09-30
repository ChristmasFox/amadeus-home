import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service

class EngineBoundaryTest(unittest.TestCase):
    def test_default_is_mlx_and_mps_is_explicit_emergency_path(self):
        mlx = Mock(return_value='mlx')
        module = types.SimpleNamespace(QwenMlxEngine=mlx)
        with patch.dict(os.environ, {'AMADEUS_TTS_MLX_MODEL_PATH': '/protected/model'}, clear=True), patch.dict(sys.modules, {'mlx_engine': module}):
            self.assertEqual(service.create_engine(Path('/protected/profile'), 'model'), 'mlx')
            mlx.assert_called_once()
        with patch.dict(os.environ, {'AMADEUS_TTS_ENGINE': 'mps'}, clear=True), patch.object(service, 'QwenEngine', return_value='mps') as mps:
            self.assertEqual(service.create_engine(Path('/protected/profile'), 'model'), 'mps')
            mps.assert_called_once()

    def test_unknown_backend_and_missing_mlx_path_fail_closed(self):
        with patch.dict(os.environ, {'AMADEUS_TTS_ENGINE':'unexpected'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'unsupported_speech_engine'):
                service.create_engine(Path('/outside'), 'model')
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'mlx_model_path_required'):
                service.create_engine(Path('/outside'), 'model')
