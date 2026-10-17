import { startServer } from '../src/server/server.js';

interface Bootstrap {
  matchCount: number;
  modelEnabled: boolean;
  modelId: string | null;
  selectedSquadId: string;
  dateFrom: string | null;
  dateTo: string | null;
}

interface ResearchResponse {
  plannerSource: string;
  assistant: {
    source: string;
    status: string;
    degradedReason: string | null;
    toolNames: string[];
    claims: unknown[];
    evidence: unknown[];
  };
}

async function main(): Promise<void> {
  const previous = { port: process.env.PORT, host: process.env.HOST };
  const originalFetch = globalThis.fetch;
  let routerCalls = 0;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    process.env.PORT = '0';
    process.env.HOST = '127.0.0.1';
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const target = input instanceof Request ? input.url : String(input);
      if (target.includes(':20128/v1/')) routerCalls += 1;
      return originalFetch(input, init);
    }) as typeof fetch;

    server = await startServer();
    const bootstrapResponse = await fetch(`${server.url}/api/bootstrap`);
    if (!bootstrapResponse.ok) throw new Error('real_ai_e2e_bootstrap_failed');
    const bootstrap = await bootstrapResponse.json() as Bootstrap;
    if (!bootstrap.modelEnabled) throw new Error('real_ai_e2e_model_not_configured');
    if (bootstrap.modelId !== 'arthur-combo') throw new Error('real_ai_e2e_wrong_model_route');
    if (!bootstrap.matchCount || !bootstrap.dateFrom || !bootstrap.dateTo) throw new Error('real_ai_e2e_source_data_missing');

    const response = await fetch(`${server.url}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: '按队员汇总这段时间的总伤害，指出最高者并给出可核查的对局证据。',
        squadId: bootstrap.selectedSquadId,
        from: bootstrap.dateFrom,
        to: bootstrap.dateTo,
      }),
    });
    if (!response.ok) throw new Error('real_ai_e2e_research_http_failed');
    const result = await response.json() as ResearchResponse;
    const passed = routerCalls > 0 && result.plannerSource === 'ai-sdk'
      && result.assistant.source === 'ai-sdk' && result.assistant.status === 'answered'
      && result.assistant.claims.length > 0 && result.assistant.evidence.length > 0;
    console.log(JSON.stringify({
      realRouterCalls: routerCalls,
      modelEnabled: bootstrap.modelEnabled,
      modelId: bootstrap.modelId,
      matchCount: bootstrap.matchCount,
      plannerSource: result.plannerSource,
      assistantSource: result.assistant.source,
      assistantStatus: result.assistant.status,
      assistantDegradedReason: result.assistant.degradedReason,
      assistantToolNames: result.assistant.toolNames,
      claimCount: result.assistant.claims.length,
      evidenceCount: result.assistant.evidence.length,
      passed,
    }));
    if (!passed) process.exitCode = 1;
  } finally {
    if (server) await server.close();
    globalThis.fetch = originalFetch;
    if (previous.port === undefined) delete process.env.PORT; else process.env.PORT = previous.port;
    if (previous.host === undefined) delete process.env.HOST; else process.env.HOST = previous.host;
  }
}

main().catch(() => {
  console.error('REAL_AI_E2E=failed');
  process.exitCode = 1;
});
