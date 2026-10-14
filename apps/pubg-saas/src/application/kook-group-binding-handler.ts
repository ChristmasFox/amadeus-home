import type { KookGroupWriteIntentParserPort } from './kook-group-write-intent.js';
import type { KookIngressDiscardLog, KookIngressJob, KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import type { TeamAdminService } from './team-admin-service.js';
import type { PublicPubgPlayerResolverPort, ResolvedPubgPlayer } from '../infrastructure/pubg/player-resolver.js';
import { parseKookManagementCommand } from '../channels/kook/management-command.js';
import { KOOK_GROUP_WRITE_INTENT_LIMITS } from './kook-group-write-intent.js';

export interface KookGroupBindingServices {
  teams: TeamAdminService;
  players: PublicPubgPlayerResolverPort;
  intents?: KookGroupWriteIntentParserPort | null;
  onDiagnostic?: (event: KookIngressDiscardLog) => void;
}

function message(content: string): KookTextPayload { return { type: 'text', content }; }
function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/@/gu, '＠').trim().slice(0, 100);
}
function stripMentionMarkup(content: string): string {
  return content.replace(/<@!?[^>]{1,128}>/gu, ' ').replace(/\(met\)[^()\s]{1,128}\(met\)/gu, ' ').trim();
}

const safeErrors: Record<string, string> = {
  account_claim_conflict: '该 PUBG 账号已绑定给其他 KOOK 用户。',
  guild_admin_required: '管理员代绑需要当前服务器管理员权限。',
  kook_channel_member_required: '只有当前文字频道的成员可以声明 PUBG 账号。',
  kook_target_channel_member_required: '被 @ 的用户必须是当前文字频道成员。',
  kook_permission_check_unavailable: 'KOOK 权限校验当前不可用，请稍后重试。',
  team_action_scope_changed: '当前频道队伍状态已变化，请重试。',
  guild_team_ambiguous: '此服务器存在多个历史队伍，暂时无法自动绑定；请联系管理员处理。',
  invalid_team_label: '队名需为 1–80 个字符。',
  public_pubg_lookup_rate_limited: 'PUBG 账号查询当前繁忙，请稍后重试。',
  public_pubg_lookup_unavailable: 'PUBG 账号查询当前不可用，请稍后重试。',
  public_pubg_lookup_invalid_response: 'PUBG 返回的账号信息无法可靠识别，请稍后重试。',
  public_pubg_shard_invalid: '平台仅支持 steam/kakao/psn/xbox。',
  public_pubg_names_invalid: '请提供一个有效 PUBG 游戏名。',
};

function accountNotFound(): KookTextPayload { return message('查不到该 PUBG 账号'); }

async function resolveAndClaim(
  job: KookIngressJob,
  services: KookGroupBindingServices,
  targetUserId: string,
  shard: string,
  pubgName: string,
  signal: AbortSignal,
): Promise<KookTextPayload> {
  if (job.request.kind !== 'group' || !job.boundTeam) return message('当前频道尚未绑定服务器队伍。');
  const event = job.request.event;
  await services.teams.assertAccountClaimAllowed(event, targetUserId);
  const resolution = await services.players.resolveNames(shard, [pubgName], signal);
  if (signal.aborted) throw new Error('kook_request_aborted');
  if (resolution.missingNames.length) return accountNotFound();
  if (resolution.ambiguousNames.length) return message('该 PUBG 名称对应多个账号，无法安全绑定。');
  if (resolution.players.length !== 1) throw new Error('public_pubg_lookup_invalid_response');
  const player: ResolvedPubgPlayer = resolution.players[0]!;
  await services.teams.claimVerifiedAccount(event, job.boundTeam, targetUserId, shard, {
    accountId: player.accountId,
    displayName: player.name,
  });
  return targetUserId === event.userId
    ? message(`已验证并绑定 PUBG 账号：${safeName(player.name)}（${shard}）。再次声明即可更换。`)
    : message(`已验证并绑定 PUBG 账号：${safeName(player.name)} → <@${targetUserId}>。再次声明即可更换。`);
}

/** All new bind/rename writes happen in the current group channel. The model
 * classifies only the constrained intent; KOOK actor/mention IDs and database
 * scope remain exclusively in trusted application code. */
