import type { OwnerNotificationPresentation } from '../contracts/owner.js';
import type { PubgMatchReviewPresentation, PubgPeriodReviewPresentation, PresentationTextItem } from '../contracts/pubg.js';

export interface ValidationResult<T> {
  valid: boolean;
  value?: T;
  errors: string[];
}

function result<T>(value: T, errors: string[]): ValidationResult<T> {
  return errors.length ? { valid: false, errors } : { valid: true, value, errors: [] };
}

function stringValue(value: unknown, path: string, errors: string[], required = true): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (required) errors.push(`${path} must be a non-empty string`);
  return undefined;
}

function finiteOrNull(value: unknown, path: string, errors: string[]): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  errors.push(`${path} must be a finite number or null`);
  return undefined;
}

function iso(value: unknown, path: string, errors: string[], required = true): string | undefined {
  const text = stringValue(value, path, errors, required);
  if (text && !Number.isFinite(Date.parse(text))) errors.push(`${path} must be an ISO timestamp`);
  return text;
}

function refs(value: unknown, path: string, errors: string[], known?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    errors.push(`${path} must be an array of non-empty evidence references`);
    return [];
  }
  const normalized = value.map((item) => String(item));
  if (known) for (const ref of normalized) if (!known.has(ref)) errors.push(`${path} references unknown evidence ${ref}`);
  return normalized;
}

function textItems(value: unknown, path: string, errors: string[], known?: ReadonlySet<string>): PresentationTextItem[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`${path}[${index}] must be an object`);
      return [];
    }
    const row = item as Record<string, unknown>;
    const text = stringValue(row.text, `${path}[${index}].text`, errors);
    const evidenceRefs = refs(row.evidenceRefs, `${path}[${index}].evidenceRefs`, errors, known);
    return text ? [{ text, evidenceRefs }] : [];
  });
}

export function validatePubgMatchReviewPresentation(value: unknown, knownEvidence?: ReadonlySet<string>): ValidationResult<PubgMatchReviewPresentation> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return result(value as PubgMatchReviewPresentation, ['presentation must be an object']);
  const row = value as Record<string, unknown>;
  if (row.type !== 'pubg_match_review') errors.push('type must be pubg_match_review');
  const headline = stringValue(row.headline, 'headline', errors);
  const overviewValue = row.overview;
  const overview: Record<string, number | null | undefined> = {};
  if (!overviewValue || typeof overviewValue !== 'object') {
    errors.push('overview must be an object');
  } else {
    const source = overviewValue as Record<string, unknown>;
    for (const key of ['placement', 'kills', 'assists', 'damage', 'dbnos', 'revives']) overview[key] = finiteOrNull(source[key], `overview.${key}`, errors);
  }
  const keyMoments = textItems(row.keyMoments, 'keyMoments', errors, knownEvidence);
  const highlights = textItems(row.highlights, 'highlights', errors, knownEvidence);
  const improvements = textItems(row.improvements, 'improvements', errors, knownEvidence);
  const analysis = stringValue(row.analysis, 'analysis', errors);
  const dataUpdatedAt = iso(row.dataUpdatedAt, 'dataUpdatedAt', errors);
  const evidenceRefs = refs(row.evidenceRefs, 'evidenceRefs', errors, knownEvidence);
  if (!headline || !analysis || !dataUpdatedAt) return result(value as PubgMatchReviewPresentation, errors);
  return result({
    type: 'pubg_match_review', headline,
    overview: {
      placement: overview.placement ?? null,
      kills: overview.kills ?? null,
      assists: overview.assists ?? null,
      damage: overview.damage ?? null,
      dbnos: overview.dbnos ?? null,
      revives: overview.revives ?? null,
    },
    keyMoments, highlights, improvements, analysis, dataUpdatedAt, evidenceRefs,
  }, errors);
}

