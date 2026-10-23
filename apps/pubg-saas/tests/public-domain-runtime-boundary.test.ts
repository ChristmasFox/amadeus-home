import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('public SaaS domain entry loads without private SQLite or legacy importer modules', () => {
  const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const source = `
    await import('@rine-kit/pubg-domain/core');
    await import('./src/application/pubg-intelligence-gate-api.ts');
    const privateModules = process.moduleLoadList.filter((entry) => entry.includes('node:sqlite'));
    if (privateModules.length) process.exitCode = 9;
  `;
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '--eval', source],
    { cwd: appRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `public Domain/Gate Intelligence imports failed or loaded SQLite: ${result.stderr}`);
  assert.equal(result.stdout, '');
});
