import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqlitePubgRepository } from '@rine-kit/pubg-domain';
import { RawTelemetryArchive } from '@rine-kit/pubg-intelligence/archive';
import { startServer } from '../src/server/server.js';

import { baseMatch, player, squadIds, telemetry } from './contract-fixture.js';

test('the HTTP API serves the views the page depends on: scope filters, comparison, relative form, match story, analytics and map images', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pubg-contract-'));
  const keys = ['PUBG_INTELLIGENCE_DB', 'PUBG_INTELLIGENCE_EXPERIMENT_DB', 'PUBG_TELEMETRY_ARCHIVE_DIR', 'PUBG_INTELLIGENCE_MAP_DIR', 'PUBG_INTELLIGENCE_STATE_DIR', 'PUBG_INTELLIGENCE_ANALYSIS_WORKERS', 'PORT', 'HOST', 'PUBG_INTELLIGENCE_AI_CONFIG_FILE', 'PUBG_INTELLIGENCE_PUBLIC_HOST', 'PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE'] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const source = join(root, 'source.sqlite');
    const repository = new SqlitePubgRepository(source);
    const matches = Array.from({ length: 10 }, (_, index) => ({
      ...baseMatch,
      matchId: `contract-${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 9, 1 + index, 12)).toISOString(),
      // Matches with a telemetry link are the ones the telemetry analytics consider; the last two also have an archive.
      ...(index >= 8 ? { telemetryUrl: `https://telemetry-cdn.pubg.com/contract-${index + 1}.json` } : {}),
      players: squadIds.map((id, member) => player(id, 1 + ((index + member) % 9) + (index % 3), { damage: 100 + member * 40 + index * 10, kills: member % 3, assists: member % 2, dbnos: 1 + (member % 2) })),
    }));
    repository.upsertMatches([
      ...matches,
      { ...baseMatch, matchId: 'contract-normal', matchType: 'official', isCompetitive: false, createdAt: '2026-10-20T12:00:00.000Z', players: squadIds.map((id) => player(id, 4)) },
    ]);
    repository.close();
    const archiveDir = join(root, 'archive');
    const archive = new RawTelemetryArchive(archiveDir);
    for (const id of ['contract-9', 'contract-10']) await archive.write(id, Buffer.from(JSON.stringify(telemetry(matches.find((match) => match.matchId === id)!.createdAt))));
    const mapDir = join(root, 'maps');
    mkdirSync(mapDir);
    writeFileSync(join(mapDir, 'Baltic_Main.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    Object.assign(process.env, {
      PUBG_INTELLIGENCE_DB: source, PUBG_INTELLIGENCE_EXPERIMENT_DB: join(root, 'experiments.sqlite'), PUBG_TELEMETRY_ARCHIVE_DIR: archiveDir, PUBG_INTELLIGENCE_MAP_DIR: mapDir,
      PUBG_INTELLIGENCE_STATE_DIR: join(root, 'state'), PUBG_INTELLIGENCE_ANALYSIS_WORKERS: '1', PORT: '0', HOST: '127.0.0.1', PUBG_INTELLIGENCE_AI_CONFIG_FILE: join(root, 'no-ai.json'),
    });
    delete process.env.PUBG_INTELLIGENCE_PUBLIC_HOST;
    delete process.env.PUBG_INTELLIGENCE_PUBLIC_AUTH_FILE;
    server = await startServer();
    const get = async <T,>(path: string): Promise<T> => (await fetch(`${server!.url}${path}`)).json() as Promise<T>;

    const bootstrap = await get<{ matchCount: number; rankedMatchCount: number; archivedMatchCount: number; modeCounts: Record<string, number>; archiveBackup: unknown; squads: Array<{ id: string; members: string[] }> }>('/api/bootstrap');
    assert.deepEqual({ all: bootstrap.matchCount, ranked: bootstrap.rankedMatchCount, squad: bootstrap.modeCounts.squad, archived: bootstrap.archivedMatchCount, backup: bootstrap.archiveBackup }, { all: 11, ranked: 10, squad: 10, archived: 2, backup: null });
    const squad = bootstrap.squads[0]!;
    assert.equal(squad.members.length, 4);
    const scope = `squadId=${squad.id}&mode=squad`;

    const list = await get<{ total: number; matches: Array<{ matchId: string }> }>(`/api/matches?${scope}`);
    assert.equal(list.total, 10, 'only ranked matches are listed');
    assert.ok(!list.matches.some((match) => match.matchId === 'contract-normal'));
    assert.equal((await get<{ total: number }>(`/api/matches?${scope}&complete=1`)).total, 2, 'complete telemetry keeps only archived matches');

    const compare = await get<{ players: Array<{ accountId: string }>; matches: Array<{ t: number; rank: number | null; per: Record<string, { damage: number; kills: number }> }> }>(`/api/analytics/compare?${scope}`);
    assert.equal(compare.players.length, 4);
    assert.equal(compare.matches.length, 10);
    assert.ok(compare.matches.every((match) => Object.keys(match.per).length === 4));
    assert.ok(compare.matches.every((match, index, all) => index === 0 || all[index - 1]!.t <= match.t), 'oldest first');
    assert.equal((await get<{ matches: unknown[] }>(`/api/analytics/compare?${scope}&complete=1`)).matches.length, 2);

    const relative = await get<{ matchId: string; telemetry: boolean; historyMatches: number; players: Array<{ accountId: string; form: number | null; metrics: Array<{ key: string; goodness: number | null }> }>; highlights: unknown[] }>('/api/matches/contract-10/relative?squadId=' + squad.id);
    assert.deepEqual({ id: relative.matchId, telemetry: relative.telemetry, players: relative.players.length, history: relative.historyMatches }, { id: 'contract-10', telemetry: true, players: 4, history: 9 });
    assert.ok(relative.players.every((entry) => entry.metrics.some((metric) => metric.key === 'damage')));

    const story = await get<{ available: boolean; downCauses: Array<{ key: string }>; players: Array<{ name: string }>; story: { fights: unknown[]; downs: Array<{ cause: string; outcome: string; meters: number | null }>; rotation: { epochs: unknown[] }; players: Array<{ landing: unknown }>; turningPoints: unknown[] } }>(`/api/matches/contract-10/story?squadId=${squad.id}`);
    assert.equal(story.available, true);
    assert.equal(story.story.players.length, 4);
    assert.ok(story.downCauses.some((cause) => cause.key === 'ambush_far'));
    assert.deepEqual(story.story.downs.map((down) => [down.cause, down.outcome, down.meters]), [['ambush_far', 'revived', 250]], 'a 250 m knock with no return fire, then revived');
    assert.ok(story.story.rotation.epochs.length >= 1);
    const noArchive = await get<{ available: boolean; reason: string; story: unknown }>(`/api/matches/contract-1/story?squadId=${squad.id}`);
    assert.deepEqual({ available: noArchive.available, reason: noArchive.reason, story: noArchive.story }, { available: false, reason: 'no_archive', story: null });

    const analytics = await get<{ scope: { analyzedMatches: number }; downs: { matches: number; downs: number }; rotation: { matches: number }; streaks: { matches: number }; style: { players: unknown[] } }>(`/api/analytics/telemetry?${scope}&complete=1`);
    assert.equal(analytics.scope.analyzedMatches, 2);
    assert.deepEqual({ downMatches: analytics.downs.matches, downs: analytics.downs.downs, rotation: analytics.rotation.matches, streaks: analytics.streaks.matches }, { downMatches: 2, downs: 2, rotation: 2, streaks: 2 });

    const image = await fetch(`${server.url}/api/maps/Baltic_Main`);
    assert.deepEqual({ status: image.status, type: image.headers.get('content-type'), bytes: (await image.arrayBuffer()).byteLength }, { status: 200, type: 'image/jpeg', bytes: 4 });
    assert.equal((await fetch(`${server.url}/api/maps/Erangel_Main`)).status, 404, 'a map without an image is a 404, never an error');
    assert.equal((await fetch(`${server.url}/api/maps/..%2F..%2Fsource.sqlite`)).status, 404, 'path traversal is refused');
  } finally {
    await server?.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    rmSync(root, { recursive: true, force: true });
  }
});
