import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyRepairObservation, registerRepairObservation } from '../src/repair-observation.js';

test('persists selected failures privately, never in the ordinary logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'repair-observation-'));
  const hooks = new Map<string, (...args: any[]) => any>();
  const logs: string[] = [];
  registerRepairObservation({ on: (name: string, handler: (...args: any[]) => any) => hooks.set(name, handler), logger: { warn: (line: string) => logs.push(line) } } as any, directory);
  await hooks.get('after_tool_call')!({ toolName: 'pubg_stats', error: 'TypeError: private payload', params: { query: 'private question', apiKey: 'sensitive' } });
  await hooks.get('agent_end')!({ success: false, error: 'invalid_json_schema: private payload' });
  await hooks.get('agent_end')!({ success: false, error: '429 rate limit' });
  await hooks.get('after_tool_call')!({ toolName: 'pubg_query_stats', result: { details: { error: { code: 'plugin_runtime_error' } } } });
  await hooks.get('after_tool_call')!({ toolName: 'pubg_query_stats', result: { content: 'user mentioned plugin_runtime_error' } });
  const files = await readdir(join(directory, '.repair-incidents'));
  assert.equal(files.length, 3);
  const records = await Promise.all(files.map(async f => JSON.parse(await readFile(join(directory, '.repair-incidents', f), 'utf8'))));
  assert.deepEqual(new Set(records.map(r => r.category)), new Set(['type_error', 'invalid_schema', 'runtime_error']));
  assert.deepEqual(records.find(r => r.tool === 'pubg_stats').params, { query: 'private question', apiKey: '[redacted]' });
  assert.equal((await stat(join(directory, '.repair-incidents', files[0]!))).mode & 0o077, 0);
  assert.deepEqual(logs, []);
  assert.equal(classifyRepairObservation('pubg_stats', 'network timeout'), undefined);
  assert.deepEqual(classifyRepairObservation('exec', 'TypeError'), { tool: 'exec', category: 'type_error' });
  assert.equal(classifyRepairObservation('pubg_bad\ninjection', 'TypeError'), undefined);
});
