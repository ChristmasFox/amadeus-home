from pathlib import Path
import sys


source_path = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/app/src/langbot/pkg/platform/sources/telegram.py"
)
source = source_path.read_text()

source = source.replace(
    "from telegram.ext import ApplicationBuilder, ContextTypes, MessageHandler, CallbackQueryHandler, filters",
    "from telegram.ext import ApplicationBuilder, ContextTypes, ExtBot, MessageHandler, CallbackQueryHandler, filters\nfrom telegram.request import HTTPXRequest",
    1,
)

if "import logging" not in source:
    source = source.replace("import os\n", "import os\nimport logging\n", 1)

if "LANGBOT_TELEGRAM_READ_TIMEOUT" not in source:
    timeout_marker = "_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024\n"
    timeout_block = """def _read_telegram_timeout(name: str, default: float) -> float:
    raw_value = os.getenv(name)
    try:
        value = float(raw_value) if raw_value else default
    except (TypeError, ValueError):
        value = default
    return max(1.0, value)


_TELEGRAM_CONNECT_TIMEOUT = _read_telegram_timeout('LANGBOT_TELEGRAM_CONNECT_TIMEOUT', 30.0)
_TELEGRAM_READ_TIMEOUT = _read_telegram_timeout('LANGBOT_TELEGRAM_READ_TIMEOUT', 30.0)
_TELEGRAM_WRITE_TIMEOUT = _read_telegram_timeout('LANGBOT_TELEGRAM_WRITE_TIMEOUT', 30.0)
_TELEGRAM_POOL_TIMEOUT = _read_telegram_timeout('LANGBOT_TELEGRAM_POOL_TIMEOUT', 10.0)
_TELEGRAM_GET_UPDATES_READ_TIMEOUT = _read_telegram_timeout(
    'LANGBOT_TELEGRAM_GET_UPDATES_READ_TIMEOUT', 45.0
)


_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024
"""
    if timeout_marker not in source:
        raise SystemExit("Telegram timeout marker not found")
    source = source.replace(timeout_marker, timeout_block, 1)

if "class _LangBotTelegramBot" not in source:
    bot_marker = "_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024\n"
    bot_block = """class _LangBotTelegramBot(ExtBot):
    async def get_updates(self, *args, **kwargs):
        state = getattr(self, '_langbot_polling_probe_state', None)
        if state is None:
            return await super().get_updates(*args, **kwargs)

        started = time.monotonic()
        state['active_starts'].append(started)
        request_timeout = state['request_timeout']
        try:
            try:
                updates = await asyncio.wait_for(
                    super().get_updates(*args, **kwargs),
                    timeout=request_timeout,
                )
            except asyncio.TimeoutError as exc:
                raise telegram.error.TimedOut(
                    f'Telegram getUpdates exceeded {request_timeout:g}s'
                ) from exc
            state['last_success'] = time.monotonic()
            state['consecutive_errors'] = 0
            if updates:
                state['last_update_received'] = time.monotonic()
            return updates
        except asyncio.CancelledError:
            raise
        except Exception:
            state['consecutive_errors'] += 1
            raise
        finally:
            try:
                state['active_starts'].remove(started)
            except ValueError:
                pass
            state['last_completed'] = time.monotonic()


_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024
"""
    if bot_marker not in source:
        raise SystemExit("Telegram media marker not found")
    source = source.replace(bot_marker, bot_block, 1)

if "_TELEGRAM_API_RETRY_ATTEMPTS" not in source:
    retry_marker = "_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024\n"
    retry_block = """_TELEGRAM_API_RETRY_ATTEMPTS = 3
_TELEGRAM_API_RETRY_MAX_DELAY = 30.0

_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024
"""
    if retry_marker not in source:
        raise SystemExit("Telegram retry marker not found")
    source = source.replace(retry_marker, retry_block, 1)

