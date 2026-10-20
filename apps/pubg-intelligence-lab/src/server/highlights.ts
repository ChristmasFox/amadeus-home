import { businessDayLabel, businessDayWindow } from '@agent/pubg-domain';
import { HIGHLIGHT_RULE_VERSION, rankCrossMatchHighlights } from '@agent/pubg-intelligence';
import { analyzeMatchTelemetry } from './match-views.js';
import { archivedIds, inMode, inSquad, requestedMode, selectSquad, type Snapshot } from './snapshot.js';
import { safeDateBounds } from './http-utils.js';

export const MAX_HIGHLIGHT_MATCHES = 100;

export async function crossMatchHighlights(snapshot: Snapshot, url: URL) {
  const bounds = safeDateBounds(url.searchParams.get('from'), url.searchParams.get('to'));
  if (!bounds) throw new Error('invalid_date_range');
  const squad = selectSquad(snapshot, url.searchParams.get('squadId'));
  const mode = requestedMode(url);
  const countValue = Number(url.searchParams.get('limit') ?? 20);
  if (!Number.isInteger(countValue) || countValue < 1 || countValue > MAX_HIGHLIGHT_MATCHES) throw new Error('invalid_highlight_limit');
  const window = url.searchParams.get('window') ?? 'recent';
  if (window !== 'recent' && window !== 'night') throw new Error('invalid_highlight_window');
  const candidates = snapshot.matches.filter((match) => inSquad(match, squad) && inMode(match, mode)
    && (bounds.fromMs === undefined || match.timestamp >= bounds.fromMs)
    && (bounds.toMs === undefined || match.timestamp < bounds.toMs))
    .sort((a, b) => b.timestamp - a.timestamp || a.matchId.localeCompare(b.matchId));
  // "One night" is the most recent played Shanghai game day (06:00–06:00) inside the selected dates.
  const night = window === 'night' && candidates[0] ? businessDayWindow(businessDayLabel(candidates[0].timestamp)) : null;
  const inWindow = night ? candidates.filter((match) => match.timestamp >= night.startMs && match.timestamp < night.endMs) : candidates;
  // Select the latest N played matches before checking the archive; never replace missing matches with older ones.
  const selected = inWindow.slice(0, countValue);
  const archived = await archivedIds(snapshot);
  const results = await Promise.all(selected.map(async (match) => {
    if (!archived.has(match.matchId)) return { match, status: 'missing' as const, items: [] };
    const matchSquad = squad.memberIds.length ? squad : { ...squad, memberIds: match.players.map((player) => player.accountId) };
    const result = await analyzeMatchTelemetry(snapshot, matchSquad, match);
    return { match, status: typeof result === 'string' ? result : 'analyzed', items: typeof result === 'string' ? [] : result.highlights };
  }));
  return {
    ruleVersion: HIGHLIGHT_RULE_VERSION,
    scope: { squadId: squad.id, squadLabel: squad.label, mode, window, night: night?.businessDay ?? null, limit: countValue,
      eligibleMatches: inWindow.length, selectedMatches: selected.length, analyzedMatches: results.filter((row) => row.status === 'analyzed').length,
      missingMatches: results.filter((row) => row.status === 'missing').length, failedMatches: results.filter((row) => row.status === 'failed').length,
      truncated: inWindow.length > selected.length },
    matches: results.map(({ match, status, items }) => ({ matchId: match.matchId, createdAt: match.createdAt, status, highlights: items.length })),
    items: rankCrossMatchHighlights(results.flatMap((row) => row.items)),
    notes: ['仅使用排位原始遥测；缺失或读取失败不等于没有高光。', '按观测灭队、逆风反击、连续击倒、救援排序，同类优先人数、较新对局。', '一晚按上海时间 06:00 至次日 06:00 划分；最多读取最近 100 场。'],
  };
}
