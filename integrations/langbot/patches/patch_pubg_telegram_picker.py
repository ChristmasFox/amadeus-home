from __future__ import annotations

from pathlib import Path
import sys


telegram_path = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/app/src/langbot/pkg/platform/sources/telegram.py"
)
chat_path = Path(
    sys.argv[2]
    if len(sys.argv) > 2
    else "/app/src/langbot/pkg/pipeline/process/handlers/chat.py"
)
events_path = Path(
    sys.argv[3]
    if len(sys.argv) > 3
    else "/app/.venv/lib/python3.12/site-packages/langbot_plugin/api/entities/events.py"
)


command_path = Path(
    sys.argv[4]
    if len(sys.argv) > 4
    else "/app/src/langbot/pkg/pipeline/process/handlers/command.py"
)

PUBG_MARKER = "_PUBG_INLINE_KEYBOARD_MARKER"


def patch_events() -> None:
    source = events_path.read_text()
    normal_field_block = (
        "    platform: str = 'kook'\n"
        '    """Source platform identifier used by cross-process adapters."""\n'
        "\n"
        "    callback_data: typing.Optional[str] = None\n"
        '    """Opaque platform callback data, if this event came from a button."""\n'
        "\n"
        "    callback_id: typing.Optional[str] = None\n"
        '    """Platform callback acknowledgement identifier."""\n'
        "\n"
    )
    platform_field_block = (
        "    platform: str = 'kook'\n"
        '    """Source platform identifier used by cross-process adapters."""\n'
        "    display_name: typing.Optional[str] = None\n"
        '    """Display-only name; never used as an identity key."""\n'
        "\n"
    )

    def add_field_block(class_name: str, field_block: str) -> None:
        nonlocal source
        class_marker = f"class {class_name}(_WithReplyMessageChain):"
        class_start = source.find(class_marker)
        if class_start < 0:
            raise SystemExit(f"{class_marker} not found")
        next_class = source.find("\nclass ", class_start + len(class_marker))
        class_end = next_class if next_class >= 0 else len(source)
        class_source = source[class_start:class_end]
        if "    platform: str = 'kook'" in class_source:
            return
        text_marker = "    text_message: str\n"
        text_start = source.find(text_marker, class_start, class_end)
        if text_start < 0:
            raise SystemExit(f"{text_marker.strip()} not found in {class_name}")
        insert_at = text_start + len(text_marker)
        source = source[:insert_at] + field_block + source[insert_at:]

    for class_name in ("PersonNormalMessageReceived", "GroupNormalMessageReceived"):
        add_field_block(class_name, normal_field_block)
    for class_name in ("PersonCommandSent", "GroupCommandSent"):
        add_field_block(class_name, platform_field_block)
    events_path.write_text(source)

def patch_chat_handler() -> None:
    source = chat_path.read_text()
    if "_pubg_callback_data" not in source:
        old = """        event = event_class(
            launcher_type=query.launcher_type.value,
            launcher_id=query.launcher_id,
            sender_id=query.sender_id,
            text_message=str(query.message_chain),
            message_event=query.message_event,
            message_chain=query.message_chain,
            query=query,
        )
"""
        new = """        adapter_type = type(query.adapter)
        adapter_name = adapter_type.__name__.lower()
        adapter_module = adapter_type.__module__.lower()
        if 'whatsapp' in adapter_name or 'whatsapp' in adapter_module:
            platform = 'whatsapp'
        elif 'telegram' in adapter_name or 'telegram' in adapter_module:
            platform = 'telegram'
        else:
            platform = 'kook'

        callback_data = query.variables.get('_pubg_callback_data')
        callback_id = query.variables.get('_pubg_callback_id')
        if not callback_data:
            source_update = getattr(query.message_event, 'source_platform_object', None)
            callback_query = getattr(source_update, 'callback_query', None)
            callback_data = getattr(callback_query, 'data', None)
            callback_id = callback_id or getattr(callback_query, 'id', None)

        event = event_class(
            launcher_type=query.launcher_type.value,
            launcher_id=query.launcher_id,
            sender_id=query.sender_id,
            text_message=str(query.message_chain),
            message_event=query.message_event,
            message_chain=query.message_chain,
            platform=platform,
            callback_data=str(callback_data) if callback_data else None,
            callback_id=str(callback_id) if callback_id else None,
            query=query,
        )
"""
        if old not in source:
            raise SystemExit("Chat event construction marker not found")
        source = source.replace(old, new, 1)
    chat_path.write_text(source)


