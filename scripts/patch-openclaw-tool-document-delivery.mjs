#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const MARKER = 'amadeus-tool-document-delivery-v1';
const ROOT = process.argv[2];
if (!ROOT || process.argv.length !== 3) throw new Error('usage: patch-openclaw-tool-document-delivery.mjs <core-root>');

async function findBundle(pattern, required) {
  for (const entry of await readdir(ROOT, { withFileTypes: true })) {
    const path = join(ROOT, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (required.every((anchor) => text.includes(anchor))) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findBundleBelow(path, pattern, required);
      if (found) return found;
    }
  }
  return null;
}

async function findBundleBelow(dir, pattern, required) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      const text = await readFile(path, 'utf8');
      if (required.every((anchor) => text.includes(anchor))) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const found = await findBundleBelow(path, pattern, required);
      if (found) return found;
    }
  }
  return null;
}

async function replaceOnce(path, before, after, label) {
  const original = await readFile(path, 'utf8');
  if (original.includes(MARKER)) return 'already';
  if (original.split(before).length !== 2) throw new Error(`${label} anchor changed in ${path}`);
  await writeFile(path, original.replace(before, `${after}\n// ${MARKER}`));
  return 'applied';
}

const mediaPath = await findBundle(/^embedded-agent-tool-media-.*\.mjs$/u, ['function extractToolResultMediaArtifact(result)', 'detailsMedia.trustedLocalMedia']);
const executePath = await findBundle(/^execute\.runtime-.*\.mjs$/u, ['let toolTrustedLocalMedia = false;', 'toolTrustedLocalMedia ||= artifact?.trustedLocalMedia === true;']);
const embeddedPath = await findBundle(/^embedded-agent-.*\.mjs$/u, ['toolTrustedLocalMedia: attempt.toolTrustedLocalMedia,', 'mergeAttemptToolMediaPayloads({']);
const payloadPath = await findBundle(/^tool-media-payloads-.*\.mjs$/u, ['function mergeAttemptToolMediaPayloads(params)', 'trustedLocalMedia: params.toolTrustedLocalMedia || void 0']);
const deliverPath = await findBundle(/^deliver-prepare-.*\.mjs$/u, ['const payloadCtx = {', '\t\t\t\tpayload\n\t\t\t};']);
const builtinPath = await findBundle(/^builtin-openclaw-.*\.mjs$/u, ['function queuePendingToolMedia(ctx, mediaReply, allowedMediaUrls, autoDeliveryMediaUrls)', 'pendingToolMediaReply?.trustedLocalMedia']);
if (!mediaPath || !executePath || !embeddedPath || !payloadPath || !deliverPath || !builtinPath) throw new Error('pinned tool document delivery bundles missing');

