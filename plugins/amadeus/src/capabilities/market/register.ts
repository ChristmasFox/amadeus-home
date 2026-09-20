import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../../config.js';
import { marketIndices, type MarketPhase } from '../../market.js';
import { registerTool } from '../../shared/register-tool.js';
import { Type } from 'typebox';

const MarketParameters = Type.Object({
  phase: Type.Union([Type.Literal('open'), Type.Literal('close')]),
}, { additionalProperties: false });

export function registerMarket(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_market_indices', 'Read deterministic NASDAQ-100 and S&P 500 open/close observations from the configured market data source. It returns no current observation on weekends or exchange holidays; scheduled callers must notify only when status=ok.', MarketParameters, async (params, _context, _notifier, signal) => marketIndices(configFor(api), params.phase as MarketPhase, signal));
}
