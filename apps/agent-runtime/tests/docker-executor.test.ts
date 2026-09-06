import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  DockerApiCommandExecutor,
  type CommandExecution,
} from '@agent/homehub-domain';

function listen(server: Server, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function jsonResponse(body: unknown): Buffer {
  return Buffer.from(JSON.stringify(body));
}

function assertExecution(result: CommandExecution): asserts result is CommandExecution & { ok: true } {
  assert.equal(result.ok, true, result.error ?? result.stderr);
}

test('restricted Docker API executor observes only allowlisted containers and operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-docker-api-'));
  const socketPath = join(root, 'docker.sock');
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    response.statusCode = 200;
    if (path.includes('/containers/json')) {
      response.setHeader('content-type', 'application/json');
      response.end(jsonResponse([
        { Id: 'id-langbot', Names: ['/langbot'], State: 'running', Status: 'Up 2 minutes' },
        { Id: 'id-pubg', Names: ['/pubg-query-engine-v3'], State: 'exited', Status: 'Exited (0)' },
        { Id: 'id-secret', Names: ['/not-registered'], State: 'running', Status: 'Up 2 minutes' },
      ]));
      return;
    }
    if (path.endsWith('/containers/id-langbot/json')) {
      response.setHeader('content-type', 'application/json');
      response.end(jsonResponse({
        Id: 'id-langbot',
        Name: '/langbot',
        Created: '2026-09-06T00:00:00Z',
        RestartCount: 2,
        Config: { Image: 'local/langbot:test', Env: ['BOT_TOKEN=must-not-leak'] },
        State: { Status: 'running', Running: true, Health: { Status: 'healthy' }, ExitCode: 0 },
      }));
      return;
    }
    if (path.endsWith('/containers/id-langbot/logs?stdout=1&stderr=1&tail=2&timestamps=0')) {
      const line = Buffer.from('bounded log\n');
      const frame = Buffer.alloc(8 + line.length);
      frame[0] = 1;
      frame.writeUInt32BE(line.length, 4);
      line.copy(frame, 8);
      response.end(frame);
      return;
    }
    if (path.includes('/containers/id-langbot/stats')) {
      response.setHeader('content-type', 'application/json');
      response.end(jsonResponse({
        cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 2 },
        precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
        memory_stats: { usage: 200, limit: 1000, stats: { cache: 0 } },
      }));
      return;
    }
    if (path.endsWith('/containers/id-langbot/restart?t=10')) {
      response.statusCode = 204;
      response.end();
      return;
    }
    response.statusCode = 404;
    response.end(Buffer.from('{"message":"not found"}'));
  });

  try {
    await listen(server, socketPath);
    const executor = new DockerApiCommandExecutor({ socketPath, apiVersion: 'v1.41' });

    const ps = await executor.execute({
      command: 'docker',
      args: ['ps', '-a', '--filter', 'name=^langbot$', '--format', '{{.Names}}|{{.State}}|{{.Status}}'],
    });
    assertExecution(ps);
    assert.equal(ps.stdout, 'langbot|running|Up 2 minutes\n');

    const all = await executor.execute({ command: 'docker', args: ['ps', '-a', '--format', '{{.Names}}'] });
    assertExecution(all);
    assert.equal(all.stdout, 'langbot\npubg-query-engine-v3\n');

    const inspect = await executor.execute({ command: 'docker', args: ['inspect', 'langbot'] });
    assertExecution(inspect);
    assert.match(inspect.stdout, /"health":"healthy"/u);
    assert.doesNotMatch(inspect.stdout, /must-not-leak/u);

    const logs = await executor.execute({ command: 'docker', args: ['logs', '--tail', '2', 'langbot'] });
    assertExecution(logs);
    assert.equal(logs.stdout, 'bounded log\n');

    const stats = await executor.execute({ command: 'docker', args: ['stats', '--no-stream', '--format', '{{.CPUPerc}}|{{.MemPerc}}', 'langbot'] });
    assertExecution(stats);
    assert.equal(stats.stdout, '20.00%|20.00%\n');

    const restart = await executor.execute({ command: 'docker', args: ['restart', 'langbot'] });
    assertExecution(restart);

    for (const args of [['exec', 'langbot', 'sh'], ['run', 'langbot'], ['restart', 'not-registered']]) {
      const denied = await executor.execute({ command: 'docker', args });
      assert.equal(denied.ok, false);
      assert.equal(denied.executorAvailable, true);
      assert.equal(denied.exitCode, 2);
    }
  } finally {
    await close(server);
    await rm(root, { recursive: true, force: true });
  }
});

test('Docker API transport failure is reported as unavailable without a shell fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'homehub-docker-api-missing-'));
  try {
    const executor = new DockerApiCommandExecutor({ socketPath: join(root, 'missing.sock') });
    const result = await executor.execute({ command: 'docker', args: ['ps', '-a'] });
    assert.equal(result.ok, false);
    assert.equal(result.executorAvailable, false);
    assert.equal(result.error, 'docker executor unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