if "_TELEGRAM_OUTBOUND_METHODS" not in source:
    outbound_marker = "_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024\n"
    outbound_block = """_TELEGRAM_OUTBOUND_METHODS = frozenset({
    'send_message',
    'send_message_draft',
    'send_photo',
    'send_document',
    'edit_message_text',
    'delete_message',
})

_MAX_TELEGRAM_MEDIA_BYTES = 10 * 1024 * 1024
"""
    if outbound_marker not in source:
        raise SystemExit("Telegram outbound marker not found")
    source = source.replace(outbound_marker, outbound_block, 1)

application_marker = "        application = ApplicationBuilder().token(config['token']).build()\n"
application_replacement = """        # Build both request clients explicitly so the polling bot can be instrumented safely.
        proxy_url = (
            os.getenv('HTTPS_PROXY')
            or os.getenv('https_proxy')
            or os.getenv('ALL_PROXY')
            or os.getenv('all_proxy')
        )
        api_request = HTTPXRequest(
            read_timeout=_TELEGRAM_READ_TIMEOUT,
            write_timeout=_TELEGRAM_WRITE_TIMEOUT,
            connect_timeout=_TELEGRAM_CONNECT_TIMEOUT,
            pool_timeout=_TELEGRAM_POOL_TIMEOUT,
            proxy=proxy_url,
        )
        polling_request = HTTPXRequest(
            connection_pool_size=1,
            read_timeout=_TELEGRAM_GET_UPDATES_READ_TIMEOUT,
            write_timeout=_TELEGRAM_WRITE_TIMEOUT,
            connect_timeout=_TELEGRAM_CONNECT_TIMEOUT,
            pool_timeout=_TELEGRAM_POOL_TIMEOUT,
            proxy=proxy_url,
        )
        bot = _LangBotTelegramBot(
            token=config['token'],
            request=api_request,
            get_updates_request=polling_request,
        )
        application = ApplicationBuilder().bot(bot).build()
"""
if application_marker in source:
    source = source.replace(application_marker, application_replacement, 1)
elif "LANGBOT_TELEGRAM_GET_UPDATES_READ_TIMEOUT" not in source:
    raise SystemExit("Telegram application builder marker not found")

if "async def _telegram_call" not in source:
    call_marker = "    def _cap_stream_states(self) -> None:\n"
    call_block = """    async def _telegram_call(self, method_name: str, **kwargs):
        method = getattr(self.bot, method_name)
        is_outbound = method_name in _TELEGRAM_OUTBOUND_METHODS
        chat_id = kwargs.get('chat_id')
        text_bytes = len(str(kwargs.get('text', '')).encode('utf-8')) if 'text' in kwargs else 0
        for attempt in range(_TELEGRAM_API_RETRY_ATTEMPTS):
            try:
                result = await method(**kwargs)
                if is_outbound:
                    logging.getLogger(__name__).info(
                        'Telegram outbound success method=%s chat_id=%s bytes=%s attempt=%s',
                        method_name,
                        chat_id,
                        text_bytes,
                        attempt + 1,
                    )
                return result
            except telegram.error.RetryAfter as exc:
                if attempt + 1 >= _TELEGRAM_API_RETRY_ATTEMPTS:
                    if is_outbound:
                        logging.getLogger(__name__).error(
                            'Telegram outbound failed method=%s chat_id=%s error=%s',
                            method_name,
                            chat_id,
                            type(exc).__name__,
                        )
                    raise
                try:
                    retry_after = float(exc.retry_after)
                except (TypeError, ValueError):
                    retry_after = 1.0
                await asyncio.sleep(min(max(retry_after, 1.0), _TELEGRAM_API_RETRY_MAX_DELAY))
            except (telegram.error.TimedOut, telegram.error.NetworkError) as exc:
                if attempt + 1 >= _TELEGRAM_API_RETRY_ATTEMPTS:
                    if is_outbound:
                        logging.getLogger(__name__).error(
                            'Telegram outbound failed method=%s chat_id=%s error=%s',
                            method_name,
                            chat_id,
                            type(exc).__name__,
                        )
                    raise
                if is_outbound:
                    await self._telegram_reset_api_request()
                retry_delay = min(2.0 ** attempt, _TELEGRAM_API_RETRY_MAX_DELAY)
                if is_outbound:
                    logging.getLogger(__name__).warning(
                        'Telegram outbound retry method=%s chat_id=%s error=%s delay=%ss',
                        method_name,
                        chat_id,
                        type(exc).__name__,
                        retry_delay,
                    )
                await self.logger.warning(
                    f'Telegram API {method_name} transient failure ({type(exc).__name__}); '
                    f'retrying in {retry_delay:g}s'
                )
                await asyncio.sleep(retry_delay)
            except Exception as exc:
                if is_outbound:
                    logging.getLogger(__name__).error(
                        'Telegram outbound failed method=%s chat_id=%s error=%s',
                        method_name,
                        chat_id,
                        type(exc).__name__,
                    )
                raise

    def _cap_stream_states(self) -> None:
"""
    if call_marker not in source:
        raise SystemExit("Telegram stream state marker not found")
    source = source.replace(call_marker, call_block, 1)

