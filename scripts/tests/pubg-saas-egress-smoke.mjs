#!/usr/bin/env node
/**
 * Credential-free egress check for one PUBG SaaS Compose application network.
 * Mount this file read-only into the gateway or worker container and run it
 * with that service's normal Compose networks. It verifies there is no default
 * route, direct public/metadata TCP is unavailable, the proxy denies metadata
 * and host-gateway targets, and public HTTPS works through the proxy.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';

const require = createRequire(`${process.cwd()}/package.json`);
const { ProxyAgent, setGlobalDispatcher } = require('undici');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function directConnect(host, port, timeoutMs = 3500) {
  return new Promise(resolve => {
    const socket = createConnection({ host, port });
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish('blocked:timeout'), timeoutMs);
    socket.once('connect', () => finish('connected'));
    socket.once('error', error => finish(`blocked:${error.code ?? 'error'}`));
  });
}

function proxyConnectStatus(authority, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: 'egress-proxy', port: 8080 });
    let settled = false;
    let response = '';
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('proxy_connect_timeout')), timeoutMs);
    socket.once('connect', () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
    });
    socket.on('data', chunk => {
      response += chunk.toString('latin1');
      const status = /^HTTP\/1\.[01] ([0-9]{3})/u.exec(response)?.[1];
      if (status) finish(resolve, Number(status));
    });
    socket.once('error', error => finish(reject, error));
  });
}

const routeTable = readFileSync('/proc/net/route', 'utf8');
const defaultRouteExists = routeTable
  .split('\n')
  .slice(1)
  .some(line => line.trim().split(/\s+/u)[1] === '00000000');
assert(!defaultRouteExists, 'pubg_saas_egress_default_route_present');

const directPublic = await directConnect('1.1.1.1', 443);
const directMetadata = await directConnect('169.254.169.254', 80);
assert(directPublic !== 'connected', 'pubg_saas_egress_direct_public_allowed');
assert(directMetadata !== 'connected', 'pubg_saas_egress_direct_metadata_allowed');

const metadataProxy = await proxyConnectStatus('169.254.169.254:443');
const privateHostProxy = await proxyConnectStatus('host.docker.internal:443');
assert(metadataProxy === 403, 'pubg_saas_egress_metadata_proxy_not_denied');
assert(privateHostProxy === 403, 'pubg_saas_egress_private_host_proxy_not_denied');

const dispatcher = new ProxyAgent('http://egress-proxy:8080');
setGlobalDispatcher(dispatcher);
let publicHttpsStatus;
try {
  const response = await fetch('https://example.com/', {
    method: 'HEAD',
    signal: AbortSignal.timeout(12_000),
  });
  publicHttpsStatus = response.status;
} finally {
  await dispatcher.close();
}
assert(publicHttpsStatus >= 200 && publicHttpsStatus < 400, 'pubg_saas_egress_public_https_failed');

process.stdout.write(
  `PUBG_SAAS_EGRESS_SMOKE=passed direct_public=${directPublic} `
  + `direct_metadata=${directMetadata} metadata_proxy=${metadataProxy} `
  + `private_host_proxy=${privateHostProxy} public_https=${publicHttpsStatus}\n`,
);
