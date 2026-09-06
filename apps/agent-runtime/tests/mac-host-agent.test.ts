import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { MacHostAgentCommandExecutor, RuntimeExecutorManager, HostCollector } from '@agent/homehub-domain';

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('no address'));
      resolve(address.port);
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('MacHostAgentCommandExecutor uses token auth and a three-endpoint allowlist', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer secret');
    if (request.url === '/v1/host/status') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        status: 'available',
        hostname: 'mac-mini',
        os: { name: 'macOS', version: '15.6', build: '24G90' },
        model: 'Macmini9,1',
        uptime: 123,
        loadAverage: [1, 2, 3],
        cpu: { usage: 23, cores: 8 },
        memory: { total: 1000, used: 300, available: 700, percentage: 30 },
        disks: [{ mount: '/', total: 1000, used: 920, available: 80, percentage: 92 }],
        network: [{ interface: 'en0', bytesIn: 1, bytesOut: 2 }],
        power: { source: 'AC Power', percentage: 95, charging: true, state: '充电中' },
        cloudflared: { status: 'running', pid: 12 },
        highCpuProcesses: [{ pid: 12, name: 'cloudflared', cpu: 10, memory: 1 }],
      }));
      return;
    }
    if (request.url === '/v1/cloudflared/status') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ status: 'running', running: true, pid: 12 }));
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ status: 'ok', service: 'mac-host-agent' }));
  });
  const port = await listen(server);
  try {
    const executor = new MacHostAgentCommandExecutor({ baseUrl: `http://127.0.0.1:${port}`, token: 'secret' });
    const host = await executor.execute({ command: 'macos-agent', args: ['/v1/host/status'] });
    assert.equal(host.ok, true);
    assert.match(host.stdout, /mac-mini/u);
    const cloudflared = await executor.execute({ command: 'macos-agent', args: ['/v1/cloudflared/status'] });
    assert.equal(cloudflared.ok, true);
    const health = await executor.execute({ command: 'macos-agent', args: ['/v1/health'] });
    assert.equal(health.ok, true);
    const denied = await executor.execute({ command: 'macos-agent', args: ['/v1/exec'] });
    assert.equal(denied.ok, false);
    assert.equal(denied.exitCode, 2);
    const wrongCommand = await executor.execute({ command: 'bash', args: ['-lc', 'uname'] });
    assert.equal(wrongCommand.ok, false);

    const manager = new RuntimeExecutorManager({ executors: { 'macos-host': executor } });
    const collector = new HostCollector({ execution: manager });
    const collected = await collector.collect();
    assert.equal(collected.status, 'available');
    assert.equal(collected.hostname, 'mac-mini');
    assert.equal(collected.cpu.usage, 23);
    assert.equal(collected.model, 'Macmini9,1');
    assert.equal(collected.cloudflared?.status, 'running');
    assert.equal(collected.highCpuProcesses?.[0]?.name, 'cloudflared');
  } finally {
    await close(server);
  }
});

test('MacHostAgentCommandExecutor reports unavailable when token or endpoint is absent', async () => {
  const missingToken = new MacHostAgentCommandExecutor({ baseUrl: 'http://127.0.0.1:1' });
  const result = await missingToken.execute({ command: 'macos-agent', args: ['/v1/health'] });
  assert.equal(result.ok, false);
  assert.equal(result.executorAvailable, false);
});
