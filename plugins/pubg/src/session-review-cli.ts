/**
 * Manual companion to the daily review, for previews and one-off sends.
 *
 *   session-review-cli groups
 *   session-review-cli preview [--day YYYY-MM-DD]
 *   session-review-cli test    --message <text>
 *   session-review-cli send    [--day YYYY-MM-DD] --share-base <url> [--record] [--resend <tag>]
 *
 * Common options: --db <pubg.sqlite> --team <team.json> --target-file <file> --expected-name <name> --account <id>
 * [--timezone <tz>]. --day is a business day (06:00 to 06:00); it defaults to the latest complete one, which is what
 * the 09:30 run covers. preview prints the exact message with a placeholder link and sends nothing. The gateway is
 * reached with the command in PUBG_GATEWAY_CALL (default: `openclaw gateway call`, which is what runs inside the
 * OpenClaw container). Sends use the same target checks as the scheduled run and always carry a share link
 * (--share-base, needs the writable Lab database); --record writes the send to the review ledger, and --resend <tag>
 * gives a deliberate second send of the same day its own idempotency key.
 */
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createTeamContext, latestCompleteBusinessDay, loadTeamConfig, PubgDomainService, SqlitePubgRepository, SqlitePubgRepositoryAdapter } from '@agent/pubg-domain';
import {
  checkReviewTarget,
  loadReviewSubscription,
  reviewIdempotencyKey,
  sendReview,
  type ReportGateway,
} from './session-review-delivery.js';
import { composeDailyReview, DAILY_REVIEW_LINK } from './daily-review.js';
import { dailyStatsSource } from './daily-review-stats.js';
import { issueQueryShare, querySharePlayers, queryShareTeamTotals } from './query-share.js';

const run = promisify(execFile);

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

/**
 * The child's environment. In the OpenClaw image the node wrapper points LD_LIBRARY_PATH at a private glibc that only
 * node can load; inherited by a child it breaks every system binary (/usr/bin/env exits 127). The child's own node
 * wrapper sets it again for itself.
 */
export function childEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => key !== 'LD_LIBRARY_PATH'));
}

/** Calls a Gateway method through the OpenClaw CLI, which runs next to the live gateway. */
export function cliGateway(command = process.env.PUBG_GATEWAY_CALL?.trim() || 'openclaw gateway call'): ReportGateway {
  const [program, ...prefix] = command.split(/\s+/u);
  return {
    async request(method, params, options) {
      const timeout = Number(options?.timeoutMs ?? 20_000);
      const { stdout } = await run(program!, [...prefix, method, '--json', '--timeout', String(timeout), '--params', JSON.stringify(params)], { timeout: timeout + 15_000, maxBuffer: 8 * 1024 * 1024, env: childEnvironment() });
      const start = stdout.indexOf('{');
      const parsed = JSON.parse(start >= 0 ? stdout.slice(start) : stdout) as { ok?: boolean; error?: { message?: string } };
      if (parsed.ok === false) throw new Error(parsed.error?.message ?? `${method} failed`);
      return parsed;
    },
  };
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const gateway = cliGateway();
  if (command === 'groups') {
    const response = await gateway.request('conversations.list', { agentId: option(args, 'agent') ?? 'main' }) as { conversations?: Array<Record<string, unknown>> };
    for (const row of response.conversations ?? []) {
      if (row.channel === 'whatsapp' && row.kind === 'group') console.log(`${row.accountId}\t${row.target}\t${String(row.label ?? '').replace(/^whatsapp:g-/u, '')}\t${new Date(Number(row.lastSeenAt ?? 0)).toISOString()}`);
    }
    return;
  }
  const team = loadTeamConfig({ path: required(args, 'team'), required: true });
  const sessionTeam = {
    id: team.id, label: team.label, tenantId: 'lab', memberIds: team.players.map((player) => player.id),
    playerNames: new Map(team.players.map((player) => [player.id, player.name])),
  };
  const subscriptionFor = () => loadReviewSubscription({
    targetFile: required(args, 'target-file'), expectedName: required(args, 'expected-name'), accountId: required(args, 'account'), squadId: team.id,
  });
  if (command === 'test') {
    const subscription = await subscriptionFor();
    const check = await checkReviewTarget(gateway, subscription, sessionTeam.tenantId);
    if (!check.ok) throw new Error(`target check failed: ${check.reason}${check.groupName ? ` (group is "${check.groupName}")` : ''}`);
    await sendReview(gateway, subscription, required(args, 'message'), `pubg-session-review-test:${Date.now()}`);
    console.log(`TEST_MESSAGE=sent group="${check.groupName}"`);
    return;
  }
  if (command !== 'preview' && command !== 'send') throw new Error('usage: session-review-cli groups|preview|test|send [options]');
  const shareBase = option(args, 'share-base');
  if (command === 'send' && !shareBase) throw new Error('--share-base is required: the daily review is never sent without its share link');
  const record = args.includes('--record');
  const timezone = option(args, 'timezone') ?? 'Asia/Shanghai';
  // Writable even for preview: the stats query records its result set, as it does for any 战绩 question.
  const repository = new SqlitePubgRepository(required(args, 'db'));
  const teamContext = createTeamContext('private', team);
  const service = new PubgDomainService({ teamContext, repository: new SqlitePubgRepositoryAdapter(repository, teamContext), timezone });
  const now = new Date();
  const businessDay = option(args, 'day') ?? latestCompleteBusinessDay(now, timezone);
  const composed = await composeDailyReview({ store: repository, team: sessionTeam, businessDay, timezone, stats: dailyStatsSource(() => service, timezone), now });
  if (!composed) throw new Error(`no squad matches on business day ${businessDay}`);
  console.log(`DAY=${businessDay} SESSION=${composed.session.key} MATCHES=${composed.session.matches.length}`);
  if (command === 'preview') { console.log(composed.render(DAILY_REVIEW_LINK)); return; }
  const subscription = await subscriptionFor();
  const check = await checkReviewTarget(gateway, subscription, sessionTeam.tenantId);
  if (!check.ok) throw new Error(`target check failed: ${check.reason}${check.groupName ? ` (group is "${check.groupName}")` : ''}`);
  const link = issueQueryShare({
    toolName: 'pubg_query_stats', matchIds: composed.session.matches.map((item) => item.match.matchId), displayText: composed.stats.displayText,
    dataUpdatedAt: composed.stats.dataUpdatedAt, timezone, squadId: team.id, shareBaseUrl: shareBase!, store: repository, now, sessionKey: composed.session.key,
    players: querySharePlayers(composed.stats.presentation), teamTotals: queryShareTeamTotals(composed.stats.displayText),
  });
  if (!link) throw new Error('share link was not issued');
  const resend = option(args, 'resend');
  await sendReview(gateway, subscription, composed.render(link), `${reviewIdempotencyKey(composed.session.key, subscription)}${resend ? `:resend:${resend}` : ''}`);
  if (record) {
    repository.putSessionReview({
      squadId: team.id, sessionKey: composed.session.key, matchIds: composed.session.matches.map((item) => item.match.matchId), lastMatchEndMs: composed.session.lastEndMs,
      status: 'sent', detail: `manual${resend ? `:${resend}` : ''} group:${check.groupName}`, message: composed.render(DAILY_REVIEW_LINK), attempts: 1, updatedAt: now.toISOString(),
    });
  }
  console.log(`DAILY_REVIEW=sent group="${check.groupName}"${record ? ' ledger=recorded' : ''}`);
  console.log(`SHARE_URL=${link}`);
}

// Run as a program, not when a test imports a helper from this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