export function createKookGroupBindingHandler(services: KookGroupBindingServices): KookRequestHandler {
  const diagnosticWindows = new Map<string, { loggedAt: number; suppressed: number }>();
  function reportIntentDiagnostic(event: KookIngressDiscardLog): void {
    const channelId = event.channelId && /^[0-9]{1,40}$/u.test(event.channelId) ? event.channelId : undefined;
    const safeEvent: KookIngressDiscardLog = {
      event: 'kook_ingress_discarded', stage: 'intent_classifier', reason: event.reason, count: event.count,
      ...(channelId ? { channelId } : {}),
    };
    const key = `${safeEvent.reason}:${channelId ?? ''}`;
    const now = Date.now();
    let window = diagnosticWindows.get(key);
    if (!window) {
      if (diagnosticWindows.size >= 64) {
        const oldest = diagnosticWindows.keys().next().value;
        if (oldest !== undefined) diagnosticWindows.delete(oldest);
      }
      window = { loggedAt: now, suppressed: 0 };
      diagnosticWindows.set(key, window);
      try { services.onDiagnostic?.({ ...safeEvent, count: 1 }); } catch { /* logging cannot block a request */ }
      return;
    }
    window.suppressed += 1;
    if (now - window.loggedAt < 60_000) return;
    const count = window.suppressed;
    window.loggedAt = now;
    window.suppressed = 0;
    try { services.onDiagnostic?.({ ...safeEvent, count }); } catch { /* logging cannot block a request */ }
  }

  async function handleLegacyGroupCommand(job: KookIngressJob, signal: AbortSignal): Promise<KookTextPayload | undefined> {
    if (job.request.kind !== 'group') return undefined;
    const event = job.request.event;
    const command = parseKookManagementCommand(event.content);
    if (command?.kind === 'me') return await resolveAndClaim(job, services, event.userId, 'steam', command.name, signal);
    if (command?.kind === 'claim') return await resolveAndClaim(job, services, event.userId, command.shard, command.name, signal);
    if (/^(?:\/|!)pubg\s+me(?:\s|$)/iu.test(event.content.trim()) && command?.kind === 'invalid') {
      return message('用法：/pubg me <PUBG 游戏名>。平台默认为 Steam。');
    }
    return undefined;
  }

  return async (job, signal) => {
    try {
      if (signal.aborted) throw new Error('kook_request_aborted');
      if (job.request.kind === 'direct') {
        const legacy = parseKookManagementCommand(job.request.event.content);
        if (legacy?.kind === 'claim' || /^(?:\/|!)pubg\s+me(?:\s|$)/iu.test(job.request.event.content.trim())) {
          return message('账号绑定请在队伍群聊中发送：/pubg me <游戏名>。');
        }
        return undefined;
      }
      if (job.request.kind !== 'group') return undefined;
      const event = job.request.event;
      const explicitLegacyCommand = /^(?:\/|!)pubg(?:\s|$)/iu.test(event.content.trim());
      if (!services.intents) {
        reportIntentDiagnostic({ event: 'kook_ingress_discarded', stage: 'intent_classifier', reason: 'model_unavailable', count: 1, channelId: event.channelId });
        return explicitLegacyCommand ? await handleLegacyGroupCommand(job, signal) : null;
      }
      const classifierInput = stripMentionMarkup(event.content);
      const intent = classifierInput.length <= KOOK_GROUP_WRITE_INTENT_LIMITS.maxInputCharacters
        ? await services.intents.parse(classifierInput, signal) : null;
      if (!intent) {
        const reason = classifierInput.length > KOOK_GROUP_WRITE_INTENT_LIMITS.maxInputCharacters
          ? 'input_limit_exceeded' : 'model_no_valid_intent';
        reportIntentDiagnostic({ event: 'kook_ingress_discarded', stage: 'intent_classifier', reason, count: 1, channelId: event.channelId });
        // Only bounded, explicit legacy commands use deterministic parsing when
        // the model is unavailable or returned no valid constrained intent.
        return explicitLegacyCommand ? await handleLegacyGroupCommand(job, signal) : null;
      }
      if (intent.action === 'unsupported') {
        reportIntentDiagnostic({ event: 'kook_ingress_discarded', stage: 'intent_classifier', reason: 'model_intent_unsupported', count: 1, channelId: event.channelId });
        return null;
      }
      if (intent.action === 'query_stats') return undefined;
      if (intent.action === 'legacy_command') {
        if (!explicitLegacyCommand) {
          reportIntentDiagnostic({ event: 'kook_ingress_discarded', stage: 'intent_classifier', reason: 'legacy_command_prefix_missing', count: 1, channelId: event.channelId });
          return null;
        }
        return await handleLegacyGroupCommand(job, signal);
      }
      if (intent.action === 'rename_team') {
        if (!job.boundTeam) return message('当前频道尚未绑定服务器队伍。');
        await services.teams.renameBoundTeam(event, job.boundTeam, intent.teamName);
        return message(`队名已改为：${safeName(intent.teamName)}`);
      }
      const mentioned = event.mentionedUserIds.filter(userId => userId !== event.botAccountId);
      if (intent.target === 'self') return await resolveAndClaim(job, services, event.userId, 'steam', intent.pubgName, signal);
      if (mentioned.length !== 1) return message('代绑时请只 @ 一位当前频道成员。');
      return await resolveAndClaim(job, services, mentioned[0]!, 'steam', intent.pubgName, signal);
    } catch (error) {
      const safe = error instanceof Error ? safeErrors[error.message] : undefined;
      if (safe) return message(safe);
      throw error;
    }
  };
}