export function validatePubgPeriodReviewPresentation(value: unknown, knownEvidence?: ReadonlySet<string>): ValidationResult<PubgPeriodReviewPresentation> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return result(value as PubgPeriodReviewPresentation, ['presentation must be an object']);
  const row = value as Record<string, unknown>;
  if (row.type !== 'pubg_period_review') errors.push('type must be pubg_period_review');
  const periodValue = row.period;
  let label: string | undefined;
  let displayDate: string | undefined;
  if (!periodValue || typeof periodValue !== 'object') errors.push('period must be an object');
  else {
    const period = periodValue as Record<string, unknown>;
    label = stringValue(period.label, 'period.label', errors);
    displayDate = stringValue(period.displayDate, 'period.displayDate', errors, false);
  }
  const summary = stringValue(row.summary, 'summary', errors);
  const analysis = stringValue(row.analysis, 'analysis', errors);
  const dataUpdatedAt = iso(row.dataUpdatedAt, 'dataUpdatedAt', errors);
  const highlights = textItems(row.highlights, 'highlights', errors, knownEvidence);
  const patterns = textItems(row.patterns, 'patterns', errors, knownEvidence);
  const evidenceRefs = refs(row.evidenceRefs, 'evidenceRefs', errors, knownEvidence);
  const orderedMatches: PubgPeriodReviewPresentation['orderedMatches'] = [];
  if (!Array.isArray(row.orderedMatches)) errors.push('orderedMatches must be an array');
  else row.orderedMatches.forEach((item, index) => {
    if (!item || typeof item !== 'object') { errors.push(`orderedMatches[${index}] must be an object`); return; }
    const match = item as Record<string, unknown>;
    const matchId = stringValue(match.matchId, `orderedMatches[${index}].matchId`, errors);
    const matchLabel = stringValue(match.label, `orderedMatches[${index}].label`, errors);
    const startedAt = match.startedAt === null ? null : iso(match.startedAt, `orderedMatches[${index}].startedAt`, errors, false) ?? null;
    const placement = finiteOrNull(match.placement, `orderedMatches[${index}].placement`, errors);
    if (matchId && matchLabel) orderedMatches.push({ matchId, label: matchLabel, startedAt, placement: placement ?? null });
  });
  if (!label || !summary || !analysis || !dataUpdatedAt) return result(value as PubgPeriodReviewPresentation, errors);
  return result({ type: 'pubg_period_review', period: { label, ...(displayDate ? { displayDate } : {}) }, summary, orderedMatches, highlights, patterns, analysis, dataUpdatedAt, evidenceRefs }, errors);
}

export function validateOwnerNotificationPresentation(value: unknown, knownEvidence?: ReadonlySet<string>): ValidationResult<OwnerNotificationPresentation> {
  const errors: string[] = [];
  if (!value || typeof value !== 'object') return result(value as OwnerNotificationPresentation, ['presentation must be an object']);
  const row = value as Record<string, unknown>;
  if (row.type !== 'owner_notification') errors.push('type must be owner_notification');
  const eventType = stringValue(row.eventType, 'eventType', errors);
  const severity = row.severity;
  if (!['info', 'success', 'warning', 'error'].includes(String(severity))) errors.push('severity is invalid');
  const eventKey = stringValue(row.eventKey, 'eventKey', errors);
  const source = stringValue(row.source, 'source', errors);
  const headline = stringValue(row.headline, 'headline', errors);
  const summary = stringValue(row.summary, 'summary', errors, false);
  const dataUpdatedAt = iso(row.dataUpdatedAt, 'dataUpdatedAt', errors, false);
  const occurredAt = iso(row.occurredAt, 'occurredAt', errors);
  const facts: OwnerNotificationPresentation['facts'] = [];
  if (!Array.isArray(row.facts)) errors.push('facts must be an array');
  else row.facts.forEach((item, index) => {
    if (!item || typeof item !== 'object') { errors.push(`facts[${index}] must be an object`); return; }
    const fact = item as Record<string, unknown>;
    const label = stringValue(fact.label, `facts[${index}].label`, errors);
    const raw = fact.value;
    if (!(raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean')) errors.push(`facts[${index}].value must be scalar or null`);
    const evidenceRefs = refs(fact.evidenceRefs, `facts[${index}].evidenceRefs`, errors, knownEvidence);
    if (label) facts.push({ label, value: raw as string | number | boolean | null, evidenceRefs });
  });
  if (!eventType || !eventKey || !source || !headline || !occurredAt || !severity || typeof severity !== 'string') return result(value as OwnerNotificationPresentation, errors);
  return result({ type: 'owner_notification', eventType, severity: severity as OwnerNotificationPresentation['severity'], eventKey, source, headline, facts, ...(summary ? { summary } : {}), ...(dataUpdatedAt ? { dataUpdatedAt } : {}), occurredAt, ...(row.worldLineClosing === true ? { worldLineClosing: true } : {}) }, errors);
}

export function assertValid<T>(validation: ValidationResult<T>): T {
  if (!validation.valid || !validation.value) throw new Error(`invalid presentation: ${validation.errors.join('; ')}`);
  return validation.value;
}
