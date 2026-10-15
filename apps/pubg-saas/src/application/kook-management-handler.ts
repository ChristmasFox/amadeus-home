import { createConfirmationCard } from '../channels/kook/confirmation-card.js';
import type { KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import { handleKookOnboardingRequest, type KookOnboardingServices } from './kook-onboarding-handler.js';
function message(content: string): KookTextPayload { return { type: 'text', content }; }
const groupHelp = '群聊绑定：机器人进入服务器后会自动创建一支队伍并绑定默认文字频道；玩家发送“我的 PUBG 账号是 游戏名”或 /pubg me <游戏名>（默认 Steam）即可验证并绑定本人账号。管理员可发送“@成员 他的 PUBG 账号是 游戏名”代绑；频道成员可发送“我们的队名是 队名”修改队名。旧命令 /pubg claim <平台> <游戏名> 仍可自绑。队伍查询与管理：/pubg teams 列出服务器队伍；/pubg status 查看状态；/pubg add <游戏名…> 添加队员；/pubg roster <游戏名…> 替换完整名单；/pubg preference 查看或设置默认排行榜；/pubg alias list|set|delete 管理查询别名；/pubg privacy 查看数据说明。旧管理操作仍会按权限要求确认。';
const directHelp = '账号绑定必须在队伍群聊中进行：/pubg me <游戏名>，平台默认为 Steam；旧命令 /pubg claim <平台> <游戏名> 也可在群聊使用。/pubg account 查看自己的关联；/pubg privacy 查看数据说明。';
export const KOOK_PUBLIC_PRIVACY_NOTICE = '隐私与数据说明：本服务保存 KOOK 账号/频道标识、已授权队伍名单与 PUBG 公开比赛/遥测数据，用于队伍查询；不读取私人 Kurisu 的 SQLite、凭据、记忆或聊天记录。群聊对话按频道隔离、私聊对话按用户隔离并持久保留，不设条数、字符数或 12 小时自动清理上限；历史内容不会授予权限，PUBG 查询每次仍依据当前可信 KOOK 事件重新验证身份、租户、队伍和频道绑定。未完成请求正文最多保留 1 小时用于重试；模型用量（用户/请求关联、模型与 token 数）最多保留 30 天；收发事件标识及已结束的投递记录最多保留 7 天。群聊和直接消息内容及账号/队名写入请求会发送给配置的公共模型提供方；不会发送 tenant、队伍权限或 KOOK 用户标识，提供方自身的数据规则另行适用。账号声明会先通过 PUBG 公共 API 查验游戏名并保存 API 返回的账号 ID；这只证明该游戏名可解析，不证明 KOOK 用户拥有该 PUBG 账号。队伍默认排行榜指标及最后修改它的管理员标识会保留到管理员删除偏好或解散队伍；/pubg preference delete 可删除该设置。队伍自定义查询别名仅在管理员确认后保存，解绑频道不会删除别名；管理员可用 /pubg alias delete 删除，替换名单移除队员或解散队伍时会一并删除相关别名。/pubg account 可查看本人关联；历史 /pubg unclaim 仍需本人确认；服务器管理员可用 /pubg roster 更新名单、/pubg unbind 解绑频道或 /pubg disband 删除队伍关联数据。解除账号声明不会自动移除队伍名单中的 PUBG 账号；已发送消息无法由本服务撤回。';
const publicErrors: Record<string, string> = {
  guild_admin_required: '需要当前服务器的拥有者或管理员权限。',
  channel_not_bound: '当前频道尚未绑定队伍。',
  team_action_confirmation_unavailable: '此确认已失效或不属于当前操作者/频道，请重新发起操作。',
  account_claim_confirmation_unavailable: '此账号确认已失效或不属于当前操作者，请重新发起操作。',
  account_claim_not_found: '你尚未关联 PUBG 账号。',
  account_claim_conflict: '该账号已有其他用户的声明关联，请联系服务器管理员处理。',
  account_claim_already_bound: '你已声明关联一个 PUBG 账号，请先确认解除关联后再关联其他账号。',
  channel_binding_conflict: '当前频道已经绑定队伍，请先确认解绑后再发起建队或绑定。',
  squad_setup_confirmation_unavailable: '此建队/绑定确认已失效或不属于当前操作者和频道，请重新发起。',
  team_unavailable_in_guild: '无法在当前服务器选择此队伍，请通过 /pubg teams 重新选择。',
  team_action_scope_changed: '频道绑定已变化，请重新发起本次操作。',
  team_alias_invalid: '队员别名需为 1–100 个字符，且不能包含控制字符。',
  team_alias_member_not_found: '没有在当前队伍中找到该游戏名，请先核对完整队员名单。',
  team_alias_member_ambiguous: '该名称对应多名队员，请使用更明确的游戏名。',
  team_alias_conflict: '该别名已被队伍中的其他名称使用，请换一个别名。',
  team_preference_metric_invalid: '排行榜指标不受支持，请使用 damage/kills/kd/matches/avg_damage。',
  team_roster_limit_exceeded: '队伍最多保留 8 名玩家，请核对名单后重新提交。',
  too_many_pending_team_actions: '你有较多尚未确认的操作，请先完成或等待它们过期。',
  public_pubg_shard_invalid: '平台仅支持 steam/kakao/psn/xbox，请核对后重新提交。',
  public_pubg_names_invalid: '请提供 1–8 个不重复的游戏名；名称不能包含逗号或控制字符。',
  public_pubg_lookup_rate_limited: 'PUBG 账号查询当前繁忙，请稍后重试。',
  public_pubg_lookup_unavailable: 'PUBG 账号查询当前不可用，请稍后重试。',
  public_pubg_lookup_invalid_response: 'PUBG 返回的账号信息无法可靠识别，请稍后重试。',
  invalid_team_label: '队伍名称需为 1–80 个字符。',
};
/** Deterministic management/onboarding paths. The public conversation Agent
 * runs before this handler for ordinary chat; explicit commands stay here. */
export function createKookManagementHandler(services: KookOnboardingServices): KookRequestHandler {
  return async (job, signal) => {
    if (signal.aborted)
      throw new Error('kook_request_aborted');
    try {
      const onboardingReply = await handleKookOnboardingRequest(job, services, signal);
      if (onboardingReply !== undefined) return onboardingReply;
      const request = job.request;
      if(request.kind==='guild_join')return message('机器人已加入服务器，可以在绑定频道内直接询问 PUBG 数据。');
      if (request.kind === 'button') {
        const match = /^(team|claim):([A-Za-z0-9_-]{43})$/u.exec(request.event.value);
        if (!match || !request.event.eventId)
          return message('无法识别此确认操作，请重新发起。');
        const click = { ...request.event, value: match[2]! };
        if (match[1] === 'team') {
          const result = await services.teams.confirmTeamActionFromButton(click);
          const labels = { add_members: '队员已添加。', replace_roster: '队员名单已更新。', set_team_alias: '队员查询别名已添加。', delete_team_alias: '队员查询别名已删除。', set_leaderboard_metric: '队伍默认排行榜已更新。', delete_leaderboard_metric: '队伍默认排行榜设置已删除。', unbind_channel: '当前频道已解绑，队伍仍保留。', disband_team: '队伍已解散，绑定与队伍上下文已清理。' };
          return message(labels[result.kind]);
        }
        const result = await services.claims.confirmUnclaimFromButton(click);
        if (result.kind !== 'unclaim') throw new Error('account_claim_confirmation_unavailable');
        return message('你的 PUBG 账号声明关联已解除。');
      }
      const explicitCommand = /^(?:\/|!)pubg(?:\s|$)/iu.test(request.event.content.trim());
      if (!explicitCommand && request.kind === 'group') return undefined;
      const command = request.event.content.trim().replace(/^[!/]pubg(?:\s+|$)/iu, '').trim().toLowerCase();
      if (command === 'privacy') return message(KOOK_PUBLIC_PRIVACY_NOTICE);
      if (request.kind === 'group') {
        if (!job.boundTeam)
          return message('当前频道尚未绑定队伍，暂时无法处理此请求。');
        if (command === 'status') {
          const status = await services.teams.getBoundTeamStatus(request.event);
          return message(`队伍：${status.label}\n平台：${status.pubgShard}\n队员数：${status.pubgAccountIds.length}\n已绑定频道：${status.boundChannelCount}`);
        }
        if (command === 'unbind' || command === 'disband') {
          const action = command === 'unbind' ? 'unbind_channel' : 'disband_team';
          const pending = await services.teams.prepareTeamAction(request.event, { kind: action }, job.boundTeam);
          return createConfirmationCard({
            title: command === 'unbind' ? '确认解绑频道' : '确认解散队伍',
            detail: command === 'unbind' ? '只解绑当前频道，队伍将保留。此按钮仅限本次操作者；过期后请重新发起。' : '将移除队伍、频道绑定和队伍上下文。此按钮仅限本次操作者；过期后请重新发起。',
            confirmText: '确认', confirmationToken: pending.confirmationToken, actionScope: 'team',
          });
        }
        return message(groupHelp);
      }
      if (command === 'account') {
        const claim = await services.claims.getMyClaim(request.event);
        return message(claim ? `你的关联：${claim.pubgShard} / ${claim.pubgAccountId}\n状态：${claim.claimStatus === 'verified' ? '已验证' : '本人声明，未经所有权验证'}` : '你尚未关联 PUBG 账号。');
      }
      if (command === 'unclaim') {
        const pending = await services.claims.prepareUnclaim(request.event);
        return createConfirmationCard({ title: '确认解除账号关联', detail: '只解除你本人的 PUBG 账号声明关联。过期后请重新发起。', confirmText: '确认解除', confirmationToken: pending.confirmationToken, actionScope: 'claim' });
      }
      return message(directHelp);
    }
    catch (error) {
      const safe = error instanceof Error ? publicErrors[error.message] : undefined;
      if (safe)
        return message(safe);
      // Transport/DB failures retry through the durable queue; raw details are
      // neither sent to users nor added to the persisted error category.
      throw error;
    }
  };
}
