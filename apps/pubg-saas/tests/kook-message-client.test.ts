import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KOOK_MAX_CARD_KMARKDOWN_LENGTH,
  KOOK_MAX_CARD_PLAIN_TEXT_LENGTH,
  KOOK_MAX_MESSAGE_LENGTH,
  KookMessageApiClient,
  KookRateLimitGate,
  adaptKookMessagePayload,
  splitKookOutboundPayload,
  validateKookMessagePayload,
} from '../src/index.js';

function success(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('sends only group message fields to the fixed KOOK create endpoint', async () => {
  const requests: Array<{ url: URL; init: RequestInit; body: URLSearchParams }> = [];
  const client = new KookMessageApiClient({
    token: 'fixture-token',
    fetcher: async (input, init) => {
      const body = init?.body as URLSearchParams;
      requests.push({ url: new URL(String(input)), init: init ?? {}, body });
      return success({ msg_id: 'synthetic-message' });
    },
  });
  await client.send('bound-channel', { type: 'text', content: 'hello squad' }, 'a'.repeat(64), 'source-message');

  const request = requests[0]!;
  assert.equal(request.url.origin, 'https://www.kookapp.cn');
  assert.equal(request.url.pathname, '/api/v3/message/create');
  assert.equal(request.init.method, 'POST');
  assert.equal(new Headers(request.init.headers).get('Authorization'), 'Bot fixture-token');
  assert.equal(new Headers(request.init.headers).get('Content-Type'), 'application/x-www-form-urlencoded');
  assert.equal(request.body.get('target_id'), 'bound-channel');
  assert.equal(request.body.get('type'), '1');
  assert.equal(request.body.get('content'), 'hello squad');
  assert.equal(request.body.get('nonce'), 'a'.repeat(64));
  assert.equal(request.body.get('reply_msg_id'), 'source-message');
  assert.equal(request.body.get('quote'), 'source-message');
  assert.equal(request.body.has('guild_id'), false);
});

test('sanitizes assistant scaffolding and adapts user mentions to KOOK KMarkdown at send time', async () => {
  let sentContent: string | null = null;
  let sentType: string | null = null;
  const client = new KookMessageApiClient({
    token: 'fixture-token',
    fetcher: async (_input, init) => {
      const body = init?.body as URLSearchParams;
      sentContent = body.get('content');
      sentType = body.get('type');
      return success({ msg_id: 'sanitized-message' });
    },
  });
  await client.send('bound-channel', {
    type: 'text', content: '[回复成员12] 成员3说：<@!123456> 你好！',
  }, 'e'.repeat(64));
  assert.equal(sentContent, '(met)123456(met) 你好！');
  assert.equal(sentType, '9');
});

test('splits long replies at KOOK message boundaries without truncating mentions or Unicode', () => {
  const source = `${'甲'.repeat(7999)}(met)123456(met)${'😀'.repeat(5000)}`;
  const parts = splitKookOutboundPayload({ type: 'text', content: source });
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.content.length <= 8000));
  assert.equal(parts.map(part => part.content).join(''), source);
  assert.equal(parts[0]?.content.endsWith('(met)'), false);
  assert.equal(parts[1]?.content.startsWith('(met)123456(met)'), true);
});

test('uses KOOK official message and card text limits at the channel adapter boundary', () => {
  assert.equal(KOOK_MAX_MESSAGE_LENGTH, 8000);
  assert.equal(KOOK_MAX_CARD_PLAIN_TEXT_LENGTH, 2000);
  assert.equal(KOOK_MAX_CARD_KMARKDOWN_LENGTH, 5000);
  for (const type of ['text', 'kmarkdown'] as const) {
    assert.equal(validateKookMessagePayload({ type, content: '字'.repeat(8000) }).content.length, 8000);
    assert.throws(() => validateKookMessagePayload({ type, content: '字'.repeat(8001) }), /kook_payload_invalid/u);
  }
  const card = (type: 'plain-text' | 'kmarkdown', length: number) => JSON.stringify([{
    type: 'card', modules: [{ type: 'section', text: { type, content: '字'.repeat(length) } }],
  }]);
  assert.doesNotThrow(() => validateKookMessagePayload({ type: 'card', content: card('plain-text', 2000) }));
  assert.throws(() => validateKookMessagePayload({ type: 'card', content: card('plain-text', 2001) }), /kook_payload_invalid/u);
  assert.doesNotThrow(() => validateKookMessagePayload({ type: 'card', content: card('kmarkdown', 5000) }));
  assert.throws(() => validateKookMessagePayload({ type: 'card', content: card('kmarkdown', 5001) }), /kook_payload_invalid/u);
});

