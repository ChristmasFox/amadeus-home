import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import service

class EngineBoundaryTest(unittest.TestCase):
    def test_default_is_mps_and_unknown_fails_closed(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(service, 'QwenEngine', return_value='mps') as mps:
            self.assertEqual(service.create_engine(Path('/outside'), 'model'), 'mps')
            mps.assert_called_once()
        with patch.dict(os.environ, {'AMADEUS_TTS_ENGINE':'unexpected'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'unsupported_speech_engine'):
                service.create_engine(Path('/outside'), 'model')
        with patch.dict(os.environ, {'AMADEUS_TTS_ENGINE':'mlx'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'experimental_mlx_model_path_required'):
                service.create_engine(Path('/outside'), 'model')
