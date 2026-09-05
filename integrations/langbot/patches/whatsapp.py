"""LangBot MessagePlatformAdapter for the Meta WhatsApp Cloud API.

The adapter uses LangBot's unified ``/bots/<bot_uuid>`` webhook route.  Meta's
POST is authenticated and parsed before a listener task is scheduled; the
HTTP response is returned without waiting for aggregation, Mastra, or PUBG.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import typing
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote

import aiohttp
import pydantic
import quart

import langbot_plugin.api.definition.abstract.platform.adapter as abstract_platform_adapter
import langbot_plugin.api.definition.abstract.platform.event_logger as abstract_platform_logger
import langbot_plugin.api.entities.builtin.platform.entities as platform_entities
import langbot_plugin.api.entities.builtin.platform.events as platform_events
import langbot_plugin.api.entities.builtin.platform.message as platform_message

from ...utils import httpclient


WHATSAPP_WEBHOOK_OBJECT = 'whatsapp_business_account'
SIGNATURE_HEADER = 'X-Hub-Signature-256'
MAX_BODY_BYTES = 1 * 1024 * 1024
IDEMPOTENCY_TTL_SECONDS = 10 * 60
IDEMPOTENCY_MAX_ENTRIES = 4096
INBOUND_TASK_MAX = 100
GRAPH_API_VERSION = 'v23.0'
GRAPH_API_BASE_URL = 'https://graph.facebook.com'
MAX_TEXT_LENGTH = 4096


@dataclass(frozen=True)
class _InboundTextMessage:
    message_id: str
    sender_id: str
    text: str
    sender_name: str | None
    timestamp: float | str | None
    raw: dict[str, typing.Any]


def _value(config: dict[str, typing.Any], key: str, default: str = '') -> str:
    raw = config.get(key)
    if raw is None or raw == '':
        raw = config.get(key.lower(), default)
    if raw is None:
        return default
    return str(raw).strip()


def verify_webhook_signature(body: bytes, signature: str | None, app_secret: str) -> bool:
    """Verify Meta's HMAC-SHA256 signature against the exact request body."""
    if not app_secret or not signature:
        return False
    value = str(signature).strip()
    if len(value) != len('sha256=') + 64 or not value.lower().startswith('sha256='):
        return False
    digest = value[len('sha256='):]
    if any(char not in '0123456789abcdefABCDEF' for char in digest):
        return False
    expected = hmac.new(app_secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, digest.lower())


def verify_challenge(mode: str | None, verify_token: str | None, challenge: str | None, expected_token: str) -> str | None:
    """Return Meta's challenge only for a valid subscription verification."""
    if mode != 'subscribe' or not challenge or not expected_token:
        return None
    if not hmac.compare_digest(str(verify_token or ''), expected_token):
        return None
    return challenge


def _timestamp(value: typing.Any) -> float:
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return time.time()
    return numeric / 1000 if numeric > 10_000_000_000 else numeric


def _profile_name(value: dict[str, typing.Any], sender_id: str) -> str | None:
    contacts = value.get('contacts') or []
    if not isinstance(contacts, list):
        return None
    for contact in contacts:
        if not isinstance(contact, dict) or str(contact.get('wa_id', '')).strip() != sender_id:
            continue
        profile = contact.get('profile') or {}
        if isinstance(profile, dict) and str(profile.get('name', '')).strip():
            return str(profile['name']).strip()
    return None


