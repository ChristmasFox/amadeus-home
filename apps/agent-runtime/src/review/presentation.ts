import type { CanonicalQuery } from '../schema/query.js';
import { PresentationModelSchema, type PresentationModel, type PresentationSection } from '../platform/core/contracts.js';
import type { FunEvent, MatchPickerModel, MatchReviewResult, ReviewPlayerFacts } from './types.js';

const REVIEW_SECTION_KEYS = ['overview', 'players', 'key_operations', 'key_fights', 'turning_points', 'weapons', 'vehicles', 'heavy_weapons', 'fun', 'conclusion'] as const;

function integer(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function clock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function localTime(value: string | null): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

function rankLabel(rank: number | null): string {
  return rank === 1 ? '🍗 #1' : rank === null ? '#?' : `#${rank}`;
}

function ordinalLabel(ordinal: number): string {
  return ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'][ordinal - 1] ?? String(ordinal);
}

function operationIcon(type: string): string {
  return ({ ENTRY: '🔥', MULTI_KNOCK: '⚡', CLUTCH: '🏆', FLANK: '🧭', TRADE: '🔁', SUPPORT: '🛡️', REVIVE: '❤️', DAMAGE: '💥', POSITIONING_RISK: '⚠️', MISTAKE: '❗', VEHICLE: '🚗', HEAVY_WEAPON: '🚀' } as Record<string, string>)[type] ?? '⭐';
}

function vehicleLine(player: ReviewPlayerFacts): string | null {
  const vehicle = player.vehicle;
  if (!vehicle || !vehicle.evidenceIds.length) return null;
  const parts: string[] = [];
  if (vehicle.driverConfirmed && vehicle.driveDistance > 0) parts.push(`驾驶${(vehicle.driveDistance / 1000).toFixed(1)}km`);
  else if (vehicle.rideDistance > 0) parts.push(`乘车${(vehicle.rideDistance / 1000).toFixed(1)}km`);
  if (vehicle.maxSpeed > 0) parts.push(`最高${Math.round(vehicle.maxSpeed)}km/h`);
  if (vehicle.vehicleDamage > 0) parts.push(`载具伤害${integer(vehicle.vehicleDamage)}`);
  if (vehicle.vehiclesDestroyed > 0) parts.push(`摧毁${vehicle.vehiclesDestroyed}辆`);
  return parts.length ? `🚗 ${parts.join(' · ')}` : null;
}

function heavyWeaponLine(player: ReviewPlayerFacts): string[] {
  return player.heavyWeapons
    .filter((weapon) => weapon.evidenceIds.length > 0)
    .map((weapon) => {
      const shot = weapon.shots > 0 ? `${weapon.shots}发${weapon.hits > 0 ? `${weapon.hits}中` : ''}` : `拾取${weapon.pickupEvents}次 · 0发`;
      const impact: string[] = [];
      if (weapon.kills > 0) impact.push(`${weapon.kills}杀`);
      if (weapon.knocks > 0) impact.push(`${weapon.knocks}倒地`);
      if (weapon.vehiclesDestroyed > 0) impact.push(`摧毁${weapon.vehiclesDestroyed}辆载具`);
      return `🚀 ${weapon.weapon} · ${shot}${impact.length ? ` · ${impact.join(' · ')}` : ''}`;
    });
}

function playerSection(review: MatchReviewResult, player: ReviewPlayerFacts, profile: string): PresentationSection {
  const commentary = review.analysis.playerCommentary.find((item) => item.playerId === player.playerId);
  const lines = [
    `━━━━━━━━━━━━━━`,
    `👑 ${player.playerName}${player.matchRole ? ` · ${player.matchRole}` : ''}`,
    `━━━━━━━━━━━━━━`,
    `${player.kills}杀 · ${player.assists}助 · ${integer(player.damage)}伤害`,
    `${player.dbnos}倒地 · ${player.revives}救援 · ${rankLabel(player.rank)}`,
  ];
  const vehicle = vehicleLine(player);
  if (vehicle && (profile === 'default' || profile === 'vehicle' || profile === 'detailed' || profile === 'fun')) lines.push(vehicle);
  const heavy = heavyWeaponLine(player);
  if (heavy.length && (profile === 'default' || profile === 'weapon' || profile === 'detailed' || profile === 'fun')) lines.push(...heavy);
  if (profile !== 'vehicle' && profile !== 'weapon') {
    lines.push('', '⭐ 关键操作');
    if (player.keyOperations.length) {
      for (const operation of player.keyOperations) lines.push(`${operationIcon(operation.type)}${operation.time === null ? '' : ` ${clock(operation.time)}`}\n${operation.impact}`);
    } else {
      lines.push('— 未发现足够影响战局的关键操作');
    }
    lines.push('', '💬 点评', commentary?.text ?? '暂无点评');
    if (commentary?.improvements.length) lines.push(`⚠️ ${commentary.improvements.join('；')}`);
  }
  return {
    type: 'players',
    title: player.playerName,
    text: lines.join('\n'),
    data: {
      playerId: player.playerId,
      operationIds: player.keyOperations.map((operation) => operation.id),
      section: 'key_operations',
      vehicle: player.vehicle ?? null,
      heavyWeapons: player.heavyWeapons,
    },
  };
}

function funEventMatchesProfile(event: FunEvent, review: MatchReviewResult, query: CanonicalQuery, profile: string): boolean {
  if (profile === 'vehicle' && event.category !== 'vehicle' && !event.tags.includes('vehicle')) return false;
  if (profile === 'weapon' && event.category !== 'heavy_weapon' && !event.tags.includes('heavy_weapon')) return false;
  if (profile === 'personal' && query.subject.type !== 'team') {
    const ids = new Set(query.subject.ids);
    if ((!event.actorPlayerId || !ids.has(event.actorPlayerId)) && !event.targetPlayerIds.some((id) => ids.has(id))) return false;
  }
  return Boolean(review);
}

function funSection(review: MatchReviewResult, query: CanonicalQuery, profile: string): PresentationSection | null {
  const events = (review.analysis.funEvents ?? []).filter((event) => funEventMatchesProfile(event, review, query, profile));
  if (!events.length) return null;
  const text = ['🤣 本局整活', ...events.map((event) => `${event.title}\n${event.text}`)].join('\n\n');
  return {
    type: 'fun',
    title: 'fun',
    text,
    data: { items: events, eventIds: events.map((event) => event.id) },
  };
}

function buildPickerText(picker: MatchPickerModel, query: CanonicalQuery): string {
  const period = query.selector.label ?? '指定范围';
  const lines = [`🎬 PUBG · ${period}复盘`, `${period}共 ${picker.candidateCount} 场，请选择：`, ''];
  for (const candidate of picker.candidates) {
    const teamKills = Number(candidate.row.metrics.teamKills ?? candidate.row.metrics.kills ?? 0);
    const teamAssists = Number(candidate.row.metrics.teamAssists ?? candidate.row.metrics.assists ?? 0);
    const teamDamage = Number(candidate.row.metrics.teamDamage ?? candidate.row.metrics.damage ?? 0);
    lines.push(`${ordinalLabel(candidate.ordinal)} ${localTime(candidate.match.createdAt)} · ${candidate.match.mapName} · ${rankLabel(candidate.row.bestRank ?? null)}`);
    const players = candidate.row.players ?? [];
    lines.push(players.map((player) => `${player.displayName || player.playerName} ${player.kills}杀${player.assists}助`).join(' ｜ ') || '暂无队员明细');
    lines.push(`⚔️ ${teamKills}杀 · ${teamAssists}助 ｜🎯 ${integer(teamDamage)}伤害`, '');
  }
  return lines.join('\n').trim();
}

export function buildMatchPickerPresentation(picker: MatchPickerModel, query: CanonicalQuery, resultSetId: string | null): PresentationModel {
  const text = buildPickerText(picker, query);
  const buttons = picker.buttons.map((button) => ({ text: button.text, callbackData: button.callbackData }));
  return PresentationModelSchema.parse({
    version: 1,
    type: 'review_match_picker',
    title: 'PUBG 对局选择',
    sections: [{ type: 'match-picker', title: 'match-picker', text, data: { candidateCount: picker.candidateCount, resultSetId, buttons } }],
    fallbackText: text,
    metadata: { resultSetId, inlineKeyboard: buttons, picker: true },
  });
}

export function buildReviewPresentation(review: MatchReviewResult, query: CanonicalQuery, resultSetId: string | null): PresentationModel {
  const profile = query.presentation.profile ?? 'default';
  const match = review.match;
  const facts = review.facts;
  const analysis = review.analysis;
  const overview = [
    '🎬 PUBG · 对局复盘',
    `${match.ordinal} ${localTime(match.startedAt)} · ${match.mapName}`,
    `${rankLabel(match.placement)} · ${clock(match.duration)}`,
    '',
    `⚔️ ${facts.squad.kills}杀 · ${facts.squad.assists}助攻`,
    `🎯${integer(facts.squad.damage)}伤害 · 💥${facts.squad.knocks}倒地`,
    '',
    '🔥 本局一句话',
    analysis.summary,
  ];
  if (review.telemetry.status === 'UNAVAILABLE') overview.push('', '⚠️ 该场基础战绩已经找到，但详细战斗记录暂时无法获取。');
  if (!facts.fightIntegrity.pass) overview.push('', '⚠️ 详细团战数据未通过一致性校验，暂不展示团战结论。');
  const sections: PresentationSection[] = [{ type: 'overview', title: 'overview', text: overview.join('\n'), data: { matchId: match.matchId, telemetry: review.telemetry } }];
  const visiblePlayers = profile === 'personal' && query.subject.type !== 'team'
    ? facts.players.filter((player) => query.subject.ids.includes(player.playerId))
    : facts.players;
  for (const player of visiblePlayers) sections.push(playerSection(review, player, profile));
  const fun = funSection(review, query, profile);
  if (fun) sections.push(fun);
  if (profile !== 'personal' && profile !== 'vehicle' && profile !== 'weapon') {
    const fightLines = !facts.fightIntegrity.pass
      ? ['⚠️ 详细团战数据未通过一致性校验，暂不展示。']
      : analysis.keyFights.length
        ? analysis.keyFights.map((fight, index) => `${index + 1} ${clock(fight.start)}–${clock(fight.end)} · ${fight.result}\n我方：${fight.teamKills}杀 · ${integer(fight.teamDamage)}伤害 · ${fight.teamKnocks}倒地\n承受：${integer(fight.receivedDamage)}伤害 · ${fight.receivedKnocks}人倒地\n关键人物：${fight.keyPlayers.length ? fight.keyPlayers.map((playerId) => facts.players.find((player) => player.playerId === playerId)?.playerName ?? playerId).join('、') : '暂无'}${fight.location ? `\n地点：${fight.location}` : ''}`)
        : ['暂无足够战斗事件形成团战'];
    sections.push({ type: 'key_fights', title: 'key_fights', text: ['━━━━━━━━━━━━━━', '⚔️ 关键团战', '━━━━━━━━━━━━━━', ...fightLines].join('\n'), data: { fights: analysis.keyFights } });
    const good = analysis.good.length ? analysis.good.map((item) => `• ${item}`).join('\n') : '• 暂无可确认的正向结论';
    const improvements = analysis.improvements.length ? analysis.improvements.map((item) => `• ${item}`).join('\n') : '• 暂无明确改进项';
    const keyPlayers = analysis.keyPlayers.length ? analysis.keyPlayers.map((item) => `• ${item}`).join('\n') : '• 暂无足够证据';
    const conclusion = ['━━━━━━━━━━━━━━', '🧠 本局复盘', '━━━━━━━━━━━━━━', '✅ 做得好的', good, '', '⚠️ 可以改进', improvements, '', '🏅 本局关键人物', keyPlayers];
    sections.push({ type: 'conclusion', title: 'conclusion', text: conclusion.join('\n'), data: { good: analysis.good, improvements: analysis.improvements, keyPlayers: analysis.keyPlayers } });
  }
  const fallbackText = sections.map((section) => section.text ?? '').filter(Boolean).join('\n\n');
  return PresentationModelSchema.parse({
    version: 1,
    type: 'review_match',
    title: '对局复盘',
    sections,
    fallbackText,
    metadata: { queryId: query.queryId, resultSetId, profile, telemetry: review.telemetry, sectionKeys: REVIEW_SECTION_KEYS },
  });
}
