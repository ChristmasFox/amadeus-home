from __future__ import annotations

import unittest

from components.intent import is_list_request, parse_watch_intent


class ProductRadarIntentTest(unittest.TestCase):
    def test_seller(self) -> None:
        result = parse_watch_intent('帮我盯这个 Bunjang 卖家，他上架 Chrome Hearts 就告诉我 https://m.bunjang.co.kr/shops/4771473/products')
        self.assertEqual(result['type'], 'seller')
        self.assertEqual(result['rules']['keywords'], ['Chrome Hearts'])

    def test_product(self) -> None:
        result = parse_watch_intent('帮我盯这个商品 https://m.bunjang.co.kr/products/418123655')
        self.assertEqual(result['type'], 'product')
        self.assertEqual(result['target']['productExternalId'], '418123655')

    def test_list(self) -> None:
        self.assertTrue(is_list_request('我现在盯着什么？'))
