import { Static, Type } from 'typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { organizeMedia } from '../../media.js';
import { registerTool } from '../../shared/register-tool.js';

const MediaParameters = Type.Object({
  action: Type.Union([Type.Literal('scan'), Type.Literal('preview'), Type.Literal('execute'), Type.Literal('cancel')]),
  sourceName: Type.Optional(Type.String({ maxLength: 256 })),
  candidateIndex: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })),
  previewId: Type.Optional(Type.String({ maxLength: 256 })),
  confirm: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export function registerMedia(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_media_organize', 'Scan, preview, execute, or cancel one explicit Emby download-folder organization. Execute only after explicit same-session confirmation.', MediaParameters, async (params, context, notifier, signal) => organizeMedia(configFor(api), params as Static<typeof MediaParameters>, context, notifier, signal));
}
