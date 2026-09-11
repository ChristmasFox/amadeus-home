import type { CanonicalQuery } from '../schema/query.js';
import { PresentationModelSchema, type PresentationModel, type PresentationSection } from '../platform/core/contracts.js';
import { meleeKindOf } from './telemetry-events.js';
import type {
  FunEvent,
  MatchPickerModel,
  MatchReviewResult,
  ReviewPlayerFacts,
  ReviewTurningPoint,
  WeaponStats,
} from './types.js';

const TEMPLATE_REVIEW_SECTION_KEYS = ['overview', 'players', 'interactions', 'loot', 'environment', 'conclusion'] as const;
const EXTENDED_REVIEW_SECTION_KEYS = [
  'overview', 'players', 'key_operations', 'key_fights', 'turning_points', 'weapons',
  'interactions', 'recovery', 'loot', 'environment', 'vehicles', 'heavy_weapons', 'awards', 'fun', 'conclusion',
] as const;

function integer(value: number): string {
  return Math.round(value).toLocaleString('zh-CN');
}

function damage(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? integer(rounded) : rounded.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function percentage(value: number, total: number): string | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return null;
  return `${((value / total) * 100).toFixed(1)}%`;
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

function mapLabel(value: string): string {
  const labels: Record<string, string> = {
    Neon_Main: '荣都',
  };
  return labels[value] ?? value.replace(/_Main$/u, '').replace(/_Arena$/u, '竞技场');
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

function playerName(review: MatchReviewResult, playerId: string): string {
  return review.facts.players.find((player) => player.playerId === playerId)?.playerName ?? playerId;
}

function shortPlayerName(review: MatchReviewResult, playerId: string): string {
  const name = playerName(review, playerId);
  const match = name.match(/^SG_LabmemNo(\d+)$/u);
  return match ? `SG${match[1]}` : name === 'kim_kkl' ? 'kim' : name;
}

function recordedPlayers(review: MatchReviewResult): ReviewPlayerFacts[] {
  return review.facts.players.filter((player) => player.matchPresence !== 'not_recorded');
}

function teamDamageForPlayer(review: MatchReviewResult, playerId: string, direction: 'outgoing' | 'incoming') {
  return (review.facts.teamDamage ?? []).filter((fact) => direction === 'outgoing'
    ? fact.actorPlayerId === playerId
    : fact.victimPlayerId === playerId);
}

function meleeBreakdown(review: MatchReviewResult, playerId: string, direction: 'outgoing' | 'incoming') {
  const facts = teamDamageForPlayer(review, playerId, direction).filter((fact) => fact.source === 'MELEE');
  const actions = new Map<string, number>();
  const byVictim = new Map<string, { hitCount: number; damage: number; actions: Map<string, number> }>();
  for (const fact of facts) {
    const kind = fact.meleeKind ?? meleeKindOf(fact.weapon ?? null, fact.damageTypeCategory ?? null);
    actions.set(kind, (actions.get(kind) ?? 0) + fact.hitCount);
    const victimId = fact.victimPlayerId;
    const victim = byVictim.get(victimId) ?? { hitCount: 0, damage: 0, actions: new Map<string, number>() };
    victim.hitCount += fact.hitCount;
    victim.damage += fact.damage;
    victim.actions.set(kind, (victim.actions.get(kind) ?? 0) + fact.hitCount);
    byVictim.set(victimId, victim);
  }
  return {
    facts,
    actions,
    byVictim,
    hitCount: facts.reduce((sum, fact) => sum + fact.hitCount, 0),
    damage: facts.reduce((sum, fact) => sum + fact.damage, 0),
  };
}

function meleeActionText(actions: Map<string, number>): string {
  const labels: Record<string, string> = { KICK: '脚', PUNCH: '拳', OTHER: '近战' };
  return [...actions.entries()]
    .sort(([left], [right]) => ({ KICK: 1, PUNCH: 2, OTHER: 3 }[left] ?? 9) - ({ KICK: 1, PUNCH: 2, OTHER: 3 }[right] ?? 9))
    .map(([kind, count]) => `${count}${labels[kind] ?? '次'}`)
    .join(' + ');
}

function combatMvp(review: MatchReviewResult): ReviewPlayerFacts | null {
  return [...recordedPlayers(review)].sort((left, right) => (
    (right.kills * 500 + right.dbnos * 240 + right.damage + right.assists * 80 + right.revives * 60)
      - (left.kills * 500 + left.dbnos * 240 + left.damage + left.assists * 80 + left.revives * 60)
      || right.damage - left.damage
      || left.playerId.localeCompare(right.playerId)
  ))[0] ?? null;
}

function firepowerPlayer(review: MatchReviewResult): ReviewPlayerFacts | null {
  return [...recordedPlayers(review)].sort((left, right) => right.damage - left.damage || right.kills - left.kills || left.playerId.localeCompare(right.playerId))[0] ?? null;
}

function meleeHunter(review: MatchReviewResult): ReviewPlayerFacts | null {
  return [...recordedPlayers(review)]
    .map((player) => ({ player, melee: meleeBreakdown(review, player.playerId, 'outgoing') }))
    .filter((item) => item.melee.hitCount > 0)
    .sort((left, right) => right.melee.hitCount - left.melee.hitCount || right.melee.damage - left.melee.damage || left.player.playerId.localeCompare(right.player.playerId))[0]?.player ?? null;
}

function conversionRate(review: MatchReviewResult, player: ReviewPlayerFacts): number | null {
  if (player.dbnos <= 0) return null;
  return Math.round((player.kills / player.dbnos) * 100);
}

function bestConversionPlayer(review: MatchReviewResult): ReviewPlayerFacts | null {
  return [...recordedPlayers(review)]
    .filter((player) => player.dbnos > 0)
    .sort((left, right) => (right.kills / right.dbnos) - (left.kills / left.dbnos)
      || right.kills - left.kills
      || right.damage - left.damage
      || left.playerId.localeCompare(right.playerId))[0] ?? null;
}

function playerWeapons(review: MatchReviewResult, playerId: string): WeaponStats[] {
  return review.facts.weapons
    .filter((weapon) => weapon.playerId === playerId && weapon.evidenceIds.length > 0
      && (weapon.damage > 0 || weapon.hits > 0 || weapon.knocks > 0 || weapon.kills > 0))
    .sort((left, right) => right.damage - left.damage || right.kills - left.kills || right.hits - left.hits || left.weapon.localeCompare(right.weapon));
}

function fightEvents(review: MatchReviewResult, fight: ReviewTurningPoint | MatchReviewResult['facts']['fights'][number]) {
  const evidenceIds = new Set(fight.evidenceIds);
  return review.facts.combat.events.filter((event) => evidenceIds.has(event.id));
}

function fightDamageLeaders(review: MatchReviewResult, fight: MatchReviewResult['facts']['fights'][number]): Array<{ playerId: string; damage: number }> {
  const teamIds = new Set(recordedPlayers(review).map((player) => player.playerId));
  const byPlayer = new Map<string, number>();
  for (const event of fightEvents(review, fight)) {
    if (event.type !== 'DAMAGE' || !event.actorId || !teamIds.has(event.actorId)) continue;
    byPlayer.set(event.actorId, (byPlayer.get(event.actorId) ?? 0) + event.damage);
  }
  const leaders = [...byPlayer.entries()]
    .map(([playerId, damageValue]) => ({ playerId, damage: damageValue }))
    .sort((left, right) => right.damage - left.damage || left.playerId.localeCompare(right.playerId));
  if (leaders.length || !fight.keyPlayers.length || fight.teamDamage <= 0) return leaders;
  // Compact feature-cache records intentionally omit the normalized event
  // stream. Keep the derived fight key player usable in the default report.
  const keyPlayer = fight.keyPlayers.find((playerId) => teamIds.has(playerId));
  return keyPlayer ? [{ playerId: keyPlayer, damage: fight.teamDamage }] : leaders;
}

function operationForFight(review: MatchReviewResult, fightId: string, types: string[]) {
  return review.facts.players
    .flatMap((player) => player.keyOperations)
    .filter((operation) => operation.facts.fightId === fightId && types.includes(operation.type))
    .sort((left, right) => right.impactScore - left.impactScore || (left.time ?? Number.POSITIVE_INFINITY) - (right.time ?? Number.POSITIVE_INFINITY))[0] ?? null;
}

function finalLossFight(review: MatchReviewResult) {
  if (!review.facts.fightIntegrity.pass) return null;
  return [...review.facts.fights]
    .filter((fight) => fight.result === 'LOSS')
    .sort((left, right) => right.end - left.end)[0] ?? null;
}

function fightOrdinal(review: MatchReviewResult, fightId: string): number {
  return Math.max(1, review.facts.fights.findIndex((fight) => fight.id === fightId) + 1);
}

function resultLabel(result: string): string {
  return ({ WIN: '赢下', LOSS: '未收口', TRADE: '高收益交换', UNKNOWN: '接触' } as Record<string, string>)[result] ?? result;
}

function itemLabel(value: string): string {
  const normalized = value.replace(/^Item_/iu, '').replace(/^Weapon_/iu, '').replace(/_C$/u, '');
  if (/dot.?sight|red.?dot/u.test(normalized)) return '红点';
  const labels: Record<string, string> = {
    Ammo_762mm: '7.62mm弹药',
    Ammo_556mm: '5.56mm弹药',
    Ammo_9mm: '9mm弹药',
    PanzerFaust100M: 'Panzerfaust',
    FlashBang: '闪光弹',
    Grenade: '手雷',
    SmokeBomb: '烟雾弹',
    Molotov: '燃烧瓶',
    BluezoneGrenade: '蓝区手雷',
    Heal_Bandage: '绷带',
    Heal_FirstAid: '急救包',
    Boost_EnergyDrink: '能量饮料',
    Boost_PainKiller: '止痛药',
    Boost_AdrenalineSyringe: '肾上腺素',
  };
  return labels[normalized] ?? normalized;
}

function weaponLabel(value: string): string {
  const normalized = value.replace(/^Weap/iu, '').replace(/_C$/u, '').replace(/^Item_Weapon_/iu, '');
  return ({
    ProjGrenade: '手雷',
    Grenade: '手雷',
    SmokeBomb: '烟雾弹',
    Molotov: '燃烧瓶',
    StunGun: '电击枪',
    PanzerFaust: 'Panzerfaust',
    PanzerFaust100M: 'Panzerfaust',
    AUGA3: 'AUG',
    BerylM762: 'Beryl M762',
    Kar98k: 'Kar98k',
    M24: 'M24',
    RPD: 'RPD',
  } as Record<string, string>)[normalized] ?? normalized;
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
      const shot = weapon.shots > 0 ? `${weapon.shots}发 · ${weapon.hits}次命中记录` : `拾取${weapon.pickupEvents}次 · 未发射`;
      const impact: string[] = [];
      if (weapon.playerDamage > 0) impact.push(`${integer(weapon.playerDamage)}人体伤害`);
      if (weapon.vehicleDamage > 0) impact.push(`${integer(weapon.vehicleDamage)}载具伤害`);
      if (weapon.kills > 0) impact.push(`${weapon.kills}杀`);
      if (weapon.knocks > 0) impact.push(`${weapon.knocks}倒地`);
      if (weapon.vehiclesDestroyed > 0) impact.push(`摧毁${weapon.vehiclesDestroyed}辆载具`);
      return `🚀 ${weapon.weapon} · ${shot}${impact.length ? ` · ${impact.join(' · ')}` : ''}`;
    });
}

