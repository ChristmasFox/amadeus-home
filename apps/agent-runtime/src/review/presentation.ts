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

const REVIEW_SECTION_KEYS = [
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

function fightOrdinal(review: MatchReviewResult, fightId: string): number {
  return Math.max(1, review.facts.fights.findIndex((fight) => fight.id === fightId) + 1);
}

function resultLabel(result: string): string {
  return ({ WIN: '赢下', LOSS: '未收口', TRADE: '高收益交换', UNKNOWN: '接触' } as Record<string, string>)[result] ?? result;
}

function itemLabel(value: string): string {
  const normalized = value.replace(/^Item_/iu, '').replace(/^Weapon_/iu, '').replace(/_C$/u, '');
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
  const lines = ['━━━━━━━━━━━━━━', '🗑️ 垃圾佬榜 · 搜包与物资搬运', '━━━━━━━━━━━━━━'];
  const activityPlayerIds = new Set<string>();
  const trunkCounts = new Map<string, number>();
  for (const transfer of transfers) trunkCounts.set(transfer.playerId, (trunkCounts.get(transfer.playerId) ?? 0) + 1);
  for (const item of [...activity].sort((left, right) => (right.pickupEvents + right.lootBoxPickups) - (left.pickupEvents + left.lootBoxPickups) || left.playerId.localeCompare(right.playerId))) {
    activityPlayerIds.add(item.playerId);
    const movement = [`拾取${item.pickupEvents}`, `丢弃${item.dropEvents}`, `搜包${item.lootBoxPickups}`];
    const trunkCount = trunkCounts.get(item.playerId) ?? 0;
    if (trunkCount > 0) movement.push(`车厢存取${trunkCount}`);
    if (item.cosmeticPickups > 0) movement.push(`皮肤/服装${item.cosmeticPickups}`);
    lines.push(`• ${playerName(review, item.playerId)}：${movement.join(' · ')}`);
  }
  for (const item of stats) {
    if (activityPlayerIds.has(item.playerId)) continue;
    lines.push(`• ${playerName(review, item.playerId)}：搜包${item.lootBoxPickups}`);
  }
  for (const [playerId, count] of trunkCounts) {
    if (!activityPlayerIds.has(playerId)) lines.push(`• ${playerName(review, playerId)}：车厢存取${count}`);
  }
  if (activity.length && activity.every((item) => item.cosmeticPickups === 0)) lines.push('', '皮肤/服装：本局没有可确认的拾取记录。');
  return { type: 'loot', title: 'loot', text: lines.join('\n'), data: { loot: stats, lootActivity: activity, vehicleTrunk: transfers } };
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

function environmentSection(review: MatchReviewResult): PresentationSection | null {
  const stats = review.facts.environment ?? [];
  if (!stats.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🪟 环境动作', '━━━━━━━━━━━━━━'];
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
  return { type: 'environment', title: 'environment', text: lines.join('\n'), data: { environment: stats, fightsWithEnvironment: fightsWithEnvironment.map((fight) => fight.id) } };
}

function awardsSection(review: MatchReviewResult): PresentationSection | null {
  const awards = review.analysis.awards ?? [];
  if (!awards.length) return null;
  const lines = ['━━━━━━━━━━━━━━', '🏆 本局奖项', '━━━━━━━━━━━━━━', ...awards.map((award) => `• ${award.title}：${playerName(review, award.playerId)} · ${award.text}`)];
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
  const overview = [
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
  if (teamProfile) {
    const turningPoints = turningPointSection(review);
    if (turningPoints) sections.push(turningPoints);
  }
  const visiblePlayers = profile === 'personal' && query.subject.type !== 'team'
    ? facts.players.filter((player) => query.subject.ids.includes(player.playerId))
    : facts.players;
  for (const player of visiblePlayers) sections.push(playerSection(review, player, profile));
  if (teamProfile) {
    const awards = awardsSection(review);
    if (awards) sections.push(awards);
  }
  if (profile === 'default' || profile === 'combat' || profile === 'detailed' || profile === 'weapon' || profile === 'fun') {
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
