from __future__ import annotations

import re
from typing import Any

URL_RE = re.compile(r'https?://[^\s<>]+', re.IGNORECASE)
SELLER_PATH_RE = re.compile(r'/shops?/(\d+)(?:/|$)|/user/(\d+)(?:/|$)', re.IGNORECASE)
PRODUCT_PATH_RE = re.compile(r'/products?_?/(\d+)(?:/|$)', re.IGNORECASE)


def _clean_url(value: str) -> str:
    return value.rstrip('.,，。！？!）)]}')


def _split_keywords(value: str) -> list[str]:
    value = re.sub(r'^(?:上架|发布|出现|包含|有)\s*', '', value.strip(), flags=re.IGNORECASE)
    value = re.split(r'(?:就|请|告诉我|通知我|提醒我|时告诉|时通知)', value, maxsplit=1)[0]
    return [part.strip() for part in re.split(r'[,，、/]+|\s+和\s+', value) if part.strip()]


def parse_watch_intent(text: str) -> dict[str, Any] | None:
    urls = [_clean_url(value) for value in URL_RE.findall(text)]
    if not urls:
        return None
    url = urls[0]
    seller_match = SELLER_PATH_RE.search(url)
    product_match = PRODUCT_PATH_RE.search(url)
    if seller_match:
        seller_id = seller_match.group(1) or seller_match.group(2)
        keyword_match = re.search(r'(?:上架|发布|出现|包含|有)\s+(.+?)(?:就|请|告诉|通知|提醒|$)', text, flags=re.IGNORECASE)
        keywords = _split_keywords(keyword_match.group(1)) if keyword_match else []
        return {
            'source': 'bunjang',
            'type': 'seller',
            'target': {'sellerExternalId': seller_id, 'sellerUrl': url},
            'rules': {'keywords': keywords, 'keywordMode': 'any'},
        }
    if product_match:
        product_id = product_match.group(1)
        return {
            'source': 'bunjang',
            'type': 'product',
            'target': {'productExternalId': product_id, 'productUrl': url},
            'rules': {},
        }
    return None


def is_list_request(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {'我现在盯着什么', '我现在监控什么', '查看监控', '查看 watches', '/watches', '/product-radar'} or '现在盯着什么' in normalized
