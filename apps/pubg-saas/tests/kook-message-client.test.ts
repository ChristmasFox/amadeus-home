import assert from 'node:assert/strict';
import test from 'node:test';
import { KookMessageApiClient, KookRateLimitGate } from '../src/index.js';

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

test('daily message budget is settled only on definitive KOOK outcomes', async () => {
  const budgetCalls: string[] = [];
  const reservationIds: string[] = [];
  const dailyBudget = {
    async reserve(reservationId: string) { reservationIds.push(reservationId); budgetCalls.push('reserve'); },
    async markSent(reservationId: string) { assert.equal(reservationId, reservationIds.at(-1)); budgetCalls.push('sent'); },
    async release(reservationId: string) { assert.equal(reservationId, reservationIds.at(-1)); budgetCalls.push('release'); },
    async prune() { return 0; },
  };
  const accepted = new KookMessageApiClient({ token: 'fixture-token', dailyBudget, fetcher: async () => success({ msg_id: 'sent' }) });
  await accepted.send('bound-channel', { type: 'text', content: 'hello' }, 'daily-accepted');
  assert.deepEqual(budgetCalls, ['reserve', 'sent']);

  budgetCalls.length = 0;
  const rejected = new KookMessageApiClient({ token: 'fixture-token', dailyBudget, fetcher: async () => new Response('{"code":400}', { status: 200 }) });
  await assert.rejects(rejected.send('bound-channel', { type: 'text', content: 'no' }, 'daily-rejected'));
  assert.deepEqual(budgetCalls, ['reserve', 'release']);

  budgetCalls.length = 0;
  const unknown = new KookMessageApiClient({ token: 'fixture-token', dailyBudget, fetcher: async () => { throw new Error('connection ended after request write'); } });
  await assert.rejects(unknown.send('bound-channel', { type: 'text', content: 'uncertain' }, 'daily-unknown'));
  assert.deepEqual(budgetCalls, ['reserve']);
  assert.equal(new Set(reservationIds).size, 3);
  assert.ok(reservationIds.every(reservationId => !['daily-accepted', 'daily-rejected', 'daily-unknown'].includes(reservationId)));
});
