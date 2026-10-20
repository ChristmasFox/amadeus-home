import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateOwnerNotificationPresentation, type PubgStatsPresentation } from '@agent/presentation';
import { reviewShareOpen, reviewShareTokenHash, type NormalizedMatch, type ReviewShareRecord, type SessionReviewRecord, type TelemetryFeatureKey, type TelemetryFeatureRecord } from '@agent/pubg-domain';
import { nextDailyRunAt } from '../src/daily-review-service.js';
import {
  DAILY_REVIEW_FETCH_GRACE_MS,
  DAILY_REVIEW_LINK,
  DAILY_REVIEW_MAX_ATTEMPTS,
  DAILY_REVIEW_RETRY_MS,
  nextDailyReviewAt,
  runDailyReview,
  type DailyReviewInput,
  type DailyReviewStore,
  type DailyStats,
} from '../src/daily-review.js';
import { groupSlug, loadReviewSubscription, type ReportGateway, type ReportSubscription } from '../src/session-review-delivery.js';

const MIN = 60_000;
const MEMBERS = ['a', 'b', 'c', 'd'];
const GROUP = '120363000000000001@g.us';
const TZ = 'Asia/Shanghai';
/** Business day 2026-10-18 runs 2026-10-17T22:00Z to 2026-10-18T22:00Z; its review is due 2026-10-19T01:30Z (09:30). */
const DAY_START = Date.parse('2026-10-17T22:00:00Z');
const DAY_END = Date.parse('2026-10-18T22:00:00Z');
const DUE = new Date('2026-10-19T01:30:00Z');
const KEY = 'pubg-daily:squad:2026-10-18';

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

