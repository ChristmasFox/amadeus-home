import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { checkArchitecture } from './check-architecture.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const fixture = mkdtempSync(join(tmpdir(), 'amadeus-architecture-'));
const copies = [
  'AGENTS.md', 'package.json',
  'docs/INFRASTRUCTURE_CLASSIFICATION.md', 'docs/OPERATION_SKULD_MIGRATION_MANIFEST.json', 'docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md', 'docs/OPERATION_SKULD_SERVICE_INVENTORY.md', 'docs/STORAGE_RETENTION_POLICY.md',
  'scripts/developer-workflow.sh', 'scripts/host-profile.sh', 'scripts/migration-readiness.sh', 'scripts/storage-preflight.sh', 'scripts/migrate-immich-media.sh', 'scripts/reclaim-immich-old-source.sh', 'scripts/storage-maintenance.sh', 'scripts/apply-docker-log-policy.sh', 'scripts/externalize-casaos-secrets.sh', 'scripts/storage-health.sh', 'scripts/install-storage-scheduler-macos.sh', 'scripts/export-9router-runtime.sh', 'scripts/secrets-inventory.sh', 'scripts/export-skuld-secrets.sh', 'scripts/import-skuld-secrets.sh',
  'infra/docker/homelab/immich/docker-compose.example.yml',
  'plugins/amadeus/src', 'plugins/amadeus/openclaw.plugin.json', 'plugins/amadeus/skills',
  'integrations/openclaw/workspace/SOUL.md', 'integrations/openclaw/workspace/AGENTS.md',
  'packages/presentation/src', 'packages/presentation/package.json',
  'plugins/pubg/src',
  'packages/pubg-domain/src',
];
try {
  for (const relative of copies) cpSync(join(root, relative), join(fixture, relative), { recursive: true });
  assert.deepEqual(checkArchitecture(fixture), []);

  const soulPath = join(fixture, 'integrations/openclaw/workspace/SOUL.md');
  writeFileSync(soulPath, `${readFileSync(soulPath, 'utf8')}\nDo not skip pubg_search_matches.\n`);
  const errors = checkArchitecture(fixture);
  assert.ok(errors.some((error) => error.includes('SOUL.md contains capability-specific token')));

  const nestedPromptPath = join(fixture, 'plugins/amadeus/src/capabilities/identity/nested-prompt.ts');
  writeFileSync(nestedPromptPath, 'export const hook = "before_prompt_build";\n');
  const nestedErrors = checkArchitecture(fixture);
  assert.ok(nestedErrors.some((error) => error.includes('amadeus source contains global prompt injection')));

  rmSync(nestedPromptPath, { force: true });
  const pubgIndexPath = join(fixture, 'plugins/pubg/src/index.ts');
  writeFileSync(pubgIndexPath, `${readFileSync(pubgIndexPath, 'utf8')}\nconst unmapped = { name: 'pubg_unmapped_tool' };\n`);
  const registryErrors = checkArchitecture(fixture);
  assert.ok(registryErrors.some((error) => error.includes('PUBG tool has no presentation registry entry: pubg_unmapped_tool')));

  const domainPath = join(fixture, 'packages/pubg-domain/src/worldline-leak.ts');
  writeFileSync(domainPath, 'export const leaked = "SERN";\n');
  const vocabularyErrors = checkArchitecture(fixture);
  assert.ok(vocabularyErrors.some((error) => error.includes('contains worldline presentation vocabulary')));

  const storageSource = join(fixture, 'scripts/storage-maintenance.sh');
  writeFileSync(storageSource, 'docker volume prune\n');
  const storageErrors = checkArchitecture(fixture);
  assert.ok(storageErrors.some((error) => error.includes('forbidden Docker volume cleanup')));
  rmSync(storageSource, { force: true });
  console.log('ARCHITECTURE_FIXTURE_CHECK=passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
