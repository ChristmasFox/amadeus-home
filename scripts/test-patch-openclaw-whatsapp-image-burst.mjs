#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER, ALBUM_QUIET_MS, ALBUM_EXPECTED_MAX_MS, patchWhatsAppMonitorSource } from './patch-openclaw-whatsapp-image-burst.mjs';

// Mirrors the pinned monitor's debouncer wiring (same anchors), driven by a
// minimal copy of the core keyed debouncer semantics.
const fixture = `function inspectWhatsAppIngressMessage(message) {
	const remoteJid = message.key?.remoteJid?.trim();
	const id = message.key?.id?.trim();
	if (!remoteJid || !id) throw new Error("missing key");
	return {
		eventId: remoteJid + "/" + id,
		laneKey: remoteJid
	};
}
function createWhatsAppIngressMonitor(params) {
	return {
		inspect: (admission) => inspectWhatsAppIngressMessage(admission.message),
	};
}
function createWhatsAppInboundMessageDebouncer(options) {
	const pendingKeys = /* @__PURE__ */ new Map();
	const buildKey = (msg) => msg.platform.key;
	const shouldDebounce = (msg) => options.shouldDebounce?.(msg) ?? true;
	const trackKey = (key) => { pendingKeys.set(key, (pendingKeys.get(key) ?? 0) + 1); };
	const releaseKey = (entry) => { if (!entry.debounceKey || entry.debounceKeyTracked !== true) return; pendingKeys.delete(entry.debounceKey); };
	const debouncer = createInboundDebouncer({
		debounceMs: options.resolveDebounceMs(),
		resolveDebounceMs: (entry) => entry.debounceMs,
		buildKey: (msg) => msg.debounceKey ?? buildKey(msg),
		shouldDebounce,
		onFlush: (entries) => {
			for (const entry of entries) releaseKey(entry);
			const orderedEntries = entries;
			const last = orderedEntries.at(-1);
			if (orderedEntries.length === 1) { options.onMessage(last); return; }
			const combinedBody = orderedEntries.map((entry) => entry.payload.body).filter(Boolean).join("\\n");
			const combinedMessage = {
				...last,
				payload: {
								...last.payload,
								body: combinedBody,
								commandBody: combinedBody
							},
				event: { ...last.event, isBatched: true }
			};
			options.onMessage(combinedMessage);
		}
	});
	const enqueue = async (input) => {
		const message = {
			...input,
			debounceMs: options.resolveDebounceMs()
		};
		const key = buildKey(message);
		if (key) {
			message.debounceKey = key;
			if (message.debounceMs > 0 && shouldDebounce(message)) {
				message.debounceKeyTracked = true;
				trackKey(key);
			}
		}
		await debouncer.enqueue(message);
	};
	return { enqueue };
}
const shouldDebounce = (msg) => shouldDebounceTextInbound({ text: msg.payload.commandBody ?? msg.payload.body, hasMedia: Boolean(msg.payload.media?.path || msg.payload.media?.type) });
async function handleMessagesUpsert(upsert) {
		for (const msg of upsert.messages ?? []) {
			rememberBaileysMessage(msg.key?.remoteJid, msg.key?.id, msg.message);
		}
}
function makeInbound(msg, media, channelStructuredContext) {
		return {
			payload: {
				channelStructuredContext: channelStructuredContext.length > 0 ? channelStructuredContext : void 0,
				media
			},
		};
}
async function build(params) {
	const media = await toInboundMediaFactsWithMetadata(params.msg.payload.media ? [{
		path: params.msg.payload.media?.path,
		url: params.msg.payload.media?.url ?? params.msg.payload.media?.path,
		contentType: params.msg.payload.media?.type,
		kind: params.msg.payload.media?.kind
	}] : void 0, { transcribed: () => false });
	return media;
}
`;

const patched = patchWhatsAppMonitorSource(fixture);
assert.equal(patched.split(MARKER).length - 1, 1);
assert.equal(patchWhatsAppMonitorSource(patched), patched);
assert.throws(() => patchWhatsAppMonitorSource('function createWhatsAppInboundMessageDebouncer(options) {}'), /anchor count=0/);

