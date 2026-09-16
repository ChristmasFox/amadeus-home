#!/usr/bin/env node
/** Convert the versioned digest workflow from direct LangBot delivery to the
 * Kurisu event ingress. The n8n global CODEX_NOTIFY_SECRET is an existing
 * external secret; it is referenced as an expression and never written here. */
import { readFileSync, writeFileSync } from 'node:fs';

const path = process.argv[2] ?? 'integrations/n8n/workflows/daily-tech-market-digest.workflow.json';
const workflow = JSON.parse(readFileSync(path, 'utf8'));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const split = byName.get('Split Report');
const sender = byName.get('Send KOOK via LangBot');
const record = byName.get('Record Run');
if (!split || !sender || !record) throw new Error('digest workflow is missing its expected delivery nodes');

split.parameters.jsCode = `
const text = String($input.first().json.text || '').trim();
const data = $('Group Events').first().json;
const config = data.context.config;
const maxLength = Math.max(800, Number(config.delivery?.maxMessageLength || 3500));
const paragraphs = text.split(/\\n\\s*\\n/).map((part) => part.trim()).filter(Boolean);
const chunks = [];
let current = '';
for (const paragraph of paragraphs) {
  if (!current) current = paragraph;
  else if ((current + '\\n\\n' + paragraph).length <= maxLength) current += '\\n\\n' + paragraph;
  else { chunks.push(current); current = paragraph; }
}
if (current) chunks.push(current);
if (!chunks.length) chunks.push('本次简报没有可发送内容。');
return chunks.map((chunk, index) => ({
  json: {
    eventType: 'briefing.daily.ready',
    eventKey: 'briefing:' + data.run.runKey + ':part:' + String(index + 1),
    source: 'briefing',
    resultType: 'success',
    occurredAt: new Date().toISOString(),
    payload: {
      summary: chunk,
      runKey: data.run.runKey,
      edition: data.run.edition,
      part: index + 1,
      total: chunks.length,
      sourceCount: Number(data.context.sources?.filter((source) => source.enabled).length || 0),
      selectedCount: Number(data.events?.length || 0),
    },
  },
}));
`;

sender.name = 'Ingest Digest via Kurisu';
sender.parameters = {
  method: 'POST',
  url: 'http://pubg-query-engine-v3:5310/kurisu/notifications/events',
  sendHeaders: true,
  headerParameters: {
    parameters: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Kurisu-Notification-Secret', value: '={{ $vars.CODEX_NOTIFY_SECRET }}' },
    ],
  },
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ $json }}',
  options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } }, timeout: 30000 },
};
delete sender.credentials;
sender.retryOnFail = true;
sender.maxTries = 3;
sender.waitBetweenTries = 2000;

record.parameters.jsCode = String(record.parameters.jsCode)
  .replace("const deliveryResults = results.map((result) => result.body ?? result);", "const deliveryResults = results.map((result) => result.body ?? result);")
  .replace("const successful = deliveryResults.length > 0 && deliveryResults.every((result) => Number(result.statusCode || 200) >= 200 && Number(result.statusCode || 200) < 300 && !result.error);", "const successful = deliveryResults.length > 0 && deliveryResults.every((result) => Number(result.statusCode || 200) >= 200 && Number(result.statusCode || 200) < 300 && !result.error && result.accepted !== false);");

workflow.connections['Split Report'].main[0][0].node = sender.name;
workflow.connections[sender.name] = workflow.connections['Send KOOK via LangBot'];
delete workflow.connections['Send KOOK via LangBot'];
workflow.description = 'Git-managed daily digest producer. It owns scheduling, collection, analysis and run records. Delivery enters the Kurisu event/outbox boundary using an external n8n variable; Runtime is the sole platform sender.';
writeFileSync(path, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`DIGEST_WORKFLOW_MIGRATED id=${workflow.id} sender=${sender.name}`);
