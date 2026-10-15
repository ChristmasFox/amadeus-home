import assert from 'node:assert/strict';
import test from 'node:test';
import { KookMessageApiClient } from '../src/index.js';

test('public KOOK sender has no local 200-message daily quota', async () => {
  let sends = 0;
  const client = new KookMessageApiClient({
    token: 'fixture-only',
    fetcher: async () => {
      sends += 1;
      return new Response(JSON.stringify({ code: 0, data: { msg_id: `sent-${sends}` } }));
    },
  });
  for (let index = 0; index < 205; index += 1)
    await client.send('fixture-channel', { type: 'text', content: 'hello' }, `fixture-${index}`);
  assert.equal(sends, 205);
});
