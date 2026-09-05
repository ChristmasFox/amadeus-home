from pathlib import Path
import sys


source_path = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/app/src/langbot/pkg/platform/sources/kook.py"
)
source = source_path.read_text()

if "import time\n" not in source:
    source = source.replace("import traceback\n", "import traceback\nimport time\n", 1)

source = source.replace(
    "        session_id = data.get('session_id', '')\n",
    "        session_id = data.get('session_id') or data.get('sessionId') or ''\n",
    1,
)

source = source.replace(
    "                            elif signal == 5:  # RECONNECT\n"
    "                                # await self.logger.info('Received RECONNECT signal')\n"
    "                                break  # Break to reconnect\n",
    "                            elif signal == 5:  # RECONNECT\n"
    "                                await self.logger.warning('KOOK WebSocket requested reconnect')\n"
    "                                self.gateway_url = ''\n"
    "                                self.session_id = ''\n"
    "                                self.current_sn = 0\n"
    "                                await asyncio.sleep(1)\n"
    "                                break  # Break to reconnect\n",
    1,
)

source = source.replace(
    "                    await self.logger.info(f'Connected to KOOK WebSocket: {self.gateway_url}')\n",
    "                    gateway_display = self.gateway_url.split('?', 1)[0]\n"
    "                    await self.logger.info(f'Connected to KOOK WebSocket: {gateway_display}')\n",
    1,
)

source = source.replace(
    "            except websockets.exceptions.ConnectionClosed:\n"
    "                await self.logger.warning('KOOK WebSocket connection closed, reconnecting...')\n",
    "            except websockets.exceptions.ConnectionClosed as exc:\n"
    "                await self.logger.warning(\n"
    "                    f'KOOK WebSocket connection closed (code={exc.code}, reason={exc.reason}), reconnecting...'\n"
    "                )\n",
    1,
)

source = source.replace(
    "        retry_count = 0\n"
    "        max_retries = 3\n"
    "\n"
    "        while self.running and retry_count < max_retries:\n",
    "        retry_count = 0\n"
    "\n"
    "        while self.running:\n",
    1,
)

source = source.replace(
    "                self.ws = None\n\n        if retry_count >= max_retries:\n",
    "                self.ws = None\n"
    "                self.gateway_url = ''\n"
    "                self.session_id = ''\n"
    "                self.current_sn = 0\n"
    "                if self.running:\n"
    "                    await asyncio.sleep(1)\n\n        if retry_count >= max_retries:\n",
    1,
)

source = source.replace(
    "        if retry_count >= max_retries:\n            await self.logger.error(f'Failed to connect after {max_retries} retries')\n",
    "",
    1,
)

source = source.replace(
    "                await asyncio.sleep(2**retry_count)  # Exponential backoff\n",
    "                await asyncio.sleep(min(30, 2 ** min(retry_count, 5)))\n",
)

source = source.replace(
    "                await asyncio.sleep(2**retry_count)\n",
    "                await asyncio.sleep(min(30, 2 ** min(retry_count, 5)))\n",
)

if "_KOOK_MAX_CONTENT_BYTES = 7500" not in source:
    source = source.replace(
        "_KOOK_MAX_GATEWAY_MESSAGE_BYTES = 10 * 1024 * 1024\n",
        "_KOOK_MAX_GATEWAY_MESSAGE_BYTES = 10 * 1024 * 1024\n"
        "_KOOK_MAX_CONTENT_BYTES = 1800\n\n"
        "def _split_kook_content(content: str) -> list[str]:\n"
        "    if not content:\n"
        "        return [content]\n"
        "    if len(content.encode('utf-8')) <= _KOOK_MAX_CONTENT_BYTES:\n"
        "        return [content]\n\n"
        "    chunks = []\n"
        "    remaining = content\n"
        "    while remaining:\n"
        "        if len(remaining.encode('utf-8')) <= _KOOK_MAX_CONTENT_BYTES:\n"
        "            chunks.append(remaining)\n"
        "            break\n\n"
        "        byte_count = 0\n"
        "        split_index = 0\n"
        "        last_break_index = 0\n"
        "        for index, character in enumerate(remaining):\n"
        "            character_bytes = len(character.encode('utf-8'))\n"
        "            if byte_count + character_bytes > _KOOK_MAX_CONTENT_BYTES:\n"
        "                break\n"
        "            byte_count += character_bytes\n"
        "            split_index = index + 1\n"
        "            if character in '\\r\\n':\n"
        "                last_break_index = split_index\n"
        "        if last_break_index:\n"
        "            split_index = last_break_index\n"
        "        if split_index <= 0:\n"
        "            split_index = 1\n"
        "        chunks.append(remaining[:split_index])\n"
        "        remaining = remaining[split_index:]\n\n"
        "    return chunks or [content]\n",
        1,
    )

