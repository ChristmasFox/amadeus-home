from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import components.intent_planner as intent_planner
from components.command_adapter import watch_create_payload, watch_patch_payload
from components.context import load_context, set_active_watch
from components.intent_planner import apply_active_watch_context, resolve_product_radar_intent, resolve_product_radar_command
from components.platform.normalized import build_normalized_message, context_key

from components.intent import (
    DEFAULT_INTERVAL_SECONDS,
    is_cancel_request,
    is_confirm_request,
    is_list_request,
    parse_stop_intent,
    parse_watch_intent,
)


class ProductRadarIntentTest(unittest.TestCase):
    def test_seller(self) -> None:
        result = parse_watch_intent('帮我盯这个 Bunjang 卖家，他上架 Chrome Hearts 就告诉我 https://m.bunjang.co.kr/shops/4771473/products')
        self.assertEqual(result['type'], 'seller')
        self.assertEqual(result['rules']['keywords'], ['Chrome Hearts'])
        self.assertEqual(result['intervalSeconds'], DEFAULT_INTERVAL_SECONDS)

    def test_product(self) -> None:
        result = parse_watch_intent('帮我盯这个商品 https://m.bunjang.co.kr/products/418123655')
        self.assertEqual(result['type'], 'product')
        self.assertEqual(result['target']['productExternalId'], '418123655')
        self.assertEqual(result['intervalSeconds'], 120)

    def test_list_and_confirmation_controls(self) -> None:
        self.assertTrue(is_list_request('我现在盯着什么？'))
        self.assertTrue(is_list_request('我在盯着什么'))
        self.assertTrue(is_confirm_request('确认监控'))
        self.assertTrue(is_cancel_request('取消'))

    def test_stop(self) -> None:
        self.assertEqual(parse_stop_intent('停止监控')['action'], 'stop')
        self.assertEqual(parse_stop_intent('停止这个商品 https://m.bunjang.co.kr/products/418123655')['url'], 'https://m.bunjang.co.kr/products/418123655')
        self.assertIsNone(parse_stop_intent('停止今天的自动摘要'))

class ProductRadarImageIntentTest(unittest.TestCase):
    def test_image_only_creates_similarity_watch_with_fifteen_minute_interval(self) -> None:
        from components.intent import parse_similarity_watch_intent

        result = parse_similarity_watch_intent('', [{'referenceImageBase64': 'data:image/jpeg;base64,abc'}])
        self.assertEqual(result['type'], 'similarity')
        self.assertEqual(result['target']['referenceImageBase64'], 'data:image/jpeg;base64,abc')
        self.assertNotIn('searchQuery', result['target'])
        self.assertEqual(result['rules']['similarityThreshold'], 0.6)
        from components.intent import DEFAULT_SIMILARITY_INTERVAL_SECONDS
        self.assertEqual(result['intervalSeconds'], DEFAULT_SIMILARITY_INTERVAL_SECONDS)

    def test_image_caption_can_narrow_search_query(self) -> None:
        from components.intent import parse_similarity_watch_intent

        result = parse_similarity_watch_intent('帮我找类似的，关键词：Chrome Hearts hoodie', [{'referenceImageUrl': 'https://image.test/ref.jpg'}])
        self.assertEqual(result['target']['searchQuery'], 'Chrome Hearts hoodie')

class ProductRadarBridgeTest(unittest.TestCase):
    def test_message_chain_image_base64_is_extracted_without_platform_api(self) -> None:
        from components.platform.bridge import attachment_sources

        class Image:
            type = 'Image'
            base64 = 'data:image/jpeg;base64,abc'
            url = ''

        class Chain:
            root = [Image()]

        class Event:
            message_chain = Chain()

        self.assertEqual(attachment_sources(Event()), [{'referenceImageBase64': 'data:image/jpeg;base64,abc'}])

    def test_normalized_telegram_event_uses_authoritative_sender_and_chat(self) -> None:
        from components.platform.normalized import normalize_event_message

        event = {
            'platform': 'telegram',
            'launcher_type': 'group',
            'launcher_id': '-5527996775',
            'sender_id': '-5527996775',
            'message_id': 'legacy-message-id',
            'message_event': {
                'source_platform_object': {
                    'message': {
                        'message_id': 7,
                        'text': '帮我留意这件',
                        'from': {'id': 424242, 'first_name': 'Arthur'},
                        'chat': {'id': -5527996775, 'type': 'group', 'title': 'HomeHub'},
                    },
                },
            },
        }
        message = normalize_event_message(event)
        self.assertEqual(message['user']['platformUserId'], '424242')
        self.assertEqual(message['chat']['id'], '-5527996775')
        self.assertEqual(message['message']['id'], '7')
        self.assertEqual(message['user']['displayName'], 'Arthur')


