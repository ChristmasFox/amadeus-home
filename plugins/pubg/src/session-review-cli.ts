/**
 * Manual companion to the session review worker, for previews and one-off sends from the Mac.
 *
 *   session-review-cli groups
 *   session-review-cli preview [--session -1|<session key>]
 *   session-review-cli test   --message <text>
 *   session-review-cli send   [--session -1|<session key>]
 *
 * Common options: --db <pubg.sqlite> --team <team.json> --target-file <file> --expected-name <name> --account <id>
 * [--page-url <url>] [--timezone <tz>]. The gateway is reached with the command in PUBG_GATEWAY_CALL
 * (default: `openclaw gateway call`), e.g. "orb -m <machine> -u root docker exec openclaw openclaw gateway call".
 * Sends use the same target checks and idempotency key as the worker; nothing is written to the database.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadTeamConfig, splitSquadSessions, squadMatches, SqlitePubgRepository, SESSION_BASELINE_MS } from '@agent/pubg-domain';
import {
  checkReviewTarget,
  loadReviewSubscription,
  reviewIdempotencyKey,
  sendReview,
  type ReportGateway,
} from './session-review-delivery.js';
import { renderReviewFor } from './session-review-worker.js';

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

/** Calls a Gateway method through the OpenClaw CLI, which runs next to the live gateway. */
export function cliGateway(command = process.env.PUBG_GATEWAY_CALL?.trim() || 'openclaw gateway call'): ReportGateway {
  const [program, ...prefix] = command.split(/\s+/u);
  return {
    async request(method, params, options) {
      const timeout = Number(options?.timeoutMs ?? 20_000);
      const { stdout } = await run(program!, [...prefix, method, '--json', '--timeout', String(timeout), '--params', JSON.stringify(params)], { timeout: timeout + 15_000, maxBuffer: 8 * 1024 * 1024 });
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
  const store = new SqlitePubgRepository(required(args, 'db'), { readOnly: true });
  const now = new Date();
  const matches = store.listMatches({ fromMs: now.getTime() - SESSION_BASELINE_MS - 40 * 24 * 60 * 60_000, order: 'asc' });
  const sessions = splitSquadSessions(squadMatches(matches, sessionTeam.memberIds), team.id);
  const wanted = option(args, 'session') ?? '-1';
  const session = /^-?\d+$/u.test(wanted) ? sessions.at(Number(wanted)) : sessions.find((item) => item.key === wanted);
  if (!session) throw new Error(`session not found: ${wanted}`);
  const pageUrl = option(args, 'page-url');
  const message = await renderReviewFor({
    store, matches, session, team: sessionTeam, timezone: option(args, 'timezone') ?? 'Asia/Shanghai', now, ...(pageUrl ? { pageUrl } : {}),
  });
  console.log(`SESSION=${session.key} MATCHES=${session.matches.length} CHARS=${message.length}`);
  if (command === 'preview') { console.log(message); return; }
  const subscription = await subscriptionFor();
  const check = await checkReviewTarget(gateway, subscription, sessionTeam.tenantId);
  if (!check.ok) throw new Error(`target check failed: ${check.reason}${check.groupName ? ` (group is "${check.groupName}")` : ''}`);
  await sendReview(gateway, subscription, message, reviewIdempotencyKey(session.key, subscription));
  console.log(`SESSION_REVIEW=sent group="${check.groupName}"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
