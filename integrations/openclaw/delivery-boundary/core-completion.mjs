#!/usr/bin/env node
// The same version-pinned DeliveryEnvelope integration boundary also exposes
// native generated attachments before OpenClaw's optional completion Agent.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_PIN = Object.freeze({
  version: '2026.9.4', module: 'openclaw-tools-Bo9W_tg_.mjs',
  sha256: 'f8d27b259dbb9bc4ffd491c3e756004d35433974653e488682fc8369080e4124',
});
const integration = `
  if (params.eventSource === "image_generation" && params.status === "ok" &&
      (params.handle?.requesterOrigin?.channel === "whatsapp" || params.handle?.requesterOrigin?.channel === "telegram")) {
    const boundary = globalThis.__amadeusDeliveryBoundaryV2_20260930;
    if (!boundary || boundary.version !== 2 || typeof boundary.completeImageGeneration !== "function")
      throw new Error("amadeus_image_completion_boundary_unavailable");
    await boundary.completeImageGeneration({
      taskId: params.handle.taskId,
      sessionKey: params.handle.requesterSessionKey,
      channel: params.handle.requesterOrigin.channel,
      accountId: params.handle.requesterOrigin.accountId,
      conversationId: params.handle.requesterOrigin.to,
      attachments: params.attachments ?? [],
    });
    return { status: "delivered" };
  }
`;
export function installCoreCompletionSource(original, hostRoot) {
  if (createHash('sha256').update(original).digest('hex') !== CORE_PIN.sha256) throw new Error('pinned_image_completion_digest_mismatch');
  const acorn = createRequire(join(resolve(hostRoot), 'package.json'))('acorn');
  const parse = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const nodes = parse(original).body.filter((node) => node.type === 'FunctionDeclaration' && node.id?.name === 'wakeMediaGenerationTaskCompletion');
  if (nodes.length !== 1) throw new Error('pinned_image_completion_function_count_mismatch');
  const output = original.slice(0, nodes[0].body.start + 1) + integration + original.slice(nodes[0].body.start + 1);
  parse(output);
  return output;
}
export async function main(argv = process.argv.slice(2)) {
  const root = argv.includes('--host-root') ? argv[argv.indexOf('--host-root') + 1] : '/app';
  if (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version !== CORE_PIN.version) throw new Error('pinned_openclaw_version_mismatch');
  const path = join(root, 'dist', CORE_PIN.module);
  const output = installCoreCompletionSource(await readFile(path, 'utf8'), root);
  if (!argv.includes('--apply')) { console.log('IMAGE_COMPLETION_BOUNDARY=plan'); return; }
  const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.completion-tmp`;
  await writeFile(temporary, output); await chmod(temporary, mode); await rename(temporary, path);
  console.log('IMAGE_COMPLETION_BOUNDARY=installed; host=2026.9.4; contract=2');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