class ProductRadarIntentPlannerTest(unittest.IsolatedAsyncioTestCase):
    async def test_natural_language_list_request(self) -> None:
        result = await resolve_product_radar_intent(object(), '我都在盯哪些东西？', False)
        self.assertEqual(result['action'], 'list')

    async def test_natural_language_active_stop_request(self) -> None:
        result = await resolve_product_radar_intent(object(), '刚才那件不要了', False)
        self.assertEqual(result['action'], 'stop')

    async def test_status_and_stats_are_structured_operations(self) -> None:
        for phrase, intent in (
            ('我那个羽绒服还在蹲吗？', 'get_watch_status'),
            ('今天查了多少次？', 'get_watch_stats'),
            ('目前最像的是多少？', 'get_watch_stats'),
            ('花了多少 token？', 'get_watch_stats'),
        ):
            plugin = _FakeLunaPlugin({'domain': 'product_radar', 'intent': intent, 'watchType': 'similarity'})
            message = _normalized_message(phrase, user_id='user-a')
            context_plugin = SimpleNamespace()
            set_active_watch(context_plugin, _normalized_message('创建', user_id='user-a'), {
                'id': 'watch-1', 'source': 'bunjang', 'type': 'similarity', 'enabled': True, 'target': {}, 'rules': {},
            })
            context = load_context(context_plugin, message)
            with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
                command = await resolve_product_radar_command(plugin, message=message, context=context)
            self.assertEqual(command['intent'], intent)
            self.assertEqual(command['entities']['watchId'], 'watch-1')
            self.assertEqual(command['action'], 'status' if intent == 'get_watch_status' else 'stats')
            self.assertEqual(command['_usage']['inferenceCount'], 1)

    async def test_heartbeat_controls_stay_separate_from_search_interval(self) -> None:
        plugin = _FakeLunaPlugin({
            'domain': 'product_radar',
            'intent': 'update_watch',
            'watchType': 'similarity',
            'constraints': {'heartbeatEnabled': 'false', 'heartbeatIntervalSeconds': '每周'},
        })
        with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
            command = await resolve_product_radar_command(plugin, message=_normalized_message('以后不要发日报，每周一次也行'))
        self.assertEqual(command['constraints']['heartbeatEnabled'], False)
        self.assertEqual(command['constraints']['heartbeatIntervalSeconds'], 604800)
        watch_patch = watch_patch_payload(command, {'type': 'similarity'})
        self.assertEqual(watch_patch['heartbeatEnabled'], False)
        self.assertEqual(watch_patch['heartbeatIntervalSeconds'], 604800)
        self.assertNotIn('intervalSeconds', watch_patch)

    def test_cancel_without_context_is_not_acknowledged_as_pending_proposal(self) -> None:
        command = intent_planner._legacy_fast_path(_normalized_message('取消监控'), None)
        self.assertEqual(command['intent'], 'delete_watch')
        self.assertFalse(command['needsClarification'])
        self.assertIsNone(command.get('control'))

    def test_restored_context_is_attached_without_reparsing(self) -> None:
        context_plugin = SimpleNamespace()
        set_active_watch(context_plugin, _normalized_message('创建', user_id='user-a'), {
            'id': 'watch-1', 'source': 'bunjang', 'type': 'similarity', 'enabled': True, 'target': {}, 'rules': {},
        })
        context = load_context(context_plugin, _normalized_message('这个还正常吗？', user_id='user-a'))
        command = apply_active_watch_context({
            'domain': 'product_radar', 'intent': 'get_watch_status', 'watchType': None,
            'entities': {}, 'constraints': {}, 'needsClarification': True,
        }, context)
        self.assertEqual(command['entities']['watchId'], 'watch-1')
        self.assertEqual(command['watchType'], 'similarity')
        self.assertFalse(command['needsClarification'])
        self.assertTrue(command['resolvedFromContext'])



