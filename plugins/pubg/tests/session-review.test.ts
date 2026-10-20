import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateOwnerNotificationPresentation } from '@agent/presentation';
import { reviewShareOpen, reviewShareTokenHash, SESSION_GAP_MS, type NormalizedMatch, type ReviewShareRecord, type SessionReviewRecord, type TelemetryFeatureKey, type TelemetryFeatureRecord } from '@agent/pubg-domain';
import { groupSlug, loadReviewSubscription, type ReportGateway, type ReportSubscription } from '../src/session-review-delivery.js';
import { REVIEW_SHARE_LINK, runSessionReviewCycle, SESSION_REVIEW_MAX_ATTEMPTS, type SessionReviewCycleInput, type SessionReviewStore } from '../src/session-review-worker.js';

const MIN = 60_000;
const START = Date.parse('2026-10-18T12:00:00Z');
const MEMBERS = ['a', 'b', 'c', 'd'];
const GROUP = '120363000000000001@g.us';

function match(id: string, at: number, rank: number): NormalizedMatch {
  return {
    schemaVersion: 1, matchId: id, shard: 'steam', createdAt: new Date(at).toISOString(), timestamp: at, matchType: 'competitive', gameMode: 'squad',
    isCompetitive: true, mapName: 'Baltic_Main', duration: 25 * 60, patchVersion: '1',
    players: MEMBERS.map((accountId) => ({
      accountId, playerName: `P_${accountId}`, displayName: `P_${accountId}`, rank, kills: 1, assists: 0, damage: 150, dbnos: 1, revives: 0,
      headshotKills: 0, survivalTime: 1400, longestKill: 0, deaths: 1, deathSemantics: 'explicit' as const,
    })),
  };
}

class FakeStore implements SessionReviewStore {
  records = new Map<string, SessionReviewRecord>();
  meta = new Map<string, string>();
  constructor(public matches: NormalizedMatch[], public fetchedMs: number | null) {}
  listMatches(options: { fromMs?: number }) { return this.matches.filter((item) => item.timestamp >= (options.fromMs ?? 0)); }
  async get(key: TelemetryFeatureKey) { return { ...key, facts: { fights: [] }, createdAt: '' } as unknown as TelemetryFeatureRecord; }
  getSessionReview(_squad: string, key: string) { return this.records.get(key) ?? null; }
  putSessionReview(record: SessionReviewRecord) { this.records.set(record.sessionKey, record); }
  getSessionReviewMeta(key: string) { return this.meta.get(key) ?? null; }
  setSessionReviewMeta(key: string, value: string) { this.meta.set(key, value); }
  latestPrefetchFinishedMs() { return this.fetchedMs; }
  shares: ReviewShareRecord[] = [];
  putReviewShare(record: ReviewShareRecord) { this.shares.push(record); }
  getReviewShare(hash: string) { return this.shares.find((share) => share.tokenHash === hash) ?? null; }
  latestReviewShare(_squad: string, key: string) { return this.shares.filter((share) => share.sessionKey === key).at(-1) ?? null; }
  revokeReviewShares(_squad: string, key: string, at: string) {
    let count = 0;
    for (const share of this.shares) if (share.sessionKey === key && share.revokedAt === null) { share.revokedAt = at; count += 1; }
    return count;
  }
}

const SHARE_BASE = 'https://pubg.example.test';
const shareToken = (message: unknown) => String(message).match(/https:\/\/pubg\.example\.test\/s\/([A-Za-z0-9_-]{22})$/mu)?.[1];

class FakeGateway implements ReportGateway {
  sent: Array<Record<string, unknown>> = [];
  failSends = 0;
  failDirectory = 0;
  constructor(public groups: Array<Record<string, unknown>>) {}
  async request(method: string, params: Record<string, unknown>) {
    if (method === 'conversations.list') {
      if (this.failDirectory > 0) { this.failDirectory -= 1; throw new Error('gateway not ready'); }
      return { conversations: this.groups };
    }
    if (method === 'send') {
      if (this.failSends > 0) { this.failSends -= 1; throw new Error('socket closed'); }
      this.sent.push(params);
      return { ok: true };
    }
    throw new Error(`unexpected ${method}`);
  }
}

