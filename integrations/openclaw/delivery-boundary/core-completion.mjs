#!/usr/bin/env node
// One version-pinned image-generation lifecycle integration: accepted, success,
// and failure are emitted from typed OpenClaw 2026.9.4 task boundaries.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_PIN = Object.freeze({
  version: '2026.9.4', module: 'openclaw-tools-Bo9W_tg_.mjs',
  sha256: 'f8d27b259dbb9bc4ffd491c3e756004d35433974653e488682fc8369080e4124',
});
const boundaryGlobal = 'globalThis.__amadeusDeliveryBoundaryV2_20260930';
const accepted = `
  if (params.toolName === "image_generate" && params.handle) {
    const boundary = ${boundaryGlobal};
    if (boundary && boundary.version === 2 && typeof boundary.acceptImageGeneration === "function") {
      try {
        await boundary.acceptImageGeneration({
          taskId: params.handle.taskId,
          sessionKey: params.handle.requesterSessionKey,
          requesterAgentId: params.handle.requesterAgentId,
          channel: params.handle.requesterOrigin?.channel,
          accountId: params.handle.requesterOrigin?.accountId,
          conversationId: params.handle.requesterOrigin?.to,
          threadId: params.handle.requesterOrigin?.threadId,
          requestContext: params.handle.taskLabel
        });
      } catch {
        // Accepted-notification failure must never cancel the already-scheduled job.
      }
    }
  }
`;
const terminal = `
  if (params.eventSource === "image_generation" && params.toolName === "image_generate" &&
      (params.status === "ok" || params.status === "error") && params.handle &&
      (params.handle.requesterOrigin?.channel === "whatsapp" || params.handle.requesterOrigin?.channel === "telegram")) {
    const boundary = ${boundaryGlobal};
    if (!boundary || boundary.version !== 2) throw new Error("amadeus_image_lifecycle_boundary_unavailable");
    const input = {
      taskId: params.handle.taskId,
      sessionKey: params.handle.requesterSessionKey,
      requesterAgentId: params.handle.requesterAgentId,
      channel: params.handle.requesterOrigin.channel,
      accountId: params.handle.requesterOrigin.accountId,
      conversationId: params.handle.requesterOrigin.to,
      threadId: params.handle.requesterOrigin.threadId,
      requestContext: params.handle.taskLabel
    };
    if (params.status === "error") {
      if (typeof boundary.failImageGeneration !== "function") throw new Error("amadeus_image_failure_boundary_unavailable");
      await boundary.failImageGeneration(input);
      return { status: "delivered" };
    }
    if (typeof boundary.completeImageGeneration !== "function") throw new Error("amadeus_image_completion_boundary_unavailable");
    await boundary.completeImageGeneration({ ...input, attachments: params.attachments ?? [] });
    return { status: "delivered" };
  }
`;

export function assertPinnedCoreVersion(version) {
  if (version !== CORE_PIN.version) throw new Error('pinned_openclaw_version_mismatch');
}

function anchoredFunction(ast, name) {
  const nodes = ast.body.filter((node) => node.type === 'FunctionDeclaration' && node.id?.name === name);
  if (nodes.length !== 1) throw new Error(`pinned_image_lifecycle_${name}_anchor_mismatch`);
  return nodes[0];
}

export function installCoreCompletionSource(original, hostRoot) {
  const acorn = createRequire(join(resolve(hostRoot), 'package.json'))('acorn');
  const parse = (source) => acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const ast = parse(original);
  const completionNode = anchoredFunction(ast, 'wakeMediaGenerationTaskCompletion');
  const acceptedNode = anchoredFunction(ast, 'notifyMediaGenerationAsyncTaskStarted');
  if (createHash('sha256').update(original).digest('hex') !== CORE_PIN.sha256) throw new Error('pinned_image_completion_digest_mismatch');
  let output = original.slice(0, completionNode.body.start + 1) + terminal + original.slice(completionNode.body.start + 1);
  const outputAst = parse(output);
  const outputAcceptedNode = anchoredFunction(outputAst, 'notifyMediaGenerationAsyncTaskStarted');
  output = output.slice(0, outputAcceptedNode.body.start + 1) + accepted + output.slice(outputAcceptedNode.body.start + 1);
  parse(output);
  return output;
}
export async function main(argv = process.argv.slice(2)) {
  const root = argv.includes('--host-root') ? argv[argv.indexOf('--host-root') + 1] : '/app';
  assertPinnedCoreVersion(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  const path = join(root, 'dist', CORE_PIN.module);
  const output = installCoreCompletionSource(await readFile(path, 'utf8'), root);
  if (!argv.includes('--apply')) { console.log('IMAGE_GENERATION_LIFECYCLE=plan'); return; }
  const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.lifecycle-tmp`;
  await writeFile(temporary, output); await chmod(temporary, mode); await rename(temporary, path);
  console.log('IMAGE_GENERATION_LIFECYCLE=installed; host=2026.9.4; accepted=typed; terminal=typed');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