class _FakeProviderMessage:
    class Message:
        def __init__(self, *, role: str, content: object) -> None:
            self.role = role
            self.content = content


class _FakeLunaPlugin:
    def __init__(self, result: dict) -> None:
        self.result = result
        self.calls: list[tuple[str, list[object]]] = []

    def get_config(self) -> dict[str, str]:
        return {'intent_model_uuid': 'luna-test'}

    async def get_llm_models(self) -> list[str]:
        return ['luna-test']

    async def invoke_llm(self, model_uuid: str, messages: list[object], funcs: list[object]) -> dict[str, str]:
        self.calls.append((model_uuid, messages))
        return {'content': json.dumps(self.result, ensure_ascii=False)}


def _normalized_message(
    text: str,
    *,
    user_id: str = 'user-a',
    chat_id: str = 'group-1',
    attachments: list[dict[str, object]] | None = None,
):
    return build_normalized_message(
        platform='telegram',
        bot_id='telegram-test-bot',
        platform_user_id=user_id,
        chat_type='group',
        chat_id=chat_id,
        message_id=f'message-{user_id}',
        text=text,
        attachments=attachments or [],
    )


def _similarity_profile_result() -> dict:
    return {
        'domain': 'product_radar',
        'intent': 'create_watch',
        'watchType': 'similarity',
        'entities': {
            'source': 'Bunjang',
            'explicitSearchTerms': ['VISVIM jacket'],
            'brand': 'VISVIM',
        },
        'constraints': {'similarityThreshold': '60%', 'intervalSeconds': '3600'},
        'targetProfile': {
            'brand': 'Nike',
            'category': 'jacket',
            'colors': ['black'],
            'materials': ['nylon'],
            'features': ['hood'],
            'detectedText': ['VISVIM'],
            'confidence': {'category': 0.94},
        },
        'confidence': 0.93,
    }


