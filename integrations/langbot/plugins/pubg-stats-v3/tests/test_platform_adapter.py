from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from components.platform.kook import KookAdapter
from components.platform.contracts import build_normalized_message
from components.platform.registry import normalize_event_message, normalize_session_message
from components.platform.telegram import TelegramAdapter
from components.platform.whatsapp import WhatsAppAdapter
from components.pubg_v3_client import classify_pubg_message, is_whoami_command, run_whoami


class PlatformAdapterTest(unittest.TestCase):
    def test_kook_group_and_private(self) -> None:
        adapter = KookAdapter('test-kook')
        group = adapter.normalize_event({
            'channel_type': 'GROUP',
            'target_id': 'group-1',
            'author_id': 'user-1',
            'msg_id': 'message-1',
            'content': '昨日战绩',
        })
        self.assertEqual(group['platform'], 'kook')
        self.assertEqual(group['chat']['type'], 'group')
        self.assertEqual(group['user']['platformUserId'], 'user-1')
        self.assertNotIn('raw', group)

        private = adapter.normalize_event({
            'channel_type': 'PERSON',
            'target_id': 'user-1',
            'author_id': 'user-1',
            'msg_id': 'message-2',
            'content': '谁最强',
        })
        self.assertEqual(private['chat']['type'], 'private')

    def test_telegram_fixture(self) -> None:
        message = TelegramAdapter('mock-telegram').normalize_event({
            'update_id': 10,
            'message': {
                'message_id': 2,
                'date': 1788326400,
                'text': '昨日战绩',
                'from': {'id': 100, 'first_name': 'A'},
                'chat': {'id': -200, 'type': 'group', 'title': 'PUBG'},
            },
        })
        self.assertEqual(message['platform'], 'telegram')
        self.assertEqual(message['chat']['type'], 'group')
        self.assertEqual(message['chat']['id'], '-200')
        self.assertNotEqual(message['user']['platformUserId'], message['chat']['id'])

    def test_whoami_command_and_same_name_ids(self) -> None:
        self.assertTrue(is_whoami_command('/whoami'))
        self.assertTrue(is_whoami_command('/whoami@homehub_bot'))
        self.assertFalse(is_whoami_command('/whoami Arthur'))

        adapter = TelegramAdapter('test-telegram')
        first = adapter.normalize_event({
            'message': {
                'message_id': 1,
                'text': '/whoami',
                'from': {'id': 1001, 'first_name': 'Arthur'},
                'chat': {'id': -500, 'type': 'group'},
            },
        })
        second = adapter.normalize_event({
            'message': {
                'message_id': 2,
                'text': '/whoami',
                'from': {'id': 1002, 'first_name': 'Arthur'},
                'chat': {'id': -500, 'type': 'group'},
            },
        })
        self.assertEqual(first['user']['displayName'], second['user']['displayName'])
        self.assertNotEqual(first['user']['platformUserId'], second['user']['platformUserId'])

    def test_whoami_client_is_read_only_and_forwards_normalized_identity(self) -> None:
        message = build_normalized_message(
            platform='kook',
            bot_id='kook-bot',
            platform_user_id='kook-user-1',
            chat_type='group',
            chat_id='kook-channel-1',
            message_id='whoami-1',
            text='/whoami',
        )
        with patch('components.pubg_v3_client._post_json', return_value={
            'status': 'success',
            'response': 'platform: kook\nplatformUserId: kook-user-1',
            'data': {'platformUserId': 'kook-user-1'},
        }) as post:
            result = asyncio.run(run_whoami(None, message=message, query_id=7))

        self.assertEqual(result['status'], 'success')
        self.assertEqual(result['data']['platformUserId'], 'kook-user-1')
        post.assert_called_once()
        url, payload = post.call_args.args
        self.assertTrue(url.endswith('/v3/whoami'))
        self.assertEqual(payload['message']['user']['platformUserId'], 'kook-user-1')
        plugin_state: dict[str, object] = {}
        self.assertNotIn('last_pubg_query_result', plugin_state)

    def test_whoami_rejects_missing_platform_identity_without_calling_runtime(self) -> None:
        message = build_normalized_message(
            platform='telegram',
            bot_id='telegram-bot',
            platform_user_id='unknown',
            chat_type='private',
            chat_id='unknown',
            message_id='whoami-invalid',
            text='/whoami',
        )
        with patch('components.pubg_v3_client._post_json') as post:
            result = asyncio.run(run_whoami(None, message=message, query_id=8))

        self.assertEqual(result['status'], 'INVALID_IDENTITY')
        self.assertIn('真实的平台用户 ID', result['response'])
        post.assert_not_called()

    def test_session_entrypoint_uses_registered_platform_adapter(self) -> None:
        kook_message = normalize_session_message({
            'launcher_type': 'group',
            'launcher_id': 'kook-group',
            'sender_id': 'kook-user',
        }, text='昨日战绩', query_id=3)
        self.assertEqual(kook_message['platform'], 'kook')
        self.assertEqual(kook_message['chat']['type'], 'group')

        telegram_message = normalize_session_message({
            'platform': 'telegram',
            'chat_type': 'private',
            'chat_id': '1001',
            'platform_user_id': '1001',
        }, text='昨日战绩', query_id=4)
        self.assertEqual(telegram_message['platform'], 'telegram')
        self.assertEqual(telegram_message['chat']['type'], 'private')

    def test_command_event_platform_field_prevents_telegram_kook_fallback(self) -> None:
        telegram_message = normalize_event_message({
            'platform': 'telegram',
            'launcher_type': 'person',
            'launcher_id': 'telegram-user-fixture',
            'sender_id': 'telegram-user-fixture',
            'text_message': '/whoami',
            'message_id': 'telegram-command-1',
            'display_name': 'Arthur',
        })
        kook_message = normalize_event_message({
            'platform': 'kook',
            'launcher_type': 'person',
            'launcher_id': 'kook-user-fixture',
            'sender_id': 'kook-user-fixture',
            'text_message': '/whoami',
            'message_id': 'kook-command-1',
        })

        self.assertEqual(telegram_message['platform'], 'telegram')
        self.assertEqual(telegram_message['user']['platformUserId'], 'telegram-user-fixture')
        self.assertEqual(telegram_message['user']['displayName'], 'Arthur')
        self.assertEqual(kook_message['platform'], 'kook')
        self.assertEqual(kook_message['user']['platformUserId'], 'kook-user-fixture')

    def test_session_entrypoint_supports_future_platforms_with_generic_adapter(self) -> None:
        message = normalize_session_message({
            'platform': 'wechat',
            'chat_type': 'group',
            'chat_id': 'wx-group',
            'platform_user_id': 'wx-user',
        }, text='昨日战绩', query_id=5)
        self.assertEqual(message['platform'], 'wechat')
        self.assertEqual(message['chat']['id'], 'wx-group')

    def test_whatsapp_text_event_uses_cloud_identity_and_ignores_interactive(self) -> None:
        message = WhatsAppAdapter('phone-1').normalize_event({
            'object': 'whatsapp_business_account',
            'entry': [{
                'id': 'waba-1',
                'changes': [{
                    'value': {
                        'metadata': {'phone_number_id': 'phone-1'},
                        'contacts': [{'wa_id': '8613800138000', 'profile': {'name': 'Alice'}}],
                        'messages': [
                            {'id': 'wamid.text-1', 'from': '8613800138000', 'type': 'text', 'text': {'body': '昨日战绩'}},
                            {'id': 'wamid.button-1', 'from': '8613800138000', 'type': 'interactive'},
                        ],
                    },
                }],
            }],
        })
        self.assertEqual(message['platform'], 'whatsapp')
        self.assertEqual(message['botId'], 'phone-1')
        self.assertEqual(message['user']['platformUserId'], '8613800138000')
        self.assertEqual(message['user']['displayName'], 'Alice')
        self.assertEqual(message['message']['id'], 'wamid.text-1')
        self.assertEqual(message['message']['text'], '昨日战绩')
        self.assertEqual(message['attachments'], [])

    def test_whatsapp_session_adapter_is_registered(self) -> None:
        message = normalize_session_message({
            'platform': 'whatsapp',
            'chat_id': '8613800138000',
            'platform_user_id': '8613800138000',
        }, text='今日战绩', query_id='wamid.session-1')
        self.assertEqual(message['platform'], 'whatsapp')
        self.assertEqual(message['chat']['type'], 'private')

    def test_review_intent_stays_mandatory_when_runtime_is_unavailable(self) -> None:
        message = build_normalized_message(
            platform='telegram',
            bot_id='telegram-bot',
            platform_user_id='1001',
            chat_type='group',
            chat_id='review-group',
            message_id='review-1',
            text='复盘今天最后一把',
        )
        with patch('components.pubg_v3_client._post_json', return_value={
            'route': 'unknown',
            'status': 'SOURCE_UNAVAILABLE',
        }):
            result = asyncio.run(classify_pubg_message(None, message=message))

        self.assertEqual(result['route'], 'mandatory')
        self.assertTrue(result['fallback'])

    def test_review_follow_up_keywords_stay_mandatory_in_fallback(self) -> None:
        for text in ('火箭筒呢', '开车呢', '上一把'):
            message = build_normalized_message(
                platform='kook',
                bot_id='kook-bot',
                platform_user_id='user-1',
                chat_type='group',
                chat_id='review-group',
                message_id=f'review-{text}',
                text=text,
            )
            with patch('components.pubg_v3_client._post_json', return_value={
                'route': 'unknown',
                'status': 'SOURCE_UNAVAILABLE',
            }):
                result = asyncio.run(classify_pubg_message(None, message=message))

            self.assertEqual(result['route'], 'mandatory', text)


if __name__ == '__main__':
    unittest.main()
