import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { Type } from 'typebox';
import { configFor } from '../../config.js';
import { MarketService } from '../../market.js';
import { registerTool } from '../../shared/register-tool.js';

const SymbolParameters = Type.Object({ symbols: Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { minItems: 1, maxItems: 20 }) }, { additionalProperties: false });
const OneSymbolParameters = Type.Object({ symbol: Type.String({ minLength: 1, maxLength: 32 }) }, { additionalProperties: false });
const EmptyParameters = Type.Object({}, { additionalProperties: false });
const OverviewParameters = Type.Object({ phase: Type.Optional(Type.Union([Type.Literal('open'), Type.Literal('close')])) }, { additionalProperties: false });

export function registerMarket(api: OpenClawPluginApi): void {
  registerTool(api, 'amadeus_market_overview', 'Read the public US market overview from Longbridge. It is read-only and returns a truthful structured failure when OAuth or the provider is unavailable.', OverviewParameters, async (params, _context, _notifier, signal) => new MarketService(configFor(api)).overview(signal, params.phase));
  registerTool(api, 'amadeus_market_quote', 'Read public quotes for explicit US index aliases or US equity symbols such as AAPL.US. Longbridge is the only market source.', SymbolParameters, async (params, _context, _notifier, signal) => new MarketService(configFor(api)).quote(params.symbols, signal));
  registerTool(api, 'amadeus_market_intraday', 'Read deterministic intraday range and position for one public US symbol from Longbridge.', OneSymbolParameters, async (params, _context, _notifier, signal) => new MarketService(configFor(api)).intraday(params.symbol, signal));
  registerTool(api, 'amadeus_market_session', 'Read Longbridge US trading session state and trading-day information. Do not infer session validity from a fixed clock.', EmptyParameters, async (_params, _context, _notifier, signal) => new MarketService(configFor(api)).session(signal));
  registerTool(api, 'amadeus_market_movers', 'Read public US market movers from Longbridge. No account or trading data is exposed.', EmptyParameters, async (_params, _context, _notifier, signal) => new MarketService(configFor(api)).movers(signal));
  registerTool(api, 'amadeus_market_constituents', 'Read public constituents for a normalized US index from Longbridge. This exposes no account or trading data.', OneSymbolParameters, async (params, _context, _notifier, signal) => new MarketService(configFor(api)).constituents(params.symbol, signal));
}
