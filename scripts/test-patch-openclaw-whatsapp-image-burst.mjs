#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MARKER, IMAGE_BURST_DEBOUNCE_MS, IMAGE_ALBUM_DEBOUNCE_MS, patchWhatsAppMonitorSource } from './patch-openclaw-whatsapp-image-burst.mjs';

const fixture = `function createWhatsAppInboundMessageDebouncer(options) {
	const combined = {
		...last,
		payload: {
								...last.payload,
								body: combinedBody,
								commandBody: combinedCommandBody
							},
	};
	const enqueue = async (input) => {
		const message = {
			...input,
			debounceMs: options.resolveDebounceMs()
		};
		const key = buildKey(message);
	};
}
function makeInbound(msg, media) {
		const channelStructuredContext = [];
		const inboundMessage = {
			payload: {
				channelStructuredContext: channelStructuredContext.length > 0 ? channelStructuredContext : void 0,
				media
			},
		};
		return inboundMessage;
}
const shouldDebounce = (msg) => shouldDebounceTextInbound({ text: msg.payload.body });
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

const calls = [];
const run = new Function('shouldDebounceTextInbound', 'toInboundMediaFactsWithMetadata', `${patched}; return { shouldDebounce, build, amadeusImageBurstDebounceMs, amadeusPayloadMediaList, amadeusAlbumIdOf, makeInbound };`)(
  () => false,
  async (list) => { calls.push(list); return list; },
);
const image = (extra = {}) => ({ payload: { media: { type: 'image/jpeg', path: '/m/a.jpg' }, body: '' }, ...extra });
assert.equal(run.shouldDebounce(image()), true);
assert.equal(run.shouldDebounce({ payload: { body: 'hi' } }), false);
assert.equal(run.shouldDebounce({ payload: { media: { type: 'audio/ogg' } } }), false);
assert.equal(run.shouldDebounce(image({ quote: { id: 'q' } })), false);
assert.equal(run.amadeusImageBurstDebounceMs(image(), 0), IMAGE_BURST_DEBOUNCE_MS);
const album = image();
album.payload.albumId = 'parent-1';
assert.equal(run.amadeusImageBurstDebounceMs(album, 0), IMAGE_ALBUM_DEBOUNCE_MS);
const rawAlbum = { message: { messageContextInfo: { messageAssociation: { associationType: 1, parentMessageKey: { id: 'parent-1' } } } } };
assert.equal(run.amadeusAlbumIdOf(rawAlbum), 'parent-1');
assert.equal(run.amadeusAlbumIdOf({ message: {} }), undefined);
assert.equal(run.amadeusAlbumIdOf({ message: { messageContextInfo: { messageAssociation: { associationType: 2 } } } }), undefined);
assert.equal(run.makeInbound(rawAlbum, { type: 'image/jpeg' }).payload.albumId, 'parent-1');
assert.equal(run.makeInbound(rawAlbum, undefined).payload.albumId, undefined);
assert.equal(run.amadeusImageBurstDebounceMs(image(), 9000), 9000);
assert.equal(run.amadeusImageBurstDebounceMs({ payload: { body: 'hi' } }, 0), 0);

const first = { type: 'image/jpeg', path: '/m/1.jpg' };
const second = { type: 'image/png', path: '/m/2.png', url: 'u2', kind: 'image' };
await run.build({ msg: { payload: { media: second, mediaList: [first, second] } } });
assert.deepEqual(calls[0].map((item) => item.path), ['/m/1.jpg', '/m/2.png']);
assert.equal(calls[0][1].url, 'u2');
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
