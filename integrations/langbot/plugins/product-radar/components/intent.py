from __future__ import annotations

import re
from typing import Any

URL_RE = re.compile(r'https?://[^\s<>]+', re.IGNORECASE)
SELLER_PATH_RE = re.compile(r'/shops?/(\d+)(?:/|$)|/user/(\d+)(?:/|$)', re.IGNORECASE)
PRODUCT_PATH_RE = re.compile(r'/products?_?/(\d+)(?:/|$)', re.IGNORECASE)
DEFAULT_INTERVAL_SECONDS = 120
DEFAULT_SIMILARITY_INTERVAL_SECONDS = 900


def _clean_url(value: str) -> str:
    return value.rstrip('.,，。！？!）)]}')


def extract_url(text: str) -> str | None:
    match = URL_RE.search(text)
    return _clean_url(match.group(0)) if match else None


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
            'intervalSeconds': DEFAULT_INTERVAL_SECONDS,
        }
    if product_match:
        product_id = product_match.group(1)
        return {
            'source': 'bunjang',
            'type': 'product',
            'target': {'productExternalId': product_id, 'productUrl': url},
            'rules': {},
            'intervalSeconds': DEFAULT_INTERVAL_SECONDS,
        }
    return None


def parse_similarity_watch_intent(text: str, images: list[dict[str, str]]) -> dict[str, Any] | None:
    if not images:
        return None
    normalized = text.strip().lower()
    if normalized and any(is_control in normalized for is_control in ('确认监控', '开始监控', '取消监控', '停止监控', '停止', '暂停')):
        return None
    query_match = re.search(r'(?:搜索词|搜索|搜|只看|关键词|query|search(?: term)?)\s*[:：]?\s*([^，。！？\n]+)', text, flags=re.IGNORECASE)
    search_query = query_match.group(1).strip() if query_match and query_match.group(1).strip() else None
    explicit_terms = [search_query] if search_query else []
    source = images[0]
    target: dict[str, Any] = {**source, 'userText': text.strip()}
    if search_query:
        target['searchQuery'] = search_query
        target['explicitSearchTerms'] = explicit_terms
    return {
        'source': 'bunjang',
        'type': 'similarity',
        'target': target,
        'rules': {'similarityThreshold': 0.6, 'candidateLimit': 60},
        'intervalSeconds': DEFAULT_SIMILARITY_INTERVAL_SECONDS,
    }

def is_list_request(text: str) -> bool:
    normalized = text.strip().lower()
    return normalized in {'我现在盯着什么', '我现在监控什么', '查看监控', '查看 watches', '/watches', '/product-radar'} or '现在盯着什么' in normalized


def is_confirm_request(text: str) -> bool:
    return text.strip().lower() in {'确认监控', '开始监控', '确认', '开始'}


def is_cancel_request(text: str) -> bool:
    return text.strip().lower() in {'取消监控', '取消'}


def parse_stop_intent(text: str) -> dict[str, Any] | None:
    without_url = URL_RE.sub('', text).strip()
    if not re.fullmatch(r'(?:停止|停掉|暂停)(?:监控)?(?:这个|当前)?(?:商品|卖家|监控)?[。！!？?\s]*', without_url, flags=re.IGNORECASE):
        return None
    url = extract_url(text)
    return {'action': 'stop', **({'url': url} if url else {})}
