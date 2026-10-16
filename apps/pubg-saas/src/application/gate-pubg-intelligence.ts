import {
  DEFAULT_REVIEW_FEATURE_VERSION,
  DEFAULT_TELEMETRY_PARSER_VERSION,
  type PubgRepositoryPort,
  type TeamContext,
} from '@agent/pubg-domain/core';
import {
  GATE_PUBG_INTELLIGENCE_MAX_MATCHES,
  summarizeGateCachedFeatures,
  type GateIntelligenceSummary,
} from '@agent/pubg-intelligence/gate';

export const GATE_PUBG_INTELLIGENCE_WINDOW_DAYS = [7, 30] as const;
export const GATE_PUBG_INTELLIGENCE_FEATURE_READ_CONCURRENCY = 4;
export type GatePubgIntelligenceWindowDays = typeof GATE_PUBG_INTELLIGENCE_WINDOW_DAYS[number];

export interface AuthorizedGateIntelligenceRead {
  readonly teamContext: TeamContext;
  readonly repository: Pick<PubgRepositoryPort, 'store' | 'listMatches' | 'get'>;
}

/** Reads only a bounded current-version window through the already-authorized
 * Gate Postgres repository. No fetch, writes, Lab adapter, or raw events. */
export async function readGatePubgIntelligence(input: {
  authorizedQuery: AuthorizedGateIntelligenceRead;
  windowDays: GatePubgIntelligenceWindowDays;
  now: Date;
}): Promise<GateIntelligenceSummary> {
  if (input.authorizedQuery.repository.store !== 'postgres') throw new Error('gate_intelligence_postgres_repository_required');
  if (!GATE_PUBG_INTELLIGENCE_WINDOW_DAYS.includes(input.windowDays)) throw new Error('gate_intelligence_window_invalid');
  const toMs = input.now.getTime();
  const fromMs = toMs - input.windowDays * 24 * 60 * 60 * 1000;
  const matches = await input.authorizedQuery.repository.listMatches({ fromMs, toMs, limit: GATE_PUBG_INTELLIGENCE_MAX_MATCHES });
  if (matches.length > GATE_PUBG_INTELLIGENCE_MAX_MATCHES) throw new Error('gate_intelligence_match_limit_exceeded');
  const features = new Array<(Awaited<ReturnType<AuthorizedGateIntelligenceRead['repository']['get']>> | null)>(matches.length).fill(null);
  for (let offset = 0; offset < matches.length; offset += GATE_PUBG_INTELLIGENCE_FEATURE_READ_CONCURRENCY) {
    const batch = matches.slice(offset, offset + GATE_PUBG_INTELLIGENCE_FEATURE_READ_CONCURRENCY);
    const records = await Promise.all(batch.map((match) => input.authorizedQuery.repository.get({
      matchId: match.matchId,
      parserVersion: DEFAULT_TELEMETRY_PARSER_VERSION,
      featureVersion: DEFAULT_REVIEW_FEATURE_VERSION,
    })));
    records.forEach((record, index) => { features[offset + index] = record; });
  }
  return summarizeGateCachedFeatures({
    matches: matches.map((match, index) => ({ match, feature: features[index] ?? null })),
    rosterPlayerIds: input.authorizedQuery.teamContext.team.players.map((player) => player.id),
    parserVersion: DEFAULT_TELEMETRY_PARSER_VERSION,
    featureVersion: DEFAULT_REVIEW_FEATURE_VERSION,
  });
}

/** Render stable, numeric facts through Gate's KOOK boundary. References are
 * per-response aliases, not account IDs, match IDs, or database identifiers. */
export function renderGatePubgIntelligenceKook(summary: GateIntelligenceSummary, windowDays: GatePubgIntelligenceWindowDays): string {
  const coverage = summary.coverage;
  const lines = [
    `近 ${windowDays} 天小队战术数据（Gate Intelligence ${summary.apiVersion}）`,
    `当前版本遥测特征：${coverage.currentFeatureMatches}/${coverage.requestedMatches} 场；缺失或旧版本 ${coverage.missingOrStaleFeatureMatches} 场；覆盖 ${coverage.freshness}。`,
    '下列结果仅为当前授权小队在 Gate PostgreSQL 中已有的压缩遥测事实；没有读取原始事件流、Lab SQLite 或其它租户数据。',
  ];
  if (summary.fightOutcomes.status === 'available') {
    lines.push(`已通过完整性检查的团战 ${summary.fightOutcomes.sampleSize} 场：胜 ${summary.fightOutcomes.wins}、负 ${summary.fightOutcomes.losses}、互有击杀 ${summary.fightOutcomes.trades}、结果未知 ${summary.fightOutcomes.unknown}。`);
  } else if (summary.fightOutcomes.status === 'integrity_unavailable') {
    lines.push(`团战汇总未给结论：${summary.fightOutcomes.integrityUnavailableMatches} 场的 Domain 团战完整性检查未通过。`);
  } else {
    lines.push('当前覆盖内没有可引用的已识别团战；这不代表没有发生团战。');
  }
  const friendly = summary.directedFriendlyDamage;
  if (friendly.status === 'available' || friendly.status === 'incomplete') {
    lines.push(`定向队友伤害：${friendly.hitCount} 次命中 / ${friendly.damage} 伤害 / ${friendly.directedPairCount} 组方向；无法确认阶段的事实 ${friendly.unknownPhaseFactCount} 条已排除。`);
    for (const pair of friendly.pairs) {
      lines.push(`队员 ${pair.actorRef.slice('teammate-'.length)} → 队员 ${pair.victimRef.slice('teammate-'.length)}（${pair.source}）：${pair.hitCount} 次、${pair.damage} 伤害。`);
    }
  } else {
    lines.push('队友伤害方向事实不完整或不可用，未按 0 伤害处理。');
  }
  const refs = [...summary.fightOutcomes.evidence, ...friendly.pairs.flatMap((pair) => pair.evidence)].slice(0, 6);
  if (refs.length) lines.push(`证据别名：${refs.map((ref) => `${ref.matchRef}/${ref.evidenceRef}`).join('、')}。`);
  lines.push(`版本：${summary.ruleVersion} · parser ${coverage.parserVersion} · feature ${coverage.featureVersion} · facts as of ${coverage.asOf ?? '未知'}。`);
  return lines.join('\n');
}
