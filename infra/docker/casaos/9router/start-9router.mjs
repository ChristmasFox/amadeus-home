#!/usr/bin/env node
// Run the repository-owned deterministic STT protocol adapter alongside 9Router.
// Exit if either process exits so Docker restart/health can recover both together.
import { spawn } from 'node:child_process';
const requiredChildren = [
  // Node 22's built-in fetch does not honor HTTPS_PROXY by default. Scope the
  // existing host proxy to ASR only; packaged 9Router keeps its separate
  // transport policy and does not inherit this Node-wide opt-in. NO_PROXY
  // still covers container-loopback routes.
  spawn(process.execPath, ['/opt/amadeus/asr-bridge.mjs'], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  }),
  spawn(process.execPath, ['/usr/local/lib/node_modules/9router/app/custom-server.js'], { stdio: 'inherit' }),
];
// TTS is an optional sidecar during the staged migration.  A missing cloud
// secret or a bridge crash must not take the existing ASR adapter offline.
const optionalChildren = process.env.AMADEUS_TTS_BRIDGE_ENABLED === '1'
  ? [spawn(process.execPath, ['/opt/amadeus/tts-bridge.mjs'], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } })]
  : [];
const children = [...requiredChildren, ...optionalChildren];
let ending = false;
const stop = (signal) => {
  if (ending) return;
  ending = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
for (const child of children) {
  child.on('error', () => {
    if (requiredChildren.includes(child)) {
      stop('SIGTERM');
      process.exitCode = 1;
    } else {
      console.error('optional tts bridge spawn failed');
    }
  });
  child.on('exit', (code) => {
    if (ending) return;
    const required = requiredChildren.includes(child);
    if (required) {
      stop('SIGTERM');
      process.exitCode = code === 0 ? 0 : 1;
    } else {
      // Keep the router and ASR process alive for diagnosis/rollback.  The
      // route returns a normal provider failure until the bridge is repaired.
      console.error(`optional tts bridge exited code=${code ?? 'signal'}`);
    }
  });
}
