import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { configFor } from '../src/config.js';

function api(pluginConfig: Record<string, unknown> = {}): OpenClawPluginApi {
  return { pluginConfig } as unknown as OpenClawPluginApi;
}

test('owner notification delivery defaults on and migration-safe config can disable it', () => {
  const previous = process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED;
  delete process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED;
  try {
    assert.equal(configFor(api()).ownerNotificationDeliveryEnabled, true);
    assert.equal(configFor(api({ ownerNotificationDeliveryEnabled: false })).ownerNotificationDeliveryEnabled, false);
    process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED = 'false';
    assert.equal(configFor(api()).ownerNotificationDeliveryEnabled, false);
    assert.equal(configFor(api({ ownerNotificationDeliveryEnabled: true })).ownerNotificationDeliveryEnabled, true);
    process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED = 'uncertain';
    assert.throws(() => configFor(api()), /must be a boolean/u);
  } finally {
    if (previous === undefined) delete process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED;
    else process.env.OWNER_NOTIFICATION_DELIVERY_ENABLED = previous;
  }
});