function playerContributionLine(review: MatchReviewResult, player: ReviewPlayerFacts): string | null {
  if (player.matchPresence === 'not_recorded') return null;
  const parts: string[] = [];
  const share = percentage(player.damage, review.facts.squad.damage);
  if (share && player.damage > 0) parts.push(`队伍伤害占比${share}`);
  if (player.dbnos > 0) parts.push(`倒地→击杀 ${player.kills}/${player.dbnos}（${Math.round((player.kills / player.dbnos) * 100)}%）`);
  if (player.assists > 0) parts.push(`${player.assists}次助攻`);
  if (player.revives > 0) parts.push(`${player.revives}次救援`);
  return parts.length ? `📊 ${parts.join(' · ')}` : null;
}

const MOBILE_COMMENTARY_LINE_LENGTH = 28;
const COMMENTARY_BREAK_CHARS = new Set(['。', '！', '？', '；', '，', '、', ',', '!', '?', ';', '：', ':']);

/** Keep player comments scannable on narrow screens without changing their content. */
function mobileCommentaryLines(text: string): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (!normalized) return ['暂无点评'];

  const characters = Array.from(normalized);
  const lines: string[] = [];
  let offset = 0;
  while (characters.length - offset > MOBILE_COMMENTARY_LINE_LENGTH) {
    const limit = offset + MOBILE_COMMENTARY_LINE_LENGTH;
    let cut = limit;
    for (let index = limit - 1; index >= offset + Math.floor(MOBILE_COMMENTARY_LINE_LENGTH * 0.55); index -= 1) {
      if (COMMENTARY_BREAK_CHARS.has(characters[index] ?? '')) {
        cut = index + 1;
        break;
      }
    }
    lines.push(characters.slice(offset, cut).join('').trim());
    offset = cut;
  }
  const tail = characters.slice(offset).join('').trim();
  if (tail) lines.push(tail);
  return lines.length ? lines : ['暂无点评'];
}

function playerSection(review: MatchReviewResult, player: ReviewPlayerFacts, profile: string): PresentationSection {
  if (player.matchPresence === 'not_recorded') {
    return {
      type: 'players',
      title: player.playerName,
      text: `👑 ${player.playerName}\n-`,
      data: {
        playerId: player.playerId,
        operationIds: [],
        section: 'key_operations',
        vehicle: null,
        heavyWeapons: [],
        matchPresence: 'not_recorded',
      },
    };
  }
  const commentary = review.analysis.playerCommentary.find((item) => item.playerId === player.playerId);
  const lines = [
    '━━━━━━━━━━━━━━',
    `👑 ${player.playerName}${player.matchRole ? ` · ${player.matchRole}` : ''}`,
    '━━━━━━━━━━━━━━',
    `${player.kills}杀 · ${player.assists}助 · ${integer(player.damage)}伤害`,
    `${player.dbnos}倒地 · ${player.revives}救援 · ${rankLabel(player.rank)}`,
  ];
  const contribution = playerContributionLine(review, player);
  if (contribution) lines.push(contribution);
  const vehicle = vehicleLine(player);
  if (vehicle && (profile === 'default' || profile === 'vehicle' || profile === 'detailed' || profile === 'fun')) lines.push(vehicle);
  const heavy = heavyWeaponLine(player);
  if (heavy.length && (profile === 'default' || profile === 'weapon' || profile === 'detailed' || profile === 'fun')) lines.push(...heavy);
  if (profile !== 'vehicle' && profile !== 'weapon') {
    lines.push('', '⭐ 关键操作');
    if (player.keyOperations.length) {
      for (const operation of player.keyOperations) lines.push(`${operationIcon(operation.type)}${operation.time === null ? '' : ` ${clock(operation.time)}`}
${operation.impact}`);
    } else {
      lines.push('— 未发现足够影响战局的关键操作');
    }
    lines.push('', '💬 点评', ...mobileCommentaryLines(commentary?.text ?? '暂无点评'));
    if (commentary?.improvements.length && !commentary.text.includes('锐评：')) lines.push(`⚠️ ${commentary.improvements.join('；')}`);
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
      matchPresence: player.matchPresence ?? 'recorded',
    },
  };
}

function playerStatsLine(review: MatchReviewResult, player: ReviewPlayerFacts): string {
  const parts = [`${player.kills}杀`];
  if (player.assists > 0) {
    parts.push(`${player.assists}助攻`, `${integer(player.damage)}伤害`, `${player.dbnos}倒地`);
  } else {
    parts.push(`${player.dbnos}倒地`, `${integer(player.damage)}伤害`);
  }
  if (player.revives > 0) parts.push(`${player.revives}次救援`);
  const top = firepowerPlayer(review);
  if (top?.playerId === player.playerId && player.damage > 0) parts.push('全队最高伤害');
  return parts.join(' · ');
}

function vehicleImpactForPlayer(review: MatchReviewResult, playerId: string) {
  return [...(review.facts.vehicleImpacts ?? [])]
    .filter((item) => item.playerId === playerId && (item.wheelsDestroyed > 0 || item.vehicleDamage > 0 || item.playerDamage > 0 || item.knocks > 0 || item.kills > 0))
    .sort((left, right) => right.wheelsDestroyed - left.wheelsDestroyed || right.vehicleDamage - left.vehicleDamage || (left.time ?? Number.POSITIVE_INFINITY) - (right.time ?? Number.POSITIVE_INFINITY))[0] ?? null;
}

function vehicleImpactWeapon(review: MatchReviewResult, attackId: string): string | null {
  const event = review.facts.combat.events.find((item) => item.attackId === attackId && item.weaponId);
  return event?.weaponId ? weaponLabel(event.weaponId) : null;
}

function vehicleImpactDetails(impact: NonNullable<ReturnType<typeof vehicleImpactForPlayer>>): string | null {
  const parts: string[] = [];
  if (impact.wheelsDestroyed > 0) parts.push(`击破${impact.wheelsDestroyed}个车辆轮胎`);
  if (impact.vehicleDamage > 0) parts.push(`约${integer(impact.vehicleDamage)}载具伤害`);
  if (impact.playerDamage > 0) parts.push(`约${integer(impact.playerDamage)}人体伤害`);
  if (impact.knocks > 0) parts.push(`${impact.knocks}次倒地`);
  if (impact.kills > 0) parts.push(`${impact.kills}次击杀`);
  if (impact.vehicleDestroyed > 0) parts.push(`摧毁${impact.vehicleDestroyed}辆载具`);
  if (!parts.length) return null;
  return parts.join('，');
}

function vehicleImpactText(review: MatchReviewResult, playerId: string): string | null {
  const impact = vehicleImpactForPlayer(review, playerId);
  if (!impact) return null;
  const details = vehicleImpactDetails(impact);
  if (!details) return null;
  const weapon = vehicleImpactWeapon(review, impact.attackId);
  return `${weapon ?? '载具链'}${details}`;
}

function armorBreakText(review: MatchReviewResult, playerId: string): string | null {
  const armorBreak = review.facts.armorBreaks?.find((item) => item.actorPlayerId === playerId && item.followUp !== null);
  if (!armorBreak) return null;
  const weapon = weaponLabel(armorBreak.weapon ?? '攻击');
  const distance = armorBreak.distanceMeters !== null && armorBreak.distanceMeters >= 100 ? '远距离' : '';
  return `${weapon}完成${distance}破甲后${armorBreak.followUp === 'KILL' ? '收尾' : '接倒地'}`;
}

