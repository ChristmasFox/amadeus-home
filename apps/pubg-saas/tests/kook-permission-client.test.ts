import assert from 'node:assert/strict';
import test from 'node:test';
import { KookPermissionClient } from '../src/index.js';

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('fresh query checks verify the guild and text channel, filter by user and do not cache membership', async () => {
  const calls: URL[] = []; let present = true;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    if (url.pathname.endsWith('/guild/view')) return response({ id: 'guild' });
    if (url.pathname.endsWith('/channel/view')) return response({ id: 'channel', guild_id: 'guild', type: 1, is_category: false });
    assert.equal(url.searchParams.get('filter_user_id'), 'user');
    return response({ items: present ? [{ id: 'user' }] : [] });
  };
  const client = new KookPermissionClient({ token: 'fixture', fetcher });
  assert.equal(await client.isTextChannelMember('guild', 'channel', 'user'), true);
  assert.equal(calls[1]?.searchParams.get('channel_id'), 'channel'); present = false;
  assert.equal(await client.isTextChannelMember('guild', 'channel', 'user'), false);
  assert.equal(await client.isGuildMember('guild', 'user'), false);
  assert.equal(calls[5]?.searchParams.has('channel_id'), false);
});

test('query membership checks fail closed on a foreign/non-text channel and an unfiltered member response', async () => {
  const foreign = new KookPermissionClient({ token: 'fixture', fetcher: async () => response({ id: 'channel', guild_id: 'other', type: 1, is_category: false }) });
  await assert.rejects(foreign.isTextChannelMember('guild', 'channel', 'user'), /kook_permission_channel_invalid/u);
  const voice = new KookPermissionClient({ token: 'fixture', fetcher: async () => response({ id: 'channel', guild_id: 'guild', type: 2, is_category: false }) });
  await assert.rejects(voice.isTextChannelMember('guild', 'channel', 'user'), /kook_permission_channel_invalid/u);
  const unfiltered = new KookPermissionClient({ token: 'fixture', fetcher: async (input) => new URL(String(input)).pathname.endsWith('/guild/view') ? response({ id: 'guild' }) : response({ items: [{ id: 'another-user' }] }) });
  await assert.rejects(unfiltered.isGuildMember('guild', 'user'), /kook_permission_member_invalid/u);
});

test('checks live guild owner and admin role through fresh KOOK API data', async () => {
  const calls: Array<{ url: URL; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    if (url.pathname.endsWith('/guild/view')) return response({ id: 'guild-1', user_id: 'owner-1' });
    if (url.pathname.endsWith('/guild/user-list')) return response({ items: [{ id: 'admin-1', roles: [702] }], meta: { page_total: 1 } });
    if (url.pathname.endsWith('/guild-role/list')) return response({ items: [{ role_id: 702, permissions: 1 }], meta: { page_total: 1 } });
    throw new Error('unexpected_kook_endpoint');
  };
  const client = new KookPermissionClient({ token: 'fixture', fetcher });

  assert.equal(await client.isGuildAdmin('guild-1', 'owner-1'), true);
  assert.deepEqual(calls.map((call) => call.url.pathname), ['/api/v3/guild/view']);

  calls.length = 0;
  assert.equal(await client.isGuildAdmin('guild-1', 'admin-1'), true);
  assert.deepEqual(calls.map((call) => call.url.pathname), [
    '/api/v3/guild/view',
    '/api/v3/guild/user-list',
    '/api/v3/guild-role/list',
  ]);
  assert.ok(calls.every((call) => call.authorization === 'Bot fixture'));
  assert.equal(calls[1]?.url.searchParams.get('filter_user_id'), 'admin-1');
});

test('denies non-admin members and never trusts cached event roles', async () => {
  let rolePermission = 2048;
  let requestCount = 0;
  const fetcher: typeof fetch = async (input) => {
    requestCount += 1;
    const url = new URL(String(input));
    if (url.pathname.endsWith('/guild/view')) return response({ id: 'guild-1', user_id: 'owner-1' });
    if (url.pathname.endsWith('/guild/user-list')) return response({ items: [{ id: 'member-1', roles: [702] }] });
    if (url.pathname.endsWith('/guild-role/list')) return response({ items: [{ role_id: 702, permissions: rolePermission }], meta: { page_total: 1 } });
    throw new Error('unexpected_kook_endpoint');
  };
  const client = new KookPermissionClient({ token: 'fixture', fetcher });

  assert.equal(await client.isGuildAdmin('guild-1', 'member-1'), false);
  const firstRequestCount = requestCount;
  rolePermission = 1;
  assert.equal(await client.isGuildAdmin('guild-1', 'member-1'), true);
  assert.equal(requestCount, firstRequestCount * 2);
});

test('fails closed on API and malformed permission responses without echoing credentials', async () => {
  const unavailable = new KookPermissionClient({ token: 'fixture', fetcher: async () => new Response('denied', { status: 503 }) });
  await assert.rejects(unavailable.isGuildAdmin('guild-1', 'member-1'), /kook_permission_api_http_503/u);
  await assert.rejects(unavailable.isGuildAdmin('guild-1', 'member-1'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes('fixture'), false);
    return true;
  });

  const invalidRoles = new KookPermissionClient({
    token: 'fixture',
    fetcher: async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/guild/view')) return response({ id: 'guild-1', user_id: 'owner-1' });
      if (url.pathname.endsWith('/guild/user-list')) return response({ items: [{ id: 'member-1', roles: [702] }] });
      return response({ items: [{ role_id: 702, permissions: 'not-a-bitset' }], meta: { page_total: 1 } });
    },
  });
  await assert.rejects(invalidRoles.isGuildAdmin('guild-1', 'member-1'), /kook_permission_roles_invalid/u);
});
