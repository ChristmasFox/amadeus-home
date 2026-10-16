import assert from 'node:assert/strict';
import test from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import {
  anonymizeResearchText,
  renderResearchTemplate,
  runResearchAssistant,
  type ResearchAssistantToolset,
} from '../src/assistant.js';

const usage = {
  inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 12, text: 12, reasoning: undefined },
};

function response(content: Array<Record<string, unknown>>, finish: 'stop' | 'tool-calls' | 'length' = 'stop') {
  return { content, finishReason: { unified: finish, raw: finish }, usage, warnings: [] };
}

const tools: ResearchAssistantToolset = {
  searchMatches: () => ({ status: 'available', matches: [{ matchRef: 'M0001', damage: 500, evidenceRefs: ['E0001'] }] }),
  getScopedMetrics: () => ({ status: 'ok', selectedMatches: 2, summary: { averageDamage: 500 }, evidenceRefs: ['E0001'] }),
  compareRescues: () => ({ status: 'available', pairs: [], evidenceRefs: [] }),
  getMatchEpisodes: () => ({ status: 'available', episodes: [], evidenceRefs: [] }),
  lookupEvidence: () => ({ items: [{ ref: 'E0001' }], evidenceRefs: ['E0001'] }),
};

const evidenceByAlias = new Map([['E0001', {
  ref: 'E0001', matchId: 'sanitized-match-ref', eventId: 'telemetry-2', timeSeconds: 14, kind: 'damage',
}]]);

function validModel(output: unknown): MockLanguageModelV4 {
  return new MockLanguageModelV4({ doGenerate: [
    response([{ type: 'tool-call', toolCallId: 'metrics-call', toolName: 'get_scoped_metrics', input: JSON.stringify({ metric: 'damage', groupBy: 'none' }) }], 'tool-calls') as never,
    response([{ type: 'text', text: 'Metrics loaded.' }]) as never,
    response([{ type: 'text', text: JSON.stringify(output) }]) as never,
  ] });
}

const validOutput = {
  answer: 'The scoped average damage is 500.',
  claims: [{ kind: 'fact', text: 'The scoped average damage is 500.', evidenceRefs: ['E0001'], evidenceCount: 1, assumptions: [], uncertainty: null }],
  abstained: false,
};

test('AI SDK executes only typed scoped tools and returns cited structured claims', async () => {
  const model = validModel(validOutput);
  let metricCalls = 0;
  const result = await runResearchAssistant({
    model,
    message: 'Compare average damage',
    scopeDescription: 'selected squad, fixed dates',
    template: 'tactical_coaching',
    fallbackAnswer: 'Deterministic answer.',
    tools: { ...tools, getScopedMetrics: (input) => { metricCalls += 1; assert.deepEqual(input, { metric: 'damage', groupBy: 'none' }); return tools.getScopedMetrics(input); } },
    evidenceByAlias,
  });

  assert.equal(metricCalls, 1);
  assert.equal(result.source, 'ai-sdk');
  assert.equal(result.status, 'answered');
  assert.deepEqual(result.toolNames, ['get_scoped_metrics']);
  assert.deepEqual(result.evidence.map((ref) => ref.ref), ['E0001']);
  assert.equal(result.claims[0]?.evidenceCount, result.claims[0]?.evidenceRefs.length);
  assert.deepEqual(result.claims[0]?.assumptions, []);
  assert.equal(model.doGenerateCalls.length, 3);
  const prompt = JSON.stringify(model.doGenerateCalls);
  assert.match(prompt, /Fixed scope/u);
  assert.match(prompt, /untrusted data/u);
  assert.doesNotMatch(prompt, /database-url|\/DATA\/AppData/u);
});

