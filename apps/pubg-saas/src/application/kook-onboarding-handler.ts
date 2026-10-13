import { createConfirmationCard, createOnboardingCard } from '../channels/kook/confirmation-card.js';
import { parseKookManagementCommand } from '../channels/kook/management-command.js';
import type { PublicPubgPlayerResolverPort, ResolvedPubgPlayer } from '../infrastructure/pubg/player-resolver.js';
import type { AccountClaimService } from './account-claim-service.js';
import type { KookIngressJob } from './kook-ingress-queue.js';
import type { KookTextPayload } from './kook-message-queue.js';
import type { TeamAdminService } from './team-admin-service.js';

export interface KookOnboardingServices {
  teams: TeamAdminService;
  claims: AccountClaimService;
  players?: PublicPubgPlayerResolverPort;
}

function text(content: string): KookTextPayload { return { type: 'text', content }; }
const guidance: Record<string, string> = {
  'ui:create': '请在要绑定的服务器频道发送：/pubg create steam "队伍名称" PlayerA PlayerB（1–4 名玩家）。平台支持 steam/kakao/psn/xbox；含空格的名称用引号包裹。查询后需确认；服务器拥有者或管理员才能执行。',
  'ui:bind': '请在目标服务器频道发送 /pubg teams 查看该服务器的队伍，再发送 /pubg bind <队伍ID>。绑定前需确认，且当前频道必须未绑定队伍。',
  'ui:claim': '请在本私信发送 /pubg claim steam PlayerName。平台支持 steam/kakao/psn/xbox；名称含空格时用引号包裹。查询后需确认；此关联是本人声明，不能证明游戏账号所有权。',
};

async function resolve(services: KookOnboardingServices, shard: string, names: string[], signal: AbortSignal): Promise<{ players: ResolvedPubgPlayer[] } | { reply: KookTextPayload }> {
  if (!services.players) throw new Error('public_pubg_lookup_unavailable');
  const result = await services.players.resolveNames(shard, names, signal);
  if (signal.aborted) throw new Error('kook_request_aborted');
  if (result.missingNames.length || result.ambiguousNames.length) {
    const details = [
      result.missingNames.length ? `未找到：${result.missingNames.join('、')}` : null,
      result.ambiguousNames.length ? `名称存在歧义：${result.ambiguousNames.join('、')}` : null,
    ].filter(Boolean).join('\n');
    return { reply: text(`${details}\n请核对平台与游戏内名称后重新提交，名单尚未保存。`) };
  }
  if (!result.players.length || result.players.length !== names.length) throw new Error('public_pubg_lookup_invalid_response');
  return { players: result.players };
}

/** Completes name-based deterministic setup. Help buttons are read-only;
 * mutations use opaque one-use setup/team/claim tokens after name resolution. */