const SUBSCRIPTION: ReportSubscription = {
  id: `whatsapp:secondary:${GROUP}`, tenantId: 'lab', squadId: 'squad', kind: 'session-review', channel: 'whatsapp',
  accountId: 'secondary', target: GROUP, expectedName: '未来ガジェット研究所', enabled: true,
};
const GROUP_ROW = { channel: 'whatsapp', accountId: 'secondary', kind: 'group', target: GROUP, label: 'whatsapp:g-未来ガジェット研究所', lastSeenAt: 2 };

/** Two matches that ended long enough ago, a fetch after the gap, and the feature switched on before they were played. */
function setup(overrides: Partial<SessionReviewCycleInput> = {}) {
  const matches = [match('m1', START, 3), match('m2', START + 30 * MIN, 7)];
  const lastEnd = START + 30 * MIN + 25 * MIN;
  const now = new Date(lastEnd + SESSION_GAP_MS + 30 * MIN);
  const store = new FakeStore(matches, lastEnd + SESSION_GAP_MS + 10 * MIN);
  store.setSessionReviewMeta('enabled-at:squad', new Date(START - 60 * MIN).toISOString());
  const gateway = new FakeGateway([GROUP_ROW]);
  const input: SessionReviewCycleInput = {
    store, gateway, mode: 'deliver', subscription: SUBSCRIPTION, timezone: 'Asia/Shanghai', now,
    team: { id: 'squad', label: '小队', tenantId: 'lab', memberIds: MEMBERS, playerNames: new Map(MEMBERS.map((id) => [id, `Name_${id}`])) },
    ...overrides,
  };
  return { store, gateway, input };
}

test('dry-run records the rendered review once and never sends', async () => {
  const { store, gateway, input } = setup({ mode: 'dry-run' });
  assert.deepEqual(await runSessionReviewCycle(input), [{ sessionKey: 'pubg-session:squad:m1', result: 'dry_run' }]);
  const record = store.records.get('pubg-session:squad:m1')!;
  assert.equal(record.status, 'dry_run');
  assert.match(record.message!, /\*🎮 时段复盘/u);
  assert.match(record.message!, /Name_a/u);
  assert.deepEqual(await runSessionReviewCycle(input), []);
  assert.equal(gateway.sent.length, 0);
});

test('the first run marks the switch-on time, so sessions from before are skipped instead of flooding the group', async () => {
  const { store, gateway, input } = setup();
  store.meta.clear();
  assert.deepEqual((await runSessionReviewCycle(input)).map((item) => item.result), ['skipped']);
  assert.equal(gateway.sent.length, 0);
  assert.equal(store.meta.get('enabled-at:squad'), input.now.toISOString());
});

test('a verified group gets exactly one review with a per-session idempotency key', async () => {
  const { store, gateway, input } = setup({ shareBaseUrl: SHARE_BASE });
  assert.deepEqual((await runSessionReviewCycle(input)).map((item) => item.result), ['sent']);
  assert.equal(gateway.sent.length, 1);
  assert.deepEqual(
    { channel: gateway.sent[0]!.channel, to: gateway.sent[0]!.to, accountId: gateway.sent[0]!.accountId, idempotencyKey: gateway.sent[0]!.idempotencyKey },
    { channel: 'whatsapp', to: GROUP, accountId: 'secondary', idempotencyKey: `pubg-session:squad:m1:whatsapp:secondary:${GROUP}` },
  );
  assert.equal(store.records.get('pubg-session:squad:m1')?.status, 'sent');
  // The delivered text links to a share of exactly these matches; the ledger keeps only the placeholder.
  const token = shareToken(gateway.sent[0]!.message);
  assert.ok(token, String(gateway.sent[0]!.message));
  const share = store.getReviewShare(reviewShareTokenHash(token!))!;
  assert.deepEqual([share.kind, share.matchIds], ['session', ['m1', 'm2']]);
  assert.equal(JSON.parse(share.presentationJson).type, 'pubg_session_review');
  assert.ok(store.records.get('pubg-session:squad:m1')!.message!.includes(REVIEW_SHARE_LINK));
  assert.ok(!JSON.stringify([...store.records.values(), store.shares]).includes(token!));
  await runSessionReviewCycle(input);
  assert.equal(gateway.sent.length, 1);
});

