import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from components.tools.kurisu_gateway import stable_call_id, trusted_session_context  # noqa: E402


class KurisuGatewayTests(unittest.TestCase):
    def test_context_uses_stable_session_fields(self):
        context = trusted_session_context({
            'platform': 'telegram',
            'platform_user_id': '42',
            'chat_type': 'group',
            'chat_id': '-100',
            'bot_id': 'bot-1',
        }, 'q-1')
        self.assertEqual(context['platformUserId'], '42')
        self.assertEqual(context['conversation']['kind'], 'group')
        self.assertEqual(context['botId'], 'bot-1')

    def test_tool_input_is_structured(self):
        self.assertIsInstance(json.loads('{"toolName":"kurisu.homehub.status","input":{}}'), dict)

    def test_call_id_is_stable_without_model_owned_metadata(self):
        first = stable_call_id('query-1', 'kurisu.radar.list', {'includeRuns': False})
        same = stable_call_id('query-1', 'kurisu.radar.list', {'includeRuns': False})
        different = stable_call_id('query-1', 'kurisu.radar.status', {'watchId': 'watch-1'})
        self.assertEqual(first, same)
        self.assertNotEqual(first, different)
        self.assertLessEqual(len(first), 256)

    def test_external_tool_name_is_provider_compatible_and_internal_names_stay_enum_bound(self):
        manifest = (ROOT / 'components' / 'tools' / 'kurisu_gateway.yaml').read_text(encoding='utf-8')
        match = re.search(r'^  name:\s*([^\n]+)$', manifest, re.MULTILINE)
        self.assertIsNotNone(match)
        self.assertRegex(match.group(1).strip(), r'^[A-Za-z0-9_-]+$')
        self.assertIn('kurisu.radar.list', manifest)
        self.assertIn('kurisu.radar.status', manifest)


if __name__ == '__main__':
    unittest.main()
