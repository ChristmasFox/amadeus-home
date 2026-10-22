import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpenClawPluginApi, OpenClawPluginToolContext } from 'openclaw/plugin-sdk/core';
import { assertPublicUrl, downloadWebImage, findWebImages, isPublicAddress, parseImageResults, sniffImageMime, webImageCaption, MAX_WEB_IMAGE_BYTES } from '../src/web-image.js';
import { registerImageAssets, webImageDeps } from '../src/image-assets.js';
import { deliveryRuns } from '../src/delivery-runs.js';

const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4096, 1)]);
const JPEG = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(4096, 2)]);
const publicLookup = async () => ['93.184.216.34'];
const reply = (body: Buffer | string, type: string, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === 'string' ? body : new Uint8Array(body), { status, headers: { 'content-type': type, ...headers } });

test('address classification rejects private, sinkhole and mapped ranges', () => {
  for (const address of ['0.0.0.0', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '198.18.0.5', '224.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isPublicAddress(address), true, address);
});

test('URL guard blocks schemes, credentials, odd ports, internal names and DNS answers', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/a.png', 'https://user:pw@example.com/a.png', 'https://example.com:22/a.png', 'http://127.0.0.1/a.png', 'http://[::1]/a.png', 'http://localhost/a.png', 'http://searxng:8080/a.png', 'http://nas.local/a.png', 'http://metadata.internal/a.png', 'not a url']) await assert.rejects(assertPublicUrl(url, publicLookup), /web_image_/u, url);
  await assert.rejects(assertPublicUrl('https://wttr.in/a.png', async () => ['0.0.0.0', '::']), /web_image_address_forbidden/u);
  await assert.rejects(assertPublicUrl('https://rebind.example.com/a.png', async () => ['93.184.216.34', '10.0.0.5']), /web_image_address_forbidden/u);
  await assert.rejects(assertPublicUrl('https://nx.example.com/a.png', async () => { throw new Error('ENOTFOUND'); }), /web_image_dns_failed/u);
  assert.equal((await assertPublicUrl('https://example.com/a.png', publicLookup)).hostname, 'example.com');
});

test('download enforces type, magic bytes, size and revalidates redirects', async () => {
  const deps = (handler: (url: string) => Response | Promise<Response>) => ({ lookup: publicLookup, fetch: async (url: string) => handler(url) });
  const ok = await downloadWebImage('https://img.example.com/a', deps(() => reply(PNG, 'image/png')));
  assert.equal(ok.mimeType, 'image/png');
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply('<html>', 'text/html'))), /type_forbidden/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply(PNG, 'image/svg+xml'))), /type_forbidden/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply(Buffer.alloc(5000, 7), 'image/jpeg'))), /content_invalid/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply(Buffer.alloc(100, 7), 'image/jpeg'))), /too_small/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply(JPEG, 'image/jpeg', 200, { 'content-length': String(MAX_WEB_IMAGE_BYTES + 1) }))), /too_large/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply(Buffer.concat([JPEG, Buffer.alloc(MAX_WEB_IMAGE_BYTES)]), 'image/jpeg'))), /too_large/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply('', 'image/png', 404))), /http_404/u);
  const hops: string[] = [];
  const redirected = await downloadWebImage('https://img.example.com/a', deps((url) => { hops.push(url); return hops.length === 1 ? reply('', 'text/plain', 302, { location: '/b.jpg' }) : reply(JPEG, 'image/jpeg'); }));
  assert.equal(redirected.finalUrl, 'https://img.example.com/b.jpg');
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply('', 'text/plain', 302, { location: 'http://169.254.169.254/latest' }))), /address_forbidden/u);
  await assert.rejects(downloadWebImage('https://img.example.com/a', deps(() => reply('', 'text/plain', 302, { location: '/loop' }))), /too_many_redirects/u);
});

test('result parsing keeps usable still images and discards the rest', () => {
  const rows = parseImageResults({ results: [
    { title: 'Monkey  \n one', img_src: 'https://a.example/1.jpg', url: 'https://a.example/page', img_format: 'JPG', resolution: '1200×800' },
    { title: 'dup', img_src: 'https://a.example/1.jpg', url: 'https://a.example/other' },
    { title: 'tiny', img_src: 'https://a.example/t.jpg', resolution: '100×100' },
    { title: 'gif', img_src: 'https://a.example/g.gif', img_format: 'GIF' },
    { title: 'js', img_src: 'javascript:alert(1)' },
    { title: 'bare', img_src: 'https://b.example/2.png', content: 'c' },
  ] });
  assert.deepEqual(rows.map((row) => [row.title, row.imageUrl, row.pageUrl]), [['Monkey one', 'https://a.example/1.jpg', 'https://a.example/page'], ['bare', 'https://b.example/2.png', 'https://b.example/2.png']]);
  assert.equal(webImageCaption(rows[0]!), 'Monkey one ｜ 来源：https://a.example/page');
  assert.equal(sniffImageMime(PNG), 'image/png');
  assert.equal(sniffImageMime(Buffer.from('GIF89a....')), undefined);
});

