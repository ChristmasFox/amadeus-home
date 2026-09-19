import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { definePluginEntry, jsonResult } from 'openclaw/plugin-sdk/core';
import { Static, Type, type TSchema } from 'typebox';
import { configFor } from './config.js';
import { homelabStatus } from './homelab.js';
import {
  identityAddAlias,
  identityBindChannel,
  identityConfirmCandidate,
  forgetTrustedInboundReply,
  identityGetPerson,
  identityLinkAccount,
  identityListCandidates,
  identityResolve,
  rememberTrustedInboundReply,
  type IdentityAddAliasInput,
  type IdentityBindChannelInput,
  type IdentityConfirmCandidateInput,
  type IdentityGetPersonInput,
  type IdentityLinkAccountInput,
  type IdentityListCandidatesInput,
  type IdentityResolveInput,
} from './identity.js';
import { kookGroupMembers } from './kook.js';
import { marketIndices, type MarketPhase } from './market.js';
import { organizeMedia } from './media.js';
import { nas } from './nas.js';
import { isTrustedOwnerContext, OwnerNotifier, ownerEventForContext } from './owner.js';
import { productRadar } from './radar.js';
import { getVpsLiveStatus, getVpsServices, getVpsServiceInfo, getVpsSystemStatus, getVpsUsage } from './vps.js';

const pluginConfigSchema = {
  jsonSchema: { type: 'object', additionalProperties: true },
} as const;

const ProductRadarParameters = Type.Object({
  action: Type.Union([
    Type.Literal('preview'), Type.Literal('create'), Type.Literal('list'), Type.Literal('get'), Type.Literal('update'),
    Type.Literal('delete'), Type.Literal('pause'), Type.Literal('resume'), Type.Literal('status'), Type.Literal('stats'),
    Type.Literal('usage'), Type.Literal('run'), Type.Literal('context_get'), Type.Literal('context_set'), Type.Literal('context_clear'),
  ]),
  watchId: Type.Optional(Type.String({ maxLength: 256 })),
  contextKey: Type.Optional(Type.String({ maxLength: 512 })),
  body: Type.Optional(Type.Record(Type.String({ maxLength: 64 }), Type.Unknown(), { maxProperties: 64 })),
}, { additionalProperties: false });

const MediaParameters = Type.Object({
  action: Type.Union([Type.Literal('scan'), Type.Literal('preview'), Type.Literal('execute'), Type.Literal('cancel')]),
  sourceName: Type.Optional(Type.String({ maxLength: 256 })),
  candidateIndex: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  previewId: Type.Optional(Type.String({ maxLength: 256 })),
  confirm: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const NasParameters = Type.Object({
  action: Type.Union([Type.Literal('status'), Type.Literal('disk'), Type.Literal('sleep')]),
}, { additionalProperties: false });

const HomeLabParameters = Type.Object({
  notifyOwner: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const KookParameters = Type.Object({
  maxMembers: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
}, { additionalProperties: false });

const MarketParameters = Type.Object({
  phase: Type.Union([Type.Literal('open'), Type.Literal('close')]),
}, { additionalProperties: false });

const NotifyOwnerParameters = Type.Object({
  eventKey: Type.String({ minLength: 1, maxLength: 256 }),
  source: Type.String({ minLength: 1, maxLength: 128 }),
  title: Type.String({ maxLength: 200 }),
  message: Type.String({ minLength: 1, maxLength: 16_000 }),
}, { additionalProperties: false });

const VpsParameters = Type.Object({}, { additionalProperties: false });

const IDENTITY_DISPATCH_GUIDANCE = [
  'Native identity dispatch contract for person-specific PUBG requests:',
  'when the user names a person by nickname or alias (for example “胶昨天战绩” or “猴昨天战绩”), call identity_resolve with reference=alias and the exact alias before replying or calling a PUBG tool; omit scope for a preloaded nickname so the resolver checks the group alias first and then the global preset.',
  'when the user uses a first-person reference such as “我”, “我的”, “本人”, or “自己” in a PUBG request, call identity_resolve with reference=self before any PUBG tool, then pass the resolved person.personId as personIds; “我昨天战绩” is never an implicit team request.',
  'Use team=true only when the user explicitly asks for the configured team, the whole squad, or the full team; never use team=true for “我/我的/本人/自己”.',
  'If identity_resolve returns status=resolved, immediately pass result.person.personId as personIds to the relevant PUBG tool.',
  'Do not ask for a PUBG ID or claim that an account is unconfirmed before this lookup; a previous assistant reply is not current identity state.',
  'For any PUBG review/replay/summary request over a period, let the LLM classify the semantic operation and period, then use pubg_search_matches with selector={type:"relative_period",value:"today" or "yesterday"}, refresh=true, and pageSize up to 50; do not calculate calendar-midnight timestamps or reuse prior review facts.',
  'Pass the fresh pubg_search_matches resultSetId to every pubg_get_review_facts call. The review tool is structurally gated to a current-turn fresh result set; cache HIT/FETCHED is independent from fresh match discovery.',
].join('\n');

const IdentityResolveParameters = Type.Object({
  reference: Type.Union([
    Type.Literal('self'), Type.Literal('alias'), Type.Literal('person'), Type.Literal('mention'), Type.Literal('reply_sender'),
  ]),
  alias: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  personId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('group')])),
  mentionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
}, { additionalProperties: false });

const IdentityGetPersonParameters = Type.Object({
  personId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false });

const IdentityBindChannelParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  target: Type.Optional(Type.Union([Type.Literal('current_sender'), Type.Literal('mention'), Type.Literal('reply_sender')])),
  mentionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
}, { additionalProperties: false });

const IdentityAddAliasParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  alias: Type.String({ minLength: 1, maxLength: 128 }),
  scope: Type.Union([Type.Literal('global'), Type.Literal('group')]),
  source: Type.Union([Type.Literal('confirmed'), Type.Literal('observed')]),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  evidenceSummary: Type.Optional(Type.String({ maxLength: 512 })),
}, { additionalProperties: false });

const IdentityLinkAccountParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  externalId: Type.String({ minLength: 1, maxLength: 256 }),
  label: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false });

const IdentityListCandidatesParameters = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('group')])),
}, { additionalProperties: false });

const IdentityConfirmCandidateParameters = Type.Object({
  candidateId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });

type Params<S extends TSchema> = Static<S>;

function failure(error: unknown): unknown {
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
}

function makeTool<S extends TSchema>(
  api: OpenClawPluginApi,
  context: OpenClawPluginToolContext,
  name: string,
  description: string,
  parameters: S,
  handler: (params: Params<S>, signal?: AbortSignal) => Promise<unknown>,
): AnyAgentTool {
  return {
    name,
    label: name,
    description,
    parameters,
    async execute(_toolCallId, rawParams, signal) {
      try {
        return jsonResult(await handler(rawParams as Params<S>, signal));
      } catch (error) {
        api.logger.warn(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        return jsonResult(failure(error));
      }
    },
  };
}

function registerTool<S extends TSchema>(
  api: OpenClawPluginApi,
  name: string,
  description: string,
  parameters: S,
  handler: (params: Params<S>, context: OpenClawPluginToolContext, notifier: OwnerNotifier, signal?: AbortSignal) => Promise<unknown>,
): void {
  api.registerTool((context) => {
    const config = configFor(api);
    const notifier = new OwnerNotifier(api, config);
    return makeTool(api, context, name, description, parameters, (params, signal) => handler(params, context, notifier, signal));
  }, { name });
}

const entry = definePluginEntry({
  id: 'amadeus',
  name: 'Amadeus capabilities',
  description: 'Native OpenClaw capabilities for Amadeus services and owner notifications.',
  configSchema: pluginConfigSchema,
  register(api) {
    const config = configFor(api);
    api.on('before_prompt_build', () => ({ appendSystemContext: IDENTITY_DISPATCH_GUIDANCE }));
    api.on('before_dispatch', (event, hookContext) => {
      rememberTrustedInboundReply({
        sessionKey: hookContext.sessionKey ?? event.sessionKey,
        channel: hookContext.channelId ?? event.channel,
        accountId: hookContext.accountId,
        conversationId: hookContext.conversationId,
        replyToSender: hookContext.replyToSender ?? event.replyToSender,
      });
    });
    api.on('agent_end', (_event, hookContext) => {
      forgetTrustedInboundReply(hookContext.sessionKey);
    });
    let workerTimer: ReturnType<typeof setInterval> | undefined;
    api.registerService({
      id: 'amadeus-owner-notification-worker',
      async start() {
        const notifier = new OwnerNotifier(api, config);
        await notifier.drain();
        workerTimer = setInterval(() => { void notifier.drain(); }, 5_000);
        workerTimer.unref();
      },
      stop() {
        if (workerTimer) clearInterval(workerTimer);
        workerTimer = undefined;
      },
    });

    registerTool(api, 'amadeus_product_radar', 'Manage Product Radar watches through explicit structured operations. Natural-language interpretation stays in OpenClaw; this tool does not parse commands.', ProductRadarParameters, async (params, _context, _notifier, signal) => productRadar(config, params, signal));
    registerTool(api, 'amadeus_media_organize', 'Scan, preview, execute, or cancel one explicit Emby download-folder organization. Execute only after explicit same-session confirmation.', MediaParameters, async (params, context, notifier, signal) => organizeMedia(config, params, context, notifier, signal));
    registerTool(api, 'amadeus_nas', 'Read NAS status or disk usage, or put the Mac NAS to sleep. Sleep requires the trusted owner identity.', NasParameters, async (params, context, _notifier, signal) => nas(config, params.action, context, signal));
    registerTool(api, 'amadeus_homelab_status', 'Read current HomeLab host and service status. It never restarts or modifies services; notifyOwner is an explicit owner-only delivery request.', HomeLabParameters, async (params, context, notifier, signal) => homelabStatus(config, context, notifier, params.notifyOwner === true, signal));
    registerTool(api, 'amadeus_kook_group_members', 'Read members of the active KOOK group/channel only. This is an interactive lookup and never a proactive notification path.', KookParameters, async (params, context, _notifier, signal) => kookGroupMembers(config, context, params.maxMembers ?? 200, signal));
    registerTool(api, 'amadeus_market_indices', 'Read deterministic NASDAQ-100 and S&P 500 open/close observations from the configured market data source. It returns no current observation on weekends or exchange holidays; scheduled callers must notify only when status=ok.', MarketParameters, async (params, _context, _notifier, signal) => marketIndices(config, params.phase as MarketPhase, signal));
    registerTool(api, 'identity_resolve', 'Resolve a canonical Person from trusted current sender/mention metadata, a preloaded or confirmed alias, or a person id. Alias resolution checks a group alias first and falls back to the global preset unless global-only scope is requested. For any person-specific PUBG request expressed with a nickname or alias, call this tool first and pass the resolved personId to the PUBG tool. This tool never treats a channel display name, phone number, or JID as a PUBG account.', IdentityResolveParameters, async (params, context) => identityResolve(config, params as IdentityResolveInput, context));
    registerTool(api, 'identity_get_person', 'Read one canonical Person, including confirmed aliases, channel bindings, and provider-neutral external accounts.', IdentityGetPersonParameters, async (params) => identityGetPerson(config, params as IdentityGetPersonInput));
    registerTool(api, 'identity_bind_channel', 'Owner-confirm a trusted current sender, mention, or replied sender as a canonical Person. Channel identity comes only from OpenClaw metadata, never from tool text.', IdentityBindChannelParameters, async (params, context) => identityBindChannel(config, params as IdentityBindChannelInput, context));
    registerTool(api, 'identity_add_alias', 'Add a confirmed alias or a group-scoped observed alias candidate. Observed candidates never become reliable without confirmation.', IdentityAddAliasParameters, async (params, context) => identityAddAlias(config, params as IdentityAddAliasInput, context));
    registerTool(api, 'identity_link_account', 'Owner-confirm a provider-neutral external account for a Person, such as a PUBG account. The provider and external id are explicit structured values.', IdentityLinkAccountParameters, async (params, context) => identityLinkAccount(config, params as IdentityLinkAccountInput, context));
    registerTool(api, 'identity_list_candidates', 'List persisted observed nickname candidates for the current conversation or requested scope; this does not resolve them as reliable identities.', IdentityListCandidatesParameters, async (params, context) => identityListCandidates(config, params as IdentityListCandidatesInput, context));
    registerTool(api, 'identity_confirm_candidate', 'Owner-confirm one persisted observed nickname candidate so it becomes an authoritative alias.', IdentityConfirmCandidateParameters, async (params, context) => identityConfirmCandidate(config, params as IdentityConfirmCandidateInput, context));
    registerTool(api, 'amadeus_notify_owner', 'Send a proactive owner notification to the fixed WhatsApp owner DM. For scheduled VPS reports, use the stable date/period eventKey; manual cron runs are automatically isolated under a separate key and must never consume the scheduled key.', NotifyOwnerParameters, async (params, context, notifier) => {
      if (!isTrustedOwnerContext(context)) throw new Error('owner notification requires owner identity');
      return notifier.notify(ownerEventForContext(params, context));
    });
    registerTool(api, 'amadeus_vps_service_info', 'Read VPS basic service and plan facts through the fixed read-only KiwiVM service-info API. No control endpoint or credential is exposed.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsServiceInfo(config, signal));
    registerTool(api, 'amadeus_vps_live_status', 'Read the VPS Running/Stopped state, KiwiVM live resource facts, and CPU throttling through the fixed read-only live-status API.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsLiveStatus(config, signal));
    registerTool(api, 'amadeus_vps_usage', 'Read KiwiVM traffic counters, quota, remaining bytes, reset time, bounded traffic history, and the persisted delta since the previous successful sample.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsUsage(config, signal));
    registerTool(api, 'amadeus_vps_system_status', 'Read VPS uptime, load average, memory, and root filesystem usage through one fixed read-only SSH probe. It never accepts a shell command.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsSystemStatus(config, signal));
    registerTool(api, 'amadeus_vps_services', 'Read the fixed critical VPS systemd services Caddy, Xray, Hysteria2, and frps through a bounded read-only SSH probe.', VpsParameters, async (_params, _context, _notifier, signal) => getVpsServices(config, signal));
    api.logger.info('amadeus native capability plugin registered');
  },
});

export default entry;
