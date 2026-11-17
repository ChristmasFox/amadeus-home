import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { patch } from './patch-whatsapp-reconnect.mjs';

const fixture = `const DEFAULT_RECONNECT_POLICY = { maxAttempts: 12 };
function resolveReconnectPolicy(overrides) {
 const overrideConfig = overrides ?? {};
 const merged = {
\t\t...DEFAULT_RECONNECT_POLICY,
\t\t...overrideConfig
 };
 return merged;
}
// Preserve the upstream checks for logged-out and non-retryable status.
if (normalized.isLoggedOut) return {
if (this.isNonRetryableStatus(normalized.statusCode)) return {
this.reconnectPolicy.maxAttempts > 0 && this.reconnectAttempts >= this.reconnectPolicy.maxAttempts`;
const result = patch(fixture);
assert.match(result, /maxAttempts: 0, \/\/ amadeus-whatsapp-transient-reconnect-v1/);
assert.match(result, /maxAttempts: 12/); // Outbound retry fallback stays bounded.
const resolve = runInNewContext(`${result.slice(0, result.indexOf('// Preserve'))}; resolveReconnectPolicy`);
assert.equal(resolve().maxAttempts, 0);
assert.equal(resolve({ maxAttempts: 7 }).maxAttempts, 7);
assert.equal(patch(result), result);
assert.throws(() => patch(fixture.replace('if (normalized.isLoggedOut)', 'if (other)')), /unsupported/);
assert.throws(() => patch(fixture.replace('...overrideConfig', '...other')), /unsupported/);
console.log('WhatsApp reconnect patch tests passed');
