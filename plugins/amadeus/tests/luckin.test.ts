import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LuckinClient, LuckinError } from '../src/luckin/client.js';
import { LuckinAuthStore, senderFileId } from '../src/luckin/store.js';
import {
  DRAFT_TTL_MS, DraftBook, InboundSequence, luckinAuthStatus, luckinCancelOrder, luckinConfirmOrder, luckinDraftOrder, luckinOrderStatus, luckinSearchShops,
  isLuckinOutOfBandCall, type LuckinDeps,
} from '../src/luckin/tools.js';

const A = 'whatsapp:111000111';
const B = 'whatsapp:222000222';
const GROUP = 'agent:main:whatsapp:group:g1';
const TOKEN_A = 'token-for-a-0000';
const TOKEN_B = 'token-for-b-0000';

type Call = { token: string; name: string; args: Record<string, unknown> };

async function setup(options: { price?: () => number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'luckin-'));
  const store = new LuckinAuthStore(dir);
  const calls: Call[] = [];
  let time = Date.parse('2026-11-13T10:00:00Z');
  const client = {
    async callTool(token: string, name: string, args: Record<string, unknown>): Promise<unknown> {
      calls.push({ token, name, args });
      if (name === 'previewOrder') {
        return { discountPrice: options.price?.() ?? 16, totalInitialPrice: 16, privilegeMoney: 0, couponCodeList: ['c1'], aboutTime: 1778751420000,
          shopInfo: { deptId: 9, deptName: 'Store X', address: 'store addr', longitude: 116.1, latitude: 39.9, workTimeStart: '08:00', workTimeEnd: '20:00' },
          productInfoList: [{ name: 'Latte', amount: 1, additionDesc: 'iced', estimateTotalPrice: 16 }] };
      }
      if (name === 'createOrder') return { orderId: 7639308439653908490, orderIdStr: '7639308439653908490', needPay: true, discountPrice: 16, payOrderQrCodeUrl: 'https://x.lkcoffee.com/qr?token=secret-qr' };
      if (name === 'queryOrderDetailInfo') return { orderStatus: 10, orderStatusName: '待付款', orderPayAmount: 16, shopInfo: { deptName: 'Store X' }, takeMealCodeInfo: { code: '1234' }, orderCommodityList: [{ commodityName: 'Latte' }] };
      if (name === 'cancelOrder') return true;
      if (name === 'queryShopList') return [{ deptId: 9, deptName: 'Store X', address: 'a', distance: 1.2, workTimeStart: '08:00', workTimeEnd: '20:00' }];
      throw new Error(`unexpected ${name}`);
    },
  };
  const inbound = new InboundSequence();
  const qrRequests: string[] = [];
  const deps: LuckinDeps = { client, store, drafts: new DraftBook(), inbound, now: () => time, deliverQr: async (url) => { qrRequests.push(url); return { kind: 'attachment' }; } };
  const advance = (ms: number): void => { time += ms; };
  const message = (): void => inbound.note(GROUP);
  return { deps, store, calls, advance, message, qrRequests, dir };
}
const caller = (senderKey?: string, sessionKey = GROUP) => ({ ...(senderKey ? { senderKey } : {}), sessionKey });
const items = { deptId: 9, items: [{ productId: 1, skuCode: 'SP1-001', amount: 1 }] };
const record = (token: string) => ({ token, savedAt: '2026-11-13T00:00:00Z' });

test('an unauthorized sender gets the official steps and nothing reaches Luckin', async () => {
  const { deps, calls } = await setup();
  const result = await luckinDraftOrder(deps, caller(A), items) as { status: string; guide: { officialUrl: string } };
  assert.equal(result.status, 'not_authorized');
  assert.equal(result.guide.officialUrl, 'open.lkcoffee.com');
  assert.equal(calls.length, 0);
  assert.deepEqual(await luckinAuthStatus(deps, caller(A)), { status: 'ok', authorized: false, guide: result.guide });
  assert.equal(((await luckinDraftOrder(deps, caller(undefined), items)) as { reason: string }).reason, 'trusted_sender_metadata_unavailable');
});

