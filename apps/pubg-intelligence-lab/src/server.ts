import { startServer } from './server/server.js';

void startServer().then(({ url }) => {
  process.stdout.write(`PUBG_INTELLIGENCE_LAB_URL=${url}\n`);
}).catch(() => {
  process.stderr.write('PUBG_INTELLIGENCE_LAB_START_FAILED\n');
  process.exitCode = 1;
});
