import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { definePluginEntry, jsonResult } from 'openclaw/plugin-sdk/core';
import { Static, Type, type TSchema } from 'typebox';
import { configFor } from './config.js';
import { runBriefing } from './briefing.js';
import { homelabStatus } from './homelab.js';
import { kookGroupMembers } from './kook.js';
import { organizeMedia } from './media.js';
import { nas } from './nas.js';
import { isTrustedOwnerContext, OwnerNotifier, ownerEvent } from './owner.js';
import { productRadar } from './radar.js';

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

const NotifyOwnerParameters = Type.Object({
  eventKey: Type.String({ minLength: 1, maxLength: 256 }),
  source: Type.String({ minLength: 1, maxLength: 128 }),
  title: Type.String({ maxLength: 200 }),
  message: Type.String({ minLength: 1, maxLength: 16_000 }),
}, { additionalProperties: false });

const BriefingParameters = Type.Object({
  edition: Type.Optional(Type.Union([Type.Literal('auto'), Type.Literal('morning'), Type.Literal('evening')])),
  deliver: Type.Optional(Type.Boolean()),
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
    registerTool(api, 'amadeus_notify_owner', 'Send a proactive owner notification. The recipient and channel are fixed by deployment to the WhatsApp owner; callers cannot select Telegram, KOOK, or another target.', NotifyOwnerParameters, async (params, context, notifier) => {
      if (!isTrustedOwnerContext(context)) throw new Error('owner notification requires owner identity');
      return notifier.notify(ownerEvent(params));
    });
    registerTool(api, 'amadeus_briefing', 'Generate the configured technology/market morning or evening briefing from curated feeds and optionally deliver it to the WhatsApp owner.', BriefingParameters, async (params, context, notifier, signal) => runBriefing(config, params.edition ?? 'auto', params.deliver === true, isTrustedOwnerContext(context), notifier, signal));
    api.logger.info('amadeus native capability plugin registered');
  },
});

export default entry;
