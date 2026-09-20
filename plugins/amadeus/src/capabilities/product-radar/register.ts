import { Static, Type } from 'typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { productRadar } from '../../radar.js';
import { registerTool } from '../../shared/register-tool.js';

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

const MUTATING_ACTIONS = new Set([
  'create', 'update', 'delete', 'pause', 'resume', 'run', 'context_set', 'context_clear',
]);

export function registerProductRadar(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_product_radar', 'Manage Product Radar watches through explicit structured operations. Natural-language interpretation stays in OpenClaw; this tool does not parse commands.', ProductRadarParameters, async (params, context, _notifier, signal) => {
    if (MUTATING_ACTIONS.has(params.action) && context.senderIsOwner !== true) {
      throw new Error('Product Radar mutation requires owner identity');
    }
    return productRadar(configFor(api), params as Static<typeof ProductRadarParameters>, signal);
  });
}