def patch_command_handler() -> None:
    source = command_path.read_text()
    if "_pubg_command_platform" in source:
        return
    old = """        event = event_class(
            launcher_type=query.launcher_type.value,
            launcher_id=query.launcher_id,
            sender_id=query.sender_id,
            command=spt[0],
            params=spt[1:] if len(spt) > 1 else [],
            text_message=full_command_text,
            is_admin=(privilege == 2),
            query=query,
        )
"""
    new = """        # Preserve the actual source adapter on command events so platform
        # identity resolution never falls back to the historical KOOK default.
        adapter_type = type(query.adapter)
        adapter_name = adapter_type.__name__.lower()
        adapter_module = adapter_type.__module__.lower()
        if 'whatsapp' in adapter_name or 'whatsapp' in adapter_module:
            _pubg_command_platform = 'whatsapp'
        elif 'telegram' in adapter_name or 'telegram' in adapter_module:
            _pubg_command_platform = 'telegram'
        else:
            _pubg_command_platform = 'kook'

        # Preserve a display-only name when the raw platform event exposes it.
        # The stable sender_id above remains the only identity key.
        _pubg_display_name = None
        source_platform_object = getattr(query.message_event, 'source_platform_object', None)
        effective_message = getattr(source_platform_object, 'effective_message', None)
        source_user = getattr(effective_message, 'from_user', None)
        if source_user is not None:
            _pubg_display_name = getattr(source_user, 'full_name', None) or getattr(source_user, 'username', None)
        elif isinstance(source_platform_object, dict):
            extra = source_platform_object.get('extra') or {}
            author = extra.get('author') if isinstance(extra, dict) else None
            if isinstance(author, dict):
                _pubg_display_name = author.get('nickname') or author.get('username')
        if _pubg_display_name is not None:
            _pubg_display_name = str(_pubg_display_name).strip() or None

        event = event_class(
            launcher_type=query.launcher_type.value,
            launcher_id=query.launcher_id,
            sender_id=query.sender_id,
            command=spt[0],
            params=spt[1:] if len(spt) > 1 else [],
            text_message=full_command_text,
            platform=_pubg_command_platform,
            display_name=_pubg_display_name,
            is_admin=(privilege == 2),
            query=query,
        )
"""
    if old not in source:
        raise SystemExit("Command event construction marker not found")
    source = source.replace(old, new, 1)
    command_path.write_text(source)