def extract_text_messages(
    payload: dict[str, typing.Any],
    *,
    waba_id: str,
    phone_number_id: str,
) -> tuple[list[_InboundTextMessage], int]:
    """Validate the subscribed account and return text messages only.

    Statuses and unsupported message types are acknowledged and ignored.  A
    configured WABA or phone mismatch is rejected so one bot cannot consume a
    different WhatsApp business account's webhook.
    """
    if payload.get('object') != WHATSAPP_WEBHOOK_OBJECT:
        raise ValueError('unsupported webhook object')

    entries = payload.get('entry')
    if entries is None:
        return [], 0
    if not isinstance(entries, list):
        raise ValueError('entry must be an array')

    records: list[_InboundTextMessage] = []
    ignored = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError('entry must contain objects')
        entry_id = str(entry.get('id', '')).strip()
        changes = entry.get('changes') or []
        if not isinstance(changes, list):
            raise ValueError('changes must be an array')
        for change in changes:
            if not isinstance(change, dict):
                raise ValueError('change must be an object')
            value = change.get('value') or {}
            if not isinstance(value, dict):
                raise ValueError('change value must be an object')
            raw_messages = value.get('messages')
            if raw_messages is None:
                continue
            if not isinstance(raw_messages, list):
                raise ValueError('messages must be an array')
            metadata = value.get('metadata') or {}
            metadata_phone_id = str(metadata.get('phone_number_id', '')).strip() if isinstance(metadata, dict) else ''
            if raw_messages:
                if entry_id != waba_id:
                    raise ValueError('webhook WABA does not match adapter configuration')
                if metadata_phone_id != phone_number_id:
                    raise ValueError('webhook phone number does not match adapter configuration')
            for raw_message in raw_messages:
                if not isinstance(raw_message, dict):
                    ignored += 1
                    continue
                if str(raw_message.get('type', '')).lower() != 'text':
                    ignored += 1
                    continue
                message_id = str(raw_message.get('id', '')).strip()
                sender_id = str(raw_message.get('from', '')).strip()
                text = raw_message.get('text') or {}
                body = text.get('body') if isinstance(text, dict) else None
                if not message_id or not sender_id or not isinstance(body, str) or not body.strip():
                    ignored += 1
                    continue
                records.append(_InboundTextMessage(
                    message_id=message_id,
                    sender_id=sender_id,
                    text=body,
                    sender_name=_profile_name(value, sender_id),
                    timestamp=raw_message.get('timestamp'),
                    raw=raw_message,
                ))
    return records, ignored


