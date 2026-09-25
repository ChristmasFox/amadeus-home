import { definePluginEntry } from 'openclaw/plugin-sdk/core';
import { pluginConfigSchema, configFor } from './config.js';
import { registerHomeLab } from './capabilities/homelab/register.js';
import { registerIdentity } from './capabilities/identity/register.js';
import { registerKook } from './capabilities/kook/register.js';
import { registerMarket } from './capabilities/market/register.js';
import { registerMacosHost } from './capabilities/macos-host/register.js';
import { registerMedia } from './capabilities/media/register.js';
import { registerNas } from './capabilities/nas/register.js';
import { registerNotification } from './capabilities/notification/register.js';
import { registerProductRadar } from './capabilities/product-radar/register.js';
import { registerVps } from './capabilities/vps/register.js';
import { registerVoiceReplyPrompt } from './voice-reply-prompt.js';
import { registerIdentityLifecycle, registerOwnerNotificationWorker } from './shared/lifecycle.js';

const entry = definePluginEntry({
  id: 'amadeus',
  name: 'Amadeus capabilities',
  description: 'Native OpenClaw capabilities for Amadeus services and owner notifications.',
  configSchema: pluginConfigSchema,
  register(api) {
    const config = configFor(api);
    registerIdentityLifecycle(api);
    registerVoiceReplyPrompt(api);
    registerOwnerNotificationWorker(api, config);
    registerIdentity(api);
    registerProductRadar(api);
    registerMedia(api);
    registerNas(api);
    registerHomeLab(api);
    registerKook(api);
    registerMarket(api);
    registerMacosHost(api);
    registerNotification(api);
    registerVps(api);
    api.logger.info('amadeus native capability plugin registered');
  },
});

export default entry;
