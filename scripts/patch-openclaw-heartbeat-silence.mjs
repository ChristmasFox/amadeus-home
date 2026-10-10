#!/usr/bin/env node
/**
 * Version-pinned OpenClaw 2026.9.4 heartbeat delivery guard.
 *
 * Heartbeats use OpenClaw's native durable sender and deliberately suppress
 * ordinary outbound hooks.  Keep the final native path fail-closed for a
 * silent sentinel, and strip a leading Amadeus control marker before a real
 * heartbeat alert is delivered.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = 'codex-amadeus-heartbeat-silent-delivery-v1';
export const PIN = Object.freeze({
  version: '2026.9.4',
  module: 'heartbeat-runner-CPy-qxAy.mjs',
  moduleSha256: 'c01aabe6e8e11b986b5fb8dd4f4baa618eeba894d606138c0fedec2235928ac4',
});

const CONTROL_PREFIX = /^(?:\s*\[\[[^\]\r\n]+\]\]\s*)+/u;
const SILENT_REPLY = /^NO_REPLY(?:\s+NO_REPLY)*$/iu;

function hasMedia(payload) {
  return (typeof payload.mediaUrl === 'string' && payload.mediaUrl.trim().length > 0)
    || (Array.isArray(payload.mediaUrls) && payload.mediaUrls.some((url) => typeof url === 'string' && url.trim().length > 0));
}

/** Return null only for a text-only heartbeat sentinel. */
export function prepareHeartbeatDeliveryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.text !== 'string') return payload;
  const text = payload.text;
  const strippedText = text.replace(CONTROL_PREFIX, '').trimStart();
  if (SILENT_REPLY.test(strippedText.trim()) && !hasMedia(payload)) return null;
  return strippedText === text ? payload : { ...payload, text: strippedText };
}

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned ${label} anchor count=${count}; refusing to patch`);
  return source.replace(find, replacement);
}

export function patchHeartbeatRunnerSource(original) {
  if (original.includes(MARKER)) {
    if (!original.includes('const safePayload = prepareHeartbeatDeliveryPayload(payload);')) {
      throw new Error('incomplete heartbeat silence patch');
    }
    return original;
  }
  const helper = `\n// ${MARKER}\n${prepareHeartbeatDeliveryPayload.toString()}\n`;
  let result = replaceOnce(
    original,
    'async function deliverHeartbeatDispatch(policy, payload, signal) {',
    `${helper}async function deliverHeartbeatDispatch(policy, payload, signal) {`,
    'heartbeat delivery function',
  );
  result = replaceOnce(
    result,
    '\tconst { cfg, agentId, startedAt } = policy.wake;\n',
    '\tconst safePayload = prepareHeartbeatDeliveryPayload(payload);\n\tif (safePayload === null) {\n\t\tpolicy.deliveryReason = "heartbeat-silent";\n\t\treturn { visibleReplySent: false };\n\t}\n\tpayload = safePayload;\n\tconst { cfg, agentId, startedAt } = policy.wake;\n',
    'heartbeat payload guard',
  );
  return result;
}

function main(argv = process.argv.slice(2)) {
  let coreRoot;
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--core-root') coreRoot = argv[++index];
    else if (arg === '--apply') apply = true;
    else throw new Error(`unknown option ${arg}`);
  }
  if (!coreRoot || !path.isAbsolute(coreRoot)) throw new Error('--core-root must be an absolute path');
  const modulePath = path.join(coreRoot, PIN.module);
  if (!fs.statSync(modulePath).isFile()) throw new Error('pinned heartbeat runner module missing');
  const original = fs.readFileSync(modulePath, 'utf8');
  const digest = createHash('sha256').update(original).digest('hex');
  if (digest !== PIN.moduleSha256 && !original.includes(MARKER)) throw new Error('pinned heartbeat runner module digest mismatch');
  const patched = patchHeartbeatRunnerSource(original);
  if (apply && patched !== original) {
    const mode = fs.statSync(modulePath).mode & 0o777;
    const temporary = `${modulePath}.heartbeat-tmp-${process.pid}`;
    fs.writeFileSync(temporary, patched);
    fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, modulePath);
  }
  console.log(`OPENCLAW_HEARTBEAT_SILENCE=${apply ? 'applied' : 'patchable'} module=${PIN.module}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`OPENCLAW_HEARTBEAT_SILENCE=failed ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