test('without a share origin the link line is left out entirely', async () => {
  const { gateway, input } = setup();
  await runSessionReviewCycle(input);
  assert.ok(!String(gateway.sent[0]!.message).includes('🔗'));
  assert.ok(!String(gateway.sent[0]!.message).includes(REVIEW_SHARE_LINK));
});

test('the session stays open while the gap has not passed or no fetch ran after it', async () => {
  const { store, gateway, input } = setup();
  store.fetchedMs = START;
  assert.deepEqual(await runSessionReviewCycle(input), [{ sessionKey: 'pubg-session:squad:m1', result: 'waiting', detail: 'fetch_not_after_gap' }]);
  assert.equal(gateway.sent.length, 0);
});

for (const [name, rows, reason] of [
  ['a renamed group', [{ ...GROUP_ROW, label: 'whatsapp:g-别的群' }], 'group_name_mismatch'],
  ['a group the bot account is not in', [{ ...GROUP_ROW, accountId: 'default' }], 'bot_not_in_group'],
] as const) {
  test(`${name} blocks delivery and tells the owner instead`, async () => {
    const outbox = mkdtempSync(join(tmpdir(), 'pubg-owner-outbox-'));
    try {
      const { store, gateway, input } = setup({ ownerOutboxDir: outbox });
      gateway.groups = [...rows];
      assert.deepEqual((await runSessionReviewCycle(input)).map((item) => [item.result, item.detail]), [['blocked', reason]]);
      assert.equal(gateway.sent.length, 0);
      assert.equal(store.records.get('pubg-session:squad:m1')?.status, 'blocked');
      const files = readdirSync(outbox).filter((file) => file.endsWith('.pending.json'));
      assert.equal(files.length, 1);
      const event = JSON.parse(readFileSync(join(outbox, files[0]!), 'utf8'));
      assert.equal(validateOwnerNotificationPresentation(event).valid, true);
      assert.equal(event.facts[0].value, reason);
    } finally {
      rmSync(outbox, { recursive: true, force: true });
    }
  });
}

test('a failed send is retried with the same text and a fresh link, and gives up after the attempt limit', async () => {
  const { store, gateway, input } = setup({ shareBaseUrl: SHARE_BASE });
  gateway.failSends = 1;
  assert.deepEqual((await runSessionReviewCycle(input)).map((item) => item.result), ['pending_delivery']);
  const first = store.records.get('pubg-session:squad:m1')!;
  const unsent = store.shares[0]!;
  assert.deepEqual((await runSessionReviewCycle(input)).map((item) => item.result), ['sent']);
  const token = shareToken(gateway.sent[0]!.message)!;
  assert.equal(String(gateway.sent[0]!.message).replace(`${SHARE_BASE}/s/${token}`, REVIEW_SHARE_LINK), first.message);
  // The link minted for the failed attempt never reached anyone and no longer opens.
  assert.equal(reviewShareOpen(unsent, input.now), false);
  assert.equal(reviewShareOpen(store.getReviewShare(reviewShareTokenHash(token))!, input.now), true);
  assert.equal(store.getReviewShare(reviewShareTokenHash(token))!.presentationJson, unsent.presentationJson);

  const failing = setup();
  failing.gateway.failSends = SESSION_REVIEW_MAX_ATTEMPTS;
  const results: string[] = [];
  for (let index = 0; index < SESSION_REVIEW_MAX_ATTEMPTS; index += 1) results.push(...(await runSessionReviewCycle(failing.input)).map((item) => item.result));
  assert.deepEqual(results, ['pending_delivery', 'pending_delivery', 'pending_delivery', 'pending_delivery', 'blocked']);
  assert.equal(failing.gateway.sent.length, 0);
});

