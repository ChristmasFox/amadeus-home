#!/usr/local/bin/node.glibc
// Executed only as /usr/bin/ffmpeg or /usr/bin/ffprobe in the immutable image.
// The Gateway Node process needs private glibc for Longbridge, but Debian
// media binaries must not inherit that LD_LIBRARY_PATH.
const { spawn } = require('node:child_process');
const { basename } = require('node:path');
const command = basename(process.argv[1] || '');
if (command !== 'ffmpeg' && command !== 'ffprobe') {
  process.stderr.write('Unexpected media helper entrypoint\n');
  process.exit(127);
}
const env = { ...process.env };
delete env.LD_LIBRARY_PATH;
const child = spawn(`/usr/libexec/amadeus/${command}.real`, process.argv.slice(2), {
  env,
  stdio: 'inherit',
});
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}
child.on('error', () => {
  process.stderr.write('Media helper unavailable\n');
  process.exitCode = 127;
});
child.on('close', (code, signal) => {
  process.exitCode = signal ? 128 : (code ?? 127);
});
