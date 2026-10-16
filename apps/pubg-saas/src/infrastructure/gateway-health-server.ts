import { createServer, type Server } from 'node:http';

/** A loopback-only health probe reports only whether KOOK's gateway handshake
 * is currently ready. It exposes no account, event, or configuration data. */
export function startGatewayHealthServer(
  isConnected: () => boolean,
  port = 8082,
): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/healthz') {
      response.writeHead(404, { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' });
      response.end('not_found\n');
      return;
    }
    let connected = false;
    try { connected = isConnected(); } catch { connected = false; }
    response.writeHead(connected ? 200 : 503, {
      'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8',
    });
    response.end(connected ? 'ok\n' : 'not_ready\n');
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export function stopGatewayHealthServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}