for method_name in (
    'send_message',
    'send_photo',
    'send_document',
    'send_message_draft',
    'edit_message_text',
    'delete_message',
):
    source = source.replace(
        f'await self.bot.{method_name}(',
        f"await self._telegram_call('{method_name}', ",
    )
source = source.replace(
    'await self.bot.get_me()',
    "await self._telegram_call('get_me')",
)

draft_error_marker = """                except telegram.error.BadRequest as exc:
                    if 'Message_too_long' in str(exc):
"""
draft_error_replacement = """                except (telegram.error.TimedOut, telegram.error.NetworkError):
                    pass
                except telegram.error.BadRequest as exc:
                    if 'Message_too_long' in str(exc):
"""
if draft_error_marker in source:
    source = source.replace(draft_error_marker, draft_error_replacement, 1)

run_marker = """    async def run_async(self):
        await self.application.initialize()
        self.bot_account_id = (await self._telegram_call('get_me')).username
        await self.application.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        await self.application.start()
        await self.logger.info('Telegram adapter running')
"""
run_replacement = """    async def _reset_after_start_failure(self) -> None:
        # Stop only the Telegram polling task before touching the application.
        try:
            async with self._telegram_lifecycle_lock():
                await self._telegram_stop_polling_task()
                if self.application.running:
                    await self.application.stop()
                await self.application.shutdown()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    def _telegram_lifecycle_lock(self):
        lock = getattr(self, '_telegram_lifecycle_lock_value', None)
        if lock is None:
            lock = asyncio.Lock()
            self._telegram_lifecycle_lock_value = lock
        return lock

    def _telegram_bootstrap_retries(self) -> int:
        raw_value = os.getenv('LANGBOT_TELEGRAM_BOOTSTRAP_RETRIES', '3')
        try:
            value = int(raw_value)
        except (TypeError, ValueError):
            value = 3
        return min(max(value, 0), 10)

    def _telegram_install_polling_probe(self) -> None:
        if getattr(self, '_telegram_polling_probe_installed', False):
            return

        default_timeout = max(_TELEGRAM_GET_UPDATES_READ_TIMEOUT + 30.0, 90.0)
        request_timeout = max(
            _read_telegram_timeout('LANGBOT_TELEGRAM_GET_UPDATES_TIMEOUT', default_timeout),
            15.0,
        )
        self._telegram_polling_probe_state = {
            'active_starts': [],
            'last_completed': time.monotonic(),
            'last_success': time.monotonic(),
            'last_update_received': 0.0,
            'consecutive_errors': 0,
            'request_timeout': request_timeout,
        }
        self._telegram_polling_request_timeout = request_timeout
        self.bot._langbot_polling_probe_state = self._telegram_polling_probe_state
        self._telegram_polling_probe_installed = True

    def _telegram_reset_polling_probe(self) -> None:
        state = getattr(self, '_telegram_polling_probe_state', None)
        if not state:
            return
        state['active_starts'].clear()
        now = time.monotonic()
        state['last_completed'] = now
        state['last_success'] = now
        state['consecutive_errors'] = 0

    async def _telegram_pending_update_count(self) -> int | None:
        timeout = _read_telegram_timeout(
            'LANGBOT_TELEGRAM_PENDING_CHECK_TIMEOUT',
            10.0,
        )
        try:
            webhook_info = await asyncio.wait_for(
                self.bot.get_webhook_info(),
                timeout=timeout,
            )
            return max(0, int(webhook_info.pending_update_count or 0))
        except asyncio.CancelledError:
            raise
        except Exception:
            return None

    async def _telegram_stop_polling_task(self) -> bool:
        updater = self.application.updater
        if updater is None:
            return True

        polling_task = getattr(updater, '_Updater__polling_task', None)
        polling_stop_event = getattr(updater, '_Updater__polling_task_stop_event', None)
        if polling_stop_event is not None:
            polling_stop_event.set()
        updater._running = False

        stopped = True
        if polling_task is not None:
            if not polling_task.done():
                polling_task.cancel()
            try:
                await asyncio.wait_for(
                    asyncio.shield(polling_task),
                    timeout=_read_telegram_timeout(
                        'LANGBOT_TELEGRAM_POLL_CANCEL_TIMEOUT',
                        8.0,
                    ),
                )
            except asyncio.CancelledError:
                pass
            except asyncio.TimeoutError:
                stopped = False
            except Exception:
                pass

            if getattr(updater, '_Updater__polling_task', None) is polling_task:
                updater._Updater__polling_task = None

        # Do not run PTB's cleanup getUpdates call here: it can reuse the same
        # broken connection that caused recovery in the first place.
        updater._Updater__polling_cleanup_cb = None
        if polling_stop_event is not None:
            polling_stop_event.clear()
        self._telegram_reset_polling_probe()
        return stopped

    async def _telegram_reset_polling_request(self) -> bool:
        requests = getattr(self.bot, '_request', ())
        if not requests:
            return False
        polling_request = requests[0]
        try:
            # Recreate only the long-poll HTTP client so a changed proxy node
            # cannot leave the next poll on the old TCP/TLS connection.
            await polling_request.shutdown()
            await polling_request.initialize()
            return True
        except asyncio.CancelledError:
            raise
        except Exception:
            return False

    async def _telegram_reset_api_request(self) -> bool:
        requests = getattr(self.bot, '_request', ())
        if len(requests) < 2:
            return False

        lock = getattr(self, '_telegram_api_request_reset_lock', None)
        if lock is None:
            lock = asyncio.Lock()
            self._telegram_api_request_reset_lock = lock

        async with lock:
            api_request = requests[1]
            try:
                # Refresh only the regular Bot API client after a transient
                # send failure; the application and polling task stay alive.
                await api_request.shutdown()
                await api_request.initialize()
                logging.getLogger(__name__).warning('Telegram API request client reset')
                return True
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logging.getLogger(__name__).error(
                    'Telegram API request client reset failed error=%s',
                    type(exc).__name__,
                )
                return False

    async def _telegram_start_polling(self) -> None:
        await self.application.updater.start_polling(
            allowed_updates=Update.ALL_TYPES,
            bootstrap_retries=self._telegram_bootstrap_retries(),
            error_callback=self._telegram_polling_error_callback,
        )

    async def _telegram_restart_polling(self, pending_count: int) -> bool:
        async with self._telegram_lifecycle_lock():
            if self._telegram_stop_requested:
                return False

            now = time.monotonic()
            cooldown = _read_telegram_timeout(
                'LANGBOT_TELEGRAM_POLLING_RECOVERY_COOLDOWN',
                600.0,
            )
            last_recovery = getattr(self, '_telegram_last_polling_recovery', 0.0)
            if last_recovery and now - last_recovery < cooldown:
                return False

            await self.logger.warning(
                f'Telegram polling stalled with {pending_count} pending update(s); '
                'restarting polling task only'
            )
            self._telegram_last_polling_recovery = now
            if not await self._telegram_stop_polling_task():
                raise RuntimeError('Telegram polling task did not stop in time')
            if self._telegram_stop_requested:
                return False
            if not await self._telegram_reset_polling_request():
                raise RuntimeError('Telegram polling request client did not reset')
            await self._telegram_start_polling()
            self._telegram_reset_polling_probe()
            return True

    async def _telegram_polling_recovery_loop(
        self,
        recovery_event: asyncio.Event,
        stop_event: asyncio.Event,
    ) -> None:
        state = self._telegram_polling_probe_state
        request_timeout = self._telegram_polling_request_timeout
        stall_seconds = _read_telegram_timeout(
            'LANGBOT_TELEGRAM_POLLING_STALL_SECONDS',
            request_timeout,
        )
        check_interval = max(
            5.0,
            _read_telegram_timeout(
                'LANGBOT_TELEGRAM_POLLING_RECOVERY_CHECK_SECONDS',
                10.0,
            ),
        )
        pending_check_interval = 30.0
        last_pending_check = 0.0

        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=check_interval)
            except asyncio.TimeoutError:
                pass
            if stop_event.is_set():
                return

            updater = self.application.updater
            polling_task = getattr(updater, '_Updater__polling_task', None)
            if not self.application.running or not updater.running:
                return
            if polling_task is None or polling_task.done():
                return

            now = time.monotonic()
            active_starts = list(state.get('active_starts') or [])
            oldest_active = min(active_starts) if active_starts else None
            last_success = float(state.get('last_success') or now)
            consecutive_errors = int(state.get('consecutive_errors') or 0)
            active_stalled = (
                oldest_active is not None and now - oldest_active >= stall_seconds
            )
            error_stalled = (
                consecutive_errors > 0 and now - last_success >= stall_seconds
            )
            idle_stalled = (
                not active_starts and now - last_success >= stall_seconds * 2
            )
            if not (active_stalled or error_stalled or idle_stalled):
                continue

            cooldown = _read_telegram_timeout(
                'LANGBOT_TELEGRAM_POLLING_RECOVERY_COOLDOWN',
                600.0,
            )
            last_recovery = getattr(self, '_telegram_last_polling_recovery', 0.0)
            if last_recovery and now - last_recovery < cooldown:
                continue
            if now - last_pending_check < pending_check_interval:
                continue
            last_pending_check = now

            pending_count = await self._telegram_pending_update_count()
            if pending_count is None or pending_count <= 0:
                continue
            self._telegram_pending_count_last = pending_count
            recovery_event.set()
            return

    async def _telegram_stop_recovery_task(
        self,
        stop_event: asyncio.Event,
        recovery_task: asyncio.Task | None,
    ) -> None:
        stop_event.set()
        if recovery_task is None or recovery_task.done():
            return
        recovery_task.cancel()
        try:
            await recovery_task
        except BaseException:
            pass

    def _telegram_polling_error_callback(self, exc: telegram.error.TelegramError) -> None:
        try:
            asyncio.create_task(
                self.logger.warning(
                    f'Telegram polling transient failure ({type(exc).__name__})'
                )
            )
        except RuntimeError:
            pass

    async def run_async(self):
        self._telegram_stop_requested = False
        retry_attempt = 0
        connected_since = 0.0
        while True:
            if self._telegram_stop_requested:
                return
            recovery_stop = None
            recovery_task = None
            try:
                await self.application.initialize()
                if self._telegram_stop_requested:
                    return
                self.bot_account_id = (await self._telegram_call('get_me')).username
                self._telegram_install_polling_probe()
                await self._telegram_start_polling()
                if self._telegram_stop_requested:
                    await self._reset_after_start_failure()
                    return
                await self.application.start()
                await self.logger.info('Telegram adapter running')
                connected_since = time.monotonic()
                recovery_stop = asyncio.Event()
                recovery_event = asyncio.Event()
                recovery_task = asyncio.create_task(
                    self._telegram_polling_recovery_loop(
                        recovery_event,
                        recovery_stop,
                    )
                )
                while not self._telegram_stop_requested:
                    if recovery_event.is_set():
                        recovery_event.clear()
                        await self._telegram_stop_recovery_task(
                            recovery_stop,
                            recovery_task,
                        )
                        if self._telegram_stop_requested:
                            break
                        pending_count = await self._telegram_pending_update_count()
                        if pending_count is not None and pending_count > 0:
                            await self._telegram_restart_polling(pending_count)
                        recovery_stop = asyncio.Event()
                        recovery_task = asyncio.create_task(
                            self._telegram_polling_recovery_loop(
                                recovery_event,
                                recovery_stop,
                            )
                        )
                        continue

                    if not self.application.running or not self.application.updater.running:
                        raise RuntimeError('Telegram polling stopped unexpectedly')
                    polling_task = getattr(self.application.updater, '_Updater__polling_task', None)
                    if polling_task is not None and polling_task.done():
                        if polling_task.cancelled():
                            raise RuntimeError('Telegram polling task was cancelled')
                        polling_exception = polling_task.exception()
                        if polling_exception is not None:
                            raise RuntimeError(
                                f'Telegram polling task exited ({type(polling_exception).__name__})'
                            ) from polling_exception
                        raise RuntimeError('Telegram polling task exited unexpectedly')
                    await asyncio.sleep(5)
                if recovery_stop is not None and recovery_task is not None:
                    await self._telegram_stop_recovery_task(recovery_stop, recovery_task)
                return
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self._telegram_stop_requested:
                    return
                if connected_since and time.monotonic() - connected_since >= 600.0:
                    retry_attempt = 0
                retry_attempt += 1
                if recovery_stop is not None and recovery_task is not None:
                    await self._telegram_stop_recovery_task(recovery_stop, recovery_task)
                await self._reset_after_start_failure()
                retry_delay = min(300, 2 ** min(retry_attempt - 1, 8))
                await self.logger.warning(
                    f'Telegram adapter supervision failed ({type(exc).__name__}); '
                    f'retrying in {retry_delay}s'
                )
                connected_since = 0.0
                for _ in range(max(1, int(retry_delay))):
                    if self._telegram_stop_requested:
                        return
                    await asyncio.sleep(1)
"""
if run_marker in source:
    source = source.replace(run_marker, run_replacement, 1)
