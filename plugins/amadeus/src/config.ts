import { readFile } from 'node:fs/promises';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

export const pluginConfigSchema = {
  jsonSchema: { type: 'object', additionalProperties: true },
} as const;

export interface AmadeusConfig {
  productRadarBaseUrl: string;
  productRadarApiKeyFile?: string;
  mediaAdapterBaseUrl: string;
  homeLabHost: string;
  homeLabBaseUrl: string;
  homeLabGlancesUrl: string;
  homeLabUptimeUrl: string;
  macSshHost: string;
  macSshUser: string;
  macSshKeyFile: string;
  macSshKnownHostsFile?: string;
  kookApiBaseUrl: string;
  kookTokenFile?: string;
  ownerTargetFile: string;
  ownerWhatsappAccountId: string;
  ownerNotificationDeliveryEnabled: boolean;
  notificationOutboxDir: string;
  identityDatabasePath: string;
  identityPresetsFile?: string;
  marketDataBaseUrl: string;
  kiwiVmBaseUrl: string;
  kiwiVmCredentialsFile: string;
  vpsSshHost: string;
  vpsSshUser: string;
  vpsSshPort: number;
  vpsSshKeyFile: string;
  vpsSshKnownHostsFile: string;
  vpsUsageStateFile: string;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function integerValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

export function configFor(api: OpenClawPluginApi): AmadeusConfig {
  const value = api.pluginConfig ?? {};
  const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;
  const file = (key: string, envName: string, fallback: string): string => stringValue(value[key] ?? env(envName), fallback);
  const optionalFile = (key: string, envName: string): string | undefined => stringValue(value[key] ?? env(envName), '') || undefined;
  const productRadarApiKeyFile = optionalFile('productRadarApiKeyFile', 'PRODUCT_RADAR_API_KEY_FILE');
  const macSshKnownHostsFile = optionalFile('macSshKnownHostsFile', 'MAC_CONTROL_KNOWN_HOSTS_FILE');
  const kookTokenFile = optionalFile('kookTokenFile', 'KOOK_BOT_TOKEN_FILE');
  const identityPresetsFile = optionalFile('identityPresetsFile', 'IDENTITY_PRESETS_FILE');
  const ownerDeliverySetting = value.ownerNotificationDeliveryEnabled ?? env('OWNER_NOTIFICATION_DELIVERY_ENABLED');
  let ownerNotificationDeliveryEnabled: boolean;
  if (ownerDeliverySetting === undefined) ownerNotificationDeliveryEnabled = true;
  else if (ownerDeliverySetting === true || ownerDeliverySetting === 'true') ownerNotificationDeliveryEnabled = true;
  else if (ownerDeliverySetting === false || ownerDeliverySetting === 'false') ownerNotificationDeliveryEnabled = false;
  else throw new Error('ownerNotificationDeliveryEnabled must be a boolean');
  return {
    productRadarBaseUrl: file('productRadarBaseUrl', 'PRODUCT_RADAR_BASE_URL', 'http://product-radar:5315').replace(/\/$/u, ''),
    ...(productRadarApiKeyFile ? { productRadarApiKeyFile } : {}),
    mediaAdapterBaseUrl: file('mediaAdapterBaseUrl', 'MEDIA_ADAPTER_BASE_URL', 'http://media-organizer-adapter:8765').replace(/\/$/u, ''),
    homeLabHost: file('homeLabHost', 'HOME_LAB_HOST', 'http://host.docker.internal').replace(/\/$/u, ''),
    homeLabBaseUrl: file('homeLabBaseUrl', 'HOME_LAB_BASE_URL', file('homeLabHost', 'HOME_LAB_HOST', 'http://host.docker.internal')).replace(/\/$/u, ''),
    homeLabGlancesUrl: file('homeLabGlancesUrl', 'HOME_LAB_GLANCES_URL', `${file('homeLabBaseUrl', 'HOME_LAB_BASE_URL', file('homeLabHost', 'HOME_LAB_HOST', 'http://host.docker.internal')).replace(/\/$/u, '')}:61208/api/4/quicklook`),
    homeLabUptimeUrl: file('homeLabUptimeUrl', 'HOME_LAB_UPTIME_URL', `${file('homeLabBaseUrl', 'HOME_LAB_BASE_URL', file('homeLabHost', 'HOME_LAB_HOST', 'http://host.docker.internal')).replace(/\/$/u, '')}:61208/api/4/uptime`),
    macSshHost: file('macSshHost', 'MAC_CONTROL_HOST', 'host.docker.internal'),
    macSshUser: file('macSshUser', 'MAC_CONTROL_USER', ''),
    macSshKeyFile: file('macSshKeyFile', 'MAC_CONTROL_KEY', '/run/secrets/mac_ssh_key'),
    ...(macSshKnownHostsFile ? { macSshKnownHostsFile } : {}),
    kookApiBaseUrl: file('kookApiBaseUrl', 'KOOK_API_BASE_URL', 'https://www.kookapp.cn/api/v3').replace(/\/$/u, ''),
    ...(kookTokenFile ? { kookTokenFile } : {}),
    ownerTargetFile: file('ownerTargetFile', 'OWNER_WHATSAPP_TARGET_FILE', '/run/secrets/owner_whatsapp_target'),
    ownerWhatsappAccountId: file('ownerWhatsappAccountId', 'OWNER_WHATSAPP_ACCOUNT_ID', 'secondary'),
    ownerNotificationDeliveryEnabled,
    notificationOutboxDir: file('notificationOutboxDir', 'OWNER_NOTIFICATION_OUTBOX_DIR', '/var/lib/openclaw/notifications'),
    identityDatabasePath: file('identityDatabasePath', 'IDENTITY_DATABASE_PATH', '/data/identity.sqlite'),
    ...(identityPresetsFile ? { identityPresetsFile } : {}),
    marketDataBaseUrl: file('marketDataBaseUrl', 'MARKET_DATA_BASE_URL', 'https://query2.finance.yahoo.com/v8/finance/chart').replace(/\/$/u, ''),
    kiwiVmBaseUrl: file('kiwiVmBaseUrl', 'KIWIVM_BASE_URL', 'https://api.64clouds.com/v1').replace(/\/$/u, ''),
    kiwiVmCredentialsFile: file('kiwiVmCredentialsFile', 'KIWIVM_CREDENTIALS_FILE', '/run/secrets/kiwivm_credentials.json'),
    vpsSshHost: file('vpsSshHost', 'VPS_SSH_HOST', 'amadeus-gateway'),
    vpsSshUser: file('vpsSshUser', 'VPS_SSH_USER', 'vps-readonly'),
    vpsSshPort: integerValue(value.vpsSshPort ?? env('VPS_SSH_PORT'), 22),
    vpsSshKeyFile: file('vpsSshKeyFile', 'VPS_SSH_KEY_FILE', '/run/secrets/vps_ssh_key'),
    vpsSshKnownHostsFile: file('vpsSshKnownHostsFile', 'VPS_SSH_KNOWN_HOSTS_FILE', '/run/secrets/vps_ssh_known_hosts'),
    vpsUsageStateFile: file('vpsUsageStateFile', 'VPS_USAGE_STATE_FILE', '/data/vps-usage-state.json'),
  };
}

export async function readOptionalFile(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const value = await readFile(path, 'utf8');
    return value.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function readRequiredFile(path: string, label: string): Promise<string> {
  const value = await readOptionalFile(path);
  if (!value) throw new Error(`${label} is unavailable`);
  return value;
}
