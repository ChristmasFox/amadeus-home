#!/usr/bin/env node
// Version-pinned native image route authority plus accepted/success/failure
// lifecycle integration for OpenClaw 2026.9.4 task boundaries.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, chmod, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyImageGenerationFailure, failureText, installImageRouteAuthorityModules, patchImageGenerationToolSource } from './image-route-authority.mjs';
import { installCompletionCaptionModule } from './completion-caption.mjs';

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
  ${failureText.toString()}
  ${classifyImageGenerationFailure.toString()}
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
      requestContext: params.handle.taskLabel,
      ...(params.status === "error" ? { failureReason: classifyImageGenerationFailure(params.result) } : {})
    };
    if (params.status === "error") {
      if (typeof boundary.failImageGeneration !== "function") throw new Error("amadeus_image_failure_boundary_unavailable");
      await boundary.failImageGeneration(input);
      return { status: "delivered" };
    }
    if (typeof boundary.completeImageGeneration !== "function") throw new Error("amadeus_image_completion_boundary_unavailable");
    const completion = await boundary.completeImageGeneration({ ...input, attachments: params.attachments ?? [] });
    if (completion && Array.isArray(completion.completionImages)) params.amadeusCompletionImages = completion.completionImages;
    params.amadeusCompletionBoundary = boundary;
    params.amadeusCompletionInput = input;
    // Amadeus owns the generated attachment's one and only channel send. Keep
    // the native wake path alive for task_completion/completion-agent semantics,
    // but remove media primitives before the native announcement so the image
    // cannot be sent a second time. The native function still sees status,
    // result, and completion metadata and can settle the requester task.
    params.attachments = [];
    params.mediaUrls = [];
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
  anchoredFunction(ast, 'wakeMediaGenerationTaskCompletion');
  anchoredFunction(ast, 'notifyMediaGenerationAsyncTaskStarted');
  if (createHash('sha256').update(original).digest('hex') !== CORE_PIN.sha256) throw new Error('pinned_image_completion_digest_mismatch');
  let routePatched = patchImageGenerationToolSource(original);
  const handoffDeadlineThrow = `if (remainingMs <= 0) throw new Error("cron continuation did not become ready before the handoff deadline");`;
  if (routePatched.split(handoffDeadlineThrow).length - 1 !== 1) throw new Error('pinned_image_completion_handoff_deadline_anchor_mismatch');
  routePatched = routePatched.replace(handoffDeadlineThrow,
    `if (remainingMs <= 0) {
			try { await params.onTimeout?.(); } catch { /* Amadeus media fallback is best effort. */ }
			throw new Error("cron continuation did not become ready before the handoff deadline");
		}`);
  const successfulCompletionRetryAnchor = `beforeRetry: recordCompletionDeliveryProgress
			})).status`;
  if (routePatched.split(successfulCompletionRetryAnchor).length - 1 !== 1) throw new Error('pinned_image_completion_retry_anchor_mismatch');
  routePatched = routePatched.replace(successfulCompletionRetryAnchor,
    `beforeRetry: recordCompletionDeliveryProgress,
				onTimeout: async () => {
					const fallback = globalThis.__amadeusImageCompletionFallbacks20261002?.get(params.handle?.taskId);
					if (fallback?.run) await fallback.run();
				}
			})).status`);
  const completionCall = `const delivery = await deliverSubagentAnnouncement({`;
  if (routePatched.split(completionCall).length - 1 !== 1) throw new Error('pinned_image_completion_delivery_anchor_mismatch');
  let completionPatched = routePatched.replace(completionCall,
    `${completionCall}\n\t\timages: params.amadeusCompletionImages,\n\t\trequireDirectDelivery: params.toolName === "image_generate" && params.status === "ok",`);
  const completionCallStart = completionPatched.indexOf('const delivery = await deliverSubagentAnnouncement({');
  const completionCallEnd = completionPatched.indexOf('\n\t});', completionCallStart);
  if (completionCallStart < 0 || completionCallEnd < completionCallStart) throw new Error('pinned_image_completion_delivery_close_mismatch');
  const completionCallSource = completionPatched.slice(completionCallStart, completionCallEnd + '\n\t});'.length).replace('const delivery = await', 'delivery = await');
  completionPatched = completionPatched.slice(0, completionCallStart)
    + `let delivery;\n\ttry {\n\t\t${completionCallSource.replaceAll('\n', '\n\t\t')}\n\t} catch (error) {\n\t\tif (params.amadeusCompletionBoundary && params.amadeusCompletionInput && typeof params.amadeusCompletionBoundary.finishImageGeneration === "function") {\n\t\t\ttry { await params.amadeusCompletionBoundary.finishImageGeneration(params.amadeusCompletionInput); } catch { /* preserve the native error */ }\n\t\t}\n\t\tthrow error;\n\t}`
    + completionPatched.slice(completionCallEnd + '\n\t});'.length);
  const completionReturn = `\tif (delivery.delivered) return { status: "delivered" };`;
  if (completionPatched.split(completionReturn).length - 1 !== 1) throw new Error('pinned_image_completion_result_anchor_mismatch');
  completionPatched = completionPatched.replace(completionReturn,
    `\tconst completionFallbacks = globalThis.__amadeusImageCompletionFallbacks20261002 ??= new Map();
\tconst completionTaskKey = params.handle?.taskId;
\tif (delivery.disposition === "session_queued" || delivery.reason === "completion_handoff_pending") {
\t\tif (completionTaskKey && params.amadeusCompletionBoundary && params.amadeusCompletionInput && typeof params.amadeusCompletionBoundary.finishImageGeneration === "function") {
\t\t\tcompletionFallbacks.set(completionTaskKey, {
\t\t\t\trun: async () => {
\t\t\t\t\tif (!completionFallbacks.has(completionTaskKey)) return;
\t\t\t\t\tcompletionFallbacks.delete(completionTaskKey);
\t\t\t\t\ttry { await params.amadeusCompletionBoundary.finishImageGeneration(params.amadeusCompletionInput); } catch { /* fallback delivery is best effort; native task state remains authoritative */ }
\t\t\t\t}
\t\t\t});
\t\t}
\t} else if (completionTaskKey) {
\t\tcompletionFallbacks.delete(completionTaskKey);
\t}
\tif (!delivery.delivered && delivery.disposition !== "session_queued" && delivery.reason !== "completion_handoff_pending" && params.amadeusCompletionBoundary && params.amadeusCompletionInput && typeof params.amadeusCompletionBoundary.finishImageGeneration === "function") {
\t\tif (completionTaskKey) completionFallbacks.delete(completionTaskKey);
\t\ttry { await params.amadeusCompletionBoundary.finishImageGeneration(params.amadeusCompletionInput); } catch { /* fallback delivery is best effort; native task state remains authoritative */ }
\t}
${completionReturn}`);
  const routeAst = parse(completionPatched);
  const completionNode = anchoredFunction(routeAst, 'wakeMediaGenerationTaskCompletion');
  let output = completionPatched.slice(0, completionNode.body.start + 1) + terminal + completionPatched.slice(completionNode.body.start + 1);
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
  const routeModules = await installImageRouteAuthorityModules(root);
  const completionModule = await installCompletionCaptionModule(root);
  const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.lifecycle-tmp`;
  await writeFile(temporary, output); await chmod(temporary, mode); await rename(temporary, path);
  console.log(`IMAGE_GENERATION_LIFECYCLE=installed; host=2026.9.4; accepted=typed; terminal=typed; image-route-authority=${routeModules}; completion-caption=${completionModule}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
