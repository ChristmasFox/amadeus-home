import assert from 'node:assert/strict';
import { isIPv4 } from 'node:net';
import test from 'node:test';
import { startGatewayHealthServer, stopGatewayHealthServer } from '../src/infrastructure/gateway-health-server.js';

test('Gateway health endpoint reports only readiness on loopback', async () => {
  let connected = false;
  const server = await startGatewayHealthServer(() => connected, 0);
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    assert.ok(isIPv4(address.address));
    assert.equal(address.address, '127.0.0.1');
    const url = `http://127.0.0.1:${address.port}`;
    const notReady = await fetch(`${url}/healthz`);
    assert.equal(notReady.status, 503);
    assert.equal(await notReady.text(), 'not_ready\n');
    const wrongRoute = await fetch(`${url}/healthz?debug=1`);
    assert.equal(wrongRoute.status, 404);
    connected = true;
    const ready = await fetch(`${url}/healthz`);
    assert.equal(ready.status, 200);
    assert.equal(await ready.text(), 'ok\n');
  } finally {
    await stopGatewayHealthServer(server);
  }
});