function playerWeaponDamageText(review: MatchReviewResult, playerId: string): string | null {
  const weapons = playerWeapons(review, playerId).filter((weapon) => weapon.damage > 0);
  const clauses = weapons.slice(0, 4).map((weapon) => `${weaponLabel(weapon.weapon)}造成约${integer(weapon.damage)}伤害`);
  const vehicle = vehicleImpactText(review, playerId);
  if (vehicle) clauses.push(`另外${vehicle}`);
  return clauses.length ? `${clauses.join('；')}。` : null;
}

function playerHeavyWeaponText(player: ReviewPlayerFacts): string | null {
  const weapons = player.heavyWeapons
    .filter((weapon) => weapon.evidenceIds.length > 0)
    .map((weapon) => {
      const impact: string[] = [];
      if (weapon.pickupEvents > 0) impact.push(`拾取${weapon.pickupEvents}次`);
      if (weapon.shots > 0) impact.push(`${weapon.shots}发`);
      if (weapon.hits > 0) impact.push(`${weapon.hits}次命中`);
      if (weapon.playerDamage > 0) impact.push(`约${integer(weapon.playerDamage)}人体伤害`);
      if (weapon.vehicleDamage > 0) impact.push(`约${integer(weapon.vehicleDamage)}载具伤害`);
      if (weapon.knocks > 0) impact.push(`${weapon.knocks}次倒地`);
      if (weapon.kills > 0) impact.push(`${weapon.kills}次击杀`);
      if (weapon.vehiclesDestroyed > 0) impact.push(`摧毁${weapon.vehiclesDestroyed}辆载具`);
      return `${weaponLabel(weapon.weapon)}${impact.length ? `：${impact.join(' · ')}` : ''}`;
    });
  return weapons.length ? `${weapons.join('；')}。` : null;
}

function commentaryParts(text: string): { facts: string; critique: string } {
  const marker = '锐评：';
  const index = text.indexOf(marker);
  if (index < 0) return { facts: text.trim(), critique: '' };
  return { facts: text.slice(0, index).trim(), critique: text.slice(index + marker.length).trim() };
}

function mobileCommentaryGroups(groups: string[][]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    const groupLines = group.flatMap((line) => line.split('\n').flatMap((part) => mobileCommentaryLines(part)));
    if (!groupLines.length) continue;
    if (lines.length && lines.at(-1) !== '') lines.push('');
    lines.push(...groupLines);
  }
  return lines.length ? lines : ['暂无点评'];
}

function templatePlayerAwards(review: MatchReviewResult, playerId: string): string[] {
  const awards = (review.analysis.awards ?? [])
    .filter((award) => award.playerId === playerId && !award.title.includes('垃圾佬') && !award.title.includes('救援'))
    .map((award) => award.title);
  const mvp = combatMvp(review);
  if (mvp?.playerId === playerId && !awards.includes('本局MVP')) awards.push('本局MVP');
  const hunter = meleeHunter(review);
  if (hunter?.playerId === playerId) awards.push('队友猎人警告');
  return [...new Set(awards)];
}

function templatePlayerAwardIcon(awards: string[]): string {
  if (awards.some((award) => award.includes('队友猎人') || award.includes('警告'))) return '⚠️';
  if (awards.some((award) => award.includes('火力炮台'))) return '🎖';
  return '🏆';
}

function finalLossCommentary(review: MatchReviewResult, player: ReviewPlayerFacts): string | null {
  const finalLoss = finalLossFight(review);
  if (!finalLoss || finalLoss.receivedKills <= 0 || !finalLoss.participants.includes(player.playerId)) return null;
  return `末战开始后${finalLoss.receivedKnocks > 0 ? '很快先被击倒，' : ''}随后在敌方集火下被淘汰。`;
}

function templatePlayerCommentaryGroups(review: MatchReviewResult, player: ReviewPlayerFacts): string[][] {
  const commentary = review.analysis.playerCommentary.find((item) => item.playerId === player.playerId);
  const groups: string[][] = [];
  const weapons = playerWeapons(review, player.playerId);
  const topWeapon = weapons[0];
  const conversion = conversionRate(review, player);
  const bestConversion = bestConversionPlayer(review);
  const finalLoss = finalLossFight(review);
  const hunter = meleeHunter(review);
  const outgoingMelee = meleeBreakdown(review, player.playerId, 'outgoing');
  const stunGun = review.facts.stunGuns?.find((item) => item.playerId === player.playerId && (item.pickups > 0 || item.shots > 0));
  const vehicleImpact = vehicleImpactForPlayer(review, player.playerId);
  const heavyWeaponText = playerHeavyWeaponText(player);

  if (player.kills > 0) {
    if (topWeapon && topWeapon.hits > 0) {
      groups.push([`${weaponLabel(topWeapon.weapon)}只有${topWeapon.hits}次有效命中记录，却换来${player.dbnos}倒地、${player.kills}击杀${bestConversion?.playerId === player.playerId ? '，转化率是全队最高' : conversion === null ? '' : `，转化率${conversion}%`}。`]);
    } else {
      groups.push([`本局完成${player.kills}次击杀和${player.dbnos}次倒地${conversion === null ? '' : `，倒地转化率${conversion}%`}。`]);
    }
    const mainFight = [...review.facts.fights]
      .filter((fight) => fight.eventCount > 0 && fight.teamKills > 0 && fight.participants.includes(player.playerId))
      .sort((left, right) => right.teamKills - left.teamKills || right.importanceScore - left.importanceScore || left.start - right.start)[0];
    const multiKnock = mainFight ? operationForFight(review, mainFight.id, ['MULTI_KNOCK']) : null;
    const clutch = mainFight ? operationForFight(review, mainFight.id, ['CLUTCH']) : null;
    const armor = armorBreakText(review, player.playerId);
    const actionSentence: string[] = [];
    if (mainFight && (multiKnock || clutch)) {
      actionSentence.push(`第${fightOrdinal(review, mainFight.id)}波团战${mainFight.teamKills > 0 && mainFight.teamKnocks > 0 ? `由你主动开火，连续完成${mainFight.teamKnocks}次击倒并收下${mainFight.teamKills}次击杀` : `由你完成${mainFight.teamKills}次击杀`}`);
    }
    if (armor) actionSentence.push(`还用${armor}`);
    if (vehicleImpact && vehicleImpact.wheelsDestroyed >= 4) {
      const weapon = vehicleImpactWeapon(review, vehicleImpact.attackId);
      actionSentence.push(`${weapon ?? '重火力'}一炮四轮，${vehicleImpactDetails(vehicleImpact) ?? '把载具链打穿'}`);
    }
    if (actionSentence.length) groups.push([`${actionSentence.join('；')}。`]);
    groups.push([`你是本局${player.kills >= 2 ? '唯一' : '少数'}把“打中人”变成“送人进观战席”的人，队伍能拿${rankLabel(review.match.placement)}，主要靠你把这波团战接住了。`]);
  } else if (player.damage >= Math.max(120, review.facts.squad.damage * 0.3)) {
    const weaponText = playerWeaponDamageText(review, player.playerId);
    if (weaponText) groups.push([weaponText]);
    groups.push(['你的枪是开了的，问题是没有收口。']);
    const earlyFights = review.facts.fights.filter((fight) => fight.start < (finalLoss?.start ?? Number.POSITIVE_INFINITY)
      && fight.teamKills === 0 && fight.teamKnocks === 0 && fight.participants.includes(player.playerId));
    if (earlyFights.length >= 2) groups.push([`${earlyFights.length}次早期交火都打出了伤害，却没有留下倒地。`]);
    else if (earlyFights.length === 1) groups.push(['早期交火打出了伤害，却没有留下倒地。']);
    if (finalLossCommentary(review, player)) groups.push([`末战中也只是打出零散命中，最后被敌方直接清掉。`]);
    groups.push(['一句话：', '你把敌人的血条打成了报表，却没把任何人送回大厅。']);
    const weaponNames = weapons.slice(0, 3).map((weapon) => weaponLabel(weapon.weapon));
    groups.push([`你不是伤害统计器。${weaponNames.length ? `${weaponNames.join('、')}打出缺口后，必须跟上补枪；` : ''}如果只是每波贡献一点伤害，最后所有数字都会变成没有意义的墓志铭。`]);
  } else if (player.assists > 0 || topWeapon || (review.facts.flash ?? []).some((item) => item.playerId === player.playerId && item.uses > 0)) {
    const evidence: string[] = [];
    if (topWeapon && topWeapon.hits > 0) evidence.push(`${weaponLabel(topWeapon.weapon)}只有${topWeapon.hits}次有效命中记录，没有形成击倒`);
    const flash = review.facts.flash?.find((item) => item.playerId === player.playerId && item.uses > 0);
    if (flash) evidence.push(`使用${flash.uses}次闪光弹，但没有可确认的敌方控制收益`);
    if (evidence.length) groups.push([`${evidence.join('；')}。`]);
    if (outgoingMelee.hitCount && hunter?.playerId === player.playerId) {
      const victim = [...outgoingMelee.byVictim.entries()].sort((left, right) => right[1].hitCount - left[1].hitCount || right[1].damage - left[1].damage || left[0].localeCompare(right[0]))[0];
      if (victim) groups.push([`本局最稳定的命中对象是${shortPlayerName(review, victim[0])}：`, `* ${meleeActionText(victim[1].actions)}`, `* 约${damage(victim[1].damage)}点队内伤害`]);
    }
    const loss = finalLossCommentary(review, player);
    if (loss) groups.push([`你的${topWeapon ? weaponLabel(topWeapon.weapon) : '火力'}没有把敌人打倒，拳脚却把队友打得很稳定。${loss}`]);
    if (review.facts.flash?.some((item) => item.playerId === player.playerId && item.uses > 0)) groups.push(['闪光弹像烟花，队友却像固定靶。', '道具不是庆典用品，扔出去要换来压制、转点、倒地或撤退。先停止队内互殴，再把有效命中变成一次真正的战果。']);
  } else if (commentary?.text && commentary.text !== '-') {
    const parts = commentaryParts(commentary.text);
    if (parts.facts) groups.push([parts.facts]);
  }

  if (heavyWeaponText) groups.push([heavyWeaponText]);

  if (stunGun) {
    groups.push([`电击枪使用${stunGun.shots}次，${stunGun.confirmedHits > 0 ? `确认命中${stunGun.confirmedHits}次` : '未确认命中对象'}。`]);
  }

  if (outgoingMelee.hitCount && hunter?.playerId !== player.playerId) {
    const action = meleeActionText(outgoingMelee.actions);
    groups.push([action.startsWith(outgoingMelee.hitCount.toString()) && outgoingMelee.actions.size === 1
      ? `但队内踢人${outgoingMelee.hitCount}次，造成约${damage(outgoingMelee.damage)}点友伤。`
      : `但队内近战${action}，造成约${damage(outgoingMelee.damage)}点友伤。`]);
  }
  if (outgoingMelee.hitCount && hunter?.playerId === player.playerId && player.kills > 0) {
    groups.push([`但队内踢人${outgoingMelee.hitCount}次，造成约${damage(outgoingMelee.damage)}点友伤。`]);
  }
  if (player.kills > 0 && outgoingMelee.hitCount) {
    groups.push(['你是终结者，不是队内裁判。敌人还没冲进来，队友先被你踢掉一管血。主C的刀应该朝敌人挥，不要把队友当训练假人。']);
  }
  if (commentary?.improvements?.length && !groups.some((group) => group.some((line) => line.includes('末战') || line.includes('队内踢人') || line.includes('伤害统计器')))) {
    groups.push([`${commentary.improvements.slice(0, 2).join('；')}。`]);
  }
  return groups.length ? groups : [['本场没有足够战斗数据，不强行点评。']];
}

