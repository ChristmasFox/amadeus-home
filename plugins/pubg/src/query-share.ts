import { randomUUID } from 'node:crypto';
import { issueReviewShare, type ReviewShareStore } from '@agent/pubg-domain';

/** Query tools whose answers are about concrete matches; operational tools (prefetch, sync report, player lookup) get no link. */
export const QUERY_SHARE_TOOLS: ReadonlySet<string> = new Set([
  'pubg_query_stats',
  'pubg_compare_stats',
  'pubg_search_matches',
  'pubg_get_match',
  'pubg_get_review_facts',
  'pubg_get_period_review',
  'pubg_query_team_damage',
]);
/** A share page lists its matches; very wide queries share the first ones the result names. */
export const QUERY_SHARE_MAX_MATCHES = 60;

export interface QuerySharePresentation {
  type: 'pubg_query_share';
  version: 1;
  toolName: string;
  title: string;
  displayText: string;
  dataUpdatedAt: string | null;
  timezone: string;
  matchCount: number;
}

/**
 * Appends a no-login share link for the matches a query answer is built from (今日战绩 and the other query results).
 * The answer's text stays exactly as rendered; the link is one extra line at the end. Sharing never breaks an answer:
 * any problem simply leaves the text without a link.
 */
export function appendQueryShareLink(input: {
  toolName: string;
  status: string;
  matchIds: unknown;
  displayText: string;
  dataUpdatedAt: string | null;
  timezone: string;
  squadId: string;
  shareBaseUrl?: string;
  store: () => ReviewShareStore;
  now: Date;
}): string {
  if (!input.shareBaseUrl || !QUERY_SHARE_TOOLS.has(input.toolName) || input.status === 'error') return input.displayText;
  const ids = Array.isArray(input.matchIds)
    ? [...new Set(input.matchIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, QUERY_SHARE_MAX_MATCHES)
    : [];
  if (!ids.length) return input.displayText;
  try {
    const presentation: QuerySharePresentation = {
      type: 'pubg_query_share',
      version: 1,
      toolName: input.toolName,
      title: input.displayText.split('\n').map((line) => line.trim()).find(Boolean)?.slice(0, 80) ?? 'PUBG 战绩',
      displayText: input.displayText,
      dataUpdatedAt: input.dataUpdatedAt,
      timezone: input.timezone,
      matchCount: ids.length,
    };
    const { token } = issueReviewShare(input.store(), {
      squadId: input.squadId, sessionKey: `pubg-query:${randomUUID()}`, matchIds: ids, presentationJson: JSON.stringify(presentation), now: input.now, kind: 'query',
    });
    return `${input.displayText}\n\n🔗 ${input.shareBaseUrl.replace(/\/$/u, '')}/s/${token}`;
  } catch {
    return input.displayText;
  }
}
