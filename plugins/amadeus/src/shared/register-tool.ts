import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { jsonResult } from 'openclaw/plugin-sdk/core';
import { Static, type TSchema } from 'typebox';
import { configFor } from '../config.js';
import { OwnerNotifier } from '../owner.js';

type Params<S extends TSchema> = Static<S>;

function failure(error: unknown): unknown {
  return { status: 'error', message: error instanceof Error ? error.message : String(error) };
}

function makeTool<S extends TSchema>(
  api: OpenClawPluginApi,
  name: string,
  description: string,
  parameters: S,
  handler: (params: Params<S>, context: OpenClawPluginToolContext, notifier: OwnerNotifier, signal?: AbortSignal) => Promise<unknown>,
): (context: OpenClawPluginToolContext) => AnyAgentTool {
  return (context) => ({
    name,
    label: name,
    description,
    parameters,
    async execute(_toolCallId, rawParams, signal) {
      try {
        const notifier = new OwnerNotifier(api, configFor(api));
        return jsonResult(await handler(rawParams as Params<S>, context, notifier, signal));
      } catch (error) {
        api.logger.warn(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        return jsonResult(failure(error));
      }
    },
  });
}

export function registerTool<S extends TSchema>(
  api: OpenClawPluginApi,
  name: string,
  description: string,
  parameters: S,
  handler: (params: Params<S>, context: OpenClawPluginToolContext, notifier: OwnerNotifier, signal?: AbortSignal) => Promise<unknown>,
): void {
  api.registerTool(makeTool(api, name, description, parameters, handler), { name });
}
