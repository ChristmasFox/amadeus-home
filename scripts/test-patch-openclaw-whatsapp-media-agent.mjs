#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'whatsapp-http1-agent-'));
const dist = join(root, 'project/node_modules/@openclaw/whatsapp/dist');
await mkdir(dist, { recursive: true });
const file = join(dist, 'socket-close-fixture.js');
const original = `function createNodeProxyAgent(params) { return { addRequest() {}, params }; }
function createHttp1ProxyAgent() { return { dispatch() {} }; }
function createHttp1EnvHttpProxyAgent() { return { dispatch() {} }; }
function resolveProxyUrlFromAgent() { return undefined; }
function resolveEnvHttpsProxyUrl() { return 'http://proxy.local:7897'; }
async function resolveEnvFetchDispatcher(logger, agent) {
  const proxyUrl = resolveProxyUrlFromAgent(agent);
  const envProxyUrl = resolveEnvHttpsProxyUrl();
  if (!proxyUrl && !envProxyUrl) return;
  try {
    return proxyUrl ? createHttp1ProxyAgent({ uri: proxyUrl }) : createHttp1EnvHttpProxyAgent();
  } catch (error) { return; }
}
`;
await writeFile(file, original);
const run = () => spawnSync(process.execPath, ['scripts/patch-openclaw-whatsapp-media-agent.mjs', root], { encoding: 'utf8' });
const first = run();
assert.equal(first.status, 0, first.stderr);
assert.match(first.stdout, /WHATSAPP_MEDIA_AGENT_PATCH=applied/);
const second = run();
assert.equal(second.status, 0, second.stderr);
assert.match(second.stdout, /already-applied/);
const source = await readFile(file, 'utf8');
assert.equal(source.split('amadeus-whatsapp-http1-media-agent-v1').length - 1, 1);
const resolve = new Function(source + '; return resolveEnvFetchDispatcher;')();
const agent = await resolve();
assert.equal(typeof agent.addRequest, 'function');
assert.equal(agent.params.proxyUrl, 'http://proxy.local:7897');
assert.equal(agent.params.protocol, 'https');
console.log('WHATSAPP_MEDIA_AGENT_FIXTURE=passed');