// Core debouncer semantics: per-key buffer, timer restarts on each item, deadline = 5 * first window, non-debounced items flush the buffer first.
function createInboundDebouncer(params) {
  const buffers = new Map();
  const flush = (key) => { const b = buffers.get(key); if (!b) return; buffers.delete(key); clearTimeout(b.timeout); params.onFlush(b.items); };
  return {
    flushKey: async (key) => flush(key),
    async enqueue(item) {
      const key = params.buildKey(item);
      const ms = params.resolveDebounceMs(item);
      if (!(ms > 0 && params.shouldDebounce(item))) { flush(key); params.onFlush([item]); return; }
      let b = buffers.get(key);
      if (!b) { b = { items: [], deadline: Date.now() + ms * 5 }; buffers.set(key, b); }
      b.items.push(item);
      clearTimeout(b.timeout);
      b.timeout = setTimeout(() => flush(key), Math.min(ms, Math.max(0, b.deadline - Date.now())));
    },
  };
}

const calls = [];
const factory = new Function('createInboundDebouncer', 'shouldDebounceTextInbound', 'toInboundMediaFactsWithMetadata', 'rememberBaileysMessage', `${patched}; return { createWhatsAppInboundMessageDebouncer, shouldDebounce, build, handleMessagesUpsert, makeInbound, amadeusAlbumIdOf, inspectWhatsAppIngressMessage, createWhatsAppIngressMonitor };`);
const run = factory(createInboundDebouncer, ({ text, hasMedia }) => !hasMedia && Boolean(text), async (list) => { calls.push(list); return list; }, () => {});

mock.timers.enable({ apis: ['setTimeout', 'Date'] });
const dispatched = [];
const dispatchHook = { fn: (m) => dispatched.push({ at: Date.now(), body: m.payload.body, media: (m.payload.mediaList ?? (m.payload.media ? [m.payload.media] : [])).map((x) => x.path), batched: m.event.isBatched === true }) };
const debouncer = run.createWhatsAppInboundMessageDebouncer({
  resolveDebounceMs: () => 0,
  shouldDebounce: run.shouldDebounce,
  onMessage: (m) => dispatchHook.fn(m),
});
let t = 0;
const msg = (id, extra) => ({ platform: { key: 'secondary:chat:sender' }, event: { id, timestamp: t }, payload: { body: id, ...extra } });
const image = (id, path, albumId) => msg(id, { media: { type: 'image/jpeg', path }, ...(albumId ? { albumId } : {}) });
const advance = async (ms) => { mock.timers.tick(ms); t += ms; await Promise.resolve(); };
const CHAT = '232620529074198@lid';
// Shapes copied from Arthur's real 2026-10-23 00:56 messages (media fields omitted).
const parent = (id, expectedImageCount) => ({ key: { remoteJid: CHAT, fromMe: false, id }, message: { messageContextInfo: {}, albumMessage: { expectedImageCount, expectedVideoCount: 0 } } });
const child = (id, parentId) => ({ key: { remoteJid: CHAT, fromMe: false, id }, message: { imageMessage: { mimetype: 'image/jpeg' }, messageContextInfo: { messageAssociation: { associationType: 'MEDIA_ALBUM', parentMessageKey: { remoteJid: CHAT, fromMe: true, id: parentId } } } } });
const albumId = (parentId) => `${CHAT}:${parentId}`;

// Marker extraction: children name the album; protobuf enum numbers work too; plain images and other associations do not.
assert.equal(run.amadeusAlbumIdOf(child('c1', 'P1')), albumId('P1'));
assert.equal(run.amadeusAlbumIdOf({ key: { remoteJid: CHAT }, message: { messageContextInfo: { messageAssociation: { associationType: 1, parentMessageKey: { id: 'P1' } } } } }), albumId('P1'));
assert.equal(run.amadeusAlbumIdOf({ key: { remoteJid: CHAT }, message: { imageMessage: {}, messageContextInfo: {} } }), undefined);
assert.equal(run.amadeusAlbumIdOf({ key: { remoteJid: CHAT }, message: { messageContextInfo: { messageAssociation: { associationType: 'OTHER', parentMessageKey: { id: 'P1' } } } } }), undefined);
assert.equal(run.makeInbound(child('c1', 'P1'), { type: 'image/jpeg' }, []).payload.albumId, albumId('P1'));
assert.equal(run.makeInbound(child('c1', 'P1'), undefined, []).payload.albumId, undefined);

