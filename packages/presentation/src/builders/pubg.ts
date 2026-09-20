import type { PubgMatchReviewPresentation, PresentationTextItem } from '../contracts/pubg.js';
import { assertValid, validatePubgMatchReviewPresentation } from '../validation/validate.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textItems(value: unknown, fallbackEvidence: string[] = []): PresentationTextItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const text = typeof row.text === 'string' && row.text.trim() ? row.text : typeof row.title === 'string' ? `${row.title}${typeof row.text === 'string' && row.text ? `：${row.text}` : ''}` : '';
    if (!text) return [];
    const evidenceRefs = Array.isArray(row.evidenceIds) ? row.evidenceIds.filter((id): id is string => typeof id === 'string') : fallbackEvidence;
    return [{ text, evidenceRefs }];
  });
}

/** Build the tool-mediated structured contract from deterministic review facts. */
export function buildPubgMatchReviewPresentation(input: { data: unknown; dataUpdatedAt: string }): PubgMatchReviewPresentation {
  const data = record(input.data);
  const facts = record(data.facts);
  const match = record(facts.match);
  const squad = record(facts.squad);
  const analysis = record(data.derivedAnalysis);
  const evidence = Array.isArray(facts.evidence) ? facts.evidence.flatMap((item) => {
    const id = record(item).id;
    return typeof id === 'string' ? [id] : [];
  }) : [];
  const keyMoments = textItems(analysis.turningPoints, evidence);
  const highlights = textItems(analysis.awards, evidence);
  const improvements = textItems(analysis.actionPlan ?? analysis.improvements);
  const summary = typeof analysis.summary === 'string' && analysis.summary.trim() ? analysis.summary : '本场复盘事实已生成。';
  const mapName = typeof match.mapName === 'string' ? match.mapName : '未知地图';
  const ordinal = numberOrNull(match.ordinal);
  const candidate: PubgMatchReviewPresentation = {
    type: 'pubg_match_review',
    headline: `${ordinal === null ? '' : `第${ordinal}局 · `}${mapName}`,
    overview: {
      placement: numberOrNull(squad.placement),
      kills: numberOrNull(squad.kills),
      assists: numberOrNull(squad.assists),
      damage: numberOrNull(squad.damage),
      dbnos: numberOrNull(squad.knocks),
      revives: numberOrNull(squad.revives),
    },
    keyMoments,
    highlights,
    improvements,
    analysis: summary,
    dataUpdatedAt: input.dataUpdatedAt,
    evidenceRefs: evidence,
  };
  return assertValid(validatePubgMatchReviewPresentation(candidate, new Set(evidence)));
}