test('each sender only ever uses their own token and cannot see the other\'s drafts or orders', async () => {
  const { deps, store, calls, message } = await setup();
  await store.write(A, record(TOKEN_A));
  await store.write(B, record(TOKEN_B));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  message();
  const confirmed = await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }) as { status: string; orderRef: string };
  assert.equal(confirmed.status, 'ok');
  assert.ok(calls.every((call) => call.token === TOKEN_A), 'only A\'s token was used');
  // B cannot read A's order by its reference, and the lookup never reaches Luckin for B.
  const before = calls.length;
  assert.deepEqual(await luckinOrderStatus(deps, caller(B), { orderRef: confirmed.orderRef }), { status: 'refused', reason: 'order_not_found_for_this_sender' });
  assert.deepEqual(await luckinCancelOrder(deps, caller(B), { orderRef: confirmed.orderRef }), { status: 'refused', reason: 'order_not_found_for_this_sender' });
  assert.equal(calls.length, before);
  assert.equal(((await luckinOrderStatus(deps, caller(A), { orderRef: confirmed.orderRef })) as { state: string }).state, '待付款');
});

test('another sender in the group cannot confirm a draft, the owner included', async () => {
  const { deps, store, calls, message } = await setup();
  await store.write(A, record(TOKEN_A));
  await store.write(B, record(TOKEN_B));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  message();
  const result = await luckinConfirmOrder(deps, caller(B), { draftId: draft.draftId });
  assert.deepEqual(result, { status: 'refused', reason: 'draft_belongs_to_another_sender' });
  assert.equal(calls.filter((call) => call.name === 'createOrder').length, 0);
  // The draft is untouched: its own sender can still confirm it.
  assert.equal(((await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId })) as { status: string }).status, 'ok');
});

test('a draft cannot be confirmed in the same turn that made it, nor from another conversation', async () => {
  const { deps, store, calls, message } = await setup();
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  assert.deepEqual(await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }), { status: 'refused', reason: 'needs_a_new_message_from_the_sender_to_confirm' });
  message();
  assert.deepEqual(await luckinConfirmOrder(deps, caller(A, 'agent:main:whatsapp:direct:a'), { draftId: draft.draftId }), { status: 'refused', reason: 'draft_belongs_to_another_conversation' });
  assert.equal(calls.filter((call) => call.name === 'createOrder').length, 0);
});

test('a draft confirms once only', async () => {
  const { deps, store, calls, message } = await setup();
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  message();
  assert.equal(((await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId })) as { status: string }).status, 'ok');
  message();
  assert.deepEqual(await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }), { status: 'refused', reason: 'draft_already_used' });
  assert.equal(calls.filter((call) => call.name === 'createOrder').length, 1);
});

test('an expired draft is refused', async () => {
  const { deps, store, calls, message, advance } = await setup();
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  message();
  advance(DRAFT_TTL_MS + 1000);
  assert.deepEqual(await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }), { status: 'refused', reason: 'draft_expired' });
  assert.equal(calls.filter((call) => call.name === 'createOrder').length, 0);
});

test('a changed price voids the old confirmation and asks again with the new draft', async () => {
  let price = 16;
  const { deps, store, calls, message, qrRequests } = await setup({ price: () => price });
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  price = 18;
  message();
  const changed = await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }) as { status: string; draftId: string; changed: boolean; payablePrice: number };
  assert.equal(changed.status, 'draft');
  assert.equal(changed.changed, true);
  assert.equal(changed.payablePrice, 18);
  assert.notEqual(changed.draftId, draft.draftId);
  assert.equal(calls.filter((call) => call.name === 'createOrder').length, 0);
  assert.equal(qrRequests.length, 0);
  // The new draft needs a message of its own before it can be confirmed.
  assert.equal(((await luckinConfirmOrder(deps, caller(A), { draftId: changed.draftId })) as { reason: string }).reason, 'needs_a_new_message_from_the_sender_to_confirm');
  message();
  assert.equal(((await luckinConfirmOrder(deps, caller(A), { draftId: changed.draftId })) as { status: string }).status, 'ok');
});

test('creating the order uses the pickup store\'s own coordinates, never pays, and hands the QR to the delivery path only', async () => {
  const { deps, store, calls, message, qrRequests } = await setup();
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string; fulfilment: string };
  assert.match(draft.fulfilment, /自取/u);
  message();
  const result = await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }) as Record<string, unknown>;
  const create = calls.find((call) => call.name === 'createOrder')!;
  assert.equal(create.args.longitude, 116.1);
  assert.equal(create.args.latitude, 39.9);
  assert.deepEqual(create.args.couponCodeList, ['c1']);
  assert.equal(qrRequests.length, 1);
  assert.equal(result.orderRef, '908490');
  assert.ok(Array.isArray(result.deliveryAttachments));
  // Neither the QR link nor the long order id is in the text the model sees.
  const shown = JSON.stringify(result);
  assert.ok(!shown.includes('secret-qr') && !shown.includes('7639308439653908490'));
  assert.ok(!calls.some((call) => /pay/iu.test(call.name) && call.name !== 'previewOrder'));
});

