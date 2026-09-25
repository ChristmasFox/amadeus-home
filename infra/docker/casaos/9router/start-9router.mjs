#!/usr/bin/env node
// Run the repository-owned deterministic STT protocol adapter alongside 9Router.
// Exit if either process exits so Docker restart/health can recover both together.
import { spawn } from 'node:child_process';
const children = [
  // Node 22's built-in fetch does not honor HTTPS_PROXY by default. Scope the
  // existing host proxy to ASR only; packaged 9Router keeps its own persisted
  // outbound-proxy policy. NO_PROXY still covers container-loopback routes.
  spawn(process.execPath, ['/opt/amadeus/asr-bridge.mjs'], {
    stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  }),
  spawn(process.execPath, ['/usr/local/lib/node_modules/9router/app/custom-server.js'], { stdio: 'inherit' }),
];
let ending = false;
const stop = (signal) => {
  if (ending) return;
  ending = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
};
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
for (const child of children) {
  child.on('error', () => { stop('SIGTERM'); process.exitCode = 1; });
  child.on('exit', (code) => {
    if (!ending) stop('SIGTERM');
    process.exitCode = code === 0 ? 0 : 1;
  });
}
