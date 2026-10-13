import { parseTeamLeaderboardMetric, type TeamLeaderboardMetric } from '../../contracts/team-preferences.js';

export type KookManagementCommand =
  | { kind: 'help' | 'privacy' | 'teams' | 'status' | 'unbind' | 'disband' | 'account' | 'unclaim' | 'preference' | 'preference_delete' }
  | { kind: 'preference_set'; metric: TeamLeaderboardMetric }
  | { kind: 'alias_list' }
  | { kind: 'alias_set'; playerName: string; alias: string }
  | { kind: 'alias_delete'; alias: string }
  | { kind: 'create'; shard: string; label: string; names: string[] }
  | { kind: 'bind'; teamId: string }
  | { kind: 'add' | 'roster'; names: string[] }
  | { kind: 'claim'; shard: string; name: string }
  | { kind: 'invalid' };

/** Explicit command grammar. Quotes preserve labels/gamertags with spaces;
 * names and labels retain their case. No free-text capability routing. */
export function parseKookManagementCommand(content: string): KookManagementCommand | null {
  const prefix = /^(?:\/|!)pubg(?:\s|$)/iu.exec(content.trim());
  if (!prefix) return null;
  const input = content.trim().slice(prefix[0].length);
  if (input.length > 700) return { kind: 'invalid' };
  const tokens: string[] = [];
  let current = '', quote: string | null = null, escaped = false, inToken = false;
  for (const char of input) {
    if (escaped) { current += char; escaped = false; inToken = true; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; else current += char; continue; }
    if (char === '"' || char === "'") { quote = char; inToken = true; continue; }
    if (/\s/u.test(char)) { if (inToken) { tokens.push(current); current = ''; inToken = false; } }
    else { current += char; inToken = true; }
  }
  if (quote || escaped) return { kind: 'invalid' };
  if (inToken) tokens.push(current);
  if (tokens.length > 8 || tokens.some(token => !token || token.length > 100)) return { kind: 'invalid' };
  const kind = tokens[0]?.toLowerCase() ?? 'help';
  const args = tokens.slice(1);
  if (['help', 'privacy', 'teams', 'status', 'unbind', 'disband', 'account', 'unclaim'].includes(kind) && !args.length) return { kind: kind as 'help' | 'privacy' | 'teams' | 'status' | 'unbind' | 'disband' | 'account' | 'unclaim' };
  if (kind === 'preference' && !args.length) return { kind: 'preference' };
  if (kind === 'preference' && args.length === 1) {
    if (args[0]!.toLowerCase() === 'delete') return { kind: 'preference_delete' };
    const metric = parseTeamLeaderboardMetric(args[0]);
    if (metric) return { kind: 'preference_set', metric };
  }
  if (kind === 'alias' && !args.length) return { kind: 'alias_list' };
  if (kind === 'alias' && args[0]?.toLowerCase() === 'list' && args.length === 1) return { kind: 'alias_list' };
  if (kind === 'alias' && args[0]?.toLowerCase() === 'set' && args.length === 3) return { kind: 'alias_set', playerName: args[1]!, alias: args[2]! };
  if (kind === 'alias' && args[0]?.toLowerCase() === 'delete' && args.length === 2) return { kind: 'alias_delete', alias: args[1]! };
  if (kind === 'create' && args.length >= 3 && args.length <= 6) return { kind, shard: args[0]!.toLowerCase(), label: args[1]!, names: args.slice(2) };
  if (kind === 'bind' && args.length === 1) return { kind, teamId: args[0]! };
  if ((kind === 'add' || kind === 'roster') && args.length >= 1 && args.length <= 4) return { kind, names: args };
  if (kind === 'claim' && args.length === 2) return { kind, shard: args[0]!.toLowerCase(), name: args[1]! };
  return { kind: 'invalid' };
}
