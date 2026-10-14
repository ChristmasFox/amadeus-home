import { readFileSync } from 'node:fs';

/**
 * Public-safe verbatim extract from the private runtime's
 * /DATA/AppData/openclaw/workspace/SOUL.md, section "说话方式".
 * The source sentence naming the private assistant was excluded; the remaining
 * style text is kept verbatim and protected by public-agent-soul.test.ts.
 * This module reads the checked-in public copy, never the private runtime.
 */
export const PUBLIC_AGENT_SOUL_STYLE = readFileSync(
  new URL('./public-agent-soul.md', import.meta.url),
  'utf8',
).trim();
