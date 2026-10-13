import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('public SaaS domain entry loads without private SQLite or legacy importer modules', () => {
  const source = `
    await import('@agent/pubg-domain/core');
    const privateModules = process.moduleLoadList.filter((entry) => entry.includes('node:sqlite'));
    if (privateModules.length) process.exitCode = 9;
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `public Domain import failed or loaded SQLite: ${result.stderr}`);
  assert.equal(result.stdout, '');
});
