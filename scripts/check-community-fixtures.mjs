#!/usr/bin/env node
// Prevent accidental re-introduction of real PUBG account IDs/names into the checked-in example.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'packages/pubg-domain/config/default-team.json');
const team = JSON.parse(readFileSync(path, 'utf8'));
if (!/^example_[a-z0-9_-]+$/.test(team.id) ||
    team.platform !== 'steam' || !Array.isArray(team.players) || team.players.length !== 4) {
  throw new Error('PUBG fixture is not the intentionally anonymized example roster');
}
for (const [index, player] of team.players.entries()) {
  if (player.id !== 'fixture-player-' + (index + 1) ||
      player.name !== 'DemoPlayer0' + (index + 1) ||
      !Array.isArray(player.aliases)) {
    throw new Error('PUBG fixture changed: do not commit real player account IDs or names');
  }
}
console.log('COMMUNITY_PUBG_FIXTURE=synthetic_only');
