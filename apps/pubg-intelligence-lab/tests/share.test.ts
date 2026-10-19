import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { issueReviewShare, SqlitePubgRepository } from '@agent/pubg-domain';
import { RawTelemetryArchive } from '@agent/pubg-intelligence/archive';
import { CLIENT_DIST } from '../src/server/public-site.js';
import { startServer } from '../src/server/server.js';
import { aliasEnemies, SHARE_COOKIE } from '../src/server/share.js';
import { baseMatch, player, squadIds, telemetry } from './contract-fixture.js';

const HOST = 'pubg.example.com';

function writeVerifier(directory: string, password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  const path = join(directory, 'auth.json');
  writeFileSync(path, JSON.stringify({ format: 'amadeus-qwen-image-lab-scrypt-v1', salt: salt.toString('base64'), scrypt: { n: 32768, r: 8, p: 1, dklen: 64 }, digest: digest.toString('base64') }));
  chmodSync(path, 0o600);
  return path;
}

interface Reply { status: number; headers: Record<string, string | string[] | undefined>; body: string }

/** A request as the public proxy relays it: the public Host, optionally a cookie. */
function call(url: string, path: string, cookie?: string, method = 'GET'): Promise<Reply> {
  const target = new URL(path, url);
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: target.hostname, port: target.port, path: target.pathname + target.search, method, headers: { host: HOST, ...(cookie ? { cookie } : {}) } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('opposing teams become 敌方 A, B in the order they were met, and their account ids are dropped', () => {
  const aliased = aliasEnemies({
    fights: [{ start: 300, enemies: [{ team: '7' }] }, { start: 100, enemies: [{ team: '12' }, { team: '7' }] }],
    downs: [{ t: 120, attackerTeam: '12' }, { t: 500, attackerTeam: null }],
    enemies: [{ id: 'account.secret-1', team: '7', route: [[50, 1, 1]] }, { id: 'account.secret-2', team: '30', route: [[10, 2, 2]] }],
  });
  assert.deepEqual(aliased.fights.map((fight) => fight.enemies.map((enemy) => enemy.team)), [['敌方 B'], ['敌方 A', '敌方 B']]);
  assert.deepEqual(aliased.downs.map((down) => down.attackerTeam), ['敌方 A', null]);
  assert.deepEqual(aliased.enemies.map((enemy) => [enemy.id, enemy.team]), [['enemy-1', '敌方 B'], ['enemy-2', '敌方 C']]);
  assert.ok(!JSON.stringify(aliased).includes('account.secret'));
});

test('a share link opens only its own review and matches, without the password, and never the rest of the Lab', { skip: !existsSync(join(CLIENT_DIST, 'index.html')) && 'needs the built client (pnpm build)' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-share-'));
  const keys = ['PUBG_INTELLIGENCE_DB', 'PUBG_INTELLIGENCE_EXPERIMENT_DB', 'PUBG_TELEMETRY_ARCHIVE_DIR', 'PUBG_INTELLIGENCE_MAP_DIR', 'PUBG_INTELLIGENCE_STATE_DIR', 'PUBG_INTELLIGENCE_ANALYSIS_WORKERS', 'PORT', 'HOST', 'PUBG_INTELLIGENCE_AI_CONFIG_FILE', 'PUBG_INTELLIGENCE_PUBLIC_HOST', 'PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE', 'INTELLIGENCE_LAB_STATE_DIR', 'PUBG_INTELLIGENCE_REFRESH_SCRIPTS'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const source = join(root, 'source.sqlite');
    const repository = new SqlitePubgRepository(source);
    const matches = Array.from({ length: 4 }, (_, index) => ({
      ...baseMatch, matchId: `share-${index + 1}`, createdAt: new Date(Date.UTC(2026, 9, 18, 12 + index)).toISOString(),
      ...(index >= 2 ? { telemetryUrl: `https://telemetry-cdn.pubg.com/share-${index + 1}.json` } : {}),
      players: squadIds.map((id) => player(id, 3 + index)),
    }));
    repository.upsertMatches(matches);
    const now = new Date();
    const review = { type: 'pubg_session_review', startAt: matches[2]!.createdAt, endAt: matches[3]!.createdAt, timezone: 'Asia/Shanghai', matchCount: 2, headline: '名次比平时好,开局很稳。' };
    const session = issueReviewShare(repository, { squadId: 'squad', sessionKey: 'pubg-session:squad:share-3', matchIds: ['share-3', 'share-4'], presentationJson: JSON.stringify(review), now });
    const expired = issueReviewShare(repository, { squadId: 'squad', sessionKey: 'pubg-session:squad:share-1', matchIds: ['share-1'], presentationJson: '{}', now: new Date(now.getTime() - 8 * 24 * 60 * 60_000) });
    repository.close();
    const archiveDir = join(root, 'archive');
    const archive = new RawTelemetryArchive(archiveDir);
    for (const match of matches.slice(2)) await archive.write(match.matchId, Buffer.from(JSON.stringify(telemetry(match.createdAt))));
    Object.assign(process.env, {
      PUBG_INTELLIGENCE_DB: source, PUBG_INTELLIGENCE_EXPERIMENT_DB: join(root, 'experiments.sqlite'), PUBG_TELEMETRY_ARCHIVE_DIR: archiveDir, PUBG_INTELLIGENCE_MAP_DIR: join(root, 'maps'),
      PUBG_INTELLIGENCE_STATE_DIR: join(root, 'state'), INTELLIGENCE_LAB_STATE_DIR: join(root, 'snapshot-state'), PUBG_INTELLIGENCE_ANALYSIS_WORKERS: '1', PORT: '0', HOST: '127.0.0.1',
      PUBG_INTELLIGENCE_AI_CONFIG_FILE: join(root, 'no-ai.json'), PUBG_INTELLIGENCE_PUBLIC_HOST: HOST, PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE: writeVerifier(root, 'owner-pass'),
      // Never start the real snapshot script (it would restart the live page).
      PUBG_INTELLIGENCE_REFRESH_SCRIPTS: 'off',
    });
    server = await startServer();
    const url = server.url;

    // Without anything the public site is the login page, and the share API is closed.
    assert.match((await call(url, '/')).body, /password/u);
    assert.equal((await call(url, '/api/share/view')).status, 401);

    // The link sets a share-only cookie and serves the page shell with the review in its preview tags.
    const opened = await call(url, `/s/${session.token}`);
    assert.equal(opened.status, 200);
    assert.match(opened.body, /<title>时段复盘 · 10\/18 · 2 场排位<\/title>/u);
    assert.match(opened.body, /og:description" content="名次比平时好,开局很稳。"/u);
    assert.equal(opened.headers['x-robots-tag'], 'noindex, nofollow');
    const setCookie = String(opened.headers['set-cookie']);
    assert.match(setCookie, new RegExp(`^${SHARE_COOKIE}=${session.token}; Path=/; Max-Age=\\d+; HttpOnly; SameSite=Strict; Secure$`, 'u'));
    const cookie = `${SHARE_COOKIE}=${session.token}`;

    const view = JSON.parse((await call(url, '/api/share/view', cookie)).body) as { kind: string; review: { headline: string }; matches: Array<{ matchId: string; available: boolean; placement: number }> };
    assert.equal(view.kind, 'session');
    assert.equal(view.review.headline, '名次比平时好,开局很稳。');
    assert.deepEqual(view.matches.map((match) => [match.matchId, match.available, match.placement]), [['share-3', true, 5], ['share-4', true, 6]]);

    const storyReply = await call(url, '/api/share/matches/share-4/story', cookie);
    const story = JSON.parse(storyReply.body) as { available: boolean; story: { enemies: Array<{ id: string; team: string }>; downs: Array<{ attackerTeam: string | null }>; fights: Array<{ enemies: Array<{ team: string }> }> } };
    assert.equal(story.available, true);
    const teams = [...story.story.downs.map((down) => down.attackerTeam), ...story.story.fights.flatMap((fight) => fight.enemies.map((enemy) => enemy.team)), ...story.story.enemies.map((enemy) => enemy.team)]
      .filter((team): team is string => team !== null);
    assert.ok(teams.length > 0, 'the fixture has opposing teams in downs and fights');
    assert.ok(teams.every((team) => /^敌方 [A-Z]/u.test(team)), teams.join());
    assert.ok(story.story.enemies.every((enemy) => enemy.id.startsWith('enemy-')));
    assert.ok(!/"e[12]"|account\./u.test(storyReply.body), 'no opposing account ids leak');
    assert.equal((await call(url, '/share', cookie)).status, 200);

    // Matches outside the share, and the rest of the API, stay closed to the share cookie.
    assert.equal((await call(url, '/api/share/matches/share-1/story', cookie)).status, 404);
    for (const path of ['/api/bootstrap', '/api/matches', '/api/matches/share-3/story', '/api/analytics/performance', '/api/refresh']) {
      assert.equal((await call(url, path, cookie)).status, 403, path);
    }
    assert.equal((await call(url, '/api/refresh', cookie, 'POST')).status, 403);
    assert.equal((await call(url, '/api/research', cookie, 'POST')).status, 403);
    assert.match((await call(url, '/', cookie)).body, /password/u, 'the share cookie is not a login');

    // Expired, malformed and revoked links all read the same; an unknown well-formed one waits for a snapshot refresh.
    for (const path of [`/s/${expired.token}`, '/s/not-a-token']) assert.equal((await call(url, path)).status, 404, path);
    assert.equal((await call(url, '/api/share/view', `${SHARE_COOKIE}=${expired.token}`)).status, 401);
    const waiting = await call(url, `/s/${'A'.repeat(22)}?w=23`);
    assert.equal(waiting.status, 200);
    assert.match(waiting.body, /正在同步/u);
    assert.match(waiting.body, /url=\/s\/A{22}\?w=24/u);
    assert.ok(existsSync(join(root, 'state', 'share-sync.json')), 'the unknown link asked for a snapshot refresh');
    assert.equal((await call(url, `/s/${'A'.repeat(22)}?w=24`)).status, 404, 'gives up after the polling window');
    writeFileSync(join(root, 'state', 'share-revoked.json'), JSON.stringify({ sessionKeys: ['pubg-session:squad:share-3'] }));
    assert.equal((await call(url, '/api/share/view', cookie)).status, 401);
    assert.equal((await call(url, `/s/${session.token}`)).status, 404);
  } finally {
    await server?.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
});