export async function handleKookOnboardingRequest(job: KookIngressJob, services: KookOnboardingServices, signal: AbortSignal): Promise<KookTextPayload | undefined> {
  const request = job.request;
  if(request.kind==='guild_join')return createOnboardingCard();
  if (request.kind === 'button') {
    if (Object.hasOwn(guidance, request.event.value)) return text(guidance[request.event.value]!);
    const match = /^setup:([A-Za-z0-9_-]{43})$/u.exec(request.event.value);
    if (!match) return undefined;
    const result = await services.teams.confirmSquadSetupFromButton({ ...request.event, value: match[1]! });
    return text(`${result.kind === 'create' ? '队伍已创建并绑定到原频道。' : '原频道已绑定到所选队伍。'}\n队伍ID：${result.team.teamId}`);
  }
  const command = parseKookManagementCommand(request.event.content);
  if (!command) return undefined;
  if (command.kind === 'help') return createOnboardingCard();
  if (command.kind === 'invalid') return text('命令参数不完整或引号未闭合。发送 /pubg help 查看入口；游戏名和队伍名包含空格时请使用引号。');
  if (request.kind === 'group') {
    const event = request.event;
    if (command.kind === 'teams') {
      const teams = await services.teams.listGuildTeams(event);
      return text(teams.length ? `本服务器的队伍（最多显示 50 个）：\n${teams.map(team => `${team.label} · ${team.pubgShard} · ${team.memberCount} 人\n${team.teamId}`).join('\n\n')}` : '本服务器尚未创建队伍。发送 /pubg help 查看建队入口。');
    }
    if (command.kind === 'create') {
      if (job.boundTeam) throw new Error('channel_binding_conflict');
      await services.teams.assertGuildAdmin(event);
      const resolved = await resolve(services, command.shard, command.names, signal);
      if ('reply' in resolved) return resolved.reply;
      const pending = await services.teams.prepareSquadCreation(event, { label: command.label, pubgShard: command.shard,
        pubgAccountIds: resolved.players.map(player => player.accountId),
        resolvedPlayers: resolved.players.map(player => ({ accountId: player.accountId, displayName: player.name })) });
      return createConfirmationCard({ title: '确认创建队伍', detail: `队伍：${command.label}\n平台：${command.shard}\n玩家：${resolved.players.map(player => player.name).join('、')}\n确认后将创建队伍并绑定当前频道。仅本次操作者可确认。`, confirmText: '创建并绑定', confirmationToken: pending.confirmationToken, actionScope: 'setup' });
    }
    if (command.kind === 'bind') {
      if (job.boundTeam) throw new Error('channel_binding_conflict');
      const pending = await services.teams.prepareSquadBinding(event, command.teamId);
      return createConfirmationCard({ title: '确认绑定已有队伍', detail: `队伍：${pending.label}\n平台：${pending.pubgShard}\n队员数：${pending.memberCount}\n确认后将把当前频道绑定到此队伍。`, confirmText: '绑定频道', confirmationToken: pending.confirmationToken, actionScope: 'setup' });
    }
    if (command.kind === 'add' || command.kind === 'roster') {
      if (!job.boundTeam) throw new Error('channel_not_bound');
      const current = await services.teams.getBoundTeamStatus(event);
      if (current.teamId !== job.boundTeam.teamId || current.tenantId !== job.boundTeam.tenantId) throw new Error('team_action_scope_changed');
      const resolved = await resolve(services, current.pubgShard, command.names, signal);
      if ('reply' in resolved) return resolved.reply;
      const pending = await services.teams.prepareTeamAction(event, { kind: command.kind === 'add' ? 'add_members' : 'replace_roster',
        pubgAccountIds: resolved.players.map(player => player.accountId),
        resolvedPlayers: resolved.players.map(player => ({ accountId: player.accountId, displayName: player.name })) }, job.boundTeam);
      return createConfirmationCard({ title: command.kind === 'add' ? '确认添加队员' : '确认替换队员名单', detail: `队伍：${current.label}\n平台：${current.pubgShard}\n${command.kind === 'add' ? '添加玩家' : '新的完整名单'}：${resolved.players.map(player => player.name).join('、')}\n仅本次操作者可确认。`, confirmText: '确认名单', confirmationToken: pending.confirmationToken, actionScope: 'team' });
    }
    if (command.kind === 'claim') return text('个人账号声明关联请在 bot 私信中发送 /pubg claim <平台> <游戏名>。');
    return undefined;
  }
  if (command.kind === 'claim') {
    if (await services.claims.getMyClaim(request.event)) throw new Error('account_claim_already_bound');
    const resolved = await resolve(services, command.shard, [command.name], signal);
    if ('reply' in resolved) return resolved.reply;
    const player = resolved.players[0]!;
    const pending = await services.claims.prepareClaim(request.event, { pubgShard: command.shard, pubgAccountId: player.accountId });
    return createConfirmationCard({ title: '确认声明关联我的账号', detail: `平台：${command.shard}\n游戏名：${player.name}\n这只是你本人的声明关联，未经账号所有权验证。仅本次操作者可确认。`, confirmText: '确认声明关联', confirmationToken: pending.confirmationToken, actionScope: 'claim' });
  }
  if (['create', 'bind', 'teams', 'add', 'roster'].includes(command.kind)) return text('队伍管理需要在明确的服务器频道中发起。请到目标频道发送 /pubg help。');
  return undefined;
}
