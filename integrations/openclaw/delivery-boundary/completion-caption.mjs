#!/usr/bin/env node
// Narrow OpenClaw 2026.9.4 overlay: carry trusted native completion images
// into the Completion Agent model input without restoring media delivery.
import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const COMPLETION_CAPTION_PIN = Object.freeze({
  version: '2026.9.4',
  module: 'subagent-announce-delivery-Dcn7g21F.mjs',
  sha256: '11fe7aad923e180df1b73c74886e67c78241e400bd2c954bb294f3c8e085230e',
});
export const COMPLETION_CAPTION_MARKER = 'AMADEUS_NATIVE_COMPLETION_CAPTION_20261002';

function replaceOnce(source, find, replacement, label) {
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`pinned completion caption ${label} anchor count=${count}`);
  return source.replace(find, replacement);
}

export function patchCompletionCaptionSource(original) {
  if (original.includes(COMPLETION_CAPTION_MARKER)) return original;
  if (createHash('sha256').update(original).digest('hex') !== COMPLETION_CAPTION_PIN.sha256) throw new Error('pinned_completion_caption_digest_mismatch');
  let output = original.replace(
    'const directAgentParams = {',
    `const directAgentParams = {\n\t\t\t// ${COMPLETION_CAPTION_MARKER}`,
  );
  output = replaceOnce(output,
    `sourceTool: params.sourceTool ?? "subagent_announce"\n\t\t\t},\n\t\t\t...completionSourceReplyDeliveryMode`,
    `sourceTool: params.sourceTool ?? "subagent_announce"\n\t\t\t},\n\t\t\t...Array.isArray(params.images) && params.images.length ? { images: params.images } : {},\n\t\t\t...completionSourceReplyDeliveryMode`,
    'direct image input',
  );
  output = replaceOnce(output,
    `sourceTool: params.sourceTool,\n\t\t\t\tisSourceSessionEffectsAllowed: params.isSourceSessionEffectsAllowed,`,
    `sourceTool: params.sourceTool,\n\t\t\t\timages: params.images,\n\t\t\t\tisSourceSessionEffectsAllowed: params.isSourceSessionEffectsAllowed,`,
    'direct dispatch image input',
  );
  output = replaceOnce(output,
    `...expectedMedia,\n\t\t\tidempotencyKey: \`\${params.directIdempotencyKey}:agent-loop\``,
    `...expectedMedia,\n\t\t\t...Array.isArray(params.images) && params.images.length ? { images: params.images } : {},\n\t\t\tidempotencyKey: \`\${params.directIdempotencyKey}:agent-loop\``,
    'queued image input',
  );
  return output;
}

export async function installCompletionCaptionModule(coreRoot) {
  const path = join(coreRoot, 'dist', COMPLETION_CAPTION_PIN.module);
  const original = await readFile(path, 'utf8');
  const output = patchCompletionCaptionSource(original);
  const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.completion-caption-tmp`;
  await writeFile(temporary, output); await chmod(temporary, mode); await rename(temporary, path);
  return COMPLETION_CAPTION_PIN.module;
}
