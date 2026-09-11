from __future__ import annotations

"""Natural-language boundary for Product Radar.

The listener is deliberately thin: this module turns one normalized inbound
message plus its own context into a validated, platform-neutral command.  It
does not call Product Radar, inspect watches, or decide whether a listing is a
match.  The latter responsibilities stay in the deterministic Product Radar
domain.
"""

import json
import logging
import math
import re
import time
from datetime import datetime, timezone
from typing import Any

from components.context import active_watch, context_for_parser, watch_list_ids
from components.platform.normalized import (
    NormalizedBotMessage,
    build_normalized_message,
    image_sources,
)

try:
    from langbot_plugin.api.entities.builtin.provider import message as provider_message
except ImportError:  # pragma: no cover - outside LangBot
    provider_message = None

from components.vision import _content_text, _image_block, _model_uuid, _parse_json, usage_from_output


LOGGER = logging.getLogger('product-radar.intent')

PRODUCT_RADAR_DOMAIN = 'product_radar'
WATCH_INTENTS = frozenset({
    'create_watch',
    'list_watches',
    'get_watch',
    'get_watch_status',
    'get_watch_stats',
    'update_watch',
    'pause_watch',
    'resume_watch',
    'delete_watch',
})
CONTROL_VALUES = frozenset({'confirm', 'cancel'})
WATCH_TYPES = frozenset({'similarity', 'seller', 'product'})

ENTITY_FIELDS = (
    'source',
    'sellerUrl',
    'productUrl',
    'referenceImage',
    'brand',
    'modelName',
    'season',
    'category',
    'keywords',
    'excludeKeywords',
    'explicitSearchTerms',
    'watchId',
    'watchOrdinal',
)
CONSTRAINT_FIELDS = (
    'minPrice',
    'maxPrice',
    'currency',
    'intervalSeconds',
    'similarityThreshold',
    'heartbeatEnabled',
    'heartbeatIntervalSeconds',
)
PROFILE_SCALAR_FIELDS = ('brand', 'modelName', 'season', 'category', 'subcategory', 'size', 'minPrice', 'maxPrice')
PROFILE_ARRAY_FIELDS = (
    'colors',
    'materials',
    'features',
    'detectedText',
    'userHints',
    'userSearchTerms',
    'explicitSearchTerms',
    'includeKeywords',
    'excludeKeywords',
)

URL_RE = re.compile(r'https?://[^\s<>]+', re.IGNORECASE)
TOKEN_RE = re.compile(r'^[A-Za-z0-9_-]{4,80}$')
WATCH_ID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f-]{27,}$', re.IGNORECASE)
WATCH_ORDINAL_RE = re.compile(r'^(?:第\s*)?(\d+)\s*(?:号|个|個|条|條|项|項)?$', re.IGNORECASE)
CANCEL_ORDINAL_RE = re.compile(
    r'^(?:取消|删除|刪除|停止|停掉)\s*(?:监控|監控)?\s*(?:第\s*)?(\d+)\s*(?:号|个|個|条|條|项|項)?\s*(?:监控|監控)?$',
    re.IGNORECASE,
)
VIEW_ORDINAL_RE = re.compile(
    r'^(?:(查看|看看|打开|查|查询|看)\s*)?(?:第\s*)?(\d+)\s*(号|个|個|条|條|项|項)\s*(监控|監控)?(?:的)?\s*(记录|紀錄|详情|詳情|状态|狀態|统计|統計|信息|資訊)?$',
    re.IGNORECASE,
)
STATUS_QUERY_RE = re.compile(
    r'^(?:我(?:现在|目前)?(?:的)?\s*)?(?:监控|監控|监控情况|監控情況|监控状态|監控狀態)(?:的)?\s*(?:怎么样|怎麼樣|怎样|怎樣|如何|正常吗|正常嗎|还正常吗|還正常嗎|运行(?:得|的)?怎么样|運行(?:得|的)?怎麼樣)(?:了)?[？?。！!！.]?$',
    re.IGNORECASE,
)

LEGACY_ACTIONS = {
    'create_watch': 'watch',
    'list_watches': 'list',
    'get_watch': 'get',
    'get_watch_status': 'status',
    'get_watch_stats': 'stats',
    'update_watch': 'update',
    'pause_watch': 'pause',
    'resume_watch': 'resume',
    'delete_watch': 'stop',
}


def _clean_url(value: str) -> str:
    return value.rstrip('.,，。！？!）)]}')


def _urls_in_text(text: str) -> list[str]:
    return [_clean_url(value) for value in URL_RE.findall(text)]