test('converts common Markdown, emoji shortcuts and neutral user mentions in the KOOK channel adapter', () => {
  const adapted = adaptKookMessagePayload({
    type: 'text',
    content: '# 昨日战报\n\n- 输出稳定\n- <@!123456> :smile:',
  });
  assert.equal(adapted.type, 'kmarkdown');
  assert.match(adapted.content, /\*\*昨日战报\*\*/u);
  assert.match(adapted.content, /• 输出稳定/u);
  assert.match(adapted.content, /\(met\)123456\(met\)/u);
  assert.match(adapted.content, /:smile:/u);
  assert.doesNotMatch(adapted.content, /\(met\)(?:all|here)\(met\)/u);
  const dialect = adaptKookMessagePayload({ type: 'text', content: '*加粗* _斜体_ ~删除线~' });
  assert.equal(dialect.type, 'kmarkdown');
  assert.equal(dialect.content, '**加粗** *斜体* ~~删除线~~');
  const unsafe = adaptKookMessagePayload({ type: 'kmarkdown', content: '[点我](javascript:alert(1))' });
  assert.equal(unsafe.content, '点我 (javascript:alert(1))');
});

test('splits long KMarkdown at natural boundaries and balances emphasis and code fences per message', () => {
  const emphasized = `**${'团队输出稳定，配合也不错。 '.repeat(700)}**`;
  const codeBody = `${Array.from({ length: 1500 }, (_, index) => `const round${index} = 'evidence';`).join('\n')}\n`;
  const source = `${emphasized}\n\n\`\`\`ts\n${codeBody}\`\`\`\n\n查询结束。`;
  const parts = splitKookOutboundPayload({ type: 'kmarkdown', content: source });
  assert.ok(parts.length > 2);
  assert.ok(parts.every(part => part.type === 'kmarkdown' && part.content.length <= KOOK_MAX_MESSAGE_LENGTH));
  const codeParts = parts.filter(part => part.content.startsWith('```ts\n'));
  assert.ok(codeParts.length > 1);
  for (const part of parts) {
    const boldTokens = part.content.match(/\*\*/gu)?.length ?? 0;
    assert.equal(boldTokens % 2, 0, 'bold markup stays balanced in each segment');
    if (part.content.includes('```')) {
      assert.match(part.content, /^```ts\n[\s\S]*\n```$/u);
    }
  }
  const reconstructedCode = codeParts.map(part => part.content.slice('```ts\n'.length, -3)).join('');
  assert.equal(reconstructedCode, codeBody);
  assert.ok(parts.at(-1)?.content?.endsWith('查询结束。'));
});

test('keeps Markdown links and KOOK mention tokens whole when a split falls near them', () => {
  const link = `[详细记录](https://example.com/${'match/'.repeat(250)})`;
  const mention = '(met)123456789(met)';
  const parts = splitKookOutboundPayload({ type: 'kmarkdown', content: `${'战'.repeat(7990)} ${link} ${mention} 完成。` });
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.content.length <= KOOK_MAX_MESSAGE_LENGTH));
  assert.ok(parts.some(part => part.content.includes(link)));
  assert.ok(parts.some(part => part.content.includes(mention)));
  assert.equal(parts.map(part => part.content).join('').includes('详细记录'), true);
});

test('reopens KMarkdown block quotes at the start of continuation messages', () => {
  const parts = splitKookOutboundPayload({ type: 'kmarkdown', content: `> ${'队伍观察与复盘结论。 '.repeat(900)}` });
  assert.ok(parts.length > 1);
  assert.ok(parts.slice(1).every(part => /^> /u.test(part.content)));
  assert.ok(parts.every(part => part.content.length <= KOOK_MAX_MESSAGE_LENGTH));
});

test('private replies use only the fixed direct-message endpoint and the source actor', async () => {
  let request: { url: string; body: URLSearchParams } | null = null;
  const client = new KookMessageApiClient({
    token: 'fixture-token', fetcher: async (url, init) => {
      request = { url: String(url), body: init?.body as URLSearchParams };
      return success({ msg_id: 'private-response' });
    }
  });
  await client.sendDirect('source-actor', { type: 'text', content: 'account state' }, 'd'.repeat(64), 'source-dm');
  assert.ok(request);
  const captured = request as { url: string; body: URLSearchParams };
  assert.equal(captured.url, 'https://www.kookapp.cn/api/v3/direct-message/create');
  assert.equal(captured.body.get('target_id'), 'source-actor');
  assert.equal(captured.body.get('quote'), 'source-dm');
  assert.equal(captured.body.get('reply_msg_id'), 'source-dm');
  assert.equal(captured.body.has('chat_code'), false);
});

