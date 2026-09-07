from __future__ import annotations

import unittest

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
        self.assertTrue(is_confirm_request('确认监控'))
        self.assertTrue(is_cancel_request('取消'))

    def test_stop(self) -> None:
        self.assertEqual(parse_stop_intent('停止监控')['action'], 'stop')
        self.assertEqual(parse_stop_intent('停止这个商品 https://m.bunjang.co.kr/products/418123655')['url'], 'https://m.bunjang.co.kr/products/418123655')
        self.assertIsNone(parse_stop_intent('停止今天的自动摘要'))

class ProductRadarImageIntentTest(unittest.TestCase):
    def test_image_only_creates_similarity_watch_with_two_minute_interval(self) -> None:
        from components.intent import parse_similarity_watch_intent

        result = parse_similarity_watch_intent('', [{'referenceImageBase64': 'data:image/jpeg;base64,abc'}])
        self.assertEqual(result['type'], 'similarity')
        self.assertEqual(result['target']['referenceImageBase64'], 'data:image/jpeg;base64,abc')
        self.assertEqual(result['target']['searchQuery'], '의류')
        self.assertEqual(result['rules']['similarityThreshold'], 0.6)
        self.assertEqual(result['intervalSeconds'], 120)

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
