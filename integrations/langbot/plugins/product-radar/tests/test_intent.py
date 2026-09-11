from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import components.intent_planner as intent_planner
import components.vision as vision
from components.command_adapter import watch_create_payload, watch_patch_payload
from components.context import load_context, set_active_watch, set_watch_list
from components.intent_planner import apply_active_watch_context, resolve_product_radar_intent, resolve_product_radar_command
from components.observability_presentation import format_duration, format_observability, format_relative_time
from components.watch_presentation import delete_choice_buttons, format_delete_choices, format_watches
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


class ProductRadarObservabilityPresentationTest(unittest.TestCase):
    def test_duration_and_relative_time_are_human_readable(self) -> None:
        self.assertEqual(format_duration(183_845), '2天 3小时 4分钟 5秒')
        now = __import__('datetime').datetime(2026, 9, 9, 8, 0, 0, tzinfo=__import__('datetime').timezone.utc)
        self.assertEqual(
            format_relative_time('2026-09-09T06:57:57Z', now=now, empty='尚未检查'),
            '1小时 2分钟 3秒前',
        )
        self.assertEqual(
            format_relative_time('2026-09-10T09:02:03Z', now=now, empty='待调度'),
            '1天 1小时 2分钟 3秒后',
        )

    def test_status_includes_complete_counters_and_per_feed_errors(self) -> None:
        now = __import__('datetime').datetime(2026, 9, 9, 8, 0, 0, tzinfo=__import__('datetime').timezone.utc)
        output = format_observability({
            'watch': {'id': 'watch-1', 'type': 'similarity', 'target': {'searchQuery': '패딩'}},
            'status': 'DEGRADED',
            'runningForSeconds': 183_845,
            'lastRunAt': '2026-09-09T06:57:57Z',
            'nextRunAt': '2026-09-10T09:02:03Z',
            'runtime': {
                'feedRuns': 12, 'successfulRuns': 9, 'failedRuns': 3,
                'newListings': 8, 'candidatesProcessed': 7, 'imageComparisons': 6,
                'aboveThreshold': 2, 'bestScore': 0.875, 'notificationsSent': 1,
            },
            'usage': {'totalTokens': 456, 'calls': 3},
            'feeds': [{'query': '패딩', 'state': 'DEGRADED', 'runCount': 2, 'successCount': 0,
                       'failureCount': 2, 'lastError': 'WATERMARK_NOT_REACHED'}],
        }, stats=False, now=now)
        self.assertIn('运行时长：2天 3小时 4分钟 5秒', output)
        self.assertIn('上次检查：1小时 2分钟 3秒前', output)
        self.assertIn('下次检查：1天 1小时 2分钟 3秒后', output)
        self.assertIn('• 图片对比：6，达到阈值：2', output)
        self.assertIn('• 最高相似度：87.5%', output)
        self.assertIn('• 已发送通知：1', output)
        self.assertIn('패딩：DEGRADED（检查 2，成功 0，失败 2）', output)
        self.assertIn('原因：WATERMARK_NOT_REACHED', output)

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
    async def test_langbot_selector_controls_both_intent_and_vision_without_source_uuid(self) -> None:
        class SelectorPlugin:
            def get_config(self) -> dict[str, str]:
                return {'model_uuid': 'arthur-model'}

            async def get_llm_models(self) -> list[str]:
                return ['arthur-model', 'other-model']

        plugin = SelectorPlugin()
        self.assertEqual(await intent_planner._intent_model_uuid(plugin), 'arthur-model')
        self.assertEqual(await vision._model_uuid(plugin), 'arthur-model')

    async def test_invalid_langbot_selector_fails_closed_instead_of_switching_models(self) -> None:
        class SelectorPlugin:
            def get_config(self) -> dict[str, str]:
                return {'model_uuid': 'removed-model'}

            async def get_llm_models(self) -> list[str]:
                return ['arthur-model']

        self.assertIsNone(await intent_planner._intent_model_uuid(SelectorPlugin()))

    async def test_empty_langbot_selector_uses_first_available_model(self) -> None:
        class SelectorPlugin:
            def get_config(self) -> dict[str, str]:
                return {}

            async def get_llm_models(self) -> list[str]:
                return ['langbot-preferred-model']

        self.assertEqual(await intent_planner._intent_model_uuid(SelectorPlugin()), 'langbot-preferred-model')

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

    def test_status_query_has_offline_product_radar_fallback(self) -> None:
        for phrase in ('监控的怎么样了', '监控情况怎么样？', '我现在的监控正常吗'):
            command = intent_planner._legacy_fast_path(_normalized_message(phrase), None)
            self.assertIsNotNone(command, phrase)
            self.assertEqual(command['domain'], 'product_radar')
            self.assertEqual(command['intent'], 'get_watch_status')

    def test_model_status_without_target_is_eligible_for_overview(self) -> None:
        command = intent_planner._normalize_model_result(
            {'domain': 'product_radar', 'intent': 'get_watch_status', 'watchType': None},
            _normalized_message('监控的怎么样了'),
            None,
        )
        self.assertEqual(command['intent'], 'get_watch_status')
        self.assertFalse(command['needsClarification'])
        self.assertNotIn('watchId', command['entities'])

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

    async def invoke_llm(self, model_uuid: str, messages: list[object], funcs: list[object], extra_args: dict[str, object] | None = None) -> dict[str, str]:
        self.calls.append((model_uuid, messages))
        return {'content': json.dumps(self.result, ensure_ascii=False)}


