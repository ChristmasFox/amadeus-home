from __future__ import annotations

"""Deterministic translation from structured commands to Radar API payloads."""

from typing import Any

from components.platform.normalized import NormalizedBotMessage, image_sources


def _entities(command: dict[str, Any]) -> dict[str, Any]:
    value = command.get('entities')
    return value if isinstance(value, dict) else {}


def _constraints(command: dict[str, Any]) -> dict[str, Any]:
    value = command.get('constraints')
    return value if isinstance(value, dict) else {}


def _profile(command: dict[str, Any]) -> dict[str, Any] | None:
    value = command.get('targetProfile')
    return value if isinstance(value, dict) else None


def _copy_if_present(target: dict[str, Any], source: dict[str, Any], *fields: str) -> None:
    for field in fields:
        value = source.get(field)
        if value is not None and value != '' and value != []:
            target[field] = value


def _copy_reference_image(target: dict[str, Any], value: Any) -> None:
    if not isinstance(value, dict):
        return
    _copy_if_present(target, value, 'referenceImageBase64', 'referenceImageUrl')


def _interval(command: dict[str, Any], default: int) -> int:
    value = _constraints(command).get('intervalSeconds')
    if isinstance(value, bool):
        return default
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def watch_create_payload(command: dict[str, Any], message: NormalizedBotMessage) -> dict[str, Any] | None:
    if command.get('intent') != 'create_watch' or command.get('control') is not None:
        return None
    entities = _entities(command)
    constraints = _constraints(command)
    watch_type = command.get('watchType')
    if watch_type not in {'similarity', 'seller', 'product'}:
        return None
    source = str(entities.get('source') or 'bunjang').strip().lower()
    target: dict[str, Any] = {}
    rules: dict[str, Any]
    if watch_type == 'seller':
        seller_url = entities.get('sellerUrl')
        if not isinstance(seller_url, str) or not seller_url.strip():
            return None
        target['sellerUrl'] = seller_url.strip()
        keywords = entities.get('keywords')
        rules = {
            'keywords': keywords if isinstance(keywords, list) else [],
            'keywordMode': 'any',
            'excludeKeywords': entities.get('excludeKeywords') if isinstance(entities.get('excludeKeywords'), list) else [],
        }
        _copy_if_present(rules, constraints, 'minPrice', 'maxPrice', 'currency')
        interval_default = 120
    elif watch_type == 'product':
        product_url = entities.get('productUrl')
        if not isinstance(product_url, str) or not product_url.strip():
            return None
        target['productUrl'] = product_url.strip()
        rules = {
            'trackPrice': True,
            'trackStatus': True,
            'trackTitle': True,
            'trackSeller': True,
            'trackImages': False,
        }
        interval_default = 120
    else:
        sources = image_sources(message)
        if not sources:
            return None
        source_image = sources[0]
        target.update(source_image)
        _copy_if_present(target, entities, 'brand', 'modelName', 'season', 'category', 'keywords', 'excludeKeywords', 'explicitSearchTerms')
        _copy_if_present(target, constraints, 'minPrice', 'maxPrice', 'currency')
        explicit_terms = entities.get('explicitSearchTerms')
        if isinstance(explicit_terms, list) and explicit_terms:
            target['explicitSearchTerms'] = explicit_terms
            target['searchQuery'] = explicit_terms[0]
        rules = {
            'similarityThreshold': constraints.get('similarityThreshold', 0.6),
            'candidateLimit': 60,
        }
        interval_default = 900
    payload: dict[str, Any] = {
        'source': source,
        'type': watch_type,
        'target': target,
        'rules': rules,
        'intervalSeconds': _interval(command, interval_default),
    }
    for field in ('heartbeatEnabled', 'heartbeatIntervalSeconds'):
        if field in constraints:
            payload[field] = constraints[field]
    profile = _profile(command)
    if watch_type == 'similarity' and profile:
        # The Product Radar Core receives the already structured result.  This
        # prevents it from re-running natural-language or Vision extraction.
        payload['targetProfile'] = profile
    return payload


def watch_patch_payload(command: dict[str, Any], watch: dict[str, Any]) -> dict[str, Any]:
    """Translate an update command without embedding natural-language logic."""
    entities = _entities(command)
    constraints = _constraints(command)
    watch_type = str(watch.get('type') or command.get('watchType') or '')
    patch: dict[str, Any] = {}
    if 'intervalSeconds' in constraints:
        patch['intervalSeconds'] = constraints['intervalSeconds']
    for field in ('heartbeatEnabled', 'heartbeatIntervalSeconds'):
        if field in constraints:
            patch[field] = constraints[field]

    if watch_type == 'seller':
        rules: dict[str, Any] = {}
        _copy_if_present(rules, entities, 'keywords', 'excludeKeywords')
        _copy_if_present(rules, constraints, 'minPrice', 'maxPrice', 'currency')
        if rules:
            patch['rules'] = rules
        target: dict[str, Any] = {}
        _copy_if_present(target, entities, 'sellerUrl')
        if target:
            patch['target'] = target
    elif watch_type == 'product':
        target = {}
        _copy_if_present(target, entities, 'productUrl')
        if target:
            patch['target'] = target
    elif watch_type == 'similarity':
        target = {}
        _copy_if_present(target, entities, 'brand', 'modelName', 'season', 'category', 'keywords', 'excludeKeywords', 'explicitSearchTerms')
        _copy_if_present(target, constraints, 'minPrice', 'maxPrice', 'currency')
        _copy_reference_image(target, entities.get('referenceImage'))
        profile = _profile(command)
        if profile:
            # Product Radar Core treats this as the structured TargetProfile
            # supplied by the boundary; it does not invoke another provider.
            patch['targetProfile'] = profile
        if entities.get('explicitSearchTerms'):
            target['searchQuery'] = entities['explicitSearchTerms'][0]
        if target:
            patch['target'] = target
        if 'similarityThreshold' in constraints:
            patch['rules'] = {'similarityThreshold': constraints['similarityThreshold']}
    return patch


def explicit_watch_id(command: dict[str, Any]) -> str | None:
    value = _entities(command).get('watchId')
    return str(value).strip() if value is not None and str(value).strip() else None
