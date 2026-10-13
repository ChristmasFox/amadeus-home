import { createConfirmationCard } from '../channels/kook/confirmation-card.js';
import type { AccountClaimService } from './account-claim-service.js';
import type { KookRequestHandler } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import type { TeamAdminService } from './team-admin-service.js';
function message(content: string): KookTextPayload { return { type: 'text', content }; }
const groupHelp = '队伍管理：/pubg status 查看状态；/pubg unbind 申请解绑当前频道；/pubg disband 申请解散队伍。变更需由服务器管理员确认。';
const directHelp = '账号管理：/pubg account 查看自己的关联；/pubg unclaim 申请解除关联。账号关联仅为本人声明，不能证明 PUBG 账号所有权。';
const publicErrors: Record<string, string> = {
  guild_admin_required: '需要当前服务器的拥有者或管理员权限。',
  channel_not_bound: '当前频道尚未绑定队伍。',
  team_action_confirmation_unavailable: '此确认已失效或不属于当前操作者/频道，请重新发起操作。',
  account_claim_confirmation_unavailable: '此账号确认已失效或不属于当前操作者，请重新发起操作。',
  account_claim_not_found: '你尚未关联 PUBG 账号。',
  account_claim_conflict: '该账号已有其他用户的声明关联，请联系服务器管理员处理。',
};
/** Deterministic management paths only. Query planning, lookup and onboarding
 * creation will be attached separately; these paths never invoke an LLM. */
export function createKookManagementHandler(services: {
  teams: TeamAdminService;
  claims: AccountClaimService;
}): KookRequestHandler {
  return async (job, signal) => {
    if (signal.aborted)
      throw new Error('kook_request_aborted');
    try {
      const request = job.request;
      if (request.kind === 'button') {
        const match = /^(team|claim):([A-Za-z0-9_-]{43})$/u.exec(request.event.value);
        if (!match || !request.event.eventId)
          return message('无法识别此确认操作，请重新发起。');
        const click = { ...request.event, value: match[2]! };
        if (match[1] === 'team') {
          const result = await services.teams.confirmTeamActionFromButton(click);
          const labels = { add_members: '队员已添加。', replace_roster: '队员名单已更新。', unbind_channel: '当前频道已解绑，队伍仍保留。', disband_team: '队伍已解散，绑定与队伍上下文已清理。' };
          return message(labels[result.kind]);
        }
        const result = await services.claims.confirmFromButton(click);
        return message(result.kind === 'unclaim' ? '你的 PUBG 账号声明关联已解除。' : '账号声明关联已保存（未经所有权验证）。');
      }
      const command = request.event.content.trim().replace(/^[!/]pubg(?:\s+|$)/iu, '').trim().toLowerCase();
      if (request.kind === 'group') {
        if (!job.boundTeam)
          return message('当前频道尚未绑定队伍，暂时无法处理此请求。');
        if (command === 'status') {
          const status = await services.teams.getBoundTeamStatus(request.event);
          return message(`队伍：${status.label}\n平台：${status.pubgShard}\n队员数：${status.pubgAccountIds.length}\n已绑定频道：${status.boundChannelCount}`);
        }
        if (command === 'unbind' || command === 'disband') {
          const action = command === 'unbind' ? 'unbind_channel' : 'disband_team';
          const pending = await services.teams.prepareTeamAction(request.event, { kind: action });
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
