import assert from 'node:assert/strict';
import test from 'node:test';
import { KookMessageApiClient } from '../src/index.js';

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
  assert.equal(request.body.has('guild_id'), false);
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