class _FlakyJsonLunaPlugin(_FakeLunaPlugin):
    def __init__(self, result: dict) -> None:
        super().__init__(result)
        self.extra_args_seen: list[dict[str, object] | None] = []

    async def invoke_llm(self, model_uuid: str, messages: list[object], funcs: list[object], extra_args: dict[str, object] | None = None) -> dict[str, str]:
        self.extra_args_seen.append(extra_args)
        self.calls.append((model_uuid, messages))
        if len(self.calls) == 1:
            return {'content': '可以帮你留意，之后有结果会通知你。'}
        return {'content': json.dumps(self.result, ensure_ascii=False)}


class _ProviderMessageLunaPlugin(_FakeLunaPlugin):
    async def invoke_llm(self, model_uuid: str, messages: list[object], funcs: list[object], extra_args: dict[str, object] | None = None) -> object:
        self.calls.append((model_uuid, messages))
        return SimpleNamespace(content=json.dumps(self.result, ensure_ascii=False))


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
            self.assertEqual(command['entities']['source'], 'bunjang')
            self.assertEqual(command['constraints']['intervalSeconds'], 3600)
            self.assertEqual(command['targetProfile']['brand'], 'VISVIM')
            self.assertEqual(command['targetProfile']['userSearchTerms'], ['VISVIM jacket'])
            self.assertEqual(command['entities']['referenceImage']['referenceImageBase64'], attachment['base64'])
            self.assertEqual(len(plugin.calls), 1, phrase)
            user_content = plugin.calls[0][1][1].content
            self.assertEqual(user_content[-1]['type'], 'image_url')

    async def test_non_json_luna_response_is_retried_without_keyword_routing(self) -> None:
        plugin = _FlakyJsonLunaPlugin({
            'domain': 'product_radar',
            'intent': 'create_watch',
            'watchType': 'similarity',
            'entities': {},
        })
        with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
            command = await resolve_product_radar_command(
                plugin,
                message=_normalized_message(
                    '帮我长期盯着这件，有同款通知我',
                    attachments=[{'type': 'image', 'mimeType': 'image/jpeg', 'base64': 'data:image/jpeg;base64,abc'}],
                ),
            )
        self.assertIsNotNone(command)
        self.assertEqual(command['intent'], 'create_watch')
        self.assertEqual(command['watchType'], 'similarity')
        self.assertEqual(command['entities']['source'], 'bunjang')
        self.assertEqual(len(plugin.calls), 2)
        self.assertEqual(plugin.extra_args_seen[0], {'response_format': {'type': 'json_object'}})
        payload = watch_create_payload(
            command,
            _normalized_message(
                '帮我长期盯着这件，有同款通知我',
                attachments=[{'type': 'image', 'mimeType': 'image/jpeg', 'base64': 'data:image/jpeg;base64,abc'}],
            ),
        )
        self.assertEqual(payload['source'], 'bunjang')

    async def test_real_langbot_message_object_content_is_parsed(self) -> None:
        plugin = _ProviderMessageLunaPlugin({
            'domain': 'product_radar',
            'intent': 'create_watch',
            'watchType': 'similarity',
            'entities': {},
        })
        with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
            command = await resolve_product_radar_command(
                plugin,
                message=_normalized_message(
                    '帮我长期盯着这件，有同款通知我',
                    attachments=[{'type': 'image', 'mimeType': 'image/jpeg', 'base64': 'data:image/jpeg;base64,abc'}],
                ),
            )
        self.assertIsNotNone(command)
        self.assertEqual(command['domain'], 'product_radar')
        self.assertEqual(command['intent'], 'create_watch')
        self.assertEqual(command['watchType'], 'similarity')
        self.assertEqual(command['entities']['source'], 'bunjang')
        self.assertEqual(len(plugin.calls), 1)

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

    async def test_external_game_messages_remain_outside_product_radar_with_active_watch(self) -> None:
        context_plugin = SimpleNamespace()
        set_active_watch(context_plugin, _normalized_message('创建', user_id='user-a'), {
            'id': 'watch-1', 'source': 'bunjang', 'type': 'similarity', 'enabled': True,
            'target': {}, 'rules': {},
        })
        for phrase in ('今日战绩', '今日战报', '今日复盘'):
            plugin = _FakeLunaPlugin({'domain': 'none', 'intent': 'none'})
            message = _normalized_message(phrase, user_id='user-a')
            context = load_context(context_plugin, message)
            with patch.object(intent_planner, 'provider_message', _FakeProviderMessage):
                command = await resolve_product_radar_command(plugin, message=message, context=context)
            self.assertIsNone(command, phrase)

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
        self.assertTrue(command['selectionRequired'])
        self.assertNotIn('watchId', command['entities'])
        self.assertIsNone(command.get('control'))

    def test_cancel_ordinal_uses_the_callers_displayed_watch_list(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('我现在盯着什么', user_id='user-a')
        set_watch_list(plugin, message, ['watch-1', 'watch-2', 'watch-3'])
        context = load_context(plugin, _normalized_message('取消1号', user_id='user-a'))

        command = intent_planner._legacy_fast_path(
            _normalized_message('取消1号', user_id='user-a'),
            context,
        )
        self.assertEqual(command['intent'], 'delete_watch')
        self.assertEqual(command['entities']['watchOrdinal'], 1)

    def test_cancel_ordinal_without_product_radar_context_is_not_routed(self) -> None:
        command = intent_planner._legacy_fast_path(_normalized_message('取消1号'), None)
        self.assertIsNone(command)

    def test_view_ordinal_fallback_supports_details_status_and_records(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('我现在盯着什么', user_id='user-a')
        set_watch_list(plugin, message, ['watch-1', 'watch-2', 'watch-3'])
        context = load_context(plugin, _normalized_message('查看1号', user_id='user-a'))
        for phrase, intent, ordinal in (
            ('查看1号', 'get_watch', 1),
            ('第2个监控的记录', 'get_watch_stats', 2),
            ('看3号状态', 'get_watch_status', 3),
        ):
            command = intent_planner._legacy_fast_path(
                _normalized_message(phrase, user_id='user-a'),
                context,
            )
            self.assertEqual(command['intent'], intent)
            self.assertEqual(command['entities']['watchOrdinal'], ordinal)

    def test_model_result_normalizes_watch_ordinal_without_overriding_it_with_active_watch(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('取消第2个监控', user_id='user-a')
        set_active_watch(plugin, _normalized_message('创建这个', user_id='user-a'), {
            'id': 'watch-active', 'source': 'bunjang', 'type': 'product', 'enabled': True, 'target': {}, 'rules': {},
        })
        context = load_context(plugin, message)
        command = intent_planner._normalize_model_result(
            {
                'domain': 'product_radar',
                'intent': 'delete_watch',
                'watchType': None,
                'entities': {'watchOrdinal': '2号'},
            },
            message,
            context,
        )
        self.assertEqual(command['entities']['watchOrdinal'], 2)
        self.assertNotIn('watchId', command['entities'])

    def test_model_selection_request_does_not_inherit_active_watch(self) -> None:
        plugin = SimpleNamespace()
        message = _normalized_message('帮我取消监控', user_id='user-a')
        set_active_watch(plugin, _normalized_message('创建这个', user_id='user-a'), {
            'id': 'watch-active', 'source': 'bunjang', 'type': 'product', 'enabled': True, 'target': {}, 'rules': {},
        })
        context = load_context(plugin, message)
        command = intent_planner._normalize_model_result(
            {
                'domain': 'product_radar',
                'intent': 'delete_watch',
                'watchType': 'product',
                'selectionRequired': True,
            },
            message,
            context,
        )
        self.assertTrue(command['selectionRequired'])
        self.assertNotIn('watchId', command['entities'])

    def test_watch_list_numbers_and_delete_buttons_share_the_same_order(self) -> None:
        rows = [
            {'id': 'watch-1', 'source': 'bunjang', 'type': 'product', 'enabled': True, 'intervalSeconds': 120, 'target': {'productExternalId': '424506121'}},
            {'id': 'watch-2', 'source': 'bunjang', 'type': 'similarity', 'enabled': True, 'intervalSeconds': 900, 'target': {'searchQuery': '패딩'}},
        ]
        formatted = format_watches({'watches': rows})
        choices = format_delete_choices(rows)
        buttons = delete_choice_buttons(rows)
        self.assertIn('1号 · bunjang / product / 启用 / 每 2 分钟', formatted)
        self.assertIn('2号 · bunjang / similarity / 启用 / 每 15 分钟', formatted)
        self.assertIn('请选择要取消的监控：', choices)
        self.assertEqual([button['text'] for button in buttons], ['取消1号', '取消2号'])
        self.assertEqual(buttons[0]['callbackData'], 'pr1:delete:watch-1')
        self.assertEqual(buttons[1]['callbackData'], 'pr1:delete:watch-2')

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
