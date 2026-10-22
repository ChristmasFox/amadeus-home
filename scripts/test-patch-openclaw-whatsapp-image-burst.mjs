#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER, IMAGE_BURST_QUIET_MS, IMAGE_BURST_MAX_MS, patchWhatsAppMonitorSource } from './patch-openclaw-whatsapp-image-burst.mjs';

// Mirrors the pinned monitor's debouncer wiring (same anchors), driven by a
// minimal copy of the core keyed debouncer semantics.
const fixture = `function createWhatsAppInboundMessageDebouncer(options) {
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
const factory = new Function('createInboundDebouncer', 'shouldDebounceTextInbound', 'toInboundMediaFactsWithMetadata', `${patched}; return { createWhatsAppInboundMessageDebouncer, shouldDebounce, build, amadeusBurstWindowMs, amadeusPayloadMediaList };`);
const run = factory(createInboundDebouncer, ({ text, hasMedia }) => !hasMedia && Boolean(text), async (list) => { calls.push(list); return list; });

mock.timers.enable({ apis: ['setTimeout', 'Date'] });
const dispatched = [];
const debouncer = run.createWhatsAppInboundMessageDebouncer({
  resolveDebounceMs: () => 0,
  shouldDebounce: run.shouldDebounce,
  onMessage: (m) => dispatched.push({ at: Date.now(), body: m.payload.body, media: (m.payload.mediaList ?? (m.payload.media ? [m.payload.media] : [])).map((x) => x.path), batched: m.event.isBatched === true }),
});
let t = 0;
const msg = (id, extra) => ({ platform: { key: 'secondary:chat:sender' }, event: { id, timestamp: t }, payload: { body: id, ...extra } });
const image = (id, path) => msg(id, { media: { type: 'image/jpeg', path } });
const advance = async (ms) => { mock.timers.tick(ms); t += ms; await Promise.resolve(); };

// 1. Phone uploads: two images 7s apart -> exactly one dispatch carrying both.
await debouncer.enqueue(image('A1', '/m/1.jpg'));
await advance(7000);
assert.equal(dispatched.length, 0, 'first image must keep waiting for the next one');
await debouncer.enqueue(image('A2', '/m/2.jpg'));
await advance(IMAGE_BURST_QUIET_MS - 1);
assert.equal(dispatched.length, 0, 'the window restarts with each image');
await advance(1);
assert.equal(dispatched.length, 1);
assert.deepEqual(dispatched[0].media, ['/m/1.jpg', '/m/2.jpg']);
assert.equal(dispatched[0].batched, true);

// 2. Three images ~8s apart and a trailing caption text join the same dispatch.
dispatched.length = 0;
for (const [id, wait] of [['B1', 8000], ['B2', 8000], ['B3', 2000]]) { await debouncer.enqueue(image(id, `/m/${id}.jpg`)); await advance(wait); }
await debouncer.enqueue(msg('请比较这三张图', {}));
assert.equal(dispatched.length, 0, 'text inside the window must not run on its own');
await advance(1500);
assert.equal(dispatched.length, 1);
assert.deepEqual(dispatched[0].media, ['/m/B1.jpg', '/m/B2.jpg', '/m/B3.jpg']);
assert.match(dispatched[0].body, /请比较这三张图$/u);

// 3. A steady trickle cannot postpone the reply past the hard cap.
dispatched.length = 0;
const start = Date.now();
for (let i = 0; i < 12 && dispatched.length === 0; i++) { await debouncer.enqueue(image(`C${i}`, `/m/c${i}.jpg`)); await advance(9000); }
assert.equal(dispatched.length, 1);
assert.ok(dispatched[0].at - start <= IMAGE_BURST_MAX_MS + 10_000, `cap exceeded: ${dispatched[0].at - start}`);

// 4. Plain text with no pending image burst is untouched (dispatched immediately, no delay).
dispatched.length = 0;
await debouncer.enqueue(msg('hello', {}));
assert.equal(dispatched.length, 1);

// 5. Text before any image never waits, and a different sender's key is independent.
dispatched.length = 0;
await debouncer.enqueue(image('D1', '/m/d1.jpg'));
await debouncer.enqueue({ ...image('E1', '/m/e1.jpg'), platform: { key: 'secondary:chat:other' } });
await advance(IMAGE_BURST_QUIET_MS);
assert.deepEqual(dispatched.map((d) => d.media), [['/m/d1.jpg'], ['/m/e1.jpg']]);
mock.timers.reset();

assert.equal(run.amadeusBurstWindowMs(0, 10_000, 0, 25_000), 5000);
assert.equal(run.amadeusBurstWindowMs(0, 10_000, 0, 40_000), 1);

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