// 1. A single image carries no marker: zero wait.
await debouncer.enqueue(image('S1', '/m/single.jpg'));
assert.deepEqual(dispatched.map((d) => d.media), [['/m/single.jpg']]);
assert.equal(dispatched[0].batched, false);

// 2. Album announced for 2 images; the second arrives ~7s after the first (Arthur's case): one dispatch, exactly when complete.
dispatched.length = 0;
await run.handleMessagesUpsert({ messages: [parent('P1', 2)] });
await debouncer.enqueue(image('A1', '/m/1.jpg', albumId('P1')));
await advance(6700);
assert.equal(dispatched.length, 0, 'first album image waits for its sibling');
await debouncer.enqueue(image('A2', '/m/2.jpg', albumId('P1')));
assert.equal(dispatched.length, 1, 'complete album dispatches immediately, no extra quiet window');
assert.deepEqual(dispatched[0].media, ['/m/1.jpg', '/m/2.jpg']);
assert.equal(dispatched[0].batched, true);
await advance(ALBUM_QUIET_MS * 2);
assert.equal(dispatched.length, 1, 'no second run afterwards');

// 2b. The siblings' media downloads can be more than the old 8s quiet window apart (Arthur's 08:56 album): still one dispatch.
dispatched.length = 0;
await run.handleMessagesUpsert({ messages: [parent('P6', 2)] });
await debouncer.enqueue(image('F1', '/m/f1.jpg', albumId('P6')));
await advance(9000);
assert.equal(dispatched.length, 0);
await debouncer.enqueue(image('F2', '/m/f2.jpg', albumId('P6')));
assert.deepEqual(dispatched.map((d) => d.media), [['/m/f1.jpg', '/m/f2.jpg']]);
await advance(ALBUM_EXPECTED_MAX_MS);
assert.equal(dispatched.length, 1);

// 3. Messages that are not part of the album are never held back.
dispatched.length = 0;
await run.handleMessagesUpsert({ messages: [parent('P2', 3)] });
await debouncer.enqueue(image('B1', '/m/b1.jpg', albumId('P2')));
await debouncer.enqueue(msg('hello', {}));
await debouncer.enqueue(image('Z1', '/m/z.jpg'));
assert.deepEqual(dispatched.map((d) => d.media), [[], ['/m/z.jpg']]);

// 4. A missing sibling cannot hold the album forever: the announced-count cap flushes what arrived.
dispatched.length = 0;
await advance(ALBUM_EXPECTED_MAX_MS - 1);
assert.equal(dispatched.length, 0);
await advance(1);
assert.deepEqual(dispatched.map((d) => d.media), [['/m/b1.jpg']]);

// 5. Unknown parent (announcement lost): still merged by the album id within the quiet window; two albums stay separate.
dispatched.length = 0;
await debouncer.enqueue(image('C1', '/m/c1.jpg', albumId('P3')));
await debouncer.enqueue(image('D1', '/m/d1.jpg', albumId('P4')));
await advance(3000);
await debouncer.enqueue(image('C2', '/m/c2.jpg', albumId('P3')));
await advance(ALBUM_QUIET_MS);
assert.deepEqual(dispatched.map((d) => d.media).sort(), [['/m/c1.jpg', '/m/c2.jpg'], ['/m/d1.jpg']]);

// 6. The window never extends beyond the hard cap.
dispatched.length = 0;
const start = Date.now();
await run.handleMessagesUpsert({ messages: [parent('P5', 99)] });
for (let i = 0; i < 9 && dispatched.length === 0; i++) { await debouncer.enqueue(image(`E${i}`, `/m/e${i}.jpg`, albumId('P5'))); await advance(7000); }
assert.equal(dispatched.length, 1);
assert.ok(dispatched[0].at - start <= ALBUM_EXPECTED_MAX_MS + 7000, `cap exceeded: ${dispatched[0].at - start}`);

