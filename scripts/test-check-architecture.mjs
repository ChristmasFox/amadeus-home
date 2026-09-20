import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { checkArchitecture } from './check-architecture.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixture = mkdtempSync(join(tmpdir(), 'amadeus-architecture-'));
const copies = [
  'AGENTS.md', 'package.json',
  'scripts/developer-workflow.sh',
  'plugins/amadeus/src', 'plugins/amadeus/openclaw.plugin.json', 'plugins/amadeus/skills',
  'integrations/openclaw/workspace/SOUL.md', 'integrations/openclaw/workspace/AGENTS.md',
  'packages/presentation/src', 'packages/presentation/package.json',
  'packages/pubg-domain/src',
];
try {
  for (const relative of copies) cpSync(join(root, relative), join(fixture, relative), { recursive: true });
  assert.deepEqual(checkArchitecture(fixture), []);

  const soulPath = join(fixture, 'integrations/openclaw/workspace/SOUL.md');
  writeFileSync(soulPath, `${readFileSync(soulPath, 'utf8')}\nDo not skip pubg_search_matches.\n`);
  const errors = checkArchitecture(fixture);
  assert.ok(errors.some((error) => error.includes('SOUL.md contains capability-specific token')));
  console.log('ARCHITECTURE_FIXTURE_CHECK=passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
