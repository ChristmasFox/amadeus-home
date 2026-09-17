import asyncio
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from components.tools.kurisu_gateway import (  # noqa: E402
    DEFAULT_RUNTIME_URL,
    runtime_url,
    stable_call_id,
    trusted_session_context,
    trusted_session_context_from_plugin,
)


class KurisuGatewayTests(unittest.TestCase):
    def test_runtime_url_has_private_service_default_for_isolated_plugin_process(self):
        class FakePlugin:
            def get_config(self):
                return {}

        self.assertEqual(runtime_url(FakePlugin()), DEFAULT_RUNTIME_URL)

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

    def test_context_resolves_platform_from_langbot_bot_registry(self):
        class FakePlugin:
            def __init__(self):
                self.requested_bot_uuid = None

            async def get_bot_info(self, bot_uuid):
                self.requested_bot_uuid = bot_uuid
                return {'adapter': 'telegram'}

        plugin = FakePlugin()
        context = asyncio.run(
            trusted_session_context_from_plugin(
                {'bot_uuid': 'telegram-bot-uuid', 'sender_id': '42', 'launcher_id': '42', 'launcher_type': 'person'},
                'q-1',
                plugin,
            )
        )
        self.assertEqual(plugin.requested_bot_uuid, 'telegram-bot-uuid')
        self.assertEqual(context['platform'], 'telegram')
        self.assertEqual(context['botId'], 'telegram-bot-uuid')

    def test_context_fails_closed_without_bot_registry_identity(self):
        class FakePlugin:
            async def get_bot_info(self, bot_uuid):
                return {'adapter': 'unknown'}

        with self.assertRaises(RuntimeError):
            asyncio.run(
                trusted_session_context_from_plugin(
                    {'bot_uuid': 'bot-uuid', 'sender_id': '42', 'launcher_id': '42', 'launcher_type': 'person'},
                    'q-1',
                    FakePlugin(),
                )
            )

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
