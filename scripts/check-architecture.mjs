import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAPABILITIES = ['identity', 'product-radar', 'media', 'nas', 'homelab', 'kook', 'market', 'notification', 'vps'];
const SKILLS = ['amadeus', 'identity', 'product-radar', 'media-organizer', 'nas', 'homelab', 'kook', 'market', 'owner-notification', 'vps'];

function text(root, relative) {
  const path = join(root, relative);
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function files(root) {
  const result = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/u.test(entry.name)) result.push(path);
    }
  };
  visit(root);
  return result;
}

function sourceFiles(root, extensions = /\.(?:ts|tsx|mjs|sh|py|yml|yaml|json)$/u) {
  const result = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (extensions.test(entry.name)) result.push(path);
    }
  };
  visit(root);
  return result;
}

function checkForbiddenImports(root, relativeDirectory, pattern, label, errors) {
  const directory = join(root, relativeDirectory);
  for (const path of files(directory)) {
    const content = readFileSync(path, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) errors.push(`${label}: ${path.slice(root.length + 1)}:${index + 1}`);
    });
  }
}

export function checkArchitecture(root = REPO_ROOT) {
  const errors = [];
  const required = [
    'packages/presentation/package.json',
    'packages/presentation/src/index.ts',
    'plugins/amadeus/openclaw.plugin.json',
    'plugins/amadeus/src/index.ts',
    'plugins/pubg/src/index.ts',
    'packages/presentation/src/pubg-registry.ts',
    'packages/presentation/src/worldline/contracts.ts',
    'packages/presentation/src/worldline/policy.ts',
    'packages/presentation/src/worldline/adapter.ts',
    'packages/presentation/src/worldline/vocabulary.ts',
    'docs/INFRASTRUCTURE_CLASSIFICATION.md',
    'docs/OPERATION_SKULD_MIGRATION_MANIFEST.json',
    'docs/OPERATION_SKULD_MAC_MINI_MIGRATION_RUNBOOK.md',
    'docs/OPERATION_SKULD_SERVICE_INVENTORY.md',
    'docs/STORAGE_RETENTION_POLICY.md',
    'infra/docker/homelab/immich/docker-compose.example.yml',
    'scripts/host-profile.sh',
    'scripts/migration-readiness.sh',
    'scripts/storage-preflight.sh',
    'scripts/migrate-immich-media.sh',
    'scripts/reclaim-immich-old-source.sh',
    'scripts/storage-maintenance.sh',
    'scripts/apply-docker-log-policy.sh',
    'scripts/externalize-casaos-secrets.sh',
    'scripts/storage-health.sh',
    'scripts/install-storage-scheduler-macos.sh',
    'scripts/export-9router-runtime.sh',
    'scripts/secrets-inventory.sh',
    'scripts/export-skuld-secrets.sh',
    'scripts/import-skuld-secrets.sh',
    'integrations/openclaw/workspace/SOUL.md',
    'integrations/openclaw/workspace/AGENTS.md',
    'package.json',
    'scripts/developer-workflow.sh',
  ];
  for (const relative of required) if (!existsSync(join(root, relative))) errors.push(`missing required file: ${relative}`);

  checkForbiddenImports(
    root,
    'packages/pubg-domain/src',
    /^\s*(?:import|export).*from\s+["'][^"']*(?:openclaw|telegram|whatsapp)[^"']*["']/iu,
    'PUBG domain imports a transport/runtime module',
    errors,
  );
  checkForbiddenImports(
    root,
    'packages/presentation/src',
    /^\s*(?:import|export).*from\s+["'][^"']*(?:openclaw|telegram|whatsapp|sqlite|node:(?:http|https))[^"']*["']/iu,
    'presentation package imports an integration module',
    errors,
  );

  const workspaceForbidden = ['pubg_search_matches', 'pubg_get_review_facts', 'resultSetId', 'recentN', 'businessDayStart', 'Asia/Shanghai', 'before_prompt_build'];
  for (const relative of ['integrations/openclaw/workspace/SOUL.md', 'integrations/openclaw/workspace/AGENTS.md']) {
    const content = text(root, relative);
    for (const token of workspaceForbidden) if (content.includes(token)) errors.push(`${relative} contains capability-specific token: ${token}`);
  }
  const personaForbidden = ['PUBG', 'HomeLab', 'NAS', 'Product Radar', 'media-organize', 'WhatsApp', 'Telegram', 'KOOK', 'Codex', 'amadeus_', 'resultSetId', 'recentN', 'businessDayStart', 'Asia/Shanghai'];
  const soul = text(root, 'integrations/openclaw/workspace/SOUL.md');
  for (const token of personaForbidden) if (soul.includes(token)) errors.push(`integrations/openclaw/workspace/SOUL.md contains capability-specific token: ${token}`);

  const amadeusSource = text(root, 'plugins/amadeus/src/index.ts');
  checkForbiddenImports(root, 'plugins/amadeus/src', /before_prompt_build|appendSystemContext/iu, 'amadeus source contains global prompt injection', errors);
  for (const name of ['registerIdentity', 'registerProductRadar', 'registerMedia', 'registerNas', 'registerHomeLab', 'registerKook', 'registerMarket', 'registerNotification', 'registerVps']) {
    if (!amadeusSource.includes(name)) errors.push(`amadeus bootstrap does not register ${name}`);
  }
  if (/Type\.(?:Object|Union|Array|Literal)\s*\(/u.test(amadeusSource) || /\bregisterTool\s*\(/u.test(amadeusSource)) errors.push('amadeus bootstrap owns schema or tool registration');
  if (amadeusSource.split('\n').length > 80) errors.push('amadeus bootstrap is not thin');
  for (const capability of CAPABILITIES) {
    if (!existsSync(join(root, `plugins/amadeus/src/capabilities/${capability}/register.ts`))) errors.push(`missing capability registration module: ${capability}`);
  }

  const pubgSource = text(root, 'plugins/pubg/src/index.ts');
  const pubgToolNames = [...pubgSource.matchAll(/name:\s*['"](pubg_[a-z0-9_]+)['"]/gu)].map((match) => match[1]);
  const registrySource = text(root, 'packages/presentation/src/pubg-registry.ts');
  const registryToolNames = [...registrySource.matchAll(/^\s+(pubg_[a-z0-9_]+):\s*\{/gmu)].map((match) => match[1]);
  for (const name of pubgToolNames) if (!registryToolNames.includes(name)) errors.push(`PUBG tool has no presentation registry entry: ${name}`);
  for (const name of registryToolNames) if (!pubgToolNames.includes(name)) errors.push(`PUBG presentation registry has no native tool: ${name}`);
  for (const name of registryToolNames) {
    const entry = registrySource.match(new RegExp(`^\\s+${name}:\\s*\\{([^}]*)\\}`, 'mu'))?.[1] ?? '';
    if (!/(?:classification):\s*['"](?:user-facing|intermediate|scheduled)['"]/u.test(entry)) errors.push(`PUBG presentation registry entry lacks classification: ${name}`);
  }

  const worldlineSource = text(root, 'packages/presentation/src/worldline/contracts.ts');
  for (const producer of ['product-radar', 'market', 'pubg-sync', 'release', 'codex', 'vps', 'homelab', 'nas', 'media', 'storage']) {
    if (!worldlineSource.includes(`'${producer}'`)) errors.push(`worldline producer registry lacks coverage: ${producer}`);
  }

  const forbiddenWorldlineVocabulary = ['SERN', 'Reading Steiner', 'Operation Skuld', '世界线收束', '世界线偏移'];
  for (const relativeDirectory of ['packages/pubg-domain/src', 'apps/product-radar/src/core']) {
    for (const path of files(join(root, relativeDirectory))) {
      const content = readFileSync(path, 'utf8');
      for (const token of forbiddenWorldlineVocabulary) if (content.includes(token)) errors.push(`${relativeDirectory} contains worldline presentation vocabulary: ${token}`);
    }
  }
  for (const path of files(join(root, 'apps/product-radar/src/core'))) {
    const content = readFileSync(path, 'utf8');
    if (/owner-whatsapp|whatsapp.{0,40}recipient|telegram.{0,40}recipient/iu.test(content)) errors.push(`Product Radar core contains transport-specific owner destination: ${path.slice(root.length + 1)}`);
  }

  const migrationOnly = (relative) => relative.includes('/migration/') || relative.endsWith('/migration-cli.ts') || relative.endsWith('/migrate-pubg-data.ts');
  for (const relativeDirectory of ['scripts', 'infra', 'integrations', 'apps/product-radar', 'plugins', 'packages']) {
    for (const path of sourceFiles(join(root, relativeDirectory))) {
      const relative = path.slice(root.length + 1);
      if (relative === 'scripts/check-architecture.mjs' || relative === 'scripts/test-check-architecture.mjs' || relative === 'scripts/migration-readiness.sh') continue;
      if (migrationOnly(relative)) continue;
      const content = readFileSync(path, 'utf8');
      if (/langbot|n8n-sandbox|legacy n8n runtime/iu.test(content)) errors.push(`active deployment source contains retired runtime reference: ${relative}`);
      if (content.includes('/Users/blacksidev')) errors.push(`active deployment source contains old host path: ${relative}`);
      if (/rsync\s+[^\n]*--delete/iu.test(content)) errors.push(`Immich migration source contains forbidden destructive rsync flag: ${relative}`);
      if (/docker\s+(?:volume\s+prune|system\s+prune\s+--volumes)/iu.test(content)) errors.push(`forbidden Docker volume cleanup: ${relative}`);
      if (/rm\s+-rf\s+\/DATA\/AppData(?:\/|\s|$)/u.test(content)) errors.push(`generic AppData deletion: ${relative}`);
      if (/rm\s+-rf\s+.*(?:Volumes\/Avalon\/immich|IMMICH_MEDIA_ROOT)/iu.test(content)) errors.push(`generic Immich media deletion: ${relative}`);
      if (relative.endsWith('openclaw.json.example') && /192\.168\.5\.3/u.test(content)) errors.push(`runtime template contains old LAN IP: ${relative}`);
    }
  }

  try {
    const manifest = JSON.parse(text(root, 'plugins/amadeus/openclaw.plugin.json'));
    const declared = Array.isArray(manifest.skills) ? manifest.skills.map((value) => String(value).replace(/^skills\//u, '')) : [];
    for (const skill of SKILLS) {
      if (!declared.includes(skill)) errors.push(`manifest does not declare skill: ${skill}`);
      if (!existsSync(join(root, `plugins/amadeus/skills/${skill}/SKILL.md`))) errors.push(`missing skill source: ${skill}`);
    }
  } catch {
    errors.push('invalid plugins/amadeus/openclaw.plugin.json');
  }

  const packageJson = text(root, 'package.json');
  if (!/"check:architecture"\s*:/u.test(packageJson)) errors.push('root package.json does not expose check:architecture');
  if (!text(root, 'scripts/developer-workflow.sh').includes('pnpm check:architecture')) errors.push('developer workflow does not run check:architecture');
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errors = checkArchitecture(process.env.ARCHITECTURE_ROOT ? resolve(process.env.ARCHITECTURE_ROOT) : REPO_ROOT);
  if (errors.length) {
    console.error(errors.map((error) => `ARCHITECTURE_CHECK_FAIL=${error}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('ARCHITECTURE_CHECK=passed');
  }
}
