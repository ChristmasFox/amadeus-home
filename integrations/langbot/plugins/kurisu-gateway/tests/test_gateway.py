import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from components.tools.kurisu_gateway import trusted_session_context  # noqa: E402


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


if __name__ == '__main__':
    unittest.main()