test('a directory outage longer than the attempt limit keeps the review pending, tells the owner once, and sends on recovery', async () => {
  const outbox = mkdtempSync(join(tmpdir(), 'pubg-owner-outbox-'));
  try {
    const { store, gateway, input } = setup({ ownerOutboxDir: outbox });
    gateway.failDirectory = SESSION_REVIEW_MAX_ATTEMPTS + 2;
    for (let index = 0; index < SESSION_REVIEW_MAX_ATTEMPTS + 2; index += 1) {
      assert.deepEqual((await runSessionReviewCycle(input)).map((item) => [item.result, item.detail]), [['pending_delivery', 'directory_unavailable: gateway not ready']]);
    }
    assert.equal(store.records.get('pubg-session:squad:m1')?.attempts, SESSION_REVIEW_MAX_ATTEMPTS + 2);
    const files = readdirSync(outbox).filter((file) => file.endsWith('.pending.json'));
    assert.equal(files.length, 1);
    const event = JSON.parse(readFileSync(join(outbox, files[0]!), 'utf8'));
    assert.equal(validateOwnerNotificationPresentation(event).valid, true);
    assert.deepEqual(event.facts.map((fact: { value: string }) => fact.value), ['directory_unavailable', 'gateway not ready']);
    assert.equal(gateway.sent.length, 0);
    assert.deepEqual((await runSessionReviewCycle(input)).map((item) => item.result), ['sent']);
    assert.equal(gateway.sent.length, 1);
    assert.equal(store.records.get('pubg-session:squad:m1')?.status, 'sent');
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});

test('without a subscription nothing is sent', async () => {
  const { gateway, input } = setup({ subscription: null });
  assert.deepEqual((await runSessionReviewCycle(input)).map((item) => [item.result, item.detail]), [['blocked', 'no_subscription']]);
  assert.equal(gateway.sent.length, 0);
});

test('the subscription file must hold a WhatsApp group JID, and names compare in OpenClaw slug form', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pubg-review-target-'));
  try {
    const file = join(directory, 'target');
    writeFileSync(file, `${GROUP}\n`);
    const subscription = await loadReviewSubscription({ targetFile: file, expectedName: '未来ガジェット研究所', accountId: 'secondary', squadId: 'squad' });
    assert.equal(subscription.target, GROUP);
    writeFileSync(file, '+8613800000000\n');
    await assert.rejects(loadReviewSubscription({ targetFile: file, expectedName: 'x', accountId: 'secondary', squadId: 'squad' }), /group JID/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(groupSlug('whatsapp:g-van-der-linde-gang'), groupSlug('Van der Linde Gang'));
  assert.equal(groupSlug('whatsapp:g-未来ガジェット研究所'), groupSlug('未来ガジェット研究所'));
  assert.notEqual(groupSlug('whatsapp:g-别的群'), groupSlug('未来ガジェット研究所'));
});

test('the CLI never hands the image-private LD_LIBRARY_PATH to the gateway command', async () => {
  const { childEnvironment } = await import('../src/session-review-cli.js');
  const child = childEnvironment({ PATH: '/usr/bin', LD_LIBRARY_PATH: '/opt/amadeus-glibc/usr/lib', HOME: '/home/node' });
  assert.deepEqual(child, { PATH: '/usr/bin', HOME: '/home/node' });
});