const mediaOriginal = await readFile(mediaPath, 'utf8');
if (!mediaOriginal.includes(MARKER)) {
  let mediaPatched = mediaOriginal;
  const attachmentKeys = '"height",\n\t"forceDocument"';
  if (!mediaPatched.includes(attachmentKeys)) {
    const anchor = '"height"\n]);';
    if (!mediaPatched.includes(anchor)) throw new Error(`attachment key anchor changed in ${mediaPath}`);
    mediaPatched = mediaPatched.replace(anchor, attachmentKeys + '\n]);');
    const kindAnchor = 'if (key === "width" || key === "height") return asPositiveFiniteNumber(entry) !== void 0;';
    if (mediaPatched.includes(kindAnchor)) mediaPatched = mediaPatched.replace(kindAnchor, `${kindAnchor}\n\t\t\tif (key === "forceDocument") return entry === true;`);
  }
  const artifactAnchor = '...detailsMedia.trustedLocalMedia === true ? { trustedLocalMedia: true } : {}\n\t\t};';
  if (!mediaPatched.includes(artifactAnchor)) throw new Error(`media artifact anchor changed in ${mediaPath}`);
  mediaPatched = mediaPatched.replace(artifactAnchor, '...detailsMedia.trustedLocalMedia === true ? { trustedLocalMedia: true } : {},\n\t\t\t...detailsMedia.forceDocument === true ? { forceDocument: true } : {}\n\t\t};');
  await writeFile(mediaPath, `${mediaPatched}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_MEDIA=applied');
} else console.log('TOOL_DOCUMENT_MEDIA=already-applied');

const executeOriginal = await readFile(executePath, 'utf8');
if (!executeOriginal.includes(MARKER)) {
  let executePatched = executeOriginal.replace('let toolTrustedLocalMedia = false;', 'let toolTrustedLocalMedia = false;\n\tlet toolForceDocument = false;');
  executePatched = executePatched.replace('toolTrustedLocalMedia ||= artifact?.trustedLocalMedia === true;', 'toolTrustedLocalMedia ||= artifact?.trustedLocalMedia === true;\n\t\t\t\t\t\ttoolForceDocument ||= artifact?.forceDocument === true;');
  executePatched = executePatched.replace('\t\ttoolTrustedLocalMedia,\n\t\tacceptedSessionSpawns', '\t\ttoolTrustedLocalMedia,\n\t\ttoolForceDocument,\n\t\tacceptedSessionSpawns');
  executePatched = executePatched.replace('...current.toolTrustedLocalMedia ? { toolTrustedLocalMedia: true } : {},', '...current.toolTrustedLocalMedia ? { toolTrustedLocalMedia: true } : {},\n\t\t\t\t...current.toolForceDocument ? { toolForceDocument: true } : {},');
  await writeFile(executePath, `${executePatched}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_EXECUTE=applied');
} else console.log('TOOL_DOCUMENT_EXECUTE=already-applied');

const embeddedOriginal = await readFile(embeddedPath, 'utf8');
if (!embeddedOriginal.includes(MARKER)) {
  const embeddedPatched = embeddedOriginal.replace('toolTrustedLocalMedia: attempt.toolTrustedLocalMedia,', 'toolTrustedLocalMedia: attempt.toolTrustedLocalMedia,\n\t\ttoolForceDocument: attempt.toolForceDocument,');
  if (embeddedPatched === embeddedOriginal) throw new Error(`embedded agent anchor changed in ${embeddedPath}`);
  await writeFile(embeddedPath, `${embeddedPatched}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_EMBEDDED=applied');
} else console.log('TOOL_DOCUMENT_EMBEDDED=already-applied');

const payloadOriginal = await readFile(payloadPath, 'utf8');
if (!payloadOriginal.includes(MARKER)) {
  const anchor = 'trustedLocalMedia: params.toolTrustedLocalMedia || void 0';
  if (!payloadOriginal.includes(anchor)) throw new Error(`tool payload anchor changed in ${payloadPath}`);
  let payloadPatched = payloadOriginal.replace(anchor, `${anchor},\n\t\tforceDocument: params.toolForceDocument || void 0`);
  payloadPatched = payloadPatched.replace('extractMediaDirectives: false,', 'extractMediaDirectives: true,');
  payloadPatched = payloadPatched.replace('text: selected.text', 'text: selected.text.replace(/\\n\\s*\\{\\s*"(?:visibleText|modality)"\\s*:[\\s\\S]*\\}\\s*$/u, "")');
  await writeFile(payloadPath, `${payloadPatched}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_PAYLOAD=applied');
} else console.log('TOOL_DOCUMENT_PAYLOAD=already-applied');

const deliverOriginal = await readFile(deliverPath, 'utf8');
if (!deliverOriginal.includes(MARKER)) {
  const before = 'const payloadCtx = {\n\t\t\t\t...resolveCtx(overrides),\n\t\t\t\tkind: "payload",\n\t\t\t\ttext: payload.text ?? "",\n\t\t\t\tmediaUrl: payload.mediaUrl,\n\t\t\t\tpayload\n\t\t\t};';
  const after = 'const resolvedContext = resolveCtx(overrides);\n\t\t\tconst payloadCtx = {\n\t\t\t\t...resolvedContext,\n\t\t\t\tkind: "payload",\n\t\t\t\tforceDocument: payload.forceDocument === true || resolvedContext.forceDocument === true,\n\t\t\t\ttext: payload.text ?? "",\n\t\t\t\tmediaUrl: payload.mediaUrl,\n\t\t\t\tpayload\n\t\t\t};';
  if (!deliverOriginal.includes(before)) throw new Error(`delivery payload anchor changed in ${deliverPath}`);
  await writeFile(deliverPath, `${deliverOriginal.replace(before, after)}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_DELIVERY=applied');
} else console.log('TOOL_DOCUMENT_DELIVERY=already-applied');

const builtinOriginal = await readFile(builtinPath, 'utf8');
if (!builtinOriginal.includes(MARKER)) {
  let builtinPatched = builtinOriginal;
  builtinPatched = builtinPatched.replaceAll('state.pendingToolAudioAsVoice = false;', 'state.pendingToolAudioAsVoice = false;\n\tstate.pendingToolForceDocument = false;');
  builtinPatched = builtinPatched.replace('if (mediaReply.audioAsVoice) ctx.state.pendingToolAudioAsVoice = true;', 'if (mediaReply.audioAsVoice) ctx.state.pendingToolAudioAsVoice = true;\n\tif (mediaReply.forceDocument) ctx.state.pendingToolForceDocument = true;');
  builtinPatched = builtinPatched.replaceAll('audioAsVoice: state.pendingToolAudioAsVoice || void 0,', 'audioAsVoice: state.pendingToolAudioAsVoice || void 0,\n\t\tforceDocument: state.pendingToolForceDocument || void 0,');
  const selectedPayloadBefore = 'const selectedPayload = allSelectedMediaIsPending && (payload.mediaUrls ?? []).every((url) => state.pendingToolMediaTrustByUrl.get(url.trim()) === true) ? {\n\t\t\t...payloadWithMetadata,\n\t\t\ttrustedLocalMedia: true\n\t\t} : payloadWithMetadata;';
  const selectedPayloadAfter = 'const payloadWithForceDocument = state.pendingToolForceDocument ? { ...payloadWithMetadata, forceDocument: true } : payloadWithMetadata;\n\t\tconst selectedPayload = allSelectedMediaIsPending && (payload.mediaUrls ?? []).every((url) => state.pendingToolMediaTrustByUrl.get(url.trim()) === true) ? {\n\t\t\t...payloadWithForceDocument,\n\t\t\ttrustedLocalMedia: true\n\t\t} : payloadWithForceDocument;';
  if (!builtinPatched.includes(selectedPayloadBefore)) throw new Error(`builtin selected-media anchor changed in ${builtinPath}`);
  builtinPatched = builtinPatched.replace(selectedPayloadBefore, selectedPayloadAfter);
  const consumeAnchor = 'function consumePendingToolMediaIntoReply(state, payload) {\n\tif (payload.isReasoning) return payload;';
  const consumeReplacement = 'function stripPendingToolMediaStructuredTail(text) {\n\treturn text.replace(/^\\s*MEDIA:\\s*[^\\n]+\\n*/iu, "").replace(/\\n\\s*\\{\\s*"(?:visibleText|modality)"\\s*:[\\s\\S]*\\}\\s*$/u, "").trim();\n}\nfunction consumePendingToolMediaIntoReply(state, payload) {\n\tif (payload.isReasoning) return payload;\n\tif (typeof payload.text === "string") payload = { ...payload, text: stripPendingToolMediaStructuredTail(payload.text) };';
  if (!builtinPatched.includes(consumeAnchor)) throw new Error(`builtin pending media anchor changed in ${builtinPath}`);
  builtinPatched = builtinPatched.replace(consumeAnchor, consumeReplacement);
  const mergedForceAnchor = 'audioAsVoice: payload.audioAsVoice || state.pendingToolAudioAsVoice || void 0,\n\t\t...payload.trustedLocalMedia || allPendingMediaTrusted ? { trustedLocalMedia: true } : {}';
  const mergedForceReplacement = 'audioAsVoice: payload.audioAsVoice || state.pendingToolAudioAsVoice || void 0,\n\t\tforceDocument: state.pendingToolForceDocument || void 0,\n\t\t...payload.trustedLocalMedia || allPendingMediaTrusted ? { trustedLocalMedia: true } : {}';
  if (!builtinPatched.includes(mergedForceAnchor)) throw new Error(`builtin merged media anchor changed in ${builtinPath}`);
  builtinPatched = builtinPatched.replace(mergedForceAnchor, mergedForceReplacement);
  builtinPatched = builtinPatched.replace('state.pendingToolAudioAsVoice ||= payload.audioAsVoice === true;', 'state.pendingToolAudioAsVoice ||= payload.audioAsVoice === true;\n\tstate.pendingToolForceDocument ||= payload.forceDocument === true;');
  builtinPatched = builtinPatched.replace('toolTrustedLocalMedia: pendingToolMediaReply?.trustedLocalMedia,', 'toolTrustedLocalMedia: pendingToolMediaReply?.trustedLocalMedia,\n\t\ttoolForceDocument: pendingToolMediaReply?.forceDocument,');
  builtinPatched = builtinPatched.replaceAll('pendingToolAudioAsVoice: false,', 'pendingToolAudioAsVoice: false,\n\t\tpendingToolForceDocument: false,');
  if (builtinPatched === builtinOriginal) throw new Error(`builtin tool media anchors changed in ${builtinPath}`);
  await writeFile(builtinPath, `${builtinPatched}\n// ${MARKER}\n`);
  console.log('TOOL_DOCUMENT_BUILTIN=applied');
} else console.log('TOOL_DOCUMENT_BUILTIN=already-applied');

await stat(mediaPath);
