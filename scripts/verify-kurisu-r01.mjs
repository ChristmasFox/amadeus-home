import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/u, '');
const read = (relative) => readFileSync(join(root, relative), 'utf8');
const checks = [];

function check(id, passed, evidence) {
  checks.push({ id, status: passed ? 'PASS' : 'FAIL', evidence });
}

const gatewaySource = read('apps/agent-runtime/src/kurisu/gateway.ts');
const structuredEntry = read('apps/agent-runtime/src/kurisu/structured-entry.ts');
const toolRegistry = read('apps/agent-runtime/src/kurisu/tools.ts');
const domainTools = read('apps/agent-runtime/src/kurisu/domain-tools.ts');
const codexSource = read('apps/agent-runtime/src/kurisu/codex.ts');
const serverSource = read('apps/agent-runtime/src/server.ts');
const pluginManifest = read('integrations/langbot/plugins/kurisu-gateway/manifest.yaml');
const pluginToolManifest = read('integrations/langbot/plugins/kurisu-gateway/components/tools/kurisu_gateway.yaml');
const pluginSource = read('integrations/langbot/plugins/kurisu-gateway/components/tools/kurisu_gateway.py');
const acceptanceSource = read('apps/agent-runtime/tests/kurisu-acceptance.test.ts');

check(
  'R01-STRUCTURED-ENTRY',
  !/(?:text|message|query)\s*\.(?:includes|startsWith|endsWith)\s*\(/u.test(structuredEntry) && !/\b(?:keyword|synonym|nlu)\b/iu.test(structuredEntry),
  'structured-entry.ts accepts canonical data and contains no text keyword/synonym router',
);

check(
  'R01-GATEWAY-NO-KEYWORD-ROUTE',
  !/(?:text|message|query)\s*\.(?:includes|startsWith|endsWith)\s*\(/u.test(gatewaySource) && !/\b(?:keyword|synonym|nlu)\b/iu.test(gatewaySource),
  'gateway.ts performs normalization, rollout, policy, and typed tool execution only',
);

check(
  'R01-SINGLE-LANGBOT-COMPONENT',
  /^\s*EventListener\s*:/mu.test(pluginManifest) === false
    && /^\s*Command\s*:/mu.test(pluginManifest) === false
    && (pluginManifest.match(/^\s*Tool\s*:/gmu) ?? []).length === 1
    && !/on_(?:message|event)|handle_message|register_command/iu.test(pluginSource),
  'kurisu-gateway exposes one Tool component and no natural-language listener/command hook',
);

check(
  'R01-SINGLE-STRUCTURED-TOOL',
  (pluginToolManifest.match(/^kind:\s*Tool\s*$/gmu) ?? []).length === 1
    && /name:\s*kurisu_gateway/u.test(pluginToolManifest)
    && /Exact server-registered Kurisu capability name/u.test(pluginToolManifest),
  'LangBot host receives one provider-compatible structured gateway with server-registered capability names',
);

check(
  'R01-NO-SECOND-AGENT',
  !/\bnew\s+Agent\s*\(/u.test(gatewaySource + structuredEntry + toolRegistry + domainTools + pluginSource)
    && !/from\s+['"]@mastra\/.*Agent/iu.test(gatewaySource + structuredEntry + domainTools),
  'Kurisu boundary does not construct a second LLM agent or planner',
);

check(
  'R01-NO-GENERIC-SHELL',
  !/\bshell\s*:\s*true\b/u.test(codexSource)
    && !/\bspawn\s*\(\s*['"](?:sh|bash|zsh)['"]/u.test(codexSource)
    && !/\bexec\s*\(\s*['"](?:sh|bash|zsh)['"]/u.test(codexSource),
  'Codex executor has no shell passthrough; its process boundary is the controlled app-server command and fixed git argv calls',
);

check(
  'R01-NO-PSEUDO-COMPLETE',
  /CAPABILITY_UNAVAILABLE/u.test(domainTools)
    && !/\bstatus\s*:\s*['"]success['"]/u.test(domainTools + toolRegistry + codexSource),
  'missing capabilities return an explicit unavailable/error contract rather than an empty success',
);

check(
  'R01-SERVER-FRONT-DOOR',
  /url\.pathname === ['"]\/kurisu\/tool-call['"]/u.test(serverSource)
    && /kurisuService\.executeHostTool\(body\)/u.test(serverSource),
  'server.ts exposes the structured host tool-call front door to KurisuService',
);

check(
  'R01-DYNAMIC-DUMMY-REGISTRATION',
  /name:\s*'kurisu\.dummy\.battery'/u.test(acceptanceSource)
    && /service\.registry\.register\(/u.test(acceptanceSource)
    && /P6-A16-DUMMY-01/u.test(acceptanceSource),
  'A16 is exercised by test-only registration and a previously unseen expression fixture, without prompt edits',
);

let revision = 'unknown';
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // Keep the static report useful in an exported source tree without Git.
}

const result = {
  phase: 'P6',
  check: 'R01',
  status: checks.every(({ status }) => status === 'PASS') ? 'R01_PASS' : 'R01_FAIL',
  revision,
  scope: 'migrated Kurisu gateway, server boundary, Codex executor, and LangBot plugin only',
  checks,
  note: 'This static check supplements behavioral tests; it does not claim real platform or L3 model access.',
};
const outputIndex = process.argv.indexOf('--output');
if (outputIndex >= 0) {
  const outputPath = process.argv[outputIndex + 1];
  if (!outputPath) throw new Error('--output requires a path');
  writeFileSync(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
  console.log(`REPORT_WRITTEN=${resolve(outputPath)}`);
}
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'R01_PASS') process.exitCode = 1;
