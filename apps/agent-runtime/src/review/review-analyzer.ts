import type { MatchReviewFacts, PlayerCommentary, ReviewAnalysis } from './types.js';
import { selectKeyFights } from './fight-detector.js';
import { generateFunCandidates } from './fun-candidate-generator.js';
import { generateFunEvents } from './fun-intelligence.js';

function playerName(facts: MatchReviewFacts, playerId: string): string {
  return facts.players.find((player) => player.playerId === playerId)?.playerName ?? playerId;
}

function operationLabel(type: string): string {
  const labels: Record<string, string> = {
    ENTRY: '开团',
    MULTI_KNOCK: '多次倒地',
    CLUTCH: '关键收割',
    FLANK: '侧翼',
    TRADE: '补枪交换',
    SUPPORT: '火力支援',
    REVIVE: '救援',
    DAMAGE: '输出',
    POSITIONING_RISK: '站位风险',
    MISTAKE: '失误',
    VEHICLE: '载具作战',
    HEAVY_WEAPON: '重武器',
  };
  return labels[type] ?? type;
}

function operationTime(value: number | null): number {
  return value ?? Number.POSITIVE_INFINITY;
}

function hasBaseContribution(player: MatchReviewFacts['players'][number]): boolean {
  return player.kills > 0 || player.assists > 0 || player.dbnos > 0 || player.revives > 0 || player.damage > 0;
}

function isKeyPlayerSpecialEvent(type: string): boolean {
  // Travel, unused weapons, and misses are useful fun facts but do not make a
  // player a match key person. Keep that leaderboard tied to combat/support
  // impact or a directly evidenced high-impact special event.
  return [
    'MULTI_KNOCK',
    'CLUTCH',
    'REVIVE_CHAIN',
    'ROCKET_HIT',
    'ROCKET_MULTI_KILL',
    'ROCKET_VEHICLE_DESTROY',
    'ROCKET_VEHICLE_MULTI_KILL',
    'VEHICLE_DESTROY',
    'VEHICLE_KILL',
  ].includes(type);
}

function commentaryForPlayer(facts: MatchReviewFacts, player: MatchReviewFacts['players'][number]): PlayerCommentary {
  const operations = [...player.keyOperations].sort((left, right) => right.impactScore - left.impactScore || operationTime(left.time) - operationTime(right.time));
  const strengths = operations.slice(0, 2).map((operation) => operation.impact);
  const improvements: string[] = [];
  let text: string;
  if (operations.length) {
    const role = player.matchRole ? `主要承担${player.matchRole}` : '检测到明确战斗操作';
    text = `${role}；关键贡献集中在${operations.slice(0, 2).map((operation) => operationLabel(operation.type)).join('、')}。`;
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

export function analyzeMatchReview(facts: MatchReviewFacts): ReviewAnalysis {
  const fightAnalyticsValid = facts.fightIntegrity.pass;
  const keyFights = fightAnalyticsValid ? selectKeyFights(facts.fights, 3) : [];
  const specialByPlayer = new Map<string, number>();
  for (const event of facts.specialEvents) {
    if (!event.playerId || !isKeyPlayerSpecialEvent(event.type)) continue;
    specialByPlayer.set(event.playerId, (specialByPlayer.get(event.playerId) ?? 0) + event.impactScore);
  }
  const keyPlayerCandidates = facts.players
    .map((player) => {
      const operationScore = player.keyOperations.reduce((sum, operation) => sum + operation.impactScore, 0);
      const fightScore = fightAnalyticsValid
        ? facts.fights.filter((fight) => fight.keyPlayers.includes(player.playerId)).reduce((sum, fight) => sum + Math.min(300, fight.importanceScore / 10), 0)
        : 0;
      const specialScore = specialByPlayer.get(player.playerId) ?? 0;
      return { player, score: operationScore + fightScore + specialScore, evidenced: operationScore > 0 || fightScore > 0 || specialScore > 0 };
    })
    .filter((item) => item.evidenced)
    .sort((left, right) => right.score - left.score || left.player.playerId.localeCompare(right.player.playerId))
    .slice(0, 2)
    .map((item) => playerName(facts, item.player.playerId));

  const playerCommentary = facts.players.map((player) => commentaryForPlayer(facts, player));
  const good: string[] = [];
  const improvements: string[] = [];
  if (facts.match.placement === 1) good.push('最终拿到第一名，基础战绩确认吃鸡');
  if (keyFights.some((fight) => fight.result === 'WIN')) good.push(`关键团战中有${keyFights.filter((fight) => fight.result === 'WIN').length}波取得优势`);
  if (facts.squad.revives > 0) good.push(`队伍完成${facts.squad.revives}次救援，保留了回合容错`);
  if (facts.specialEvents.some((event) => ['ROCKET_HIT', 'ROCKET_MULTI_KILL', 'ROCKET_VEHICLE_MULTI_KILL', 'VEHICLE_DESTROY'].includes(event.type))) {
    good.push('Telemetry 确认存在重武器或载具高影响事件');
  }
  if (keyFights.some((fight) => fight.result === 'LOSS')) improvements.push('关键团战中有一波出现人员或交换劣势');
  if (!keyFights.length && facts.match.placement !== 1 && facts.fightIntegrity.pass) improvements.push('本局没有足够的团队级高影响团战证据');
  if (!facts.fightIntegrity.pass) improvements.push('详细团战数据未通过一致性校验，已停止展示团战结论');
  const summary = facts.match.placement === 1
    ? `这把以 #1 收尾，${keyPlayerCandidates.length ? `${keyPlayerCandidates.join('、')}的有证据关键操作贡献最突出` : '但没有足够的高光操作证据展开'}`
    : keyFights.length
      ? `这把最终 #${facts.match.placement ?? '未知'}，复盘重点是${keyFights.slice(0, 2).map((fight) => `第${fight.id.replace('fight-', '')}波团战`).join('、')}。`
      : `这把最终 #${facts.match.placement ?? '未知'}，目前只有基础战绩或团战数据未通过校验。`;
  const funCandidates = generateFunCandidates(facts);
  const funEvents = generateFunEvents(facts);
  return {
    summary,
    playerCommentary,
    keyFights,
    good,
    improvements,
    keyPlayers: keyPlayerCandidates,
    fun: funEvents.map((item) => `${item.title}\n${item.text}`),
    funCandidates,
    funEvents,
  };
}
