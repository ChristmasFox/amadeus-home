#!/usr/bin/env node
/**
 * Generate a private PUBG team config from exact official in-game names.
 * Never print the API key or resolved account IDs; never overwrite an existing file.
 */
import { readFile, mkdir, open, unlink, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHARDS = new Set(['steam', 'kakao', 'psn', 'xbox']);

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (!['--players', '--platform', '--team-id', '--label', '--api-key-file', '--output'].includes(flag)) {
      throw new Error('unknown_argument: ' + flag);
    }
    if (options[flag] !== undefined) throw new Error('duplicate_argument: ' + flag);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error('missing_value: ' + flag);
    options[flag] = value;
  }
  return {
    players: (options['--players'] ?? '').split(',').map(s => s.trim()).filter(Boolean),
    platform: options['--platform'] ?? 'steam',
    teamId: options['--team-id'] ?? 'my_squad',
    label: options['--label'] ?? 'My Squad',
    apiKeyFile: options['--api-key-file'],
    output: options['--output'] ?? join(ROOT, '.local/pubg-team.json'),
  };
}

export function validateOptions(options) {
  if (!Array.isArray(options.players) || options.players.length < 1 || options.players.length > 4) {
    throw new Error('players_required_1_to_4');
  }
  if (options.players.some(n => !/^[A-Za-z0-9_-]{1,32}$/.test(n)) ||
      new Set(options.players.map(n => n.toLowerCase())).size !== options.players.length) {
    throw new Error('invalid_or_duplicate_player_names');
  }
  if (!SHARDS.has(options.platform)) throw new Error('invalid_platform_shard');
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(options.teamId)) throw new Error('invalid_team_id');
  if (typeof options.label !== 'string' || options.label.trim().length < 1 || options.label.length > 64) {
    throw new Error('invalid_team_label');
  }
  const output = resolve(options.output);
  const relativePath = relative(ROOT, output);
  if (!relativePath.startsWith('..' + sep) && relativePath !== '..' && !isAbsolute(relativePath) &&
      relativePath !== '.local' && !relativePath.startsWith('.local' + sep)) {
    throw new Error('refusing_to_write_tracked_repository_path');
  }
  return output;
}

export async function resolvePlayers(options, apiKey, fetchImpl = fetch) {
  const params = new URLSearchParams({ 'filter[playerNames]': options.players.join(',') });
  const url = 'https://api.pubg.com/shards/' + encodeURIComponent(options.platform) + '/players?' + params;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: /^Bearer\s+/i.test(apiKey) ? apiKey : 'Bearer ' + apiKey,
        Accept: 'application/vnd.api+json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('pubg_api_network_or_timeout_error');
  }
  if (!response.ok) throw new Error('pubg_api_http_' + response.status);
  let body;
  try { body = await response.json(); }
  catch { throw new Error('pubg_api_invalid_json'); }
  if (!body || !Array.isArray(body.data)) throw new Error('pubg_api_invalid_players_response');
  const players = options.players.map(requested => {
    const matches = body.data.filter(entry =>
      entry?.type === 'player' &&
      typeof entry.attributes?.name === 'string' &&
      entry.attributes.name.toLowerCase() === requested.toLowerCase() &&
      typeof entry.id === 'string' &&
      /^account\.[A-Za-z0-9_-]{16,128}$/.test(entry.id)
    );
    if (matches.length !== 1) throw new Error('player_not_found_or_ambiguous: ' + requested);
    return { id: matches[0].id, name: matches[0].attributes.name, aliases: [] };
  });
  if (new Set(players.map(p => p.id)).size !== players.length) throw new Error('duplicate_player_account_ids');
  return players;
}

export async function initializeTeam(options, { env = process.env, fetchImpl = fetch } = {}) {
  const output = validateOptions(options);
  const keyPath = options.apiKeyFile || env.PUBG_API_KEY_FILE;
  const apiKey = keyPath ? (await readFile(keyPath, 'utf8')).trim() : (env.PUBG_API_KEY ?? '').trim();
  if (!apiKey) throw new Error('pubg_api_key_required');
  // Resolve the players before touching the destination. A failure cannot create a partial team file.
  const players = await resolvePlayers(options, apiKey, fetchImpl);
  const data = {
    id: options.teamId,
    label: options.label.trim(),
    platform: options.platform,
    players,
  };
  const directory = dirname(output);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Reject paths inside the worktree, including .local symlink tricks that resolve into tracked paths.
  const physicalDir = await realpath(directory);
  const physicalPath = resolve(physicalDir, output.slice(directory.length + 1));
  const physicalRelative = relative(ROOT, physicalPath);
  if (!physicalRelative.startsWith('..' + sep) && physicalRelative !== '..' &&
      !isAbsolute(physicalRelative) && physicalRelative !== '.local' &&
      !physicalRelative.startsWith('.local' + sep)) {
    throw new Error('refusing_to_write_tracked_repository_path');
  }
  const file = await open(output, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8');
  } catch (error) {
    await file.close();
    await unlink(output).catch(() => {});
    throw error;
  }
  await file.close();
  return { path: output, count: players.length };
}

const usage = [
  'Initialize an external PUBG team config (never committed to Git).',
  '',
  'Usage:',
  '  node scripts/init-pubg-team.mjs --players Name1,Name2 --platform steam [--label "My Squad"] [--team-id my_squad]',
  '       [--api-key-file /private/pubg-api-key] [--output /private/pubg-team.json]',
  '',
  'Set PUBG_API_KEY_FILE or PUBG_API_KEY in the environment instead of passing keys on the command line.',
  'Defaults: --platform steam; --team-id my_squad; --output .local/pubg-team.json.',
  'No output overwrite; existing files are never modified.',
].join('\n');

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else {
      const { path, count } = await initializeTeam(options);
      console.log('PUBG_TEAM_INITIALIZED=' + count + ' players');
      console.log('PUBG_TEAM_CONFIG_FILE=' + path);
      console.log('Player IDs and API keys were not printed. Keep this file outside Git.');
    }
  } catch (error) {
    console.error('PUBG_TEAM_INIT_FAILED=' + (error instanceof Error ? error.message : 'unknown_error'));
    process.exitCode = 1;
  }
}