// 7. Durable ingress lanes: a held turn keeps its lane until adoption, so album images need lanes of their own.
const lanes = (laneKeyOf, downloadMs) => {
  const chains = new Map();
  const waiting = [];
  dispatched.length = 0;
  const originalOnMessage = dispatchHook.fn;
  dispatchHook.fn = (m) => { originalOnMessage(m); while (waiting.length) waiting.pop()(); };
  const process = (raw, path) => {
    const key = laneKeyOf(raw);
    const next = (chains.get(key) ?? Promise.resolve()).then(async () => {
      await new Promise((resolve) => setTimeout(resolve, downloadMs));
      const adopted = new Promise((resolve) => waiting.push(resolve));
      await debouncer.enqueue(image(raw.key.id, path, run.amadeusAlbumIdOf(raw)));
      await adopted;
    });
    chains.set(key, next);
  };
  return { process, restore: () => { dispatchHook.fn = originalOnMessage; } };
};
const settle = async (ms) => { for (let spent = 0; spent < ms; spent += 100) { await advance(100); for (let i = 0; i < 20; i++) await Promise.resolve(); } };
await run.handleMessagesUpsert({ messages: [parent('P7', 2)] });
const albumChildren = [child('G1', 'P7'), child('G2', 'P7')];
const plainLane = lanes((raw) => raw.key.remoteJid, 300);
albumChildren.forEach((raw, index) => plainLane.process(raw, `/m/g${index + 1}.jpg`));
await settle(ALBUM_EXPECTED_MAX_MS * 2 + 2000);
assert.equal(dispatched.length >= 2, true, 'with the chat as lane the siblings are serialized and split (the observed bug)');
plainLane.restore();
await run.handleMessagesUpsert({ messages: [parent('P8', 2)] });
const albumLane = lanes((raw) => run.inspectWhatsAppIngressMessage(raw).laneKey, 8800);
[child('H1', 'P8'), child('H2', 'P8')].forEach((raw, index) => albumLane.process(raw, `/m/h${index + 1}.jpg`));
await settle(ALBUM_EXPECTED_MAX_MS + 1000);
assert.deepEqual(dispatched.map((d) => d.media), [['/m/h1.jpg', '/m/h2.jpg']], 'album images share one dispatch when each has its own lane');
albumLane.restore();
// Lane keys: plain messages keep the chat lane, album children each get their own, a claim made under the old lane key is still accepted.
assert.equal(run.inspectWhatsAppIngressMessage({ key: { remoteJid: CHAT, id: 'x' }, message: { conversation: 'hi' } }).laneKey, CHAT);
assert.equal(run.inspectWhatsAppIngressMessage(child('c1', 'P1')).laneKey, `album:${albumId('P1')}:c1`);
const monitor = run.createWhatsAppIngressMonitor({});
assert.equal(monitor.inspect({ message: child('c1', 'P1') }, { phase: 'claim', claimedLaneKey: CHAT }).laneKey, CHAT);
assert.equal(monitor.inspect({ message: child('c1', 'P1') }, { phase: 'claim', claimedLaneKey: `album:${albumId('P1')}:c1` }).laneKey, `album:${albumId('P1')}:c1`);
mock.timers.reset();

// Media list feeds the inbound facts.
const first = { type: 'image/jpeg', path: '/m/1.jpg' };
const second = { type: 'image/png', path: '/m/2.png', url: 'u2', kind: 'image' };
await run.build({ msg: { payload: { media: second, mediaList: [first, second] } } });
assert.deepEqual(calls[0].map((item) => item.path), ['/m/1.jpg', '/m/2.png']);
await run.build({ msg: { payload: { media: first } } });
assert.deepEqual(calls[1].map((item) => item.path), ['/m/1.jpg']);
await run.build({ msg: { payload: {} } });
assert.equal(calls[2], undefined);

const root = await mkdtemp(join(tmpdir(), 'whatsapp-image-burst-'));
const dist = join(root, 'project/node_modules/@openclaw/whatsapp/dist');
await mkdir(dist, { recursive: true });
await writeFile(join(dist, 'monitor-fixture.js'), fixture);
// Same invocation as deploy-openclaw.sh: the script arrives on stdin.
const source = await readFile('scripts/patch-openclaw-whatsapp-image-burst.mjs', 'utf8');
const cli = () => spawnSync(process.execPath, ['-', root], { encoding: 'utf8', input: source });
const one = cli();
assert.equal(one.status, 0, one.stderr);
assert.match(one.stdout, /WHATSAPP_IMAGE_BURST_PATCH=applied/);
assert.match(cli().stdout, /already-applied/);
assert.ok((await readFile(join(dist, 'monitor-fixture.js'), 'utf8')).includes(MARKER));
console.log('WHATSAPP_IMAGE_BURST_FIXTURE=passed');
