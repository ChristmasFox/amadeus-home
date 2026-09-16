/**
 * A small deterministic probe for the selected LangBot host contract.
 *
 * This is deliberately a host-shape test, not a second production agent. It
 * models the minimum loop that Path A must preserve: the host chooses typed
 * tools, receives correlated results, follows a dependency, and only then
 * emits a final answer. The real model/provider probe is recorded separately
 * because it must never be hidden behind this fixture.
 */

export type ProbeStatus = 'ok' | 'error';

export interface ProbeContext {
  platform: 'telegram' | 'kook' | 'test';
  platformUserId: string;
  conversationId: string;
  runId: string;
}

export interface ProbeToolCall {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export interface ProbeToolResult {
  toolCallId: string;
  status: ProbeStatus;
  evidence: string[];
  entityRefs: string[];
}

export interface ProbeTrace {
  context: ProbeContext;
  toolCalls: ProbeToolCall[];
  toolResults: ProbeToolResult[];
  finalAnswer: string | null;
}

export interface ProbeTool {
  name: string;
  execute(
    call: ProbeToolCall,
    context: ProbeContext,
  ): Promise<ProbeToolResult>;
}

const defaultTools: readonly ProbeTool[] = [
  {
    name: 'kurisu_probe_status',
    async execute(call, context) {
      return {
        toolCallId: call.id,
        status: 'ok',
        evidence: [`${context.conversationId}:fake-service=healthy`],
        entityRefs: ['fake-service'],
      };
    },
  },
  {
    name: 'kurisu_probe_details',
    async execute(call, context) {
      if (call.arguments.entityRef !== 'fake-service') {
        return {
          toolCallId: call.id,
          status: 'error',
          evidence: [`${context.runId}:unknown-entity`],
          entityRefs: [],
        };
      }
      return {
        toolCallId: call.id,
        status: 'ok',
        evidence: [`${context.runId}:fake-service=ready`],
        entityRefs: ['fake-service'],
      };
    },
  },
];

/** Run the minimum multi-tool dependency loop expected from the selected host. */
export async function runFakeHostProbe(
  tools: readonly ProbeTool[] = defaultTools,
): Promise<ProbeTrace> {
  const context: ProbeContext = {
    platform: 'test',
    platformUserId: 'probe-user-1',
    conversationId: 'probe-conversation-1',
    runId: 'probe-run-1',
  };
  const registry = new Map(tools.map((tool) => [tool.name, tool]));
  const trace: ProbeTrace = {
    context,
    toolCalls: [],
    toolResults: [],
    finalAnswer: null,
  };

  const call = async (
    id: string,
    name: string,
    args: Record<string, string>,
  ): Promise<ProbeToolResult> => {
    const toolCall: ProbeToolCall = { id, name, arguments: args };
    trace.toolCalls.push(toolCall);
    const tool = registry.get(name);
    if (!tool) {
      const result: ProbeToolResult = {
        toolCallId: id,
        status: 'error',
        evidence: [`${context.runId}:tool-not-found`],
        entityRefs: [],
      };
      trace.toolResults.push(result);
      return result;
    }
    const result = await tool.execute(toolCall, context);
    trace.toolResults.push(result);
    return result;
  };

  const status = await call('probe-call-1', 'kurisu_probe_status', {
    scope: 'host-loop',
  });
  if (status.status === 'ok' && status.entityRefs.length === 1) {
    const details = await call('probe-call-2', 'kurisu_probe_details', {
      entityRef: status.entityRefs[0]!,
    });
    if (details.status === 'ok') {
      trace.finalAnswer = 'fake-service is ready; evidence is correlated.';
    }
  }

  return trace;
}

export function isSuccessfulFakeHostProbe(trace: ProbeTrace): boolean {
  return (
    trace.toolCalls.map((call) => call.name).join(',') ===
      'kurisu_probe_status,kurisu_probe_details' &&
    trace.toolResults.every((result, index) => result.toolCallId === trace.toolCalls[index]?.id) &&
    trace.toolResults.every((result) => result.status === 'ok') &&
    trace.finalAnswer !== null
  );
}
