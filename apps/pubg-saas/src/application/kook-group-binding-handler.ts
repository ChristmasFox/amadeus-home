import type { KookIngressDiscardLog, KookIngressJob, KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import type { TeamAdminService } from './team-admin-service.js';
import type { PublicPubgPlayerResolverPort, ResolvedPubgPlayer } from '../infrastructure/pubg/player-resolver.js';
import { parseKookManagementCommand } from '../channels/kook/management-command.js';
import { sanitizeKookMentionMarkup } from '../channels/kook/trusted-group-event.js';

export interface KookGroupBindingServices {
  teams: TeamAdminService;
  players: PublicPubgPlayerResolverPort;
  onDiagnostic?: (event: KookIngressDiscardLog) => void;
}

function message(content: string): KookTextPayload { return { type: 'text', content }; }
function safeName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/@/gu, '＠').trim().slice(0, 100);
}
function stripMentionMarkup(content: string): string {
  return content.replace(/<@!?[^>]{1,128}>/gu, ' ').replace(/\(met\)[^()\s]{1,128}\(met\)/gu, ' ').trim();
}

function literalAppears(messageText: string, value: string): boolean {
  return messageText.normalize('NFKC').toLocaleLowerCase().includes(value.normalize('NFKC').toLocaleLowerCase());
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

/** The deterministic legacy route remains available; ordinary natural
 * messages are handled by the conversational agent and never classified here. */
export function createKookGroupBindingHandler(services: KookGroupBindingServices): KookRequestHandler {
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
      if (!/^(?:\/|!)pubg\s+me(?:\s|$)|^(?:\/|!)pubg\s+claim(?:\s|$)/iu.test(event.content.trim())) return undefined;
      return await handleLegacyGroupCommand(job, signal);
    } catch (error) {
      const safe = error instanceof Error ? safeErrors[error.message] : undefined;
      if (safe) return message(safe);
      throw error;
    }
  };
}

export type KookNaturalWriteIntent =
  | { kind: 'declare_pubg_account'; target: 'self' | 'mentioned_member'; pubgName: string }
  | { kind: 'rename_team'; teamName: string };

export interface KookNaturalWriteResult {
  outcome: 'completed' | 'rejected';
  message: string;
  /** Safe operational metadata; callers must not expose this to the model. */
  failure?: { kind: 'authorization_denied' | 'authorization_unavailable'; code: string };
}

const authorizationDenialCodes = new Set([
  'guild_admin_required',
  'kook_channel_member_required',
  'kook_target_channel_member_required',
  'team_action_scope_changed',
]);

function naturalWriteFailure(error: unknown, fallback: string): KookNaturalWriteResult {
  const code = error instanceof Error ? error.message : '';
  const failure = authorizationDenialCodes.has(code)
    ? { kind: 'authorization_denied' as const, code }
    : code === 'kook_permission_check_unavailable'
      ? { kind: 'authorization_unavailable' as const, code }
      : undefined;
  return { outcome: 'rejected', message: safeErrors[code] ?? fallback, ...(failure ? { failure } : {}) };
}

/** Executes only a literal, model-selected write slot. Actor, mention IDs,
 * guild/channel scope, admin status and current membership all come from the
 * trusted event and TeamAdminService; this function has no model access. */
export async function executeKookNaturalWrite(
  job: KookIngressJob,
  services: KookGroupBindingServices,
  intent: KookNaturalWriteIntent,
  signal: AbortSignal,
): Promise<KookNaturalWriteResult> {
  if (job.request.kind !== 'group' || !job.boundTeam) {
    return { outcome: 'rejected', message: '当前频道还没有可用的 PUBG 小队。普通聊天可以继续；要查询或绑定 PUBG 数据，请先在服务器创建队伍。' };
  }
  const event = job.request.event;
  const normalized = stripMentionMarkup(event.content);
  if (intent.kind === 'rename_team') {
    if (!intent.teamName.trim() || intent.teamName.length > 80 || !literalAppears(normalized, intent.teamName)) {
      return { outcome: 'rejected', message: '我没能确认你要设置的完整队名，请直接写出新的队名。' };
    }
    try {
      await services.teams.renameBoundTeam(event, job.boundTeam, intent.teamName);
      return { outcome: 'completed', message: `队名已改为：${safeName(intent.teamName)}` };
    } catch (error) {
      return naturalWriteFailure(error, '这次队名修改没有完成，请稍后重试。');
    }
  }
  if (!intent.pubgName.trim() || intent.pubgName.length > 100 || !literalAppears(normalized, intent.pubgName)) {
    return { outcome: 'rejected', message: '我没能确认 PUBG 游戏名，请在消息里完整写出账号名。' };
  }
  const mentioned = event.mentionedUserIds.filter(userId => userId !== event.botAccountId);
  const targetUserId = intent.target === 'self' ? event.userId : mentioned.length === 1 ? mentioned[0]! : null;
  if (!targetUserId) return { outcome: 'rejected', message: '代绑时请只 @ 一位当前频道成员。' };
  try {
    const payload = await resolveAndClaim(job, services, targetUserId, 'steam', intent.pubgName, signal);
    return {
      outcome: payload.content === '查不到该 PUBG 账号' ? 'rejected' : 'completed',
      message: sanitizeKookMentionMarkup(payload.content),
    };
  } catch (error) {
    return naturalWriteFailure(error, '账号绑定没有完成，请稍后重试。');
  }
}