test('claim evidence counts must match references and hypotheses must declare uncertainty', async () => {
  const result = await runResearchAssistant({
    model: validModel({
      answer: 'This is a likely pattern.',
      claims: [{ kind: 'hypothesis', text: 'This is a likely pattern.', evidenceRefs: ['E0001'], evidenceCount: 2, assumptions: [], uncertainty: null }],
      abstained: false,
    }),
    message: 'What happened?',
    scopeDescription: 'selected squad, fixed dates',
    template: 'tactical_coaching',
    fallbackAnswer: 'Deterministic average is 500.',
    fallbackEvidenceRefs: ['E0001'],
    tools,
    evidenceByAlias,
  });
  assert.equal(result.source, 'deterministic-fallback');
  assert.equal(result.degradedReason, 'invalid_grounded_output');
  assert.deepEqual(result.claims[0]?.evidenceRefs, ['E0001']);
  assert.equal(result.claims[0]?.evidenceCount, 1);
  assert.match(result.claims[0]?.uncertainty ?? '', /证据校验/u);
});

test('invalid citations and invented numbers are rejected and deterministically downgraded', async () => {
  const result = await runResearchAssistant({
    model: validModel({
      answer: 'The result is 999.',
      claims: [{ kind: 'fact', text: 'The result is 999.', evidenceRefs: ['E9999'], evidenceCount: 1, assumptions: [], uncertainty: null }],
      abstained: false,
    }),
    message: 'Compare average damage',
    scopeDescription: 'selected squad, fixed dates',
    template: 'chronological_story',
    fallbackAnswer: 'The scoped average damage is 500.',
    fallbackEvidenceRefs: ['E0001'],
    tools,
    evidenceByAlias,
  });
  assert.equal(result.source, 'deterministic-fallback');
  assert.equal(result.status, 'degraded');
  assert.equal(result.degradedReason, 'invalid_grounded_output');
  assert.deepEqual(result.evidence.map((ref) => ref.ref), ['E0001']);
  assert.match(result.answer, /按已记录的比赛证据/u);
  assert.doesNotMatch(result.answer, /999/u);
});

test('no tool result and no model produce clear deterministic fallbacks', async () => {
  const noToolModel = new MockLanguageModelV4({ doGenerate: {
    ...response([{ type: 'text', text: 'Unsubstantiated answer.' }]),
  } as never });
  const noTool = await runResearchAssistant({
    model: noToolModel,
    message: 'What happened?',
    scopeDescription: 'selected squad, fixed dates',
    template: 'squad_humor',
    fallbackAnswer: 'Current sample has no matching metric.',
    tools,
    evidenceByAlias,
  });
  assert.equal(noTool.degradedReason, 'no_read_tool_used');
  assert.equal(noTool.source, 'deterministic-fallback');

  const noModel = await runResearchAssistant({
    message: 'What happened?',
    scopeDescription: 'selected squad, fixed dates',
    template: 'tactical_coaching',
    fallbackAnswer: '',
    tools,
    evidenceByAlias: new Map(),
  });
  assert.equal(noModel.status, 'abstained');
  assert.equal(noModel.degradedReason, 'model_unavailable');
  assert.deepEqual(noModel.claims, []);
  assert.match(noModel.answer, /没有足够的可核验证据/u);
});

test('templates change wording while retaining exactly the same metric values', () => {
  const outputs = ['tactical_coaching', 'squad_humor', 'chronological_story']
    .map((template) => renderResearchTemplate(template as 'tactical_coaching' | 'squad_humor' | 'chronological_story', '2 matches, 500 average damage'));
  assert.equal(new Set(outputs).size, 3);
  assert.ok(outputs.every((value) => value.includes('2 matches') && value.includes('500 average damage')));
});

test('player names in questions are replaced with squad-local aliases before model use', () => {
  assert.equal(anonymizeResearchText('Did Alice revive Bob?', [
    { name: 'Alice', alias: 'PLAYER_01' }, { name: 'Bob', alias: 'PLAYER_02' },
  ]), 'Did PLAYER_01 revive PLAYER_02?');
  assert.equal(anonymizeResearchText('match-raw-1 account-raw-2', [], [
    { value: 'match-raw-1', alias: '[比赛编号已隐藏]' }, { value: 'account-raw-2', alias: '[队员编号已隐藏]' },
  ]), '[比赛编号已隐藏] [队员编号已隐藏]');
});