class WhatsAppAdapter(abstract_platform_adapter.AbstractMessagePlatformAdapter):
    """First-phase text-only WhatsApp Cloud API adapter."""

    bot_uuid: str = pydantic.Field(default='', exclude=True)
    verify_token: str = pydantic.Field(default='', exclude=True)
    app_secret: str = pydantic.Field(default='', exclude=True)
    access_token: str = pydantic.Field(default='', exclude=True)
    phone_number_id: str = pydantic.Field(default='', exclude=True)
    waba_id: str = pydantic.Field(default='', exclude=True)
    graph_api_endpoint: str = pydantic.Field(default='', exclude=True)
    listeners: dict[
        typing.Type[platform_events.Event],
        typing.Callable[[platform_events.Event, abstract_platform_adapter.AbstractMessagePlatformAdapter], typing.Awaitable[None]],
    ] = pydantic.Field(default_factory=dict, exclude=True)
    idempotency_cache: dict[str, float] = pydantic.Field(default_factory=dict, exclude=True)
    inbound_tasks: set[asyncio.Task] = pydantic.Field(default_factory=set, exclude=True)

    model_config = pydantic.ConfigDict(arbitrary_types_allowed=True)

    def __init__(self, config: dict, logger: abstract_platform_logger.AbstractEventLogger):
        config = dict(config or {})
        values = {
            'VERIFY_TOKEN': _value(config, 'VERIFY_TOKEN'),
            'APP_SECRET': _value(config, 'APP_SECRET'),
            'ACCESS_TOKEN': _value(config, 'ACCESS_TOKEN'),
            'PHONE_NUMBER_ID': _value(config, 'PHONE_NUMBER_ID'),
            'WABA_ID': _value(config, 'WABA_ID'),
        }
        missing = [key for key, value in values.items() if not value]
        if missing:
            raise ValueError(f'WhatsApp 缺少配置项: {", ".join(missing)}')

        graph_version = _value(config, 'GRAPH_API_VERSION', GRAPH_API_VERSION) or GRAPH_API_VERSION
        graph_base_url = _value(config, 'GRAPH_API_BASE_URL', GRAPH_API_BASE_URL).rstrip('/') or GRAPH_API_BASE_URL
        endpoint = f'{graph_base_url}/{graph_version.strip("/")}/{quote(values["PHONE_NUMBER_ID"], safe="")}/messages'
        normalized_config = {**config, **values}
        super().__init__(
            config=normalized_config,
            logger=logger,
            bot_account_id=values['PHONE_NUMBER_ID'],
            verify_token=values['VERIFY_TOKEN'],
            app_secret=values['APP_SECRET'],
            access_token=values['ACCESS_TOKEN'],
            phone_number_id=values['PHONE_NUMBER_ID'],
            waba_id=values['WABA_ID'],
            graph_api_endpoint=endpoint,
            listeners={},
            idempotency_cache={},
            inbound_tasks=set(),
        )

    # -- LangBot lifecycle -------------------------------------------------

    def set_bot_uuid(self, bot_uuid: str) -> None:
        object.__setattr__(self, 'bot_uuid', bot_uuid)

    def get_launcher_id(self, event: platform_events.MessageEvent) -> str:
        return str(event.sender.id)

    def register_listener(
        self,
        event_type: typing.Type[platform_events.Event],
        callback: typing.Callable[
            [platform_events.Event, abstract_platform_adapter.AbstractMessagePlatformAdapter], typing.Awaitable[None]
        ],
    ) -> None:
        self.listeners[event_type] = callback

    def unregister_listener(
        self,
        event_type: typing.Type[platform_events.Event],
        callback: typing.Callable[
            [platform_events.Event, abstract_platform_adapter.AbstractMessagePlatformAdapter], typing.Awaitable[None]
        ],
    ) -> None:
        self.listeners.pop(event_type, None)

    async def is_muted(self, group_id: int) -> bool:
        return False

    async def is_stream_output_supported(self) -> bool:
        return False

    async def run_async(self):
        # Webhook requests are dispatched by LangBot's shared HTTP server.
        while True:
            await asyncio.sleep(3600)

    async def kill(self) -> bool:
        tasks = list(self.inbound_tasks)
        for task in tasks:
            if not task.done():
                task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.inbound_tasks.clear()
        self.idempotency_cache.clear()
        return True

    # -- inbound webhook ---------------------------------------------------

    @staticmethod
    def _error(kind: str, detail: str, status: int):
        return quart.jsonify({'status': 'error', 'error': kind, 'message': detail}), status

    def _reserve_wamid(self, message_id: str) -> str:
        now = time.monotonic()
        accepted_at = self.idempotency_cache.get(message_id)
        if accepted_at is not None and now - accepted_at <= IDEMPOTENCY_TTL_SECONDS:
            return 'duplicate'
        if accepted_at is not None:
            self.idempotency_cache.pop(message_id, None)

        if len(self.idempotency_cache) >= IDEMPOTENCY_MAX_ENTRIES:
            expired = [
                key for key, timestamp in self.idempotency_cache.items()
                if now - timestamp > IDEMPOTENCY_TTL_SECONDS
            ][:128]
            for key in expired:
                self.idempotency_cache.pop(key, None)
        if len(self.idempotency_cache) >= IDEMPOTENCY_MAX_ENTRIES:
            return 'overloaded'
        self.idempotency_cache[message_id] = now
        return 'accepted'

    def _start_inbound_task(self, coroutine: typing.Coroutine) -> bool:
        self.inbound_tasks = {task for task in self.inbound_tasks if not task.done()}
        if len(self.inbound_tasks) >= INBOUND_TASK_MAX:
            coroutine.close()
            return False
        task = asyncio.create_task(coroutine)
        self.inbound_tasks.add(task)

        def done(completed: asyncio.Task) -> None:
            self.inbound_tasks.discard(completed)
            if not completed.cancelled():
                completed.exception()  # retrieve fire-and-forget failures

        task.add_done_callback(done)
        return True

    async def handle_unified_webhook(self, bot_uuid: str, path: str, request):
        object.__setattr__(self, 'bot_uuid', bot_uuid)
        if path not in ('', None):
            return self._error('bad_request', f'unknown webhook path: {path}', 404)
        if request.method == 'GET':
            challenge = verify_challenge(
                request.args.get('hub.mode'),
                request.args.get('hub.verify_token'),
                request.args.get('hub.challenge'),
                self.verify_token,
            )
            if challenge is None:
                return self._error('verification_failed', 'invalid webhook verification token', 403)
            return quart.Response(challenge, status=200, content_type='text/plain')
        if request.method != 'POST':
            return self._error('method_not_allowed', 'only GET and POST are supported', 405)

        content_length = request.content_length
        if content_length is not None and content_length > MAX_BODY_BYTES:
            return self._error('payload_too_large', 'webhook body is too large', 413)
        body = await request.get_data()
        if len(body) > MAX_BODY_BYTES:
            return self._error('payload_too_large', 'webhook body is too large', 413)
        if not verify_webhook_signature(body, request.headers.get(SIGNATURE_HEADER), self.app_secret):
            return self._error('invalid_signature', 'X-Hub-Signature-256 verification failed', 401)
        try:
            payload = json.loads(body.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._error('invalid_json', 'webhook body is not valid JSON', 400)
        if not isinstance(payload, dict):
            return self._error('invalid_json', 'webhook body must be an object', 400)
        try:
            records, ignored = extract_text_messages(
                payload,
                waba_id=self.waba_id,
                phone_number_id=self.phone_number_id,
            )
        except ValueError as exc:
            return self._error('invalid_payload', str(exc), 403)

        listener = self.listeners.get(platform_events.FriendMessage)
        accepted = 0
        duplicates = 0
        overloaded = 0
        if records and listener is None:
            return self._error('adapter_not_ready', 'no FriendMessage listener is registered', 503)

        for record in records:
            reservation = self._reserve_wamid(record.message_id)
            if reservation == 'duplicate':
                duplicates += 1
                continue
            if reservation == 'overloaded':
                overloaded += 1
                continue
            event = self._build_event(record)
            try:
                listener_coroutine = listener(event, self)
            except Exception:
                self.idempotency_cache.pop(record.message_id, None)
                overloaded += 1
                continue
            if not self._start_inbound_task(listener_coroutine):
                self.idempotency_cache.pop(record.message_id, None)
                overloaded += 1
                continue
            accepted += 1

        # This ACK is intentionally returned before the LangBot pipeline task.
        if overloaded:
            return self._error('overloaded', 'too many webhook messages are in flight', 503)
        return quart.jsonify({
            'status': 'ok',
            'accepted': accepted,
            'duplicates': duplicates,
            'ignored': ignored,
        }), 200

    def _build_event(self, record: _InboundTextMessage) -> platform_events.FriendMessage:
        message_time = datetime.fromtimestamp(_timestamp(record.timestamp), timezone.utc)
        chain = platform_message.MessageChain([
            platform_message.Source(id=record.message_id, time=message_time),
            platform_message.Plain(text=record.text),
        ])
        sender = platform_entities.Friend(
            id=record.sender_id,
            nickname=record.sender_name or record.sender_id,
            remark=record.sender_name or record.sender_id,
        )
        kwargs = {
            'sender': sender,
            'message_chain': chain,
            'time': message_time.timestamp(),
            'source_platform_object': record.raw,
        }
        # platform is added by the bundled event patch so plugin listeners can
        # normalize this event without importing Meta-specific payloads.
        try:
            return platform_events.FriendMessage(**kwargs, platform='whatsapp')
        except (TypeError, pydantic.ValidationError):
            event = platform_events.FriendMessage(**kwargs)
            try:
                setattr(event, 'platform', 'whatsapp')
            except (AttributeError, ValueError, TypeError):
                pass
            return event

    # -- Graph API outbound ------------------------------------------------

    @staticmethod
    def _text_from_chain(message: platform_message.MessageChain) -> str:
        parts: list[str] = []
        for component in message:
            if isinstance(component, platform_message.Source):
                continue
            if isinstance(component, platform_message.Plain):
                parts.append(component.text)
                continue
            raise ValueError('WhatsApp phase one only supports text outbound')
        return ''.join(parts)

    @staticmethod
    def _chunks(text: str) -> typing.Iterator[str]:
        for offset in range(0, len(text), MAX_TEXT_LENGTH):
            yield text[offset:offset + MAX_TEXT_LENGTH]

    @staticmethod
    def _source_id(message: platform_message.MessageChain) -> str | None:
        for component in message:
            if isinstance(component, platform_message.Source):
                value = str(component.id).strip()
                if value:
                    return value
        return None

    async def _send_text(self, recipient: str, text: str, reply_to: str | None = None) -> None:
        payload: dict[str, typing.Any] = {
            'messaging_product': 'whatsapp',
            'recipient_type': 'individual',
            'to': recipient,
            'type': 'text',
            'text': {'preview_url': False, 'body': text},
        }
        if reply_to:
            payload['context'] = {'message_id': reply_to}
        timeout_value = _value(self.config, 'GRAPH_API_TIMEOUT_SECONDS', '30')
        try:
            timeout_seconds = max(float(timeout_value), 1.0)
        except (TypeError, ValueError):
            timeout_seconds = 30.0
        timeout = aiohttp.ClientTimeout(total=timeout_seconds)
        # Meta is an external API; honor the deployment's outbound proxy when
        # one is configured, while keeping the shared connection pool.
        session = httpclient.get_session(trust_env=True)
        headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        async with session.post(self.graph_api_endpoint, json=payload, headers=headers, timeout=timeout) as response:
            response_body = await httpclient.read_text_limited(response, max_bytes=64 * 1024)
            if response.status < 200 or response.status >= 300:
                detail = response_body[:500] or 'request failed'
                raise RuntimeError(f'WhatsApp Graph API HTTP {response.status}: {detail}')

    async def send_message(self, target_type: str, target_id: str, message: platform_message.MessageChain):
        if str(target_type).lower() not in {'person', 'private', 'user'}:
            raise ValueError('WhatsApp phase one only supports person targets')
        recipient = str(target_id).strip()
        if not recipient:
            raise ValueError('WhatsApp recipient phone number is required')
        text = self._text_from_chain(message)
        if not text:
            return
        for chunk in self._chunks(text):
            await self._send_text(recipient, chunk)

    async def reply_message(
        self,
        message_source: platform_events.MessageEvent,
        message: platform_message.MessageChain,
        quote_origin: bool = False,
    ):
        recipient = str(message_source.sender.id).strip()
        if not recipient:
            raise ValueError('WhatsApp reply recipient is missing')
        text = self._text_from_chain(message)
        if not text:
            return
        reply_to = self._source_id(message_source.message_chain) if quote_origin else None
        for chunk in self._chunks(text):
            await self._send_text(recipient, chunk, reply_to=reply_to)


    async def reply_message_chunk(
        self,
        message_source: platform_events.MessageEvent,
        bot_message: typing.Any,
        message: platform_message.MessageChain,
        quote_origin: bool = False,
        is_final: bool = False,
    ):
        # Streaming is disabled; if a host calls this hook, preserve text-only
        # behavior and send the supplied chunk through the same Graph sender.
        return await self.reply_message(message_source, message, quote_origin=quote_origin)
