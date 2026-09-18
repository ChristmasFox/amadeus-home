import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('Amadeus manifest exposes the native Identity contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8')) as {
    skills?: string[];
    contracts?: { tools?: string[] };
  };
  const tools = new Set(manifest.contracts?.tools ?? []);
  for (const name of [
    'identity_resolve',
    'identity_get_person',
    'identity_bind_channel',
    'identity_add_alias',
    'identity_link_account',
    'identity_list_candidates',
    'identity_confirm_candidate',
  ]) assert.equal(tools.has(name), true, `missing manifest tool: ${name}`);
  assert.equal(manifest.skills?.includes('skills/identity'), true);
});