send_start = source.index("    async def send_message(")
reply_start = source.index("    async def reply_message(", send_start)
muted_start = source.index("    async def is_muted(", reply_start)

replacement = '''    async def _post_kook_message(
        self,
        url: str,
        payload: dict[str, object],
        operation: str,
    ) -> None:
        if not self.http_session:
            self.http_session = httpclient.get_session()

        headers = {
            'Authorization': f'Bot {self.config["token"]}',
            'Content-Type': 'application/json',
        }

        async with self.http_session.post(url, json=payload, headers=headers) as response:
            if response.status != 200:
                body = await httpclient.read_text_limited(response, max_bytes=4096)
                raise RuntimeError(f'{operation} HTTP {response.status}: {body[:500]}')

            result = await httpclient.read_json_limited(response, max_bytes=64 * 1024)
            if not isinstance(result, dict):
                raise RuntimeError(f'{operation} returned an invalid response')
            if result.get('code') != 0:
                detail = result.get('message') or result.get('code')
                raise RuntimeError(f'{operation} failed: {detail}')

    async def send_message(self, target_type: str, target_id: str, message: platform_message.MessageChain):
        target_type = str(target_type).upper()
        content, msg_type = await self.message_converter.yiri2target(message)
        content_chunks = _split_kook_content(content)

        if target_type == 'GROUP':
            url = 'https://www.kookapp.cn/api/v3/message/create'
        else:
            url = 'https://www.kookapp.cn/api/v3/direct-message/create'

        for chunk_index, content_chunk in enumerate(content_chunks):
            payload = {
                'target_id': target_id,
                'content': content_chunk,
                'type': msg_type,
            }
            try:
                await self._post_kook_message(
                    url,
                    payload,
                    f'Message send chunk {chunk_index + 1}/{len(content_chunks)} '
                    f'({len(content_chunk.encode("utf-8"))} bytes)',
                )
            except Exception as exc:
                await self.logger.error(
                    f'Failed to send message chunk {chunk_index + 1}/{len(content_chunks)}: {exc}'
                )
                raise

        await self.logger.debug(
            f'Message sent successfully to {target_id} in {len(content_chunks)} chunk(s)'
        )

    async def reply_message(
        self,
        message_source: platform_events.MessageEvent,
        message: platform_message.MessageChain,
        quote_origin: bool = False,
    ):
        content, msg_type = await self.message_converter.yiri2target(message)
        content_chunks = _split_kook_content(content)

        kook_event = message_source.source_platform_object
        channel_type = str(kook_event.get('channel_type') or '').upper()
        target_id = kook_event.get('target_id')
        msg_id = kook_event.get('msg_id')

        if channel_type == 'GROUP':
            url = 'https://www.kookapp.cn/api/v3/message/create'
            base_payload = {
                'target_id': target_id,
                'type': msg_type,
            }
        else:
            url = 'https://www.kookapp.cn/api/v3/direct-message/create'
            author_id = kook_event.get('author_id')
            extra = kook_event.get('extra', {})
            chat_code = extra.get('code', '')
            base_payload = {'type': msg_type}

            if chat_code:
                base_payload['chat_code'] = chat_code
            else:
                base_payload['target_id'] = str(author_id or target_id or '')

        for chunk_index, content_chunk in enumerate(content_chunks):
            payload = dict(base_payload)
            payload['content'] = content_chunk

            if chunk_index == 0 and quote_origin and msg_id:
                payload['quote'] = msg_id
            if chunk_index == 0 and msg_id:
                payload['reply_msg_id'] = msg_id

            try:
                await self._post_kook_message(
                    url,
                    payload,
                    f'Reply send chunk {chunk_index + 1}/{len(content_chunks)} '
                    f'({len(content_chunk.encode("utf-8"))} bytes)',
                )
            except Exception as exc:
                await self.logger.error(
                    f'Failed to send reply chunk {chunk_index + 1}/{len(content_chunks)}: {exc}'
                )
                raise

        await self.logger.debug(
            f'Reply sent successfully in {len(content_chunks)} chunk(s)'
        )

'''

source = source[:send_start] + replacement + source[muted_start:]
source_path.write_text(source)
