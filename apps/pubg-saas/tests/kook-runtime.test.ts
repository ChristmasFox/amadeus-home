import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { KookApplicationRuntime, migratePublicDatabase, type KookGatewaySocket, type KookGatewaySocketEvent } from '../src/index.js';
const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;
class FixtureSocket implements KookGatewaySocket {
  private listeners = new Map<string, Array<(event: KookGatewaySocketEvent) => void>>();
  addEventListener(type: string, listener: (event: KookGatewaySocketEvent) => void) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }
  send(_data: string) { }
  close() { this.emit('close', {}); }
  open() { this.emit('open', {}); }
  frame(value: unknown) { this.emit('message', { data: JSON.stringify(value) }); }
  private emit(type: string, event: KookGatewaySocketEvent) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event);
  }
}
async function waitFor(check: () => Promise<boolean> | boolean, label: string) {
  for (let i = 0; i < 250; i++) {
    if (await check())
      return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out: ${label}`);
}
test('runtime commits gateway ingress ahead of slow work, routes group/DM/button replies, and drains on shutdown', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 8 });
  const suffix = randomUUID(), bot = `runtime-${suffix}`, tenant = `tenant-${suffix}`, team = `team-${suffix}`, guild = `guild-${suffix}`, channel = `channel-${suffix}`, user = `actor-${suffix}`;
  const socket = new FixtureSocket();
  let connected = false;
  let handled = 0;
  let unblock: () => void = () => { };
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  const requests: Array<{
    path: string;
    body: URLSearchParams;
  }> = [];
  const errors: string[] = [];
  const abort = new AbortController();
  let run: Promise<void> | null = null;
  try {
    await migratePublicDatabase(pool);
    await pool.query("INSERT INTO tenants(tenant_id,platform,bot_account_id,guild_id) VALUES ($1,'kook',$2,$3)", [tenant, bot, guild]);
    await pool.query("INSERT INTO teams(tenant_id,team_id,label,pubg_shard) VALUES ($1,$2,'runtime fixture','steam')", [tenant, team]);
    await pool.query("INSERT INTO channel_bindings(tenant_id,platform,bot_account_id,channel_id,team_id,bound_by_user_id) VALUES ($1,'kook',$2,$3,$4,$5)", [tenant, bot, channel, team, user]);
    const runtime = new KookApplicationRuntime({
      pool, botAccountId: bot, token: 'fixture-only', pollMs: 5, dailyMessageBudget: 3, onError: code => errors.push(code),
      socketFactory: () => { connected = true; return socket; },
      fetcher: async (input, init) => {
        const url = new URL(String(input));
        assert.equal(url.origin, 'https://www.kookapp.cn');
        if (url.pathname === '/api/v3/gateway/index')
          return new Response(JSON.stringify({ code: 0, data: { url: 'wss://gateway.kookapp.cn/gateway?token=fixture' } }));
        requests.push({ path: url.pathname, body: init?.body as URLSearchParams });
        return new Response(JSON.stringify({ code: 0, data: { msg_id: `sent-${requests.length}` } }));
      },
      handler: async (job, signal) => {
        assert.equal(signal.aborted, false);
        handled += 1;
        if (job.request.kind === 'group') {
          assert.deepEqual(job.boundTeam, { tenantId: tenant, teamId: team });
          await blocked;
        }
        return { type: 'text', content: `reply ${job.request.kind}` };
      },
    });
    run = runtime.run(abort.signal);
    await assert.rejects(runtime.run(abort.signal), /kook_runtime_already_running/u);
    await waitFor(() => connected, 'fixture socket');
    socket.open();
    socket.frame({ s: 1, d: { code: 0, session_id: `session-${suffix}` } });
    const group = { type: 1, channel_type: 'GROUP', target_id: channel, author_id: user, content: '/pubg status', msg_id: `group-${suffix}`, msg_timestamp: Date.now(), extra: { guild_id: guild, channel_type: 1, author: { id: user, bot: false } } };
    socket.frame({ s: 0, sn: 1, d: group });
    socket.frame({ s: 0, sn: 2, d: { type: 1, channel_type: 'PERSON', target_id: bot, author_id: user, content: '/pubg claim', msg_id: `dm-${suffix}`, msg_timestamp: Date.now() } });
    socket.frame({ s: 0, sn: 3, d: { type: 255, channel_type: 'PERSON', msg_id: `click-${suffix}`, msg_timestamp: Date.now(), extra: { type: 'message_btn_click', body: { user_id: user, msg_id: 'original-card', target_id: channel, value: 'x'.repeat(43) } } } });
    await waitFor(async () => Number((await pool.query('SELECT last_sn FROM kook_gateway_state WHERE bot_account_id=$1', [bot])).rows[0]?.last_sn) === 3, 'durable sequence while handler blocked');
    assert.equal(handled, 1);
    assert.equal(requests.length, 0);
    unblock();
    await waitFor(() => requests.length === 3, 'outbox sends');
    const groupSend = requests.find(item => item.path === '/api/v3/message/create');
    assert.ok(groupSend);
    assert.equal(groupSend.body.get('target_id'), channel);
    assert.equal(groupSend.body.get('quote'), group.msg_id);
    const directSends = requests.filter(item => item.path === '/api/v3/direct-message/create');
    assert.equal(directSends.length, 2);
    assert.ok(directSends.every(item => item.body.get('target_id') === user));
    assert.equal(directSends.find(item => item.body.get('content') === 'reply button')?.body.has('quote'), false);
    socket.frame({ s: 0, sn: 4, d: group }); // provider replay with another sequence, same source message
    await waitFor(async () => Number((await pool.query('SELECT last_sn FROM kook_gateway_state WHERE bot_account_id=$1', [bot])).rows[0]?.last_sn) === 4, 'replayed event ack');
    socket.frame({ s: 0, sn: 5, d: { type: 1, channel_type: 'PERSON', target_id: bot, author_id: user, content: '/pubg status', msg_id: `dm-budget-${suffix}`, msg_timestamp: Date.now() } });
    await waitFor(async () => {
      const row = (await pool.query('SELECT status,last_error_code FROM message_outbox WHERE bot_account_id=$1 AND source_event_id=$2', [bot, `dm-budget-${suffix}`])).rows[0];
      return row?.status === 'retry' && row.last_error_code === 'kook_message_daily_budget_exhausted';
    }, 'outbox defers when the durable daily send budget is exhausted');
    assert.equal(Number((await pool.query('SELECT used_count FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot])).rows[0]?.used_count), 3);
    assert.equal(requests.length, 3);
    abort.abort();
    await run;
    assert.equal(handled, 4);
    assert.equal(requests.length, 3);
    assert.deepEqual(errors, []);
    assert.equal((await pool.query('SELECT 1 FROM kook_ingress_events WHERE bot_account_id=$1 AND event_json IS NOT NULL', [bot])).rowCount, 0);
  }
  finally {
    unblock();
    abort.abort();
    if (run)
      await run.catch(() => undefined);
    await pool.query('DELETE FROM message_outbox WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_message_daily_reservations WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_message_daily_usage WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_ingress_events WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM kook_gateway_state WHERE bot_account_id=$1', [bot]);
    await pool.query('DELETE FROM tenants WHERE bot_account_id=$1', [bot]);
    await pool.end();
  }
});