def _unique_strings(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else [value]
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def _string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _number(value: Any, *, field: str) -> int | float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value if math.isfinite(float(value)) else None
    if not isinstance(value, str):
        return None
    text = value.strip().replace(',', '').replace('，', '')
    if not text:
        return None
    if field in {'intervalSeconds', 'heartbeatIntervalSeconds'}:
        interval_aliases = {
            '每小时': 3600,
            '每小時': 3600,
            '每半小时': 1800,
            '每半小時': 1800,
            '每天': 86400,
            '每日': 86400,
            '每24小时': 86400,
            '每24小時': 86400,
            '每周': 604800,
            '每週': 604800,
            'hourly': 3600,
            'daily': 86400,
            'weekly': 604800,
        }
        alias = interval_aliases.get(text.casefold())
        if alias is not None:
            return alias
    multiplier = 1
    if text.lower().endswith(('万', 'w')):
        multiplier = 10_000
        text = text[:-1].strip()
    elif text.lower().endswith('k'):
        multiplier = 1_000
        text = text[:-1].strip()
    if text.endswith('%'):
        try:
            parsed = float(text[:-1].strip()) / 100
        except ValueError:
            return None
    else:
        try:
            parsed = float(text) * multiplier
        except ValueError:
            if field in {'intervalSeconds', 'heartbeatIntervalSeconds'}:
                hour = re.fullmatch(r'每?\s*(\d+(?:\.\d+)?)\s*(?:小时|小時|hour|hours|h)', text, re.IGNORECASE)
                minute = re.fullmatch(r'每?\s*(\d+(?:\.\d+)?)\s*(?:分钟|分鐘|分|minute|minutes|min)', text, re.IGNORECASE)
                if hour:
                    parsed = float(hour.group(1)) * 3600
                elif minute:
                    parsed = float(minute.group(1)) * 60
                else:
                    return None
            else:
                return None
    if field == 'similarityThreshold' and parsed > 1 and parsed <= 100:
        parsed /= 100
    if field in {'intervalSeconds', 'heartbeatIntervalSeconds'}:
        return int(parsed) if math.isfinite(parsed) else None
    return int(parsed) if parsed.is_integer() else parsed


def _watch_ordinal(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if math.isfinite(value) and value.is_integer() and value > 0 else None
    if not isinstance(value, str):
        return None
    match = WATCH_ORDINAL_RE.fullmatch(value.strip())
    if not match:
        return None
    ordinal = int(match.group(1))
    return ordinal if ordinal > 0 else None


def _cancel_ordinal(value: str) -> int | None:
    match = CANCEL_ORDINAL_RE.fullmatch(value.strip())
    if not match:
        return None
    ordinal = int(match.group(1))
    return ordinal if ordinal > 0 else None


def _view_ordinal(value: str) -> tuple[int, str] | None:
    match = VIEW_ORDINAL_RE.fullmatch(value.strip())
    if not match:
        return None
    verb, raw_ordinal, _unit, monitor, suffix = match.groups()
    if not verb and not monitor and not suffix:
        return None
    ordinal = int(raw_ordinal)
    if ordinal <= 0:
        return None
    normalized_suffix = (suffix or '').casefold()
    if normalized_suffix in {'记录', '紀錄', '统计', '統計'}:
        intent = 'get_watch_stats'
    elif normalized_suffix in {'状态', '狀態'}:
        intent = 'get_watch_status'
    else:
        intent = 'get_watch'
    return ordinal, intent


def _is_status_query(value: str) -> bool:
    return bool(STATUS_QUERY_RE.fullmatch(value.strip()))


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().casefold()
        if normalized in {'true', '1', 'yes', 'on', 'enabled', '开启', '打开', '启用'}:
            return True
        if normalized in {'false', '0', 'no', 'off', 'disabled', '关闭', '关掉', '停用'}:
            return False
    return None


def _currency(value: Any) -> str | None:
    text = _string(value)
    if not text:
        return None
    aliases = {
        '₩': 'KRW', '韩元': 'KRW', '원': 'KRW', 'krw': 'KRW',
        '¥': 'CNY', '￥': 'CNY', '人民币': 'CNY', 'cny': 'CNY',
        '$': 'USD', '美元': 'USD', 'usd': 'USD',
    }
    return aliases.get(text.casefold(), text.upper())


def _control_token(text: str) -> tuple[str, str] | None:
    parts = text.strip().split()
    if len(parts) != 2 or not TOKEN_RE.fullmatch(parts[1]):
        return None
    label = parts[0].casefold()
    if label in {'确认监控', '开始监控', '确认', '开始'}:
        return 'confirm', parts[1]
    if label in {'取消监控', '取消'}:
        return 'cancel', parts[1]
    return None


def _legacy_fast_path(message: NormalizedBotMessage, context: dict[str, Any] | None) -> dict[str, Any] | None:
    """Handle protocol controls and a conservative offline fallback.

    This is intentionally not the semantic router.  Natural-language domain
    decisions are delegated to Luna below.  The fallback exists so callback
    confirmations and basic controls remain safe during a provider outage.
    """
    text = str((message.get('message') or {}).get('text') or '').strip()
    normalized = text.casefold()
    current = active_watch(context)
    displayed_watch_ids = watch_list_ids(context)

    # A UUID is a Watch reference, not a pending proposal token.  Keep this
    # compatibility path deterministic when the user still has an old ID.
    parts = text.split()
    if len(parts) == 2 and parts[0].casefold() in {'取消监控', '取消'} and WATCH_ID_RE.fullmatch(parts[1]):
        return _command('delete_watch', entities={'watchId': parts[1]}, confidence=1.0)

    ordinal = _cancel_ordinal(text)
    if ordinal and (displayed_watch_ids or current):
        return _command('delete_watch', entities={'watchOrdinal': ordinal}, confidence=0.95)

    viewed = _view_ordinal(text)
    if viewed and displayed_watch_ids:
        ordinal, intent = viewed
        return _command(intent, entities={'watchOrdinal': ordinal}, confidence=0.85)

    # Product Radar status wording is strong domain evidence.  Keep this
    # narrow fallback available when Luna is temporarily unavailable, so the
    # message is handled by the deterministic listener instead of falling
    # through to LangBot's unrelated general chat.
    if _is_status_query(text):
        return _command('get_watch_status', confidence=0.85)

    token = _control_token(text)
    if token:
        return _command('create_watch', control=token[0], entities={'watchId': token[1]})
    if normalized in {'确认', '开始', '确认监控', '开始监控'}:
        return _command('create_watch', control='confirm')
    if normalized in {'取消', '取消监控'}:
        # ``cancel`` is reserved for a pending create proposal.  Once a Watch
        # already exists, the user's plain cancellation is a delete request;
        # otherwise the listener would acknowledge a proposal cancellation
        # while leaving the real Watch enabled.
        if isinstance(context, dict) and context.get('pendingProposalToken'):
            return _command('create_watch', control='cancel')
        return _command('delete_watch', confidence=0.9, selection_required=True)
    if normalized in {'/watches', '/product-radar'}:
        return _command('list_watches', confidence=1.0)

    # These exact forms are compatibility affordances for an unavailable LLM;
    # they are never used when Luna is available and are not the primary route.
    if normalized in {
        '我在盯着什么', '我现在盯着什么', '我都在盯哪些东西？',
        '我都在盯哪些东西', '我都蹲了什么', '当前监控', '查看监控',
    }:
        return _command('list_watches', confidence=0.85)
    if normalized in {'刚才那件不要了', '不要盯着了', '不要再盯了', '不想盯了', '不要了', '不用了', '不需要了'}:
        if current and current.get('id'):
            return _command('delete_watch', watch_type=current.get('type'), entities={'watchId': current.get('id')}, confidence=0.8)
        return _command('delete_watch', confidence=0.7, clarification_question='请指定要取消的商品链接、卖家链接或 Watch ID。')
    if current and normalized in {'暂停它', '暂停这个', '先停一下', '先暂停'}:
        return _command('pause_watch', watch_type=current.get('type'), entities={'watchId': current.get('id')}, confidence=0.8)
    if current and normalized in {'恢复它', '继续监控', '继续盯', '重新开始'}:
        return _command('resume_watch', watch_type=current.get('type'), entities={'watchId': current.get('id')}, confidence=0.8)
    return None


def _command(
    intent: str,
    *,
    watch_type: str | None = None,
    entities: dict[str, Any] | None = None,
    constraints: dict[str, Any] | None = None,
    target_profile: dict[str, Any] | None = None,
    control: str | None = None,
    confidence: float | None = None,
    needs_clarification: bool = False,
    clarification_question: str | None = None,
    selection_required: bool = False,
    evidence: list[str] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        'domain': PRODUCT_RADAR_DOMAIN,
        'intent': intent,
        'watchType': watch_type,
        'entities': entities or {},
        'constraints': constraints or {},
        'targetProfile': target_profile,
        'confidence': confidence,
        'needsClarification': needs_clarification,
        'clarificationQuestion': clarification_question,
        'selectionRequired': selection_required,
        'evidence': evidence or [],
    }
    # Kept as a compatibility field for older listener code and installed
    # plugin tests.  New routing uses domain + intent + structured fields.
    if control is not None:
        result['control'] = control
        result['action'] = control
    else:
        result['action'] = LEGACY_ACTIONS.get(intent, intent)
    return result


def _raw_field(raw: dict[str, Any], entities: dict[str, Any], constraints: dict[str, Any], field: str) -> Any:
    if field in entities:
        return entities[field]
    if field in constraints:
        return constraints[field]
    return raw.get(field)


def _normalize_profile(
    value: Any,
    *,
    entities: dict[str, Any],
    constraints: dict[str, Any],
    force: bool = False,
) -> dict[str, Any] | None:
    profile = dict(value) if isinstance(value, dict) else {}
    normalized: dict[str, Any] = {}
    for field in PROFILE_SCALAR_FIELDS:
        candidate = profile.get(field)
        if field in entities and field not in {'minPrice', 'maxPrice'}:
            candidate = entities[field]
        elif field in constraints:
            candidate = constraints[field]
        if field in {'minPrice', 'maxPrice'}:
            candidate = _number(candidate, field=field)
        else:
            candidate = _string(candidate)
        if candidate is not None:
            normalized[field] = candidate
    for field in PROFILE_ARRAY_FIELDS:
        candidate = profile.get(field)
        if field == 'userSearchTerms' and 'explicitSearchTerms' in entities:
            candidate = _unique_strings(entities['explicitSearchTerms']) + _unique_strings(candidate)
        if field == 'explicitSearchTerms' and field in entities:
            candidate = entities[field]
        if field == 'includeKeywords' and 'keywords' in entities:
            candidate = entities['keywords']
        if field == 'excludeKeywords' and 'excludeKeywords' in entities:
            candidate = entities['excludeKeywords']
        values = _unique_strings(candidate)
        if values:
            normalized[field] = values
    for field in ('hardConstraints', 'softHints'):
        if isinstance(profile.get(field), list):
            normalized[field] = [item for item in profile[field] if isinstance(item, dict)]

    hard_constraints = normalized.get('hardConstraints')
    if not isinstance(hard_constraints, list):
        hard_constraints = []
        if force or normalized:
            normalized['hardConstraints'] = hard_constraints

    def add_user_constraint(field: str, operator: str, candidate: Any) -> None:
        if candidate is None or candidate == '' or candidate == []:
            return
        if any(
            isinstance(item, dict)
            and item.get('field') == field
            and item.get('operator') == operator
            and item.get('source') == 'user'
            and item.get('value') == candidate
            for item in hard_constraints
        ):
            return
        hard_constraints.append({'field': field, 'operator': operator, 'value': candidate, 'source': 'user', 'confidence': 1.0})

    for field in ('brand', 'modelName', 'season', 'category'):
        add_user_constraint(field, 'equals', entities.get(field))
    for field in ('minPrice', 'maxPrice'):
        add_user_constraint(field, 'equals', constraints.get(field))
    for keyword in _unique_strings(entities.get('keywords')):
        add_user_constraint('keywords', 'contains', keyword)
    for keyword in _unique_strings(entities.get('excludeKeywords')):
        add_user_constraint('keywords', 'not_contains', keyword)
    if isinstance(profile.get('confidence'), dict):
        normalized['confidence'] = profile['confidence']
    provenance = dict(profile.get('provenance')) if isinstance(profile.get('provenance'), dict) else {}
    for field in ('brand', 'modelName', 'season', 'category', 'minPrice', 'maxPrice', 'userSearchTerms', 'explicitSearchTerms', 'includeKeywords', 'excludeKeywords'):
        if field in entities or field in constraints:
            provenance[field] = {'source': 'user', 'confidence': 1.0}
    if provenance:
        normalized['provenance'] = provenance
    if not normalized and not force:
        return None
    if force:
        for field in ('colors', 'materials', 'features', 'detectedText', 'userHints', 'userSearchTerms', 'explicitSearchTerms', 'includeKeywords', 'excludeKeywords'):
            normalized.setdefault(field, [])
        normalized.setdefault('hardConstraints', [])
        normalized.setdefault('softHints', [])
        normalized.setdefault('provenance', {})
        normalized.setdefault('extractedAt', datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
    normalized['provider'] = _string(profile.get('provider')) or 'langbot'
    return normalized


def _normalize_model_result(
    raw: dict[str, Any],
    message: NormalizedBotMessage,
    context: dict[str, Any] | None,
) -> dict[str, Any] | None:
    raw_domain = _string(raw.get('domain'))
    raw_intent = _string(raw.get('intent'))
    raw_action = _string(raw.get('action'))
    raw_control = _string(raw.get('control'))
    aliases = {
        'watch': 'create_watch',
        'create': 'create_watch',
        'list': 'list_watches',
        'get': 'get_watch',
        'status': 'get_watch_status',
        'health': 'get_watch_status',
        'stats': 'get_watch_stats',
        'usage': 'get_watch_stats',
        'history': 'get_watch_stats',
        'update': 'update_watch',
        'pause': 'pause_watch',
        'resume': 'resume_watch',
        'stop': 'delete_watch',
        'delete': 'delete_watch',
    }
    intent = aliases.get((raw_intent or raw_action or '').casefold(), raw_intent or raw_action or '')
    if raw_control in CONTROL_VALUES and intent in {'', 'none'}:
        intent = 'create_watch'
    if raw_domain is None:
        return None
    if raw_domain.casefold() not in {PRODUCT_RADAR_DOMAIN, 'product-radar', 'none', 'unknown'}:
        return None
    if raw_domain and raw_domain.casefold() in {'none', 'unknown'}:
        return None
    if intent == 'none' or intent not in WATCH_INTENTS:
        return None

    raw_entities = raw.get('entities') if isinstance(raw.get('entities'), dict) else {}
    raw_constraints = raw.get('constraints') if isinstance(raw.get('constraints'), dict) else {}
    entities: dict[str, Any] = {}
    constraints: dict[str, Any] = {}

    for field in ENTITY_FIELDS:
        candidate = _raw_field(raw, raw_entities, raw_constraints, field)
        if field == 'referenceImage':
            continue  # An LLM cannot manufacture an attachment reference.
        if field in {'keywords', 'excludeKeywords', 'explicitSearchTerms'}:
            values = _unique_strings(candidate)
            if values:
                entities[field] = values
        elif field == 'watchOrdinal':
            ordinal = _watch_ordinal(candidate)
            if ordinal is not None:
                entities[field] = ordinal
        else:
            text = _string(candidate)
            if text:
                if field == 'source':
                    entities[field] = text.casefold()
                else:
                    entities[field] = _clean_url(text) if field.endswith('Url') else text
    for field in CONSTRAINT_FIELDS:
        candidate = _raw_field(raw, raw_entities, raw_constraints, field)
        if field == 'currency':
            value = _currency(candidate)
        elif field == 'heartbeatEnabled':
            value = _boolean(candidate)
        else:
            value = _number(candidate, field=field)
        if value is not None:
            constraints[field] = value

    text = str((message.get('message') or {}).get('text') or '')
    urls = _urls_in_text(text)
    for url in urls:
        lower = url.casefold()
        if ('/shop' in lower or '/user/' in lower) and 'sellerUrl' not in entities:
            entities['sellerUrl'] = url
        elif '/product' in lower and 'productUrl' not in entities:
            entities['productUrl'] = url

    attachments = image_sources(message)
    # An attachment is data, not a Product Radar request.  It must have a
    # textual semantic signal before any model result can enter this domain.
    if not text.strip():
        return None
    if attachments:
        entities['referenceImage'] = attachments[0]

    current = active_watch(context)
    selection_required = raw.get('selectionRequired') is True
    if current and intent in {'get_watch', 'get_watch_status', 'get_watch_stats', 'update_watch', 'pause_watch', 'resume_watch', 'delete_watch'}:
        if not selection_required and not entities.get('watchId') and not entities.get('watchOrdinal') and current.get('id'):
            entities['watchId'] = str(current['id'])
        if not _string(entities.get('source')) and current.get('source'):
            entities['source'] = str(current['source'])

    watch_type = _string(raw.get('watchType')) or _string(raw.get('type'))
    if watch_type:
        watch_type = watch_type.casefold()
        watch_type = {'image': 'similarity', 'visual': 'similarity', 'seller_watch': 'seller', 'product_watch': 'product'}.get(watch_type, watch_type)
    if watch_type not in WATCH_TYPES:
        watch_type = str(current.get('type')) if current and current.get('type') in WATCH_TYPES else None
    if intent == 'create_watch' and watch_type is None and attachments:
        watch_type = 'similarity'
    if intent == 'create_watch' and not entities.get('source'):
        entities['source'] = 'bunjang'

    profile_value = raw.get('targetProfile')
    if profile_value is None:
        profile_value = raw.get('profile')
    profile_signal = any(
        field in entities
        for field in ('brand', 'modelName', 'season', 'category', 'keywords', 'excludeKeywords', 'explicitSearchTerms', 'referenceImage')
    ) or any(field in constraints for field in ('minPrice', 'maxPrice'))
    target_profile = _normalize_profile(
        profile_value,
        entities=entities,
        constraints=constraints,
        force=(
            isinstance(profile_value, dict)
            or (watch_type == 'similarity' and bool(attachments) and intent == 'create_watch')
            or (watch_type == 'similarity' and profile_signal)
        ),
    )

    control = raw_control if raw_control in CONTROL_VALUES else None

    needs_clarification = bool(raw.get('needsClarification') is True)
    clarification_question = _string(raw.get('clarificationQuestion'))
    if intent == 'create_watch':
        if watch_type is None:
            needs_clarification = True
            clarification_question = clarification_question or '你想找卖家、指定商品，还是按图片找相似商品？'
        elif watch_type == 'similarity' and not attachments:
            needs_clarification = True
            clarification_question = clarification_question or '请再发一张参考图片，我就能按图片帮你长期留意。'
        elif watch_type == 'seller' and not entities.get('sellerUrl'):
            needs_clarification = True
            clarification_question = clarification_question or '请提供要留意的卖家主页链接。'
        elif watch_type == 'product' and not entities.get('productUrl'):
            needs_clarification = True
            clarification_question = clarification_question or '请提供要留意的商品链接。'
    elif intent in {'get_watch', 'get_watch_status', 'get_watch_stats', 'update_watch', 'pause_watch', 'resume_watch', 'delete_watch'}:
        if intent not in {'delete_watch', 'get_watch_status', 'get_watch_stats'} and not entities.get('watchId') and not entities.get('watchOrdinal') and not entities.get('sellerUrl') and not entities.get('productUrl'):
            needs_clarification = True
            clarification_question = clarification_question or '请说明要操作哪一个监控，或先在本次对话中创建一个。'
    if intent == 'update_watch' and not constraints and not any(
        field in entities for field in ('sellerUrl', 'productUrl', 'brand', 'modelName', 'season', 'category', 'keywords', 'excludeKeywords', 'explicitSearchTerms', 'referenceImage')
    ):
        needs_clarification = True
        clarification_question = clarification_question or '你想修改这个监控的价格、频率、关键词，还是图片条件？'

    evidence = _unique_strings(raw.get('evidence'))
    if text.strip() and not evidence:
        evidence = ['text']
    confidence = _number(raw.get('confidence'), field='similarityThreshold')
    if isinstance(confidence, (int, float)):
        confidence = max(0.0, min(1.0, float(confidence)))
    else:
        confidence = None
    result = _command(
        intent,
        watch_type=watch_type,
        entities=entities,
        constraints=constraints,
        target_profile=target_profile,
        control=control,
        confidence=confidence,
        needs_clarification=needs_clarification,
        clarification_question=clarification_question,
        selection_required=selection_required,
        evidence=evidence,
    )
    result['sourceText'] = text.strip()
    if current and intent in {'get_watch', 'get_watch_status', 'get_watch_stats', 'update_watch', 'pause_watch', 'resume_watch', 'delete_watch'}:
        result['resolvedFromContext'] = bool(not raw_entities.get('watchId') and not raw.get('watchId'))
    return result


def apply_active_watch_context(command: dict[str, Any], context: dict[str, Any] | None) -> dict[str, Any]:
    """Attach a restored active Watch to an already parsed command.

    This is a structured-result operation, not a second semantic parse.  It is
    used after a plugin reload when the durable context lookup succeeds, so a
    natural-language message does not spend a duplicate Luna call merely to
    add the Watch ID that the context already owns.
    """
    current = active_watch(context)
    intent = command.get('intent')
    if not current or intent not in {'get_watch', 'get_watch_status', 'get_watch_stats', 'update_watch', 'pause_watch', 'resume_watch', 'delete_watch'}:
        return command
    result = dict(command)
    entities = dict(command.get('entities')) if isinstance(command.get('entities'), dict) else {}
    if not result.get('selectionRequired') and not entities.get('watchId') and not entities.get('watchOrdinal') and current.get('id'):
        entities['watchId'] = str(current['id'])
    if not entities.get('source') and current.get('source'):
        entities['source'] = str(current['source'])
    result['entities'] = entities
    if not result.get('watchType') and current.get('type') in WATCH_TYPES:
        result['watchType'] = current['type']
    if intent in {'get_watch', 'get_watch_status', 'get_watch_stats', 'pause_watch', 'resume_watch', 'delete_watch'}:
        result['needsClarification'] = False
    result['resolvedFromContext'] = True
    return result


def _intent_prompt() -> str:
    return '''你是 GPT-5.6 Luna，负责 Product Radar 的自然语言语义解析。
你只输出一个合法 JSON，不回答用户、不调用工具、不搜索商品、不判断最终图片相似度。

只有用户明确表达了商品雷达语义时，domain 才能是 product_radar：创建、查看、获取、修改、暂停、恢复或删除商品/卖家/图片寻货监控，或者对刚创建的监控进行后续修改。不要把“有图片”本身当成 Product Radar 证据。activeWatch 只能解析已经明确属于商品雷达的后续指代，不能把无关消息强行解释成监控操作。
“这是什么衣服？”、“帮我翻译图片里的韩文”、“这张图好看吗？”属于 none；不要创建 Watch。
与游戏、PUBG、绝地求生、吃鸡、对局、战绩、战报、复盘有关的消息属于其他领域，必须输出 domain=none、intent=none；例如“今日战绩”“今日战报”“今日复盘”即使 context 中存在 activeWatch，也不能输出 Product Radar 命令。不要因为消息出现在群聊、包含日期或使用“状态/情况”等泛化词而改变领域判断。
语义不要求出现“监控”“蹲”“相似”等固定词。比如带参考图时，“帮我蹲这件”“这件韩国有人卖了告诉我”“Bunjang 有类似的叫我”“帮我长期留意一下”“韩国那边什么时候出了通知我”“这个有了喊我”“帮我看看以后有没有人上这个”都表示 create_watch + similarity。

intent 只能是：create_watch、list_watches、get_watch、get_watch_status、get_watch_stats、update_watch、pause_watch、resume_watch、delete_watch；无关消息输出 domain=none、intent=none。
watchType 只能是 similarity、seller、product 或 null。seller/product 通常需要从 sellerUrl/productUrl 判断；带参考图并请求持续发现相似商品时使用 similarity。
“暂停它”是 pause_watch；“恢复/继续盯它”是 resume_watch；“不要了/不需要了”是 delete_watch；“价格改成30万”“每小时看一次”“刚才那个其实是 VISVIM”是 update_watch。列表是 list_watches，要求查看某一个监控详情是 get_watch；“还在蹲吗”“监控正常吗”“为什么一直没消息”是 get_watch_status；“今天查了多少次”“目前最像的是多少”“花了多少 token”是 get_watch_stats。

entities 至少按以下键输出实际识别到的值：source、sellerUrl、productUrl、referenceImage、brand、modelName、season、category、keywords、excludeKeywords、explicitSearchTerms、watchId、watchOrdinal。watchOrdinal 只用于用户已经看到的当前监控列表，例如“取消1号”“取消第2个”“查看3号”；不要凭空猜测序号。单独说“取消监控”表示先列出监控并让用户选择，不要直接猜某一条；此时输出 selectionRequired=true。用户说“取消1号”“取消第2个”“取消第3条监控”时输出 delete_watch + entities.watchOrdinal；用户说“查看1号”“第2个监控的记录”时同样输出对应 watchOrdinal。
constraints 至少按以下键输出实际识别到的值：minPrice、maxPrice、currency、intervalSeconds、similarityThreshold；如果用户提到日报/心跳，使用 heartbeatEnabled、heartbeatIntervalSeconds。明确的“改成”价格可将 minPrice 与 maxPrice 都设为同一数值；“30万”应输出 300000。频率统一输出秒数。比如“不要发每日摘要”“关闭心跳”表示 heartbeatEnabled=false，“每周发一次摘要”表示 heartbeatIntervalSeconds=604800；不要把它误当成 SearchFeed intervalSeconds。

如果有参考图，请在同一次响应中输出 targetProfile，包括你从图像得到的 brand、modelName、season、category、colors、materials、features、detectedText、confidence 等软信息；不要再要求另一次视觉调用。用户文字明确给出的字段、价格、包含/排除条件和搜索词优先于图片推断；把用户明确的搜索词放入 targetProfile.userSearchTerms，并可写入 provenance.source=user / hardConstraints。
只能使用提供的 activeWatch 或当前用户已经看到的 watchListCount 解析“它/刚才那个”和序号，不要猜测别人的监控。无法唯一确定时 needsClarification=true，并给出 clarificationQuestion；不要假装已经创建或修改。

如果 context.pendingProposal=true，用户说“好的”“就这个”“可以”可输出 control=confirm；“不用了”“取消这个”可输出 control=cancel，并把 intent 设为 create_watch。control 只用于待确认 proposal，不要把无关的“取消订阅/取消别的事情”强行改成 Product Radar。

输出形状：
{"domain":"product_radar|none","intent":"create_watch|list_watches|get_watch|get_watch_status|get_watch_stats|update_watch|pause_watch|resume_watch|delete_watch|none","watchType":"similarity|seller|product|null","entities":{},"constraints":{},"targetProfile":null,"control":"confirm|cancel|null","selectionRequired":false,"confidence":0.0,"needsClarification":false,"clarificationQuestion":null,"evidence":[]}
'''


def _structured_retry_messages(messages: list[object]) -> list[object]:
    """Add one protocol reminder without changing the user's semantic input."""
    if not messages or provider_message is None:
        return messages
    last = messages[-1]
    content = getattr(last, 'content', None)
    reminder = {
        'type': 'text',
        'text': '上一条响应不是合法 JSON。请重新解析同一条用户消息，只返回输出形状中的一个 JSON 对象，不要回答用户、不要解释。',
    }
    if isinstance(content, list):
        retry_content = [*content, reminder]
    elif isinstance(content, str):
        retry_content = f'{content}\n\n{reminder["text"]}'
    else:
        return messages
    return [
        *messages[:-1],
        provider_message.Message(role=getattr(last, 'role', 'user'), content=retry_content),
    ]


async def _invoke_structured_llm(plugin: Any, model_uuid: str, messages: list[object]) -> Any:
    """Prefer provider-enforced JSON while remaining compatible with older hosts."""
    try:
        return await plugin.invoke_llm(
            model_uuid,
            messages,
            funcs=[],
            extra_args={'response_format': {'type': 'json_object'}},
        )
    except TypeError as exc:
        # The local test doubles and older LangBot plugin SDKs may not expose
        # call-level extra_args.  Do not turn that compatibility issue into a
        # Product Radar outage.
        if 'extra_args' not in str(exc):
            raise
        return await plugin.invoke_llm(model_uuid, messages, funcs=[])
    except Exception:
        # Some OpenAI-compatible providers do not implement JSON mode. Retry
        # once without that optional parameter; semantic ownership remains with
        # Luna and the Core still receives only a validated structured result.
        return await plugin.invoke_llm(model_uuid, messages, funcs=[])


async def _intent_model_uuid(plugin: Any) -> str | None:
    return await _model_uuid(plugin, operation='intent')


async def resolve_product_radar_command(
    plugin: Any,
    *,
    message: NormalizedBotMessage,
    context: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Resolve one inbound message into a Product Radar structured command."""
    fast = _legacy_fast_path(message, context)
    if fast is not None:
        return fast
    text = str((message.get('message') or {}).get('text') or '').strip()
    # An image is an input modality, not domain evidence.  Do not spend a
    # semantic call, and never create a watch, for an image-only message.
    if not text:
        return None
    if provider_message is None:
        return None
    model_uuid = await _intent_model_uuid(plugin)
    if not model_uuid:
        return None

    images = image_sources(message)
    parser_context = context_for_parser(context)
    content: list[dict[str, Any]] = [{
        'type': 'text',
        'text': '\n'.join([
            _intent_prompt(),
            f'normalized_message_text: {text or "（空）"}',
            f'has_reference_image: {str(bool(images)).lower()}',
            f'context: {json.dumps(parser_context, ensure_ascii=False, separators=(",", ":"))}',
        ]),
    }]
    for source in images:
        block = _image_block(source)
        if block:
            content.append(block)
    try:
        messages = [
            provider_message.Message(role='system', content='只输出合法 JSON。'),
            provider_message.Message(role='user', content=content),
        ]
        started = time.monotonic()
        output = await _invoke_structured_llm(plugin, model_uuid, messages)
        try:
            parsed = _parse_json(_content_text(output))
        except (TypeError, ValueError, json.JSONDecodeError):
            # A model can still ignore protocol instructions even when the
            # provider accepts response_format. One bounded retry repairs that
            # transport/protocol failure without introducing keyword routing.
            output = await _invoke_structured_llm(plugin, model_uuid, _structured_retry_messages(messages))
            parsed = _parse_json(_content_text(output))
        command = _normalize_model_result(parsed, message, context)
        if command is not None:
            command['_usage'] = usage_from_output(
                output,
                model=model_uuid,
                operation='intent_target_profile' if images else 'intent',
                images_processed=len(images),
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        return command
    except Exception as exc:  # pragma: no cover - provider integration behavior
        LOGGER.warning('product radar intent extraction failed: %s', type(exc).__name__)
        return None


async def resolve_product_radar_intent(plugin: Any, text: str, has_images: bool) -> dict[str, Any] | None:
    """Compatibility wrapper for older plugin callers and tests.

    New code should call :func:`resolve_product_radar_command` with a full
    normalized message and context.  The returned object still carries the
    old ``action`` alias so an already-installed listener can fail safely.
    """
    attachments = []
    if has_images:
        attachments = [{'type': 'image', 'url': None, 'name': None, 'mimeType': None, 'base64': None}]
    message = build_normalized_message(
        platform='kook',
        bot_id='product-radar-test-bot',
        platform_user_id='test-user',
        chat_type='private',
        chat_id='test-chat',
        message_id='test-message',
        text=text,
        attachments=attachments,
    )
    return await resolve_product_radar_command(plugin, message=message)
