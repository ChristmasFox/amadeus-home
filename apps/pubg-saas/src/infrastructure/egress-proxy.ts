import { lookup } from 'node:dns/promises';
import { BlockList, connect, isIP, type Socket } from 'node:net';
import { createServer, type Server } from 'node:http';
import type { LookupAddress } from 'node:dns';
import type { Duplex } from 'node:stream';
import { pathToFileURL } from 'node:url';

const blockedV4 = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['168.63.129.16', 32],
  ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blockedV4.addSubnet(subnet, prefix, 'ipv4');

const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const blockedV6 = new BlockList();
for (const [subnet, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blockedV6.addSubnet(subnet, prefix, 'ipv6');

export function isBlockedEgressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedV4.check(address, 'ipv4');
  if (family === 6) return !ipv6Global.check(address, 'ipv6') || blockedV6.check(address, 'ipv6');
  return true;
}

export function parseHttpsConnectAuthority(authority: string): string | null {
  const match = /^(?:\[([^\]]+)\]|([^:\[\]]+)):([0-9]{1,5})$/u.exec(authority);
  if (!match || Number(match[3]) !== 443) return null;
  const rawHost = match[1] ?? match[2];
  if (!rawHost || /[%@\s/\\]/u.test(rawHost)) return null;
  let hostname: string;
  try { hostname = new URL(`https://${rawHost}`).hostname.toLowerCase().replace(/\.$/u, ''); }
  catch { return null; }
  if (!hostname || isIP(hostname.replace(/^\[|\]$/gu, '')) !== 0
    || hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(hostname)) return null;
  return hostname;
}

export interface EgressProxyOptions {
  host?: string;
  port?: number;
  lookupHost?: (hostname: string) => Promise<LookupAddress[]>;
  connectUpstream?: (address: string, port: number) => Promise<Socket>;
}

const proxyClients = new WeakMap<Server, Set<Socket>>();

export function closePublicEgressProxy(server: Server): Promise<void> {
  const clients = proxyClients.get(server);
  for (const socket of clients ?? []) socket.destroy();
  return new Promise(resolve => {
    if (!server.listening) { resolve(); return; }
    server.close(() => resolve());
  });
}

function defaultLookup(hostname: string): Promise<LookupAddress[]> {
  return lookup(hostname, { all: true, verbatim: true });
}

function connectToAddress(address: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const upstream: Socket = connect({ host: address, port, family: isIP(address) });
    const fail = (error: Error) => { upstream.destroy(); reject(error); };
    upstream.setTimeout(5000, () => fail(new Error('egress_upstream_timeout')));
    upstream.once('error', fail);
    upstream.once('connect', () => {
      upstream.setTimeout(0);
      upstream.removeListener('error', fail);
      resolve(upstream);
    });
  });
}

function replyAndClose(socket: Duplex, status: 403 | 502): void {
  if (socket.destroyed) return;
  const reason = status === 403 ? 'Forbidden' : 'Bad Gateway';
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function createPublicEgressProxy(options: EgressProxyOptions = {}): Server {
  const lookupHost = options.lookupHost ?? defaultLookup;
  const connectUpstream = options.connectUpstream ?? connectToAddress;
  const server = createServer();
  const clients = new Set<Socket>();
  proxyClients.set(server, clients);
  server.on('connection', socket => {
    clients.add(socket);
    socket.once('close', () => clients.delete(socket));
  });
  server.maxConnections = 128;
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;

  server.on('request', (_request, response) => {
    response.writeHead(405, { connection: 'close', 'content-length': '0' });
    response.end();
  });
  server.on('connect', (request, clientSocket, head) => {
    const hostname = parseHttpsConnectAuthority(request.url ?? '');
    if (!hostname) { replyAndClose(clientSocket, 403); return; }
    void (async () => {
      let records: LookupAddress[];
      try { records = await lookupHost(hostname); }
      catch { replyAndClose(clientSocket, 502); return; }
      if (records.length === 0 || records.some(record => isBlockedEgressAddress(record.address))) {
        replyAndClose(clientSocket, 403); return;
      }
      let upstream: Socket | null = null;
      for (const record of records) {
        if (isBlockedEgressAddress(record.address)) continue;
        try { upstream = await connectUpstream(record.address, 443); break; }
        catch { /* Try the next already-vetted public DNS answer. */ }
      }
      if (!upstream || clientSocket.destroyed) {
        upstream?.destroy();
        if (!clientSocket.destroyed) replyAndClose(clientSocket, 502);
        return;
      }
      clientSocket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: pubg-saas-egress\r\n\r\n');
      if (head.length) upstream.write(head);
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
      clientSocket.once('error', () => upstream?.destroy());
      upstream.once('error', () => clientSocket.destroy());
      clientSocket.once('close', () => upstream?.destroy());
    })().catch(() => replyAndClose(clientSocket, 502));
  });
  server.listen(options.port ?? 8080, options.host ?? '0.0.0.0');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PUBG_SAAS_EGRESS_PROXY_PORT ?? 8080);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('pubg_saas_egress_proxy_config_invalid\n');
    process.exitCode = 1;
  } else {
    const server = createPublicEgressProxy({ host: '0.0.0.0', port });
    const shutdown = () => { void closePublicEgressProxy(server).then(() => { process.exitCode = 0; }); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }
}
