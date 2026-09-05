import defaultTeam from '../../teams/default-team.json' with { type: 'json' };

export interface TeamPlayer {
  id: string;
  name: string;
  aliases: string[];
}

export interface TeamConfig {
  id: string;
  label: string;
  platform: string;
  players: TeamPlayer[];
}

export const DEFAULT_TEAM = defaultTeam as TeamConfig;

export const DEFAULT_TEAM_PLAYER_IDS = DEFAULT_TEAM.players.map((player) => player.id);

export function playerAliasMap(team: TeamConfig = DEFAULT_TEAM): Map<string, TeamPlayer> {
  const aliases = new Map<string, TeamPlayer>();
  for (const player of team.players) {
    aliases.set(player.id.toLowerCase(), player);
    aliases.set(player.name.toLowerCase(), player);
    for (const alias of player.aliases) aliases.set(alias.toLowerCase(), player);
  }
  return aliases;
}