function templatePlayerSection(review: MatchReviewResult, player: ReviewPlayerFacts, includeHeading: boolean): PresentationSection {
  if (player.matchPresence === 'not_recorded') {
    return {
      type: 'players',
      title: player.playerName,
      text: `${includeHeading ? '👥 队员点评\n\n' : ''}${player.playerName}\n-`,
      data: { playerId: player.playerId, operationIds: [], section: 'players', vehicle: null, heavyWeapons: [], matchPresence: 'not_recorded' },
    };
  }
  const awards = templatePlayerAwards(review, player.playerId);
  const heading = awards.length ? `${player.playerName} · ${awards.join(' / ')}` : player.playerName;
  const lines = [
    ...(includeHeading ? ['👥 队员点评', ''] : []),
    `${templatePlayerAwardIcon(awards)} ${heading}`,
    playerStatsLine(review, player),
    '',
    ...mobileCommentaryGroups(templatePlayerCommentaryGroups(review, player)),
  ];
  return {
    type: 'players',
    title: player.playerName,
    text: lines.join('\n'),
    data: { playerId: player.playerId, operationIds: player.keyOperations.map((operation) => operation.id), section: 'players', vehicle: player.vehicle ?? null, heavyWeapons: player.heavyWeapons, matchPresence: player.matchPresence ?? 'recorded', awards },
  };
}

function weaponLine(review: MatchReviewResult, weapon: WeaponStats): string {
  const player = playerName(review, weapon.playerId);
  const impact: string[] = [];
  if (weapon.damage > 0) impact.push(`${integer(weapon.damage)}伤害`);
  if (weapon.hits > 0) impact.push(`${weapon.hits}次命中记录`);
  if (weapon.knocks > 0) impact.push(`${weapon.knocks}倒地`);
  if (weapon.kills > 0) impact.push(`${weapon.kills}杀`);
  if (!impact.length && weapon.shots > 0) impact.push(`${weapon.shots}次攻击记录，未形成伤害命中`);
  return `• ${player} · ${weaponLabel(weapon.weapon)} · ${impact.join(' · ')}`;
}

