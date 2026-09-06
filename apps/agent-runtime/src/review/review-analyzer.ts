import type { Fight, MatchReviewFacts, PlayerCommentary, ReviewAnalysis, ReviewTurningPoint } from './types.js';
import { selectKeyFights } from './fight-detector.js';
import { generateFunCandidates } from './fun-candidate-generator.js';
import { generateFunEvents } from './fun-intelligence.js';

function playerName(facts: MatchReviewFacts, playerId: string): string {
  return facts.players.find((player) => player.playerId === playerId)?.playerName ?? playerId;
}

function operationLabel(type: string): string {
  const labels: Record<string, string> = {
    ENTRY: '开团', MULTI_KNOCK: '多次倒地', CLUTCH: '关键收割', FLANK: '侧翼', TRADE: '补枪交换',
    SUPPORT: '火力支援', REVIVE: '救援', DAMAGE: '输出', POSITIONING_RISK: '站位风险', MISTAKE: '失误',
    VEHICLE: '载具作战', HEAVY_WEAPON: '重武器',
  };
  return labels[type] ?? type;
}

function operationTime(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function hasBaseContribution(player: MatchReviewFacts['players'][number]): boolean {
  return player.kills > 0 || player.assists > 0 || player.dbnos > 0 || player.revives > 0 || player.damage > 0;
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

function fightNumber(facts: MatchReviewFacts, fight: Fight): number {
  return Math.max(1, facts.fights.findIndex((candidate) => candidate.id === fight.id) + 1);
}

function fightLabel(facts: MatchReviewFacts, fight: Fight): string {
  return `第${fightNumber(facts, fight)}波团战`;
}

function operationForFight(facts: MatchReviewFacts, fight: Fight, type: string) {
  return facts.players
    .flatMap((player) => player.keyOperations)
    .filter((operation) => operation.facts.fightId === fight.id && operation.type === type)
    .sort((left, right) => right.impactScore - left.impactScore || operationTime(left.time) - operationTime(right.time))[0] ?? null;
}

function isKeyPlayerSpecialEvent(type: string): boolean {
  return ['MULTI_KNOCK', 'CLUTCH', 'REVIVE_CHAIN', 'ROCKET_HIT', 'ROCKET_MULTI_KILL', 'ROCKET_VEHICLE_DESTROY', 'ROCKET_VEHICLE_MULTI_KILL', 'VEHICLE_DESTROY', 'VEHICLE_KILL'].includes(type);
}

function commentaryForPlayer(facts: MatchReviewFacts, player: MatchReviewFacts['players'][number]): PlayerCommentary {
  const operations = [...player.keyOperations].sort((left, right) => right.impactScore - left.impactScore || operationTime(left.time) - operationTime(right.time));
  const strengths = operations.slice(0, 2).map((operation) => operation.impact);
  const improvements: string[] = [];

  if (player.matchPresence === 'not_recorded') {
    return {
      playerId: player.playerId,
      roleConfidence: player.roleConfidence,
      text: '本场 Match Store 未记录到这名玩家，无法据此评价其局内表现。',
      strengths: [],
      improvements: ['补齐该账号的 Match Store 记录后再做贡献判断'],
      operationIds: [],
    };
  }

  let text: string;
  if (operations.length) {
    const role = player.matchRole ? `主要承担${player.matchRole}` : '检测到明确战斗操作';
    const detail: string[] = [];
    const share = percentage(player.damage, facts.squad.damage);
    if (share && player.damage > 0) detail.push(`贡献队伍${share}伤害`);
    if (player.dbnos > 0) detail.push(`${player.dbnos}次倒地转化${player.kills}次击杀（${Math.round((player.kills / player.dbnos) * 100)}%）`);
    if (player.assists > 0) detail.push(`${player.assists}次助攻`);
    if (player.revives > 0) detail.push(`${player.revives}次救援`);
    text = `${role}；${detail.length ? `${detail.join('，')}；` : ''}关键贡献集中在${operations.slice(0, 2).map((operation) => operationLabel(operation.type)).join('、')}。`;
    if (player.matchRole === '开团/信息' && player.kills === 0) improvements.push('开团后继续报点并跟进补枪，把先手优势转成击杀');
    if (player.heavyWeapons.some((weapon) => weapon.pickupEvents > 0 && weapon.shots === 0)) improvements.push('携带重武器进入接触区前先确认弹药、射界和队友站位');
  } else if (hasBaseContribution(player)) {
    text = '有一定基础战斗参与，但没有检测到高影响关键操作。';
    improvements.push('可以继续提升把基础参与转化为能够改变团战的操作');
  } else {
    text = '本局未检测到有效关键贡献。';
    improvements.push('本局未检测到有效关键贡献，暂不做更强的负面推断');
  }
  if (!operations.length && player.damage === 0 && player.kills === 0 && player.assists === 0 && player.dbnos === 0 && player.revives === 0) {
    improvements.push('Match Store 未记录到击杀、助攻、伤害、倒地或救援');
  }
  return {
    playerId: player.playerId,
    ...(player.matchRole ? { role: player.matchRole } : {}),
    roleConfidence: player.roleConfidence,
    text,
    strengths,
    improvements,
    operationIds: operations.map((operation) => operation.id),
  };
}

function turningPointEvidence(fight: Fight, ...extra: string[][]): string[] {
  return [...new Set([...
    fight.evidenceIds,
    ...extra.flat(),
  ])];
}

function mainFightPoint(facts: MatchReviewFacts, fight: Fight): ReviewTurningPoint {
  const entry = operationForFight(facts, fight, 'ENTRY');
  const multiKnock = operationForFight(facts, fight, 'MULTI_KNOCK');
  const clutch = operationForFight(facts, fight, 'CLUTCH');
  const clauses: string[] = [];
  if (entry) clauses.push(`${playerName(facts, entry.playerId)}先手开团`);
  if (multiKnock) clauses.push(`${playerName(facts, multiKnock.playerId)}打出${String(multiKnock.facts.knocks ?? fight.teamKnocks)}次倒地`);
  if (clutch) clauses.push(`${playerName(facts, clutch.playerId)}完成${String(clutch.facts.kills ?? fight.teamKills)}次击杀`);
  const result = fight.result === 'TRADE'
    ? `拿到${fight.teamKills}杀/${fight.teamKnocks}倒地，但付出${fight.receivedKills}次被击杀，属于高收益交换而不是无伤碾压`
    : `我方${fight.result === 'WIN' ? '赢下' : '完成'}这波，${fight.teamKills}杀/${fight.teamKnocks}倒地，承受${fight.receivedKills}次被击杀`;
  return {
    id: `turning-point-${fight.id}`,
    type: fight.result === 'TRADE' ? 'POWER_SPIKE' : fight.result === 'WIN' ? 'CLEAN_WIN' : 'POWER_SPIKE',
    time: fight.start,
    title: fight.result === 'TRADE' ? '主战团：高收益交换' : fight.result === 'WIN' ? '主战团：成功收口' : '主战团：战斗窗口',
    text: `${fightLabel(facts, fight)} ${clock(fight.start)}–${clock(fight.end)}：${clauses.length ? `${clauses.join('，')}；` : ''}${result}。全波造成${Math.round(fight.teamDamage)}伤害。`,
    impact: fight.teamKills > fight.receivedKills ? 'positive' : fight.teamKills < fight.receivedKills ? 'negative' : 'neutral',
    facts: { fightId: fight.id, teamKills: fight.teamKills, teamKnocks: fight.teamKnocks, teamDamage: Math.round(fight.teamDamage), receivedKills: fight.receivedKills, receivedKnocks: fight.receivedKnocks },
    evidenceIds: turningPointEvidence(fight, entry?.evidenceIds ?? [], multiKnock?.evidenceIds ?? [], clutch?.evidenceIds ?? []),
  };
}

function buildTurningPoints(facts: MatchReviewFacts): ReviewTurningPoint[] {
  if (!facts.fightIntegrity.pass) return [];
  const fights = facts.fights.filter((fight) => fight.eventCount > 0);
  if (!fights.length) return [];
  const result: ReviewTurningPoint[] = [];
  const main = [...fights].sort((left, right) => right.importanceScore - left.importanceScore || left.start - right.start)[0];
  if (main) result.push(mainFightPoint(facts, main));

  const cleanWin = [...fights]
    .filter((fight) => fight.id !== main?.id && fight.result === 'WIN')
    .sort((left, right) => right.importanceScore - left.importanceScore || left.start - right.start)[0];
  if (cleanWin) {
    result.push({
      id: `turning-point-${cleanWin.id}`,
      type: 'CLEAN_WIN',
      time: cleanWin.start,
      title: '小团战：无伤收口',
      text: `${fightLabel(facts, cleanWin)} ${clock(cleanWin.start)}–${clock(cleanWin.end)}完成${cleanWin.teamKills}次击杀、${cleanWin.teamKnocks}次倒地和${Math.round(cleanWin.teamDamage)}伤害，遥测未记录我方被击杀。`,
      impact: 'positive',
      facts: { fightId: cleanWin.id, teamKills: cleanWin.teamKills, teamKnocks: cleanWin.teamKnocks, teamDamage: Math.round(cleanWin.teamDamage) },
      evidenceIds: [...cleanWin.evidenceIds],
    });
  }

  const finalLoss = [...fights].filter((fight) => fight.result === 'LOSS').sort((left, right) => right.end - left.end)[0];
  if (finalLoss && finalLoss.id !== main?.id && finalLoss.id !== cleanWin?.id) {
    result.push({
      id: `turning-point-${finalLoss.id}`,
      type: 'FINAL_LOSS',
      time: finalLoss.start,
      title: '末战：有输出但没收口',
      text: `${fightLabel(facts, finalLoss)} ${clock(finalLoss.start)}–${clock(finalLoss.end)}造成${Math.round(finalLoss.teamDamage)}伤害、${finalLoss.teamKnocks}次倒地，却没有击杀；同时我方被击杀${finalLoss.receivedKills}次，最终以${facts.match.placement === null ? '未知名次' : `#${facts.match.placement}`}结束。`,
      impact: 'negative',
      facts: { fightId: finalLoss.id, teamDamage: Math.round(finalLoss.teamDamage), teamKnocks: finalLoss.teamKnocks, teamKills: finalLoss.teamKills, receivedKills: finalLoss.receivedKills },
      evidenceIds: [...finalLoss.evidenceIds],
    });
  }

  const friendlyDamage = facts.teamDamage ?? [];
  const totalFriendlyDamage = friendlyDamage.reduce((sum, item) => sum + item.damage, 0);
  if (totalFriendlyDamage > 0) {
    result.push({
      id: 'turning-point-teamwork-risk',
      type: 'TEAMWORK_RISK',
      time: friendlyDamage.flatMap((item) => item.timestamps).sort((left, right) => left - right)[0] ?? friendlyDamage[0]?.timestamp ?? null,
      title: '协同风险：队友误伤',
      text: `遥测记录队友误伤${Math.round(totalFriendlyDamage)}伤害（${friendlyDamage.reduce((sum, item) => sum + item.hitCount, 0)}次命中），包含近战和投掷物；这会压缩后续战斗容错。`,
      impact: 'negative',
      facts: { friendlyDamage: Math.round(totalFriendlyDamage), friendlyHits: friendlyDamage.reduce((sum, item) => sum + item.hitCount, 0) },
      evidenceIds: [...new Set(friendlyDamage.flatMap((item) => item.evidenceIds))],
    });
  }
  return result.slice(0, 4);
}

function buildTeamStory(facts: MatchReviewFacts, keyFights: Fight[]): string {
  const recorded = facts.players.filter((player) => player.matchPresence !== 'not_recorded');
  const top = [...recorded].sort((left, right) => right.damage - left.damage || right.kills - left.kills)[0];
  const share = top ? percentage(top.damage, facts.squad.damage) : null;
  const main = keyFights[0];
  const finalLoss = facts.fightIntegrity.pass
    ? [...facts.fights].filter((fight) => fight.result === 'LOSS').sort((left, right) => right.end - left.end)[0]
    : undefined;
  const sentences: string[] = [];
  if (top && share) sentences.push(`火力主要集中在${top.playerName}（${Math.round(top.damage)}伤害，占队伍${share}）`);
  if (main) {
    const entry = operationForFight(facts, main, 'ENTRY');
    const clutch = operationForFight(facts, main, 'CLUTCH');
    sentences.push(`${fightLabel(facts, main)}由${entry ? playerName(facts, entry.playerId) : '队伍'}${entry ? '先手打开' : '接手'}，打出${main.teamKills}杀/${main.teamKnocks}倒地，但付出${main.receivedKills}次被击杀${clutch ? `，${playerName(facts, clutch.playerId)}完成了${String(clutch.facts.kills ?? main.teamKills)}次收割` : ''}`);
  }
  const cleanWin = keyFights.find((fight) => fight.result === 'WIN');
  if (cleanWin && cleanWin !== main) sentences.push(`${fightLabel(facts, cleanWin)}完成${cleanWin.teamKills}杀且没有我方被击杀`);
  if (finalLoss) sentences.push(`末战${fightLabel(facts, finalLoss)}虽打出${finalLoss.teamKnocks}次倒地和${Math.round(finalLoss.teamDamage)}伤害，却没有击杀，优势没有延续到终局`);
  return sentences.length ? `${sentences.join('；')}。` : '当前遥测不足以串起完整战局，只展示已经通过校验的基础事实。';
}

function buildActionPlan(facts: MatchReviewFacts, keyFights: Fight[]): string[] {
  const actions: string[] = [];
  const main = keyFights.find((fight) => fight.result === 'TRADE' && fight.teamKills > fight.receivedKills);
  if (main) actions.push(`${fightLabel(facts, main)}已经拿到${main.teamKills}杀/${main.teamKnocks}倒地，但付出${main.receivedKills}次被击杀；下次第一轮倒地后优先报点、补枪并收缩。`);
  const finalLoss = facts.fightIntegrity.pass
    ? [...facts.fights].filter((fight) => fight.result === 'LOSS').sort((left, right) => right.end - left.end)[0]
    : undefined;
  if (finalLoss && finalLoss.teamKnocks > 0 && finalLoss.teamKills === 0) actions.push(`末战${fightLabel(facts, finalLoss)}有${finalLoss.teamKnocks}次倒地和${Math.round(finalLoss.teamDamage)}伤害却没有击杀；把“倒地→击杀”设为第一指令，再分散找角度。`);
  const active = facts.players.filter((player) => player.matchPresence !== 'not_recorded' && hasBaseContribution(player));
  const top = [...active].sort((left, right) => right.damage - left.damage)[0];
  const share = top ? percentage(top.damage, facts.squad.damage) : null;
  if (top && share && Number.parseFloat(share) >= 75 && active.length > 1) actions.push(`${top.playerName}贡献了队伍${share}伤害；下一局让其余队员明确承担补枪、侧翼或投掷物压制，避免火力单核。`);
  const friendlyDamage = (facts.teamDamage ?? []).reduce((sum, item) => sum + item.damage, 0);
  if (friendlyDamage > 0) actions.push(`队友误伤合计${Math.round(friendlyDamage)}伤害；投掷物和近战接触前先确认落点与目标。`);
  const receivedKnocks = facts.fights.reduce((sum, fight) => sum + fight.receivedKnocks, 0);
  if (facts.squad.revives === 0 && receivedKnocks > 0) actions.push(`本局没有救援记录，团战中至少有${receivedKnocks}次我方被击倒；下次先封烟/拉开再救。`);
  return [...new Set(actions)].slice(0, 5);
}

function buildImprovements(facts: MatchReviewFacts, keyFights: Fight[]): string[] {
  const improvements: string[] = [];
  const main = keyFights.find((fight) => fight.result === 'TRADE' && fight.teamKills > fight.receivedKills);
  if (main) improvements.push(`${fightLabel(facts, main)}虽取得${main.teamKills}杀/${main.teamKnocks}倒地，但付出${main.receivedKills}次被击杀，优势没有做到低损收口。`);
  const finalLoss = facts.fightIntegrity.pass
    ? [...facts.fights].filter((fight) => fight.result === 'LOSS').sort((left, right) => right.end - left.end)[0]
    : undefined;
  if (finalLoss && finalLoss.teamKnocks > 0 && finalLoss.teamKills === 0) improvements.push(`末战${fightLabel(facts, finalLoss)}有${finalLoss.teamKnocks}次倒地和${Math.round(finalLoss.teamDamage)}伤害，却没有转化为击杀。`);
  const active = facts.players.filter((player) => player.matchPresence !== 'not_recorded' && hasBaseContribution(player));
  const top = [...active].sort((left, right) => right.damage - left.damage)[0];
  const share = top ? percentage(top.damage, facts.squad.damage) : null;
  if (top && share && Number.parseFloat(share) >= 75 && active.length > 1) improvements.push(`${top.playerName}贡献队伍${share}伤害，其他队员的补枪、侧翼或投掷物贡献不足。`);
  const friendlyDamage = (facts.teamDamage ?? []).reduce((sum, item) => sum + item.damage, 0);
  if (friendlyDamage > 0) improvements.push(`记录到${Math.round(friendlyDamage)}点队友误伤，近战和投掷物的协同安全需要加强。`);
  if (facts.squad.revives === 0 && facts.fights.some((fight) => fight.receivedKnocks > 0)) improvements.push('本局有我方被击倒但没有救援记录，需要改善封烟、拉开和救援节奏。');
  return [...new Set(improvements)].slice(0, 5);
}

export function analyzeMatchReview(facts: MatchReviewFacts): ReviewAnalysis {
  const fightAnalyticsValid = facts.fightIntegrity.pass;
  const keyFights = fightAnalyticsValid ? selectKeyFights(facts.fights, 3) : [];
  const keyPlayers = facts.players
    .map((player) => ({ player, score: player.keyOperations.reduce((sum, operation) => sum + operation.impactScore, 0)
      + (fightAnalyticsValid ? facts.fights.filter((fight) => fight.keyPlayers.includes(player.playerId)).reduce((sum, fight) => sum + Math.min(300, fight.importanceScore / 10), 0) : 0)
      + facts.specialEvents.filter((event) => event.playerId === player.playerId && isKeyPlayerSpecialEvent(event.type)).reduce((sum, event) => sum + event.impactScore, 0) }))
    .filter((item) => item.score > 0 && item.player.matchPresence !== 'not_recorded')
    .sort((left, right) => right.score - left.score || left.player.playerId.localeCompare(right.player.playerId))
    .slice(0, 2)
    .map((item) => playerName(facts, item.player.playerId));

  const playerCommentary = facts.players.map((player) => commentaryForPlayer(facts, player));
  const turningPoints = buildTurningPoints(facts);
  const teamStory = buildTeamStory(facts, keyFights);
  const actionPlan = buildActionPlan(facts, keyFights);
  const good: string[] = [];
  const improvements: string[] = buildImprovements(facts, keyFights);
  const main = keyFights.find((fight) => fight.result === 'TRADE' || fight.result === 'WIN');
  const cleanWin = keyFights.find((fight) => fight.result === 'WIN');
  const top = [...facts.players].filter((player) => player.matchPresence !== 'not_recorded').sort((left, right) => right.damage - left.damage || right.kills - left.kills)[0];
  if (facts.match.placement === 1) good.push('最终拿到第一名，基础战绩确认吃鸡');
  if (main && main.teamKills > 0) good.push(`${fightLabel(facts, main)}打出${main.teamKills}杀、${main.teamKnocks}倒地和${Math.round(main.teamDamage)}伤害`);
  if (cleanWin) good.push(`${fightLabel(facts, cleanWin)}完成${cleanWin.teamKills}杀且没有我方被击杀`);
  if (top && top.damage > 0) {
    const share = percentage(top.damage, facts.squad.damage);
    if (share) good.push(`${top.playerName}贡献队伍${share}伤害，承担了主要火力`);
  }
  const heavy = facts.heavyWeapons.find((item) => item.shots > 0 || item.kills > 0 || item.knocks > 0 || item.vehiclesDestroyed > 0);
  if (heavy) good.push(`${heavy.weapon}记录${heavy.shots}发、${heavy.hits}次命中记录，带来${heavy.kills}杀/${heavy.knocks}倒地${heavy.vehiclesDestroyed ? `并摧毁${heavy.vehiclesDestroyed}辆载具` : ''}`);
  if (facts.squad.revives > 0) good.push(`队伍完成${facts.squad.revives}次救援，保留了回合容错`);
  if (!keyFights.length && facts.match.placement !== 1 && facts.fightIntegrity.pass) improvements.push('本局没有足够的团队级高影响团战证据');
  if (!facts.fightIntegrity.pass) improvements.push('详细团战数据未通过一致性校验，已停止展示团战结论');

  const summary = main
    ? `这把最终 #${facts.match.placement ?? '未知'}；${fightLabel(facts, main)}打出${main.teamKills}杀/${main.teamKnocks}倒地，但付出${main.receivedKills}次被击杀${facts.fights.some((fight) => fight.result === 'LOSS') ? '，末战没有完成收口' : ''}。`
    : facts.match.placement === 1
      ? `这把以 #1 收尾，${keyPlayers.length ? `${keyPlayers.join('、')}的有证据关键操作贡献最突出` : '但没有足够的高光操作证据展开'}`
      : keyFights.length
        ? `这把最终 #${facts.match.placement ?? '未知'}，复盘重点是${keyFights.slice(0, 2).map((fight) => fightLabel(facts, fight)).join('、')}。`
        : `这把最终 #${facts.match.placement ?? '未知'}，目前只有基础战绩或团战数据未通过校验。`;
  const funCandidates = generateFunCandidates(facts);
  const funEvents = generateFunEvents(facts);
  return {
    summary,
    teamStory,
    turningPoints,
    actionPlan,
    playerCommentary,
    keyFights,
    good: [...new Set(good)],
    improvements: [...new Set(improvements)],
    keyPlayers,
    fun: funEvents.map((item) => `${item.title}\n${item.text}`),
    funCandidates,
    funEvents,
  };
}
