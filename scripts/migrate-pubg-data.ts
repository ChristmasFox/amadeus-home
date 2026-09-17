import { importLegacyPubgData, SqlitePubgRepository } from '@agent/pubg-domain';

interface Arguments {
  apply: boolean;
  target: string;
  n8n?: string;
  state?: string;
  features?: string;
  migrationId?: string;
}

function valueAfter(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(argv: string[]): Arguments {
  const parsed: Arguments = {
    apply: false,
    target: process.env.PUBG_MIGRATION_TARGET_DB ?? '/data/pubg.sqlite',
    n8n: process.env.PUBG_LEGACY_N8N_DB,
    state: process.env.PUBG_LEGACY_STATE_JSON,
    features: process.env.PUBG_LEGACY_FEATURES_JSON,
    migrationId: process.env.PUBG_MIGRATION_ID,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') parsed.apply = true;
    else if (argument === '--target') parsed.target = valueAfter(argv, index++, argument);
    else if (argument === '--n8n') parsed.n8n = valueAfter(argv, index++, argument);
    else if (argument === '--state') parsed.state = valueAfter(argv, index++, argument);
    else if (argument === '--features') parsed.features = valueAfter(argv, index++, argument);
    else if (argument === '--migration-id') parsed.migrationId = valueAfter(argv, index++, argument);
    else if (argument === '--help') {
      process.stdout.write('Usage: pnpm migrate:pubg-data [--apply] [--target PATH] [--n8n PATH] [--state PATH] [--features PATH] [--migration-id ID]\n');
      process.exit(0);
    } else throw new Error(`unknown argument: ${argument}`);
  }
  if (!parsed.n8n && !parsed.state && !parsed.features) throw new Error('at least one legacy source is required');
  return parsed;
}

const argumentsValue = parseArguments(process.argv.slice(2));
const repository = new SqlitePubgRepository(argumentsValue.target);
try {
  const report = importLegacyPubgData(repository, {
    n8nDatabasePath: argumentsValue.n8n,
    stateJsonPath: argumentsValue.state,
    featuresJsonPath: argumentsValue.features,
    migrationId: argumentsValue.migrationId,
    apply: argumentsValue.apply,
  });
  process.stdout.write(JSON.stringify({ ...report, target: argumentsValue.target }, null, 2) + '\n');
  if (report.errors.length > 0) process.exitCode = 2;
} finally {
  repository.close();
}