function weaponSection(review: MatchReviewResult): PresentationSection | null {
  const weapons = review.facts.weapons
    .filter((weapon) => weapon.evidenceIds.length > 0 && (weapon.damage > 0 || weapon.hits > 0 || weapon.knocks > 0 || weapon.kills > 0))
    .sort((left, right) => right.damage - left.damage || right.kills - left.kills || right.shots - left.shots)
    .slice(0, 12);
  if (!weapons.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🔫 武器信息', '━━━━━━━━━━━━━━', '命中记录来自伤害/倒地事件，不把攻击次数直接当作命中率。', ...weapons.map((weapon) => weaponLine(review, weapon))];
  return { type: 'weapons', title: 'weapons', text: lines.join('\n'), data: { weapons } };
}

function interactionsSection(review: MatchReviewResult): PresentationSection | null {
  const facts = review.facts;
  const names = new Map(facts.players.map((player) => [player.playerId, player.playerName]));
  const lines = ['━━━━━━━━━━━━━━', '🥊 队内伤害账本', '━━━━━━━━━━━━━━'];
  const melee = (facts.teamDamage ?? []).filter((fact) => fact.source === 'MELEE');
  const meleeByDirection = new Map<string, { actorPlayerId: string; victimPlayerId: string; phase: Set<string>; hitCount: number; damage: number; evidenceIds: string[]; actions: Map<string, number> }>();
  for (const fact of melee) {
    const key = `${fact.actorPlayerId}:${fact.victimPlayerId}`;
    const current = meleeByDirection.get(key) ?? {
      actorPlayerId: fact.actorPlayerId,
      victimPlayerId: fact.victimPlayerId,
      phase: new Set<string>(),
      hitCount: 0,
      damage: 0,
      evidenceIds: [],
      actions: new Map<string, number>(),
    };
    current.hitCount += fact.hitCount;
    current.damage += fact.damage;
    current.evidenceIds.push(...fact.evidenceIds);
    if (fact.phase) current.phase.add(fact.phase);
    const kind = fact.meleeKind ?? meleeKindOf(fact.weapon ?? null, fact.damageTypeCategory ?? null);
    current.actions.set(kind, (current.actions.get(kind) ?? 0) + fact.hitCount);
    meleeByDirection.set(key, current);
  }
  const actionLabels: Record<string, string> = { KICK: '脚', PUNCH: '拳', OTHER: '近战' };
  for (const item of meleeByDirection.values()) {
    const actions = [...item.actions.entries()]
      .sort(([left], [right]) => ({ KICK: 1, PUNCH: 2, OTHER: 3 }[left] ?? 9) - ({ KICK: 1, PUNCH: 2, OTHER: 3 }[right] ?? 9))
      .map(([kind, count]) => `${count}${actionLabels[kind] ?? '次'}`)
      .join(' + ');
    const phase = item.phase.size > 1 ? ` · ${[...item.phase].map((value) => value === 'pre_match' ? '赛前' : value === 'in_match' ? '正赛' : '未知阶段').join('/')}` : '';
    lines.push(`• ${names.get(item.actorPlayerId) ?? item.actorPlayerId} → ${names.get(item.victimPlayerId) ?? item.victimPlayerId}：${actions} · ${damage(item.damage)}伤害${phase}`);
  }
  const other = (facts.teamDamage ?? []).filter((fact) => fact.source !== 'MELEE');
  for (const fact of other) {
    const source = fact.source === 'EXPLOSIVE' ? '手雷/爆炸物' : fact.source === 'GUN' ? '枪械' : fact.source === 'VEHICLE' ? '载具' : '近战';
    lines.push(`• ${names.get(fact.actorPlayerId) ?? fact.actorPlayerId} → ${names.get(fact.victimPlayerId) ?? fact.victimPlayerId}：${source}${fact.hitCount}次 · ${damage(fact.damage)}伤害`);
  }
  const stun = (facts.stunGuns ?? []).filter((item) => item.pickups > 0 || item.shots > 0);
  for (const item of stun) lines.push(`• ${names.get(item.playerId) ?? item.playerId}：电击枪拾取${item.pickups}次 · 开火${item.shots}次 · ${item.confirmedHits > 0 ? `确认命中${item.confirmedHits}次` : '未确认命中对象'}`);
  if (!melee.length && !other.length && !stun.length) return null;
  if (melee.length) {
    const eventCount = new Set(melee.flatMap((fact) => fact.evidenceIds)).size;
    const hitCount = melee.reduce((sum, fact) => sum + fact.hitCount, 0);
    const totalDamage = melee.reduce((sum, fact) => sum + fact.damage, 0);
    lines.push('', `近战对账：${eventCount}/${hitCount}条命中事件 · ${damage(totalDamage)}点友伤${eventCount === hitCount ? ' · 数据齐全' : ' · ⚠️ 事件数与命中数不一致'}`);
    const directions = [...meleeByDirection.values()];
    if (directions.length >= 2 && directions.some((left) => directions.some((right) => left.actorPlayerId === right.victimPlayerId && left.victimPlayerId === right.actorPlayerId))) lines.push('🚨 组合：本场出现双向队友拳击/近战，训练场切磋打进了正赛。');
  }
  if (melee.length && other.some((fact) => fact.source === 'EXPLOSIVE')) lines.push('🚨 组合：双向队友拳击/近战 + 投掷物误伤，形成误伤三件套，协同安全直接破产。');
  return { type: 'interactions', title: 'interactions', text: lines.join('\n'), data: { teamDamage: facts.teamDamage ?? [], stunGuns: stun, meleeLedgerComplete: melee.length === 0 || new Set(melee.flatMap((fact) => fact.evidenceIds)).size === melee.reduce((sum, fact) => sum + fact.hitCount, 0) } };
}

function templateInteractionsSection(review: MatchReviewResult): PresentationSection {
  const melee = (review.facts.teamDamage ?? []).filter((fact) => fact.source === 'MELEE');
  const names = new Map(review.facts.players.map((player) => [player.playerId, player.playerName]));
  const byDirection = new Map<string, { actorPlayerId: string; victimPlayerId: string; actions: Map<string, number>; damage: number }>();
  for (const fact of melee) {
    const key = `${fact.actorPlayerId}:${fact.victimPlayerId}`;
    const current = byDirection.get(key) ?? { actorPlayerId: fact.actorPlayerId, victimPlayerId: fact.victimPlayerId, actions: new Map<string, number>(), damage: 0 };
    const kind = fact.meleeKind ?? meleeKindOf(fact.weapon ?? null, fact.damageTypeCategory ?? null);
    current.actions.set(kind, (current.actions.get(kind) ?? 0) + fact.hitCount);
    current.damage += fact.damage;
    byDirection.set(key, current);
  }
  const eventCount = new Set(melee.flatMap((fact) => fact.evidenceIds)).size;
  const hitCount = melee.reduce((sum, fact) => sum + fact.hitCount, 0);
  const totalDamage = melee.reduce((sum, fact) => sum + fact.damage, 0);
  const complete = eventCount === hitCount;
  const lines = [
    '🥊 队内伤害账本',
    '',
    `已核对原始近战事件 ${eventCount}/${hitCount}，${complete ? '无遗漏、无其他队内近战记录。' : '事件数与命中数不一致，需复核。'}`,
  ];
  for (const item of byDirection.values()) {
    lines.push(`* ${names.get(item.actorPlayerId) ?? item.actorPlayerId} → ${names.get(item.victimPlayerId) ?? item.victimPlayerId}：${meleeActionText(item.actions)} · ${damage(item.damage)}伤害`);
  }
  if (melee.length) {
    const totalActions = new Map<string, number>();
    for (const fact of melee) {
      const kind = fact.meleeKind ?? meleeKindOf(fact.weapon ?? null, fact.damageTypeCategory ?? null);
      totalActions.set(kind, (totalActions.get(kind) ?? 0) + fact.hitCount);
    }
    lines.push('', `合计：${meleeActionText(totalActions)}，${damage(totalDamage)}点友伤。`);
  } else {
    lines.push('* 本场没有可确认的队内近战记录。');
  }
  const nonMelee = (review.facts.teamDamage ?? []).filter((fact) => fact.source !== 'MELEE');
  if (nonMelee.length) {
    const bySource = new Map<string, { hits: number; damage: number }>();
    for (const fact of nonMelee) {
      const key = fact.source === 'EXPLOSIVE' ? '投掷物' : fact.source === 'GUN' ? '枪械' : fact.source === 'VEHICLE' ? '载具' : '其他';
      const current = bySource.get(key) ?? { hits: 0, damage: 0 };
      current.hits += fact.hitCount;
      current.damage += fact.damage;
      bySource.set(key, current);
    }
    lines.push('', `其他队内伤害：${[...bySource.entries()].map(([source, value]) => `${source}${value.hits}次 · ${damage(value.damage)}伤害`).join('；')}。`);
  }
  return {
    type: 'interactions',
    title: 'interactions',
    text: lines.join('\n'),
    data: {
      teamDamage: review.facts.teamDamage ?? [],
      meleeLedgerComplete: complete,
      meleeEventCount: eventCount,
      meleeHitCount: hitCount,
      meleeDamage: totalDamage,
    },
  };
}

function recoveryLine(review: MatchReviewResult, playerId: string): string | null {
  const stats = review.facts.recovery?.find((item) => item.playerId === playerId);
  if (!stats) return null;
  const healing: string[] = [];
  if (stats.bandages) healing.push(`绷带${stats.bandages}`);
  if (stats.firstAids) healing.push(`急救包${stats.firstAids}`);
  if (stats.medKits) healing.push(`医疗箱${stats.medKits}`);
  const boosts: string[] = [];
  if (stats.adrenaline) boosts.push(`肾上腺素${stats.adrenaline}`);
  if (stats.energyDrinks) boosts.push(`能量饮料${stats.energyDrinks}`);
  if (stats.painkillers) boosts.push(`止痛药${stats.painkillers}`);
  if (stats.otherUses) boosts.push(`其他增益${stats.otherUses}`);
  const lines = [`• ${playerName(review, playerId)}`];
  if (healing.length) lines.push(`  治疗：${healing.join(' · ')}`);
  if (boosts.length) lines.push(`  能量/增益：${boosts.join(' · ')}`);
  return lines.join('\n');
}

function recoverySection(review: MatchReviewResult): PresentationSection | null {
  const stats = review.facts.recovery ?? [];
  if (!stats.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '💊 恢复物品与能量', '━━━━━━━━━━━━━━', ...stats.map((item) => recoveryLine(review, item.playerId)).filter((item): item is string => Boolean(item))];
  return { type: 'recovery', title: 'recovery', text: lines.join('\n'), data: { recovery: stats } };
}

function lootSection(review: MatchReviewResult): PresentationSection | null {
  const stats = review.facts.loot ?? [];
  const activity = review.facts.lootActivity ?? [];
  const transfers = review.facts.vehicleTrunk ?? [];
  if (!stats.length && !activity.length && !transfers.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🗑️ 垃圾佬榜', '━━━━━━━━━━━━━━'];
  const activityPlayerIds = new Set<string>();
  const trunkCounts = new Map<string, number>();
  for (const transfer of transfers) trunkCounts.set(transfer.playerId, (trunkCounts.get(transfer.playerId) ?? 0) + 1);
  for (const item of [...activity].sort((left, right) => (right.pickupEvents + right.lootBoxPickups) - (left.pickupEvents + left.lootBoxPickups) || left.playerId.localeCompare(right.playerId))) {
    activityPlayerIds.add(item.playerId);
    const movement: string[] = [];
    const pickedUp = item.pickupEvents + item.lootBoxPickups;
    if (pickedUp > 0) movement.push(`拾取${pickedUp}`);
    if (item.dropEvents > 0) movement.push(`丢弃${item.dropEvents}`);
    const trunkCount = trunkCounts.get(item.playerId) ?? 0;
    if (trunkCount > 0) movement.push(`车厢${trunkCount}`);
    if (item.cosmeticPickups > 0) movement.push(`外观${item.cosmeticPickups}`);
    lines.push(`• ${playerName(review, item.playerId)}：${movement.join(' · ') || '—'}`);
  }
  for (const item of stats) {
    if (activityPlayerIds.has(item.playerId)) continue;
    lines.push(`• ${playerName(review, item.playerId)}：搜包${item.lootBoxPickups}`);
  }
  for (const [playerId, count] of trunkCounts) {
    if (!activityPlayerIds.has(playerId)) lines.push(`• ${playerName(review, playerId)}：车厢存取${count}`);
  }
  return { type: 'loot', title: 'loot', text: lines.join('\n'), data: { loot: stats, lootActivity: activity, vehicleTrunk: transfers } };
}

function templateLootRecords(review: MatchReviewResult) {
  const activity = review.facts.lootActivity ?? [];
  const loot = review.facts.loot ?? [];
  const transfers = review.facts.vehicleTrunk ?? [];
  return recordedPlayers(review)
    .map((player) => {
      const movement = activity.find((item) => item.playerId === player.playerId);
      const boxes = loot.find((item) => item.playerId === player.playerId)?.lootBoxPickups ?? 0;
      const transferItems = transfers.filter((item) => item.playerId === player.playerId);
      return {
        player,
        pickup: movement?.pickupEvents ?? 0,
        drops: movement?.dropEvents ?? 0,
        boxes: Math.max(movement?.lootBoxPickups ?? 0, boxes),
        cosmetics: movement?.cosmeticPickups ?? 0,
        transferItems,
        hasEvidence: Boolean(movement || boxes || transferItems.length),
      };
    })
    .filter((item) => item.hasEvidence);
}

function distinctLootRecord<T extends { player: ReviewPlayerFacts }>(records: T[], excluded: Set<string>, predicate: (record: T) => boolean): T | null {
  return records.find((record) => !excluded.has(record.player.playerId) && predicate(record))
    ?? records.find((record) => predicate(record))
    ?? null;
}

function lootTransferText(record: { transferItems: Array<{ item: string }> }): string | null {
  if (!record.transferItems.length) return null;
  const items = [...new Set(record.transferItems.map((item) => itemLabel(item.item)))];
  return items.length === 1
    ? `并参与${record.transferItems.length}个${items[0]}的车厢转运`
    : `并参与${record.transferItems.length}次车厢转运（${items.join('、')}）`;
}

function lootCollectorDescription(record: { player: ReviewPlayerFacts; pickup: number; drops: number; boxes: number }): string {
  if (record.player.kills === 0 && record.player.dbnos === 0) return '背包像黑洞，东西进得去，击倒出不来。';
  if (record.player.kills > 0) return `搜得多也打得出，${record.player.kills}杀没有被物资拖住。`;
  return '物资搬得很勤快，下一步是把背包里的资源换成战果。';
}

function lootArchaeologyDescription(record: { player: ReviewPlayerFacts }): string {
  if (record.player.kills > 0) return `刚打完${record.player.kills}杀就开始考古，杀人和舔包两条产业链同时运营。`;
  return '翻盒很积极，但考古成果还没有转成击倒。';
}

function lootWarehouseDescription(record: { player: ReviewPlayerFacts }): string {
  if (record.player.damage > 0 && record.player.kills === 0) return `整理物资很勤快，可惜${integer(record.player.damage)}伤害没整理成击杀。`;
  return '车厢调度清楚，物资没有在转点时掉队。';
}

function templateLootSection(review: MatchReviewResult): PresentationSection {
  const records = templateLootRecords(review);
  const lines = ['🗑️ 垃圾佬榜', ''];
  const garbage = [...records]
    .filter((record) => record.pickup > 0 || record.boxes > 0)
    .sort((left, right) => right.pickup + right.boxes - (left.pickup + left.boxes) || right.boxes - left.boxes || left.player.playerId.localeCompare(right.player.playerId))[0] ?? null;
  const used = new Set<string>();
  if (garbage) {
    used.add(garbage.player.playerId);
    const movement = [`原始拾取${garbage.pickup}次`, `丢弃${garbage.drops}次`];
    if (garbage.boxes > 0) movement.push(`搜刮${garbage.boxes}个死亡盒`);
    lines.push(`* 垃圾佬王：${shortPlayerName(review, garbage.player.playerId)}`, `  ${movement.join(' · ')}。${lootCollectorDescription(garbage)}`);
  }
  const archaeologist = distinctLootRecord(
    [...records].sort((left, right) => right.boxes - left.boxes || right.pickup - left.pickup || left.player.playerId.localeCompare(right.player.playerId)),
    used,
    (record) => record.boxes > 0,
  );
  if (archaeologist) {
    used.add(archaeologist.player.playerId);
    lines.push(`* 死亡盒考古奖：${shortPlayerName(review, archaeologist.player.playerId)}`, `  搜刮${archaeologist.boxes}个死亡盒。${lootArchaeologyDescription(archaeologist)}`);
  }
  const warehouse = distinctLootRecord(
    [...records].sort((left, right) => right.transferItems.length - left.transferItems.length || right.pickup - left.pickup || left.player.playerId.localeCompare(right.player.playerId)),
    used,
    (record) => record.transferItems.length > 0,
  );
  if (warehouse) {
    used.add(warehouse.player.playerId);
    const transfer = lootTransferText(warehouse);
    const movement = [`原始拾取${warehouse.pickup}次`, `丢弃${warehouse.drops}次`];
    lines.push(`* 仓库管理员：${shortPlayerName(review, warehouse.player.playerId)}`, `  ${movement.join(' · ')}${transfer ? `，${transfer}` : ''}。${lootWarehouseDescription(warehouse)}`);
  }
  if (!records.length) lines.push('* 本场没有可确认的拾取、搜包或车厢转运记录。');
  const cosmeticCount = records.reduce((sum, record) => sum + record.cosmetics, 0);
  lines.push('', cosmeticCount > 0
    ? `本场确认拾取${cosmeticCount}件皮肤/衣服记录；只计入有明确 item metadata 的事件。`
    : '本场没有可靠的“捡到武器皮肤或衣服”记录，皮肤ID不计入拾荒统计。');
  return {
    type: 'loot',
    title: 'loot',
    text: lines.join('\n'),
    data: { loot: review.facts.loot ?? [], lootActivity: review.facts.lootActivity ?? [], vehicleTrunk: review.facts.vehicleTrunk ?? [] },
  };
}

function environmentObjectLabel(value: string): string {
  const normalized = value.replace(/^BP_/iu, '').replace(/_C$/u, '').toLowerCase();
  const labels: Record<string, string> = {
    window: '窗',
    door: '门',
    fence: '栅栏',
    gaspump: '加油泵',
    itembox: '物资箱',
    hittableactorspawncontainer: '可破坏物资箱',
    hay: '稻草堆',
  };
  return labels[normalized] ?? value;
}

function environmentActionLines(review: MatchReviewResult): string[] {
  const stats = review.facts.environment ?? [];
  const lines: string[] = [];
  for (const item of stats) {
    const actions = [`开门${item.doorOpens}`, `关门${item.doorCloses}`, `翻越${item.vaults}`];
    if (item.ledgeGrabs) actions.push(`抓边${item.ledgeGrabs}`);
    if (item.vaultsOnVehicle) actions.push(`车上翻越${item.vaultsOnVehicle}`);
    const destroyed = (item.destroyedObjects ?? []).map((object) => `${environmentObjectLabel(object.objectType)}${object.count}`);
    if (destroyed.length) actions.push(`破坏${destroyed.join('、')}`);
    else if (item.windowsDestroyed || item.fencesDestroyed) actions.push(`破窗${item.windowsDestroyed} · 拆栅栏${item.fencesDestroyed}`);
    if (item.terrainActions) actions.push(`明确地形动作${item.terrainActions}`);
    lines.push(`• ${playerName(review, item.playerId)}：${actions.join(' · ')}`);
  }
  const environmentTimes = stats.flatMap((item) => item.eventTimes);
  const fightsWithEnvironment = review.facts.fights.filter((fight) => environmentTimes.some((time) => time >= fight.start && time <= fight.end));
  lines.push('', fightsWithEnvironment.length
    ? `战斗关联：${fightsWithEnvironment.map((fight) => `第${fightOrdinal(review, fight.id)}波`).join('、')}战斗窗口内出现环境动作。`
    : '战斗关联：精确战斗窗口内未记录开门或翻越，不据此推断战果因果。');
  return lines;
}

function environmentSection(review: MatchReviewResult): PresentationSection | null {
  const stats = review.facts.environment ?? [];
  if (!stats.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🪟 环境动作', '━━━━━━━━━━━━━━', ...environmentActionLines(review)];
  const environmentTimes = stats.flatMap((item) => item.eventTimes);
  const fightsWithEnvironment = review.facts.fights.filter((fight) => environmentTimes.some((time) => time >= fight.start && time <= fight.end));
  return { type: 'environment', title: 'environment', text: lines.join('\n'), data: { environment: stats, fightsWithEnvironment: fightsWithEnvironment.map((fight) => fight.id) } };
}

function environmentDestructionParts(item: { destroyedObjects?: Array<{ objectType: string; count: number }>; windowsDestroyed: number; fencesDestroyed: number }): string[] {
  const parts: string[] = [];
  const destroyed = item.destroyedObjects ?? [];
  let hasWindow = false;
  let hasFence = false;
  for (const object of destroyed) {
    const label = environmentObjectLabel(object.objectType);
    if (label === '窗') {
      hasWindow = true;
      parts.push(`破窗${object.count}次`);
    } else if (label === '栅栏') {
      hasFence = true;
      parts.push(`拆栅栏${object.count}次`);
    } else if (label === '门') {
      parts.push(`破坏${object.count}扇门`);
    } else {
      parts.push(`破坏${object.count}个${label}`);
    }
  }
  if (!hasWindow && item.windowsDestroyed > 0) parts.unshift(`破窗${item.windowsDestroyed}次`);
  if (!hasFence && item.fencesDestroyed > 0) parts.push(`拆栅栏${item.fencesDestroyed}次`);
  return parts;
}

function templateEnvironmentSection(review: MatchReviewResult): PresentationSection {
  const environment = review.facts.environment ?? [];
  const lines = ['🧱 环境与载具', ''];
  const environmentPlayerIds = new Set<string>();
  for (const item of environment) {
    environmentPlayerIds.add(item.playerId);
    const parts = environmentDestructionParts(item);
    if (item.doorOpens > 0) parts.push(`开门${item.doorOpens}次`);
    if (item.doorCloses > 0) parts.push(`关门${item.doorCloses}次`);
    if (item.vaults > 0) parts.push(`翻越${item.vaults}次`);
    if (item.ledgeGrabs > 0) parts.push(`抓边${item.ledgeGrabs}次`);
    if (item.vaultsOnVehicle > 0) parts.push(`车上翻越${item.vaultsOnVehicle}次`);
    if (item.terrainActions) parts.push(`明确地形动作${item.terrainActions}次`);
    const impact = vehicleImpactText(review, item.playerId);
    if (impact) parts.push(impact);
    if (parts.length) lines.push(`* ${shortPlayerName(review, item.playerId)}：${parts.join('、')}。`);
  }
  for (const impact of review.facts.vehicleImpacts ?? []) {
    if (environmentPlayerIds.has(impact.playerId)) continue;
    const text = vehicleImpactText(review, impact.playerId);
    if (text) lines.push(`* ${shortPlayerName(review, impact.playerId)}：${text}。`);
  }
  if (!environment.length && !(review.facts.vehicleImpacts ?? []).length) lines.push('* 本场没有可确认的环境破坏或互动记录。');

  const vehicles = recordedPlayers(review)
    .map((player) => player.vehicle)
    .filter((vehicle): vehicle is NonNullable<ReviewPlayerFacts['vehicle']> => Boolean(vehicle && (vehicle.rideDistance > 0 || vehicle.driveDistance > 0 || vehicle.evidenceIds.length)));
  const maxSpeed = Math.max(0, ...vehicles.map((vehicle) => vehicle.maxSpeed));
  if (vehicles.length) {
    const recordedCount = recordedPlayers(review).length;
    const vehicleSubject = vehicles.length === recordedCount ? `${recordedCount}名有记录队员均有` : `${vehicles.length}名有记录队员有`;
    lines.push(`* ${vehicleSubject}乘车轨迹${maxSpeed > 0 ? `，最高速度约${maxSpeed.toFixed(1)}km/h` : ''}。`);
  } else {
    lines.push('* 未检测到可靠的乘车轨迹。');
  }
  const drivers = vehicles.filter((vehicle) => vehicle.driverConfirmed).map((vehicle) => shortPlayerName(review, vehicle.playerId));
  if (drivers.length) {
    lines.push(`* 已确认驾驶人：${drivers.join('、')}。`);
  } else {
    lines.push('* 本场没有确认具体驾驶人，也没有证据证明“开车冲进敌方房区导致团灭”，所以不硬扣“别开车了”。');
  }
  const terrainActions = environment.reduce((sum, item) => sum + (item.terrainActions ?? 0), 0);
  lines.push(terrainActions > 0
    ? `* 检测到明确地形动作${terrainActions}次。`
    : '* 未检测到明确的挖坑或地形形变事件。');
  return {
    type: 'environment',
    title: 'environment',
    text: lines.join('\n'),
    data: { environment, vehicles: review.facts.vehicles, vehicleImpacts: review.facts.vehicleImpacts ?? [], terrainActions },
  };
}

function fightMainlineText(review: MatchReviewResult, fight: MatchReviewResult['facts']['fights'][number], repeated = false): string {
  const leaders = fightDamageLeaders(review, fight);
  const leader = leaders[0];
  const actor = leader && leader.damage > 0
    ? `${playerName(review, leader.playerId)}${repeated ? '再次' : ''}打出约${integer(leader.damage)}伤害`
    : `队伍${repeated ? '再次' : ''}打出约${integer(fight.teamDamage)}伤害`;
  const outcome = fight.teamKnocks > 0 ? `${fight.teamKnocks}倒地` : `${repeated ? '仍然' : ''}0倒地`;
  return `* ${clock(fight.start)}：${actor}，${outcome}。`;
}

function recentReviverBeforeFight(review: MatchReviewResult, fight: MatchReviewResult['facts']['fights'][number]): string | null {
  const teamIds = new Set(recordedPlayers(review).map((player) => player.playerId));
  const event = review.facts.combat.events
    .filter((item) => item.type === 'REVIVE'
      && item.actorId !== null
      && teamIds.has(item.actorId)
      && item.victimId !== null
      && teamIds.has(item.victimId)
      && item.timeSeconds !== null
      && item.timeSeconds < fight.start
      && fight.start - item.timeSeconds <= 90)
    .sort((left, right) => (right.timeSeconds ?? 0) - (left.timeSeconds ?? 0))[0];
  if (!event) return null;
  return event.victimId ? playerName(review, event.victimId) : '队伍有人';
}

function blueZonePlayersInFight(review: MatchReviewResult, fight: MatchReviewResult['facts']['fights'][number]): string[] {
  const ids = new Set<string>();
  for (const event of fightEvents(review, fight)) {
    if (!event.blueZone) continue;
    if (event.actorId && recordedPlayers(review).some((player) => player.playerId === event.actorId)) ids.add(event.actorId);
    if (event.victimId && recordedPlayers(review).some((player) => player.playerId === event.victimId)) ids.add(event.victimId);
  }
  return [...ids].map((playerId) => playerName(review, playerId));
}

function templateMainlineLines(review: MatchReviewResult): string[] {
  if (!review.facts.fightIntegrity.pass) return [review.analysis.teamStory || '当前遥测不足以串起完整战局，只展示已经通过校验的基础事实。'];
  const fights = review.facts.fights.filter((fight) => fight.eventCount > 0).sort((left, right) => left.start - right.start || left.id.localeCompare(right.id));
  if (!fights.length) return [review.analysis.teamStory || '当前遥测不足以串起完整战局，只展示已经通过校验的基础事实。'];
  const winningFights = fights.filter((fight) => fight.result === 'WIN' && fight.teamKills > 0);
  const mainFight = [...winningFights].sort((left, right) => right.importanceScore - left.importanceScore || left.start - right.start)[0]
    ?? [...fights].sort((left, right) => right.importanceScore - left.importanceScore || left.start - right.start)[0];
  const finalLoss = finalLossFight(review);
  const earlyFights = mainFight
    ? fights.filter((fight) => fight.start < mainFight.start && fight.teamKills === 0 && fight.teamKnocks === 0)
    : fights.filter((fight) => fight.teamKills === 0 && fight.teamKnocks === 0);
  const lines: string[] = [];
  if (earlyFights.length) {
    lines.push(`前${earlyFights.length}次交火，队伍一直在“打伤害”，但没有把伤害变成击倒：`, ...earlyFights.map((fight, index) => fightMainlineText(review, fight, index > 0)));
  }
  if (mainFight && (mainFight.teamKills > 0 || mainFight.teamKnocks > 0)) {
    const entry = operationForFight(review, mainFight.id, ['ENTRY']);
    const action = entry?.playerId ? `${playerName(review, entry.playerId)}完成开团，` : '';
    const description = winningFights.length === 1 ? '是本局唯一真正赢下来的团战' : '是本局最关键的赢团窗口';
    lines.push('', `${clock(mainFight.start)}—${clock(mainFight.end)}${description}。${action}打出${mainFight.teamKnocks}次倒地和${mainFight.teamKills}次击杀，队伍造成${integer(mainFight.teamDamage)}伤害。`);
  }
  if (finalLoss) {
    lines.push('', `但${clock(finalLoss.start)}进入末战后，队伍只造成${integer(finalLoss.teamDamage)}伤害，却承受约${integer(finalLoss.receivedDamage)}伤害。`);
    const revived = recentReviverBeforeFight(review, finalLoss);
    const blueZonePlayers = blueZonePlayersInFight(review, finalLoss);
    const context: string[] = [];
    if (revived) context.push(`${revived}刚被救起不久`);
    if (blueZonePlayers.length) context.push(`${blueZonePlayers.join('、')}处于蓝圈压力中`);
    if (context.length) lines.push(`${context.join('，')}，随后${finalLoss.receivedKills > 0 ? `${Math.min(finalLoss.receivedKills, recordedPlayers(review).length)}名有记录队员几乎同时被清掉` : '队伍被清掉'}。`);
    else if (finalLoss.receivedKills > 0) lines.push(`随后${Math.min(finalLoss.receivedKills, recordedPlayers(review).length)}名有记录队员被清掉。`);
  }
  if (mainFight && finalLoss) lines.push('', `这局不是没有输出，是输出和决策没有接上。第${fightOrdinal(review, mainFight.id)}波像战神降临，第${fightOrdinal(review, finalLoss.id)}波像全员排队领盒。`);
  return lines.length ? lines : [review.analysis.teamStory || '当前遥测不足以串起完整战局，只展示已经通过校验的基础事实。'];
}

function awardLines(review: MatchReviewResult): string[] {
  return (review.analysis.awards ?? []).map((award) => `• ${award.title}：${playerName(review, award.playerId)} · ${award.text}`);
}

function templateGarbageCollector(review: MatchReviewResult) {
  return templateLootRecords(review)
    .filter((record) => record.pickup > 0 || record.boxes > 0)
    .sort((left, right) => right.pickup + right.boxes - (left.pickup + left.boxes) || right.boxes - left.boxes || left.player.playerId.localeCompare(right.player.playerId))[0] ?? null;
}

function templateConclusionSection(review: MatchReviewResult): PresentationSection {
  const mvp = combatMvp(review);
  const firepower = firepowerPlayer(review);
  const hunter = meleeHunter(review);
  const finalLoss = finalLossFight(review);
  const mainFight = [...review.facts.fights]
    .filter((fight) => fight.eventCount > 0 && fight.result === 'WIN' && fight.teamKills > 0)
    .sort((left, right) => right.importanceScore - left.importanceScore || left.start - right.start)[0] ?? null;
  const lines = ['🎯 本局结论', ''];
  const conclusions: string[] = [];
  if (mvp && (mvp.kills > 0 || mvp.dbnos > 0 || mvp.damage > 0)) {
    const melee = meleeBreakdown(review, mvp.playerId, 'outgoing');
    conclusions.push(`${shortPlayerName(review, mvp.playerId)}继续承担主C，但${melee.hitCount > 0 ? '停止队内近战' : '保持主动开团和收口'}。`);
  }
  if (firepower && firepower.damage > 0 && firepower.playerId !== mvp?.playerId) {
    conclusions.push(`${shortPlayerName(review, firepower.playerId)}伤害很高，必须练习伤害后的补枪和击倒转化。`);
  }
  if (hunter) conclusions.push(`${shortPlayerName(review, hunter.playerId)}减少无效道具和队内互殴，先把火力对准敌人。`);
  if (mainFight && finalLoss) {
    conclusions.push(`第${fightOrdinal(review, mainFight.id)}波赢团后必须重新补状态、脱离蓝区、统一站位，不能把上一波的胜利直接带进下一波的葬礼。`);
  } else if (review.analysis.actionPlan?.length) {
    conclusions.push(...review.analysis.actionPlan.slice(0, 4));
  }
  if (!conclusions.length) conclusions.push('本局没有足够证据形成具体行动建议。');
  lines.push(...conclusions.map((item, index) => `${index + 1}. ${item}`));

  lines.push('', '本局奖项：');
  if (mvp && (mvp.kills > 0 || mvp.dbnos > 0 || mvp.damage > 0)) lines.push(`* MVP：${shortPlayerName(review, mvp.playerId)}`);
  if (firepower && firepower.damage > 0 && firepower.playerId !== mvp?.playerId) lines.push(`* 火力炮台奖：${shortPlayerName(review, firepower.playerId)}`);
  const garbage = templateGarbageCollector(review);
  if (garbage) lines.push(`* 垃圾佬王：${shortPlayerName(review, garbage.player.playerId)}`);
  if (hunter) lines.push(`* 队友猎人警告：${shortPlayerName(review, hunter.playerId)}`);
  if (!(mvp && (mvp.kills > 0 || mvp.dbnos > 0 || mvp.damage > 0))
    && !(firepower && firepower.damage > 0)
    && !garbage
    && !hunter) lines.push('* 暂无可确认奖项');
  return {
    type: 'conclusion',
    title: 'conclusion',
    text: lines.join('\n'),
    data: { conclusions, mvp: mvp?.playerId ?? null, firepower: firepower?.playerId ?? null, hunter: hunter?.playerId ?? null, garbageCollector: garbage?.player.playerId ?? null },
  };
}

function awardsSection(review: MatchReviewResult): PresentationSection | null {
  const awards = review.analysis.awards ?? [];
  if (!awards.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🏆 本局奖项', '━━━━━━━━━━━━━━', ...awardLines(review)];
  return { type: 'awards', title: 'awards', text: lines.join('\n'), data: { awards } };
}

function turningPointLine(review: MatchReviewResult, point: ReviewTurningPoint): string {
  const icon = point.impact === 'positive' ? '✅' : point.impact === 'negative' ? '⚠️' : '🔎';
  return `${icon} ${point.time === null ? '' : `${clock(point.time)} · `}${point.title}\n${point.text}`;
}

function turningPointSection(review: MatchReviewResult): PresentationSection | null {
  const points = review.analysis.turningPoints ?? [];
  if (!points.length && !review.analysis.teamStory) return null;
  const lines = ['━━━━━━━━━━━━━━', '🧭 战局走势', '━━━━━━━━━━━━━━'];
  if (points.length) lines.push('', ...points.map((point) => turningPointLine(review, point)));
  else lines.push(review.analysis.teamStory || '暂无足够事实串起战局');
  return { type: 'turning_points', title: 'turning_points', text: lines.join('\n'), data: { turningPoints: points, actionPlan: review.analysis.actionPlan ?? [] } };
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
  const text = ['🤣 趣味事件组合', ...events.map((event) => `${event.title}\n${event.text}`)].join('\n\n');
  return { type: 'fun', title: 'fun', text, data: { items: events, eventIds: events.map((event) => event.id) } };
}

function buildPickerText(picker: MatchPickerModel, query: CanonicalQuery): string {
  const period = query.selector.label ?? '指定范围';
  const lines = [`🎬 PUBG · ${period}复盘`, `${period}共 ${picker.candidateCount} 场，请选择：`, ''];
  for (const candidate of picker.candidates) {
    const teamKills = Number(candidate.row.metrics.teamKills ?? candidate.row.metrics.kills ?? 0);
    const teamAssists = Number(candidate.row.metrics.teamAssists ?? candidate.row.metrics.assists ?? 0);
    const teamDamage = Number(candidate.row.metrics.teamDamage ?? candidate.row.metrics.damage ?? 0);
    lines.push(`${ordinalLabel(candidate.ordinal)} ${localTime(candidate.match.createdAt)} · ${mapLabel(candidate.match.mapName)} · ${rankLabel(candidate.row.bestRank ?? null)}`);
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
  const compactTemplate = profile === 'default';
  const overview = compactTemplate
    ? [
      '🎬 PUBG · 对局复盘',
      '',
      `${mapLabel(match.mapName)} · ${rankLabel(match.placement)} · ${clock(match.duration)}`,
      '',
      `队伍：${facts.squad.kills}杀 · ${facts.squad.assists}助攻 · ${facts.squad.knocks}倒地`,
      `总伤害：${integer(facts.squad.damage)} · 救援${facts.squad.revives}次`,
      '',
      ...['🔥 本场主线', '', ...templateMainlineLines(review)],
    ]
    : [
      '🎬 PUBG · 对局复盘',
      `${match.ordinal} ${localTime(match.startedAt)} · ${mapLabel(match.mapName)}`,
      `${rankLabel(match.placement)} · ${clock(match.duration)} · ${match.gameMode}`,
      '',
      `⚔️ ${facts.squad.kills}杀 · ${facts.squad.assists}助攻 · ${facts.squad.knocks}倒地`,
      `🎯 ${integer(facts.squad.damage)}伤害 · ❤️ ${facts.squad.revives}救援`,
      '',
      '🔥 本局一句话',
      analysis.summary,
      '',
      '🧭 战局主线',
      analysis.teamStory || '暂无足够事实串起战局',
    ];
  if (review.telemetry.status === 'UNAVAILABLE') overview.push('', '⚠️ 该场基础战绩已经找到，但详细战斗记录暂时无法获取。');
  if (!facts.fightIntegrity.pass) overview.push('', '⚠️ 详细团战数据未通过一致性校验，暂不展示团战结论。');
  const sections: PresentationSection[] = [{ type: 'overview', title: 'overview', text: overview.join('\n'), data: { matchId: match.matchId, telemetry: review.telemetry, turningPointCount: analysis.turningPoints?.length ?? 0 } }];
  const teamProfile = profile !== 'personal' && profile !== 'vehicle' && profile !== 'weapon';
  const visiblePlayers = profile === 'personal' && query.subject.type !== 'team'
    ? facts.players.filter((player) => query.subject.ids.includes(player.playerId))
    : facts.players;
  if (compactTemplate) {
    visiblePlayers.forEach((player, index) => sections.push(templatePlayerSection(review, player, index === 0)));
    sections.push(templateInteractionsSection(review));
    sections.push(templateLootSection(review));
    sections.push(templateEnvironmentSection(review));
    sections.push(templateConclusionSection(review));
  } else {
    if (teamProfile) {
      const turningPoints = turningPointSection(review);
      if (turningPoints) sections.push(turningPoints);
    }
    for (const player of visiblePlayers) sections.push(playerSection(review, player, profile));
    if (teamProfile) {
      const awards = awardsSection(review);
      if (awards) sections.push(awards);
    }
    if (profile === 'combat' || profile === 'detailed' || profile === 'weapon' || profile === 'fun') {
      const weapons = weaponSection(review);
      if (weapons) sections.push(weapons);
    }
    const interactions = interactionsSection(review);
    if (interactions) sections.push(interactions);
    const recovery = recoverySection(review);
    if (recovery) sections.push(recovery);
    const loot = lootSection(review);
    if (loot) sections.push(loot);
    const environment = environmentSection(review);
    if (environment && profile !== 'personal') sections.push(environment);
    const fun = funSection(review, query, profile);
    if (fun) sections.push(fun);
    if (teamProfile) {
      const fightLines = !facts.fightIntegrity.pass
        ? ['⚠️ 详细团战数据未通过一致性校验，暂不展示。']
        : analysis.keyFights.length
          ? analysis.keyFights.map((fight) => `${fightOrdinal(review, fight.id)} ${clock(fight.start)}–${clock(fight.end)} · ${resultLabel(fight.result)}\n我方：${fight.teamKills}杀 · ${fight.teamKnocks}倒地 · ${integer(fight.teamDamage)}伤害\n我方被击杀：${fight.receivedKills}次 · 被击倒：${fight.receivedKnocks}次 · 承受${integer(fight.receivedDamage)}伤害\n关键人物：${fight.keyPlayers.length ? fight.keyPlayers.map((playerId) => playerName(review, playerId)).join('、') : '暂无'}${fight.location ? `\n地点：${fight.location}` : ''}`)
          : ['暂无足够战斗事件形成团战'];
      sections.push({ type: 'key_fights', title: 'key_fights', text: ['━━━━━━━━━━━━━━', '⚔️ 关键团战', '━━━━━━━━━━━━━━', ...fightLines].join('\n'), data: { fights: analysis.keyFights } });
      const good = analysis.good.length ? analysis.good.map((item) => `• ${item}`).join('\n') : '• 暂无可确认的正向结论';
      const improvements = analysis.improvements.length ? analysis.improvements.map((item) => `• ${item}`).join('\n') : '• 暂无明确改进项';
      const keyPlayers = analysis.keyPlayers.length ? analysis.keyPlayers.map((item) => `• ${item}`).join('\n') : '• 暂无足够证据';
      const actionPlan = analysis.actionPlan?.length ? analysis.actionPlan.map((item) => `• ${item}`).join('\n') : '• 暂无额外行动建议';
      const conclusion = ['━━━━━━━━━━━━━━', '🧠 本局复盘', '━━━━━━━━━━━━━━', '✅ 做得好的', good, '', '⚠️ 可以改进', improvements, '', '🎯 下一局行动', actionPlan, '', '🏅 本局关键人物', keyPlayers];
      sections.push({ type: 'conclusion', title: 'conclusion', text: conclusion.join('\n'), data: { good: analysis.good, improvements: analysis.improvements, actionPlan: analysis.actionPlan ?? [], keyPlayers: analysis.keyPlayers } });
    }
  }
  const fallbackText = sections.map((section) => section.text ?? '').filter(Boolean).join('\n\n');
  return PresentationModelSchema.parse({
    version: 1,
    type: 'review_match',
    title: '对局复盘',
    sections,
    fallbackText,
    metadata: { queryId: query.queryId, resultSetId, profile, telemetry: review.telemetry, sectionKeys: compactTemplate ? TEMPLATE_REVIEW_SECTION_KEYS : EXTENDED_REVIEW_SECTION_KEYS },
  });
}
