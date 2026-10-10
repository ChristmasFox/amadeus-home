import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { initializeTeam, parseArgs, validateOptions } from './init-pubg-team.mjs';

const ACCOUNT_A = 'account.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ACCOUNT_B = 'account.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

test('CLI parsing distinguishes local team ID from official player account IDs', () => {
  const options = parseArgs(['--players', 'Alice,Bob', '--platform', 'steam', '--team-id', 'squad_one']);
  assert.deepEqual(options.players, ['Alice', 'Bob']);
  assert.equal(options.teamId, 'squad_one');
  assert.match(options.output, /\.local\/pubg-team\.json$/);
  assert.throws(() => validateOptions({ ...options, output: 'packages/pubg-domain/config/default-team.json' }), /tracked_repository_path/);
  assert.throws(() => validateOptions({ ...options, players: ['Alice', 'alice'] }), /duplicate_player_names/);
});

test('resolves exact official names and privately writes non-overwriting mode-0600 config', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pubg-init-'));
  try {
    const output = join(dir, 'private-team.json');
    const options = parseArgs(['--players', 'Alice,Bob', '--output', output, '--label', 'Friends']);
    let requests = 0;
    const mockFetch = async (url, config) => {
      requests++;
      assert.equal(new URL(url).searchParams.get('filter[playerNames]'), 'Alice,Bob');
      assert.equal(config.headers.Authorization, 'Bearer fixture-private-key');
      assert.equal(config.headers.Accept, 'application/vnd.api+json');
      return new Response(JSON.stringify({ data: [
        { type: 'player', id: ACCOUNT_A, attributes: { name: 'Alice' } },
        { type: 'player', id: ACCOUNT_B, attributes: { name: 'Bob' } },
      ] }), { status: 200 });
    };
    const result = await initializeTeam(options, { env: { PUBG_API_KEY: 'fixture-private-key' }, fetchImpl: mockFetch });
    assert.equal(result.count, 2);
    assert.equal(requests, 1);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), {
      id: 'my_squad', label: 'Friends', platform: 'steam',
      players: [
        { id: ACCOUNT_A, name: 'Alice', aliases: [] },
        { id: ACCOUNT_B, name: 'Bob', aliases: [] },
      ],
    });
    if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
    await assert.rejects(() => initializeTeam(options, { env: { PUBG_API_KEY: 'fixture-private-key' }, fetchImpl: mockFetch }), /EEXIST/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('missing or ambiguous names fail closed without writing a file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pubg-init-'));
  try {
    const output = join(dir, 'team.json');
    const options = parseArgs(['--players', 'Alice,Bob', '--output', output]);
    await assert.rejects(() => initializeTeam(options, {
      env: { PUBG_API_KEY: 'fixture-private-key' },
      fetchImpl: async () => new Response(JSON.stringify({ data: [
        { type: 'player', id: ACCOUNT_A, attributes: { name: 'Alice' } },
      ] }), { status: 200 }),
    }), /player_not_found_or_ambiguous: Bob/);
    await assert.rejects(() => readFile(output));
    await assert.rejects(() => initializeTeam(options, {
      env: { PUBG_API_KEY: 'fixture-private-key' },
      fetchImpl: async () => new Response('{}', { status: 401 }),
    }), /pubg_api_http_401/);
    await assert.rejects(() => readFile(output));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('read API key from external file and never echo it to output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pubg-init-'));
  try {
    const path = join(dir, 'key');
    const output = join(dir, 'config.json');
    await writeFile(path, 'fixture-key-from-file\n');
    const options = parseArgs(['--players', 'Alice', '--output', output, '--api-key-file', path]);
    await initializeTeam(options, { env: {}, fetchImpl: async (_, init) => {
      assert.equal(init.headers.Authorization, 'Bearer fixture-key-from-file');
      return new Response(JSON.stringify({ data: [
        { type: 'player', id: ACCOUNT_A, attributes: { name: 'Alice' } },
      ] }), { status: 200 });
    } });
    assert.equal(JSON.parse(await readFile(output, 'utf8')).players.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