def patch_telegram_adapter() -> None:
    source = telegram_path.read_text()

    if PUBG_MARKER not in source:
        marker = "_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024\n"
        block = """_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024

_PUBG_INLINE_KEYBOARD_MARKER = '__PUBG_TELEGRAM_INLINE_KEYBOARD_V1__:'


def _pubg_inline_keyboard_from_marker(value: str) -> InlineKeyboardMarkup | None:
    if not value.startswith(_PUBG_INLINE_KEYBOARD_MARKER):
        return None
    try:
        payload = json.loads(value[len(_PUBG_INLINE_KEYBOARD_MARKER):])
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    raw_rows = payload.get('inline_keyboard') if isinstance(payload, dict) else None
    if not isinstance(raw_rows, list):
        return None

    rows = []
    for raw_row in raw_rows:
        if not isinstance(raw_row, list):
            continue
        row = []
        for raw_button in raw_row:
            if not isinstance(raw_button, dict):
                continue
            text = raw_button.get('text')
            callback_data = raw_button.get('callback_data')
            if not isinstance(text, str) or not text or not isinstance(callback_data, str) or not callback_data:
                continue
            if len(callback_data.encode('utf-8')) > 64:
                continue
            row.append(InlineKeyboardButton(text=text[:128], callback_data=callback_data))
        if row:
            rows.append(row)
    return InlineKeyboardMarkup(rows) if rows else None
"""
        if marker not in source:
            raise SystemExit("Telegram media marker not found")
        source = source.replace(marker, block, 1)

    if "type': 'inline_keyboard'" not in source:
        old = """            elif isinstance(component, platform_message.Image):
                photo_bytes, _mime_type = await component.get_bytes()

                components.append({'type': 'photo', 'photo': photo_bytes})
"""
        new = """            elif isinstance(component, platform_message.Unknown):
                reply_markup = _pubg_inline_keyboard_from_marker(component.text)
                if reply_markup is not None:
                    components.append({'type': 'inline_keyboard', 'reply_markup': reply_markup})
            elif isinstance(component, platform_message.Image):
                photo_bytes, _mime_type = await component.get_bytes()

                components.append({'type': 'photo', 'photo': photo_bytes})
"""
        if old not in source:
            raise SystemExit("Telegram converter image marker not found")
        source = source.replace(old, new, 1)

    if "_enqueue_pubg_callback" not in source:
        callback_method_marker = "    def __init__(self, config: dict, logger: abstract_platform_logger.AbstractEventLogger):\n"
        callback_method = """    async def _enqueue_pubg_callback(self, update: Update, callback_query) -> None:
        import langbot_plugin.api.entities.builtin.provider.session as provider_session

        effective_message = callback_query.message or update.effective_message
        chat = effective_message.chat if effective_message is not None else update.effective_chat
        if chat is None:
            await self.logger.warning('Ignoring PUBG callback without a Telegram chat')
            return

        user = callback_query.from_user
        user_id = str(user.id)
        chat_id = chat.id
        is_group = chat.type in ('group', 'supergroup')
        launcher_type = provider_session.LauncherTypes.GROUP if is_group else provider_session.LauncherTypes.PERSON
        message_chain = platform_message.MessageChain([platform_message.Plain(text='')])

        if is_group:
            synthetic_event = platform_events.GroupMessage(
                sender=platform_entities.GroupMember(
                    id=user_id,
                    member_name=user.full_name or user.username or '',
                    permission=platform_entities.Permission.Member,
                    group=platform_entities.Group(
                        id=chat_id,
                        name=chat.title or '',
                        permission=platform_entities.Permission.Member,
                    ),
                    special_title='',
                ),
                message_chain=message_chain,
                source_platform_object=update,
            )
        else:
            synthetic_event = platform_events.FriendMessage(
                sender=platform_entities.Friend(
                    id=user_id,
                    nickname=user.full_name or user.username or '',
                    remark=str(user_id),
                ),
                message_chain=message_chain,
                source_platform_object=update,
            )

        bot_uuid = ''
        pipeline_uuid = None
        for bot in getattr(getattr(self.ap, 'platform_mgr', None), 'bots', []):
            if bot.adapter is self:
                bot_uuid = bot.bot_entity.uuid
                pipeline_uuid = bot.bot_entity.use_pipeline_uuid
                break
        if not bot_uuid:
            raise RuntimeError('Telegram callback cannot resolve bot identity')

        await self.ap.query_pool.add_query(
            bot_uuid=bot_uuid,
            launcher_type=launcher_type,
            launcher_id=chat_id,
            sender_id=user_id,
            message_event=synthetic_event,
            message_chain=message_chain,
            adapter=self,
            pipeline_uuid=pipeline_uuid,
            routed_by_rule=True,
            variables={
                '_pubg_callback_data': str(callback_query.data or ''),
                '_pubg_callback_id': str(callback_query.id or ''),
                '_routed_by_rule': True,
            },
        )

"""
        if callback_method_marker not in source:
            raise SystemExit("Telegram __init__ marker not found")
        source = source.replace(callback_method_marker, callback_method + callback_method_marker, 1)

    callback_handler_marker = """            await query.answer()
            try:
                data = json.loads(query.data)
"""
    callback_handler_replacement = """            await query.answer()
            try:
                callback_data = str(query.data or '')
                if callback_data.startswith('pubg:m:'):
                    await self._enqueue_pubg_callback(update, query)
                    return
                data = json.loads(query.data)
"""
    if "callback_data.startswith('pubg:m:')" not in source:
        if callback_handler_marker not in source:
            raise SystemExit("Telegram callback JSON marker not found")
        source = source.replace(callback_handler_marker, callback_handler_replacement, 1)

    if "reply_markup = next(" not in source:
        old = """        components = await TelegramMessageConverter.yiri2target(message, self.bot)

        chat_id_str, _, thread_id_str = str(target_id).partition('#')
"""
        new = """        components = await TelegramMessageConverter.yiri2target(message, self.bot)
        reply_markup = next(
            (
                component.get('reply_markup')
                for component in components
                if component.get('type') == 'inline_keyboard'
            ),
            None,
        )

        chat_id_str, _, thread_id_str = str(target_id).partition('#')
"""
        if old not in source:
            raise SystemExit("Telegram send_message marker not found")
        source = source.replace(old, new, 1)

    if "if component_type == 'inline_keyboard':" not in source:
        old = """        for component in components:
            component_type = component.get('type')
            args = {'chat_id': chat_id}
"""
        new = """        for component in components:
            component_type = component.get('type')
            if component_type == 'inline_keyboard':
                continue
            args = {'chat_id': chat_id}
            if reply_markup is not None:
                args['reply_markup'] = reply_markup
                reply_markup = None
"""
        if old not in source:
            raise SystemExit("Telegram send loop marker not found")
        source = source.replace(old, new, 1)

    reply_start = source.find("    async def reply_message(\n")
    reply_end = source.find("    def _process_markdown", reply_start)
    if reply_start < 0 or reply_end < 0:
        raise SystemExit("Telegram reply_message boundaries not found")
    reply_method = """    async def reply_message(
        self,
        message_source: platform_events.MessageEvent,
        message: platform_message.MessageChain,
        quote_origin: bool = False,
    ):
        assert isinstance(message_source.source_platform_object, Update)
        update = message_source.source_platform_object
        components = await TelegramMessageConverter.yiri2target(message, self.bot)
        text_component = next(
            (component for component in components if component.get('type') == 'text'),
            None,
        )
        if text_component is None:
            return

        content = text_component.get('text', '')
        if self.config['markdown_card'] is True:
            content = telegramify_markdown.markdownify(content=content)
        args = {
            'chat_id': update.effective_chat.id,
            'text': content,
        }
        if self.config['markdown_card'] is True:
            args['parse_mode'] = 'MarkdownV2'

        reply_markup = next(
            (
                component.get('reply_markup')
                for component in components
                if component.get('type') == 'inline_keyboard'
            ),
            None,
        )
        if reply_markup is not None:
            args['reply_markup'] = reply_markup

        effective_message = update.effective_message
        message_thread_id = getattr(effective_message, 'message_thread_id', None) if effective_message else None
        if message_thread_id:
            args['message_thread_id'] = message_thread_id

        if quote_origin and effective_message is not None:
            args['reply_to_message_id'] = effective_message.id

        await self._telegram_call('send_message', **args)

"""
    source = source[:reply_start] + reply_method + source[reply_end:]

    telegram_path.write_text(source)


patch_events()
patch_chat_handler()
patch_command_handler()
patch_telegram_adapter()