elif "async def _reset_after_start_failure" not in source:
    raise SystemExit("Telegram run_async marker not found")

if "Telegram stream state missing at final" not in source:
    stream_state_marker = """        if message_id not in self.msg_stream_id:
            return

        stream_state = self.msg_stream_id[message_id]
"""
    stream_state_replacement = """        if message_id not in self.msg_stream_id:
            if is_final:
                logging.getLogger(__name__).warning(
                    'Telegram stream state missing at final; falling back to send_message'
                )
                await self.reply_message(
                    message_source=message_source,
                    message=message,
                    quote_origin=quote_origin,
                )
            return

        stream_state = self.msg_stream_id[message_id]
"""
    if stream_state_marker not in source:
        raise SystemExit("Telegram stream state marker not found")
    source = source.replace(stream_state_marker, stream_state_replacement, 1)

kill_marker = """    async def kill(self) -> bool:
        if self.application.running:
            await self.application.stop()
            if self.application.updater:
                await self.application.updater.stop()
            await self.logger.info('Telegram adapter stopped')
        self.msg_stream_id.clear()
        self._form_action_titles.clear()
        return True
"""
kill_replacement = """    async def kill(self) -> bool:
        self._telegram_stop_requested = True
        await self._reset_after_start_failure()
        await self.logger.info('Telegram adapter stopped')
        self.msg_stream_id.clear()
        self._form_action_titles.clear()
        return True
"""
if kill_marker in source:
    source = source.replace(kill_marker, kill_replacement, 1)
elif "self._telegram_stop_requested = True" not in source:
    raise SystemExit("Telegram kill marker not found")

source_path.write_text(source)
