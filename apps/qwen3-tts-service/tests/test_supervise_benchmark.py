import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import supervise_benchmark as supervisor

class WatchdogTest(unittest.TestCase):
    def test_watchdog_kills_only_child_on_stalled_sample(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = supervisor.MAX_SAMPLE_S
            supervisor.MAX_SAMPLE_S = .1
            try:
                command = [sys.executable, "-u", "-c", "import time; print('START=test-safe-0',flush=True); time.sleep(10)"]
                self.assertFalse(supervisor.run_config(command, root/'run.log', root/'timeout.json'))
                self.assertIn('watchdog_timeout', (root/'timeout.json').read_text())
                self.assertEqual((root/'timeout.json').stat().st_mode & 0o777, 0o600)
            finally:
                supervisor.MAX_SAMPLE_S = old

    def test_whole_config_is_bounded_even_if_samples_keep_starting(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            old = supervisor.MAX_CONFIG_S
            supervisor.MAX_CONFIG_S = .1
            try:
                command = [sys.executable, "-u", "-c", "import time; print('START=fixture-0',flush=True); time.sleep(10)"]
                self.assertFalse(supervisor.run_config(command, root/'run.log', root/'timeout.json'))
                self.assertIn('config_watchdog_timeout', (root/'timeout.json').read_text())
            finally:
                supervisor.MAX_CONFIG_S = old