test('search skips candidates that cannot be downloaded and stops at count', async () => {
  const payload = { results: ['bad', 'sink', 'good1', 'good2', 'good3'].map((name) => ({ title: name, img_src: `https://${name}.example.com/x.png`, url: `https://${name}.example.com/` })) };
  const found = await findWebImages('http://searxng:8080', 'monkey', 2, {
    requestJson: async (url) => { assert.match(String(url), /categories=images/u); assert.match(String(url), /format=json/u); return payload; },
    lookup: async (host) => host.startsWith('sink') ? ['0.0.0.0'] : ['93.184.216.34'],
    fetch: async (url) => url.includes('bad.') ? reply('nope', 'text/html', 200) : reply(url.includes('good2') ? JPEG : PNG, url.includes('good2') ? 'image/jpeg' : 'image/png'),
  });
  assert.deepEqual(found.map((item) => item.candidate.title), ['good1', 'good2']);
});

test('tool imports bytes as a web_search asset and queues inline attachments with source captions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-image-tool-'));
  await writeFile(join(root, 'token'), 'test-only');
  const imports: Array<{ kind: string | undefined; length: number }> = [];
  let counter = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    imports.push({ kind: req.headers['x-amadeus-source-kind'] as string | undefined, length: body.length });
    const id = `img_${String(++counter).padStart(32, 'd')}`;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', asset: { imageId: id, storageKey: `original/${id}.png`, mimeType: 'image/png', width: 640, height: 480, byteSize: body.length, sha256: 'a'.repeat(64), status: 'ready', fileName: `${id}.png` } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const hooks = new Map<string, Array<(...args: any[]) => any>>();
  const tools = new Map<string, (ctx: OpenClawPluginToolContext) => any>();
  const api = { pluginConfig: { imageAssetServiceBaseUrl: `http://127.0.0.1:${port}`, imageAssetServiceTokenFile: join(root, 'token'), imageAssetContainerRoot: root, searxngBaseUrl: 'http://searx.test' }, logger: { info() {}, warn() {} }, on(name: string, fn: (...args: any[]) => any) { hooks.set(name, [...(hooks.get(name) ?? []), fn]); }, registerTool(factory: any, options: { name: string }) { tools.set(options.name, factory); } } as unknown as OpenClawPluginApi;
  registerImageAssets(api);
  webImageDeps.current = {
    requestJson: async (url) => { assert.match(String(url), /^http:\/\/searx\.test\/search\?/u); return { results: [{ title: 'Macaque', img_src: 'https://m.example.com/m.png', url: 'https://m.example.com/macaque' }] }; },
    lookup: publicLookup,
    fetch: async () => reply(PNG, 'image/png'),
  };
  try {
    const sessionKey = 'web-image-session';
    const runId = 'web-image-run';
    deliveryRuns.start({ runId, sessionKey, channel: 'whatsapp', origin: 'external_user' });
    const result = await tools.get('amadeus_web_image')!({ sessionKey, messageChannel: 'whatsapp' } as OpenClawPluginToolContext).execute('call', { query: '猴子' }, undefined);
    const details = (result as any).details;
    assert.equal(details.status, 'ok');
    assert.deepEqual(imports, [{ kind: 'web_search', length: PNG.length }]);
    assert.equal(details.deliveryAttachments[0].disposition, 'inline');
    assert.equal(details.deliveryAttachments[0].caption, 'Macaque ｜ 来源：https://m.example.com/macaque');
    assert.equal(details.images[0].sourceUrl, 'https://m.example.com/macaque');
    await Promise.all((hooks.get('after_tool_call') ?? []).map((hook) => hook({ toolName: 'amadeus_web_image', runId, result }, { runId, sessionKey, channelId: 'whatsapp' })));
    const envelope = await deliveryRuns.prepare(runId, '给你～');
    const attachments = envelope.parts.filter((part) => part.kind === 'attachment');
    assert.equal(attachments.length, 1);
    assert.equal((attachments[0] as any).caption, 'Macaque ｜ 来源：https://m.example.com/macaque');
    webImageDeps.current = { ...webImageDeps.current, fetch: async () => reply('x', 'text/html') };
    const failed = await tools.get('amadeus_web_image')!({ sessionKey, messageChannel: 'whatsapp' } as OpenClawPluginToolContext).execute('call2', { query: 'nothing' }, undefined);
    assert.equal((failed as any).details.status, 'error');
    assert.equal(imports.length, 1, 'a failed search imports nothing');
  } finally {
    webImageDeps.current = {};
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