test('only unpaid orders can be cancelled', async () => {
  const { deps, store, calls, message } = await setup();
  await store.write(A, record(TOKEN_A));
  message();
  const draft = await luckinDraftOrder(deps, caller(A), items) as { draftId: string };
  message();
  const { orderRef } = await luckinConfirmOrder(deps, caller(A), { draftId: draft.draftId }) as { orderRef: string };
  assert.deepEqual(await luckinCancelOrder(deps, caller(A), { orderRef }), { status: 'ok', orderRef, cancelled: true });
  assert.equal(calls.filter((call) => call.name === 'cancelOrder').length, 1);
});

test('an expired or rejected token sends the sender back to the official authorization', async () => {
  const { deps, store } = await setup();
  await store.write(A, { token: TOKEN_A, savedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' });
  assert.equal(((await luckinSearchShops(deps, caller(A), { longitude: 1, latitude: 1 })) as { reason: string }).reason, 'expired');
  const rejecting: LuckinDeps = { ...deps, client: { callTool: async () => { throw new LuckinError('unauthorized', 'luckin_unauthorized', 401); } } };
  await store.write(B, record(TOKEN_B));
  assert.equal(((await luckinSearchShops(rejecting, caller(B), { longitude: 1, latitude: 1 })) as { status: string }).status, 'not_authorized');
});

test('authorization files are named by a hash, readable only by the service, and keep the token out of the tool results', async () => {
  const { deps, store, dir } = await setup();
  await store.write(A, record(TOKEN_A));
  const file = join(dir, `${senderFileId(A)}.auth.json`);
  assert.ok(!file.includes('111000111'));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.match(await readFile(file, 'utf8'), new RegExp(TOKEN_A));
  const status = JSON.stringify(await luckinAuthStatus(deps, caller(A)));
  assert.ok(!status.includes(TOKEN_A));
});

test('the MCP client speaks the official protocol, sends the Bearer header, and refuses non-official hosts', async () => {
  const seen: Array<{ url: string; headers: Record<string, string>; body: { method?: string; params?: { name?: string; capabilities?: unknown } } }> = [];
  const fetcher = async (url: string, init: { headers: Record<string, string>; body: string }): Promise<Response> => {
    const body = JSON.parse(init.body) as { method?: string; id?: number };
    seen.push({ url, headers: init.headers, body });
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: JSON.stringify({ code: 0, success: true, data: [{ deptId: 1 }] }) }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const client = new LuckinClient({ fetch: fetcher });
  assert.deepEqual(await client.callTool('tok', 'queryShopList', { longitude: 1, latitude: 2 }), [{ deptId: 1 }]);
  assert.ok(seen.every((entry) => entry.headers.Authorization === 'Bearer tok' && entry.url === 'https://gwmcp.lkcoffee.com/order/user/mcp'));
  assert.deepEqual(seen[0]!.body.params?.capabilities, {});
  assert.equal(seen[2]!.headers['Mcp-Session-Id'], 's1');
  assert.throws(() => new LuckinClient({ url: 'https://example.com/mcp' }));
  assert.throws(() => new LuckinClient({ url: 'http://gwmcp.lkcoffee.com/mcp' }));
  const denied = new LuckinClient({ fetch: async () => new Response('no', { status: 401 }) });
  await assert.rejects(denied.callTool('bad', 'queryShopList', {}), (error: unknown) => error instanceof LuckinError && error.reason === 'unauthorized');
});

test('raw shell, fetch or file access to Luckin, its token files or an IP lookup is blocked; native tools and ordinary calls are not', () => {
  assert.equal(isLuckinOutOfBandCall('exec', { command: 'curl -H "Authorization: Bearer x" https://gwmcp.lkcoffee.com/order/user/mcp' }), true);
  assert.equal(isLuckinOutOfBandCall('exec', { command: 'cat ~/.my-coffee/LUCKIN_MCP_TOKEN' }), true);
  assert.equal(isLuckinOutOfBandCall('web_fetch', { url: 'https://ipinfo.io/json' }), true);
  assert.equal(isLuckinOutOfBandCall('read', { path: '/data/luckin-auth/x.auth.json' }), true);
  assert.equal(isLuckinOutOfBandCall('exec', { command: 'ls /tmp' }), false);
  assert.equal(isLuckinOutOfBandCall('luckin_draft_order', { deptId: 1 }), false);
});