test('maps KMarkdown and fails closed without exposing the bot token', async () => {
  const bodies: URLSearchParams[] = [];
  const client = new KookMessageApiClient({
    token: 'secret-fixture',
    fetcher: async (_input, init) => {
      bodies.push(init?.body as URLSearchParams);
      return success({ msg_id: 'synthetic-message' });
    },
  });
  await client.send('bound-channel', { type: 'kmarkdown', content: '**hello**' }, 'b'.repeat(64));
  assert.equal(bodies[0]?.get('type'), '9');
  await client.send('bound-channel', { type: 'card', content: '[{"type":"card","modules":[]}]' }, 'b'.repeat(64));
  assert.equal(bodies[1]?.get('type'), '10');

  const unavailable = new KookMessageApiClient({ token: 'secret-fixture', fetcher: async () => new Response('unavailable', { status: 503 }) });
  await assert.rejects(unavailable.send('bound-channel', { type: 'text', content: 'hello' }, 'c'.repeat(64)), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'kook_message_api_http_503');
    assert.equal(error.message.includes('secret-fixture'), false);
    return true;
  });
});

test('uses KOOK response bucket and global reset headers to defer later sends', () => {
  let now = 1_000;
  const gate = new KookRateLimitGate(() => now);
  gate.observe('/api/v3/message/create', new Headers({
    'x-rate-limit-bucket': 'message-create-shared',
    'x-rate-limit-remaining': '4',
    'x-rate-limit-reset': '5',
  }), 200);
  gate.observe('/api/v3/direct-message/create', new Headers({
    'x-rate-limit-bucket': 'message-create-shared',
    'x-rate-limit-remaining': '0',
    'x-rate-limit-reset': '5',
  }), 200);
  assert.equal(gate.waitMs('/api/v3/message/create'), 5_000);
  now += 5_000;
  assert.equal(gate.waitMs('/api/v3/message/create'), 0);

  gate.observe('/api/v3/message/create', new Headers({
    'x-rate-limit-global': '',
    'x-rate-limit-remaining': '2',
    'x-rate-limit-reset': '3',
  }), 200);
  assert.equal(gate.waitMs('/api/v3/direct-message/create'), 3_000);

  const global429 = new KookRateLimitGate(() => now);
  global429.observe('/api/v3/message/create', new Headers({
    'x-rate-limit-global': '',
    'x-rate-limit-bucket': 'message-create-shared',
    'x-rate-limit-remaining': '0',
    'x-rate-limit-reset': '2',
    'retry-after': '7',
  }), 429);
  assert.equal(global429.waitMs('/api/v3/direct-message/create'), 7_000);
});

test('429 returns a durable retry delay and later sends defer without another API request', async () => {
  let now = 1_000;
  let calls = 0;
  const rateLimitGate = new KookRateLimitGate(() => now);
  const client = new KookMessageApiClient({
    token: 'fixture-token',
    rateLimitGate,
    fetcher: async () => {
      calls += 1;
      return new Response('{"code":429}', {
        status: 429,
        headers: {
          'x-rate-limit-bucket': 'group-send',
          'x-rate-limit-remaining': '0',
          'x-rate-limit-reset': '2',
          'retry-after': '7',
        },
      });
    },
  });
  await assert.rejects(client.send('bound-channel', { type: 'text', content: 'hello' }, 'c'.repeat(64)), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: string }).code, 'kook_message_api_rate_limited');
    assert.equal((error as Error & { retryAfterMs?: number }).retryAfterMs, 7_000);
    return true;
  });
  await assert.rejects(client.send('bound-channel', { type: 'text', content: 'later' }, 'd'.repeat(64)), (error: unknown) => {
    assert.equal((error as Error & { retryAfterMs?: number }).retryAfterMs, 7_000);
    return true;
  });
  assert.equal(calls, 1);
  now += 7_000;
  assert.equal(rateLimitGate.waitMs('/api/v3/message/create'), 0);
});

test('connection failures expose a stable code and never echo provider details', async () => {
  const client = new KookMessageApiClient({
    token: 'secret-fixture',
    fetcher: async () => { throw new Error('fixture response carried secret-fixture and private detail'); },
  });
  await assert.rejects(client.send('bound-channel', { type: 'text', content: 'hello' }, 'safe-error'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code?: string }).code, 'kook_message_api_unavailable');
    assert.equal(error.message.includes('secret-fixture'), false);
    assert.equal(error.message.includes('private detail'), false);
    return true;
  });
});