class ProductRadarGenericNluTest(unittest.IsolatedAsyncioTestCase):
    async def test_natural_paraphrases_share_one_structured_multimodal_intent(self) -> None:
        phrases = [
            '帮我蹲这件',
            '这件韩国有人卖了告诉我',
            'Bunjang 有类似的叫我',
            '帮我长期留意一下',
            '韩国那边什么时候出了通知我',
            '这个有了喊我',
            '帮我看看以后有没有人上这个',
        ]
        attachment = {'type': 'image', 'mimeType': 'image/jpeg', 'base64': 'data:image/jpeg;base64,abc'}
        for phrase in phrases:
            plugin = _FakeLunaPlugin(_similarity_profile_result())
            with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
                command = await resolve_product_radar_command(
                    plugin,
                    message=_normalized_message(phrase, attachments=[attachment]),
                )
            self.assertIsNotNone(command, phrase)
            self.assertEqual(command['domain'], 'product_radar')
            self.assertEqual(command['intent'], 'create_watch')
            self.assertEqual(command['watchType'], 'similarity')
            self.assertEqual(command['constraints']['intervalSeconds'], 3600)
            self.assertEqual(command['targetProfile']['brand'], 'VISVIM')
            self.assertEqual(command['targetProfile']['userSearchTerms'], ['VISVIM jacket'])
            self.assertEqual(command['entities']['referenceImage']['referenceImageBase64'], attachment['base64'])
            self.assertEqual(len(plugin.calls), 1, phrase)
            user_content = plugin.calls[0][1][1].content
            self.assertEqual(user_content[-1]['type'], 'image_url')

    async def test_image_only_and_non_radar_image_questions_do_not_create_watch(self) -> None:
        attachment = {'type': 'image', 'mimeType': 'image/jpeg', 'base64': 'data:image/jpeg;base64,abc'}
        for phrase in ('这是什么衣服？', '帮我翻译图片里的韩文', '这张图好看吗？'):
            plugin = _FakeLunaPlugin({'domain': 'none', 'intent': 'none'})
            with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
                command = await resolve_product_radar_command(
                    plugin,
                    message=_normalized_message(phrase, attachments=[attachment]),
                )
            self.assertIsNone(command, phrase)
            self.assertEqual(len(plugin.calls), 1, phrase)

        image_only_plugin = _FakeLunaPlugin(_similarity_profile_result())
        with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
            command = await resolve_product_radar_command(
                image_only_plugin,
                message=_normalized_message('', attachments=[attachment]),
            )
        self.assertIsNone(command)
        self.assertEqual(image_only_plugin.calls, [])

    async def test_context_followups_resolve_against_the_callers_active_watch(self) -> None:
        message = _normalized_message('创建这个', user_id='user-a')
        plugin = SimpleNamespace()
        set_active_watch(plugin, message, {
            'id': 'watch-1',
            'source': 'bunjang',
            'type': 'similarity',
            'enabled': True,
            'intervalSeconds': 900,
            'target': {'referenceImageId': 'reference-1'},
            'rules': {'similarityThreshold': 0.6, 'candidateLimit': 60},
        })
        context = load_context(plugin, _normalized_message('价格改成30万', user_id='user-a'))

        followups = [
            ('价格改成30万', {'intent': 'update_watch', 'constraints': {'minPrice': '30万', 'maxPrice': '30万'}}),
            ('每小时看一次', {'intent': 'update_watch', 'constraints': {'intervalSeconds': '每小时'}}),
            ('刚才那个其实是 VISVIM', {
                'intent': 'update_watch',
                'entities': {'brand': 'VISVIM'},
                'targetProfile': {'brand': 'Nike'},
            }),
        ]
        for phrase, raw in followups:
            response = {'domain': 'product_radar', 'watchType': None, 'entities': {}, 'constraints': {}, **raw}
            provider = _FakeLunaPlugin(response)
            with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
                command = await resolve_product_radar_command(
                    provider,
                    message=_normalized_message(phrase, user_id='user-a'),
                    context=context,
                )
            self.assertEqual(command['intent'], 'update_watch')
            self.assertEqual(command['watchType'], 'similarity')
            self.assertEqual(command['entities']['watchId'], 'watch-1')
            self.assertFalse(command['needsClarification'])

        self.assertEqual(
            (await resolve_product_radar_command(
                plugin,
                message=_normalized_message('暂停它', user_id='user-a'),
                context=context,
            ))['intent'],
            'pause_watch',
        )
        delete_command = await resolve_product_radar_command(
            plugin,
            message=_normalized_message('不要了', user_id='user-a'),
            context=context,
        )
        self.assertEqual(delete_command['intent'], 'delete_watch')
        self.assertEqual(delete_command['entities']['watchId'], 'watch-1')

    def test_cancel_existing_watch_deletes_active_watch_not_pending_proposal(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('创建这个', user_id='user-a')
        set_active_watch(plugin, message, {
            'id': 'watch-1',
            'source': 'bunjang',
            'type': 'similarity',
            'enabled': True,
            'target': {},
            'rules': {},
        })
        context = load_context(plugin, _normalized_message('取消监控', user_id='user-a'))

        command = intent_planner._legacy_fast_path(
            _normalized_message('取消监控', user_id='user-a'),
            context,
        )
        self.assertEqual(command['intent'], 'delete_watch')
        self.assertEqual(command['entities']['watchId'], 'watch-1')
        self.assertIsNone(command.get('control'))

    def test_cancel_pending_proposal_keeps_proposal_control(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('创建这个', user_id='user-a')
        from components.context import set_pending

        set_pending(plugin, message, 'proposal-1')
        context = load_context(plugin, _normalized_message('取消', user_id='user-a'))
        command = intent_planner._legacy_fast_path(
            _normalized_message('取消', user_id='user-a'),
            context,
        )
        self.assertEqual(command['intent'], 'create_watch')
        self.assertEqual(command['control'], 'cancel')

    def test_natural_stop_fallback_deletes_active_watch(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('创建这个', user_id='user-a')
        set_active_watch(plugin, message, {
            'id': 'watch-2',
            'source': 'bunjang',
            'type': 'product',
            'enabled': True,
            'target': {},
            'rules': {},
        })
        context = load_context(plugin, _normalized_message('不要盯着了', user_id='user-a'))
        command = intent_planner._legacy_fast_path(
            _normalized_message('不要盯着了', user_id='user-a'),
            context,
        )
        self.assertEqual(command['intent'], 'delete_watch')
        self.assertEqual(command['entities']['watchId'], 'watch-2')

    def test_context_key_isolated_by_sender_inside_same_group(self) -> None:
        plugin = SimpleNamespace()
        user_a = _normalized_message('创建这个', user_id='user-a')
        user_b = _normalized_message('暂停它', user_id='user-b')
        set_active_watch(plugin, user_a, {'id': 'watch-a', 'source': 'bunjang', 'type': 'similarity', 'target': {}, 'rules': {}})
        self.assertNotEqual(context_key(user_a), context_key(user_b))
        self.assertIsNone(load_context(plugin, user_b))

        command = intent_planner._normalize_model_result(
            {'domain': 'product_radar', 'intent': 'pause_watch', 'watchType': 'similarity'},
            user_b,
            None,
        )
        self.assertTrue(command['needsClarification'])
        self.assertNotIn('watchId', command['entities'])

    def test_explicit_entities_override_conflicting_vision_profile(self) -> None:
        command = intent_planner._normalize_model_result(
            _similarity_profile_result(),
            _normalized_message('帮我找这件', attachments=[{'type': 'image', 'base64': 'data:image/jpeg;base64,abc'}]),
            None,
        )
        self.assertEqual(command['entities']['brand'], 'VISVIM')
        self.assertEqual(command['targetProfile']['brand'], 'VISVIM')
        self.assertEqual(command['targetProfile']['provenance']['brand']['source'], 'user')
        self.assertTrue(any(item['field'] == 'brand' and item['source'] == 'user' for item in command['targetProfile']['hardConstraints']))

    def test_structured_command_adapter_supports_all_watch_types_and_profile(self) -> None:
        similarity_command = intent_planner._normalize_model_result(
            _similarity_profile_result(),
            _normalized_message('帮我找这件', attachments=[{'type': 'image', 'base64': 'data:image/jpeg;base64,abc'}]),
            None,
        )
        similarity_payload = watch_create_payload(
            similarity_command,
            _normalized_message('帮我找这件', attachments=[{'type': 'image', 'base64': 'data:image/jpeg;base64,abc'}]),
        )
        self.assertEqual(similarity_payload['type'], 'similarity')
        self.assertEqual(similarity_payload['target']['referenceImageBase64'], 'data:image/jpeg;base64,abc')
        self.assertEqual(similarity_payload['targetProfile']['brand'], 'VISVIM')
        self.assertEqual(similarity_payload['rules']['similarityThreshold'], 0.6)
        similarity_patch = watch_patch_payload(
            {
                'intent': 'update_watch',
                'watchType': 'similarity',
                'entities': {'brand': 'VISVIM'},
                'constraints': {'intervalSeconds': 3600},
                'targetProfile': similarity_command['targetProfile'],
            },
            {'type': 'similarity'},
        )
        self.assertEqual(similarity_patch['intervalSeconds'], 3600)
        self.assertIn('targetProfile', similarity_patch)

        seller_payload = watch_create_payload(
            {
                'intent': 'create_watch',
                'watchType': 'seller',
                'entities': {'source': 'bunjang', 'sellerUrl': 'https://m.bunjang.co.kr/shops/1', 'keywords': ['VISVIM']},
                'constraints': {'minPrice': 100, 'maxPrice': 300000, 'currency': 'KRW'},
            },
            _normalized_message('帮我留意这个卖家'),
        )
        self.assertEqual(seller_payload['type'], 'seller')
        self.assertEqual(seller_payload['rules']['maxPrice'], 300000)

        product_payload = watch_create_payload(
            {
                'intent': 'create_watch',
                'watchType': 'product',
                'entities': {'source': 'bunjang', 'productUrl': 'https://m.bunjang.co.kr/products/1'},
                'constraints': {},
            },
            _normalized_message('帮我留意这个商品'),
        )
        self.assertEqual(product_payload['type'], 'product')
        self.assertEqual(product_payload['target']['productUrl'], 'https://m.bunjang.co.kr/products/1')