class FakeStore implements DailyReviewStore {
  records = new Map<string, SessionReviewRecord>();
  meta = new Map<string, string>();
  shares: ReviewShareRecord[] = [];
  constructor(public matches: NormalizedMatch[], public fetchedMs: number | null) {}
  listMatches(options: { fromMs?: number }) { return this.matches.filter((item) => item.timestamp >= (options.fromMs ?? 0)); }
  async get(key: TelemetryFeatureKey) { return { ...key, facts: { fights: [] }, createdAt: '' } as unknown as TelemetryFeatureRecord; }
  getSessionReview(_squad: string, key: string) { return this.records.get(key) ?? null; }
  putSessionReview(record: SessionReviewRecord) { this.records.set(record.sessionKey, record); }
  getSessionReviewMeta(key: string) { return this.meta.get(key) ?? null; }
  setSessionReviewMeta(key: string, value: string) { this.meta.set(key, value); }
  latestPrefetchFinishedMs() { return this.fetchedMs; }
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
const shareToken = (message: unknown) => String(message).match(/^🔗 https:\/\/pubg\.example\.test\/s\/([A-Za-z0-9_-]{22})$/mu)?.[1];

class FakeGateway implements ReportGateway {
  sent: Array<Record<string, unknown>> = [];
  failSends = 0;
  failDirectory = 0;
  directoryScopes: unknown[] = [];
  constructor(public groups: Array<Record<string, unknown>>) {}
  async request(method: string, params: Record<string, unknown>, options?: Record<string, unknown>) {
    if (method === 'conversations.list') {
      this.directoryScopes.push(options?.scopes);
      if (this.failDirectory > 0) { this.failDirectory -= 1; throw new Error('gateway not ready'); }
      return { conversations: this.groups };
    }
    if (method === 'send') {
      if (this.failSends > 0) { this.failSends -= 1; throw new Error('No active WhatsApp Web listener'); }
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

const STATS: PubgStatsPresentation = {
  type: 'pubg_stats', status: 'ok', dataUpdatedAt: '2026-10-19T01:00:00.000Z', headline: '指定时间', operation: 'report', groupBy: 'player',
  summary: '共 3 场。', evidenceRefs: ['m1'], sourceRange: { from: new Date(DAY_START).toISOString(), to: new Date(DAY_END).toISOString() },
  rows: [
    { label: 'Name_a', position: 1, evidenceRefs: [], values: { matches: 3, kills: 2, assists: 4, damage: 450.26, avg_damage: 150.08, kd: 0.6667, deaths: 3, wins: 0, top10: 2, dbnos: 3, revives: 2 } },
    { label: 'Name_b', position: 2, evidenceRefs: [], values: { matches: 3, kills: 6, assists: 1, damage: 1210.5, avg_damage: 403.5, kd: 2, deaths: 3, wins: 0, top10: 2, dbnos: 7, revives: 0 } },
  ],
};

function setup(overrides: Partial<DailyReviewInput> = {}, now = new Date(DUE.getTime() + MIN)) {
  // Three matches across the day: hours apart, so the old 40-minute gap would have made three reviews out of them.
  const matches = [match('m1', DAY_START + 60 * MIN, 3), match('m2', DAY_START + 9 * 60 * MIN, 7), match('m3', DAY_END - 30 * MIN, 2)];
  const store = new FakeStore(matches, DAY_END + 30 * MIN);
  store.setSessionReviewMeta('daily-enabled-at:squad', new Date(DAY_START - 24 * 60 * MIN).toISOString());
  const gateway = new FakeGateway([GROUP_ROW]);
  const statsCalls: Array<{ startMs: number; endMs: number }> = [];
  const input: DailyReviewInput = {
    store, gateway, mode: 'deliver', subscription: SUBSCRIPTION, timezone: TZ, now, shareBaseUrl: SHARE_BASE,
    team: { id: 'squad', label: '小队', tenantId: 'lab', memberIds: MEMBERS, playerNames: new Map(MEMBERS.map((id) => [id, `Name_${id}`])) },
    stats: async (window): Promise<DailyStats> => { statsCalls.push(window); return { presentation: STATS, displayText: '🏆 指定时间\n\n团队合计：8 杀', dataUpdatedAt: STATS.dataUpdatedAt }; },
    ...overrides,
  };
  return { store, gateway, input, statsCalls };
}

test('the review runs at 09:30 Shanghai time every day, sooner only to retry an unfinished day', () => {
  assert.equal(nextDailyReviewAt(new Date('2026-10-19T00:00:00Z'), TZ).toISOString(), DUE.toISOString()); // 08:00 → 09:30 today
  assert.equal(nextDailyReviewAt(DUE, TZ).toISOString(), '2026-10-20T01:30:00.000Z'); // 09:30 itself → tomorrow
  assert.equal(nextDailyReviewAt(new Date('2026-10-19T02:05:00Z'), TZ).toISOString(), '2026-10-20T01:30:00.000Z');
  const now = new Date('2026-10-19T02:05:00Z');
  const day = { businessDay: '2026-10-18', sessionKey: KEY };
  assert.equal(nextDailyRunAt({ ...day, result: 'sent' }, now, TZ).toISOString(), '2026-10-20T01:30:00.000Z');
  assert.equal(nextDailyRunAt({ ...day, result: 'pending_delivery' }, now, TZ).getTime(), now.getTime() + DAILY_REVIEW_RETRY_MS);
  assert.equal(nextDailyRunAt({ ...day, result: 'waiting', detail: 'fetch_not_after_day' }, now, TZ).getTime(), now.getTime() + DAILY_REVIEW_RETRY_MS);
  assert.equal(nextDailyRunAt({ ...day, result: 'waiting', detail: 'not_due' }, new Date('2026-10-19T00:00:00Z'), TZ).toISOString(), DUE.toISOString());
});

test('one message for the whole business day: rich 战绩 card, Kurisu voice, trend, and the share link', async () => {
  const { store, gateway, input, statsCalls } = setup();
  assert.deepEqual(await runDailyReview(input), { businessDay: '2026-10-18', sessionKey: KEY, result: 'sent', detail: 'group:未来ガジェット研究所' });
  assert.deepEqual(statsCalls.map((window) => [window.startMs, window.endMs]), [[DAY_START, DAY_END]]);
  assert.equal(gateway.sent.length, 1);
  assert.deepEqual(gateway.directoryScopes, [['operator.admin']]);
  const sent = gateway.sent[0]!;
  assert.deepEqual([sent.to, sent.accountId, sent.idempotencyKey], [GROUP, 'secondary', `${KEY}:whatsapp:secondary:${GROUP}`]);
  const text = String(sent.message);
  assert.match(text, /^\*🌅 每日复盘 · 10月18日星期日\*/u);
  assert.match(text, /10\/18 06:00 → 10\/19 06:00 · 3 场排位/u);
  // The same card a 昨日战绩 query gets: medals by K/D, titles, rounded localized metrics, team totals; WhatsApp bold.
  assert.match(text, /🏆 10月18日星期日 全天战报/u);
  assert.match(text, /🥇 \*Name_b\*/u);
  assert.match(text, /🥈 \*Name_a\*/u);
  assert.match(text, /KD 2\.00|KD 2\b/u);
  assert.match(text, /团队合计/u);
  assert.doesNotMatch(text, /\*\*/u);
  // Key facts are WhatsApp bold: section titles, names, K/D, top-ten placements, the day's totals, best and worst match.
  assert.match(text, /^\*🏆 10月18日星期日 全天战报\*$/mu);
  assert.match(text, /\*红莉栖点评\*\n\*Name_b\*:\*K\/D 2\.00\* 全队最高/u);
  assert.match(text, /\*🎮 全天走势\*\n名次 \*#3\* \*#7\* \*#2\*/u);
  assert.match(text, /场均名次 \*4\.0\* · \*吃鸡 0\* · \*前十 3\* · 击倒 \*12\*/u);
  assert.match(text, /^\*最好一局 #2 艾伦格\* · /mu);
  assert.match(text, /昨天一共 \*3 场排位\*/u);
  assert.match(text, /\*结论\*/u);
  // Ends with the share page link; the page is the 战绩 share of exactly that day's matches.
  const token = shareToken(text);
  assert.ok(token, text);
  const share = store.getReviewShare(reviewShareTokenHash(token!))!;
  assert.deepEqual([share.kind, share.sessionKey, share.matchIds], ['query', KEY, ['m1', 'm2', 'm3']]);
  const page = JSON.parse(share.presentationJson);
  assert.deepEqual([page.type, page.players.map((player: { label: string }) => player.label)], ['pubg_query_share', ['Name_a', 'Name_b']]);
  // The ledger keeps the message with a placeholder, never the token.
  const record = store.records.get(KEY)!;
  assert.equal(record.status, 'sent');
  assert.ok(record.message!.includes(DAILY_REVIEW_LINK));
  assert.ok(!JSON.stringify([...store.records.values()]).includes(token!));
  // Once a day: running again (the 10-minute retry, a restart) sends nothing more.
  assert.equal((await runDailyReview(input)).result, 'done');
  assert.equal(gateway.sent.length, 1);
});

test('nothing runs before 09:30, and switching it on after a day was due never backfills that day', async () => {
  const early = setup({}, new Date(DUE.getTime() - MIN));
  // At 09:29 the latest complete day is still 2026-10-18 and it is not due yet.
  assert.deepEqual([(await runDailyReview(early.input)).result, early.gateway.sent.length], ['waiting', 0]);
  const late = setup({}, new Date(DUE.getTime() + 30 * MIN));
  late.store.meta.clear();
  assert.deepEqual(await runDailyReview(late.input), { businessDay: '2026-10-18', sessionKey: KEY, result: 'skipped', detail: 'before_enable' });
  assert.equal(late.gateway.sent.length, 0);
  assert.equal(late.store.meta.get('daily-enabled-at:squad'), late.input.now.toISOString());
});

test('a day without squad matches is recorded and sends nothing', async () => {
  const { store, gateway, input } = setup();
  store.matches = [match('old', DAY_START - 60 * MIN, 4)];
  assert.deepEqual([(await runDailyReview(input)).result, gateway.sent.length], ['skipped', 0]);
  assert.equal(store.records.get(KEY)?.detail, 'no_matches');
});

test('without a fetch after the day ended it waits, then goes ahead once the grace has passed', async () => {
  const { store, gateway, input } = setup();
  store.fetchedMs = DAY_END - 5 * MIN;
  assert.deepEqual(await runDailyReview(input), { businessDay: '2026-10-18', sessionKey: KEY, result: 'waiting', detail: 'fetch_not_after_day' });
  assert.equal(gateway.sent.length, 0);
  assert.equal((await runDailyReview({ ...input, now: new Date(DUE.getTime() + DAILY_REVIEW_FETCH_GRACE_MS) })).result, 'sent');
});

test('without a share origin the review is held back for the owner, never sent bare', async () => {
  const outbox = mkdtempSync(join(tmpdir(), 'pubg-owner-outbox-'));
  try {
    const { gateway, input } = setup({ shareBaseUrl: undefined, ownerOutboxDir: outbox });
    delete (input as { shareBaseUrl?: string }).shareBaseUrl;
    assert.deepEqual([(await runDailyReview(input)).detail, gateway.sent.length], ['share_link_unavailable', 0]);
    assert.equal(readdirSync(outbox).filter((file) => file.endsWith('.pending.json')).length, 1);
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});

test('a failed send is retried with a fresh link, and the unsent link stops opening', async () => {
  const { store, gateway, input } = setup();
  gateway.failSends = 1;
  assert.equal((await runDailyReview(input)).result, 'pending_delivery');
  assert.match(store.records.get(KEY)!.detail!, /No active WhatsApp Web listener/u);
  const unsent = store.shares[0]!;
  assert.equal((await runDailyReview({ ...input, now: new Date(input.now.getTime() + DAILY_REVIEW_RETRY_MS) })).result, 'sent');
  assert.equal(reviewShareOpen(unsent, input.now), false);
  assert.equal(gateway.sent.length, 1);
  assert.ok(shareToken(gateway.sent[0]!.message));

  const failing = setup();
  failing.gateway.failSends = DAILY_REVIEW_MAX_ATTEMPTS;
  const results: string[] = [];
  for (let index = 0; index < DAILY_REVIEW_MAX_ATTEMPTS; index += 1) results.push((await runDailyReview(failing.input)).result);
  assert.deepEqual(results, ['pending_delivery', 'pending_delivery', 'pending_delivery', 'pending_delivery', 'blocked']);
});

test('a directory outage keeps the day pending, tells the owner once, and sends on recovery', async () => {
  const outbox = mkdtempSync(join(tmpdir(), 'pubg-owner-outbox-'));
  try {
    const { store, gateway, input } = setup({ ownerOutboxDir: outbox });
    gateway.failDirectory = DAILY_REVIEW_MAX_ATTEMPTS + 2;
    for (let index = 0; index < DAILY_REVIEW_MAX_ATTEMPTS + 2; index += 1) {
      assert.deepEqual((await runDailyReview(input)).detail, 'directory_unavailable: gateway not ready');
    }
    assert.equal(store.records.get(KEY)?.status, 'pending_delivery');
    const files = readdirSync(outbox).filter((file) => file.endsWith('.pending.json'));
    assert.equal(files.length, 1);
    const event = JSON.parse(readFileSync(join(outbox, files[0]!), 'utf8'));
    assert.equal(validateOwnerNotificationPresentation(event).valid, true);
    assert.deepEqual(event.facts.map((fact: { value: string }) => fact.value), ['directory_unavailable', 'gateway not ready']);
    assert.equal((await runDailyReview(input)).result, 'sent');
  } finally {
    rmSync(outbox, { recursive: true, force: true });
  }
});

for (const [name, rows, reason] of [
  ['a renamed group', [{ ...GROUP_ROW, label: 'whatsapp:g-别的群' }], 'group_name_mismatch'],
  ['a group the bot account is not in', [{ ...GROUP_ROW, accountId: 'default' }], 'bot_not_in_group'],
] as const) {
  test(`${name} blocks the day and tells the owner instead`, async () => {
    const outbox = mkdtempSync(join(tmpdir(), 'pubg-owner-outbox-'));
    try {
      const { store, gateway, input } = setup({ ownerOutboxDir: outbox });
      gateway.groups = [...rows];
      assert.deepEqual([(await runDailyReview(input)).result, gateway.sent.length], ['blocked', 0]);
      assert.equal(store.records.get(KEY)?.detail, reason);
      assert.equal(readdirSync(outbox).filter((file) => file.endsWith('.pending.json')).length, 1);
    } finally {
      rmSync(outbox, { recursive: true, force: true });
    }
  });
}

test('dry-run records the rendered message once and never sends', async () => {
  const { store, gateway, input } = setup({ mode: 'dry-run' });
  assert.equal((await runDailyReview(input)).result, 'dry_run');
  assert.match(store.records.get(KEY)!.message!, /每日复盘/u);
  assert.equal((await runDailyReview(input)).result, 'done');
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
