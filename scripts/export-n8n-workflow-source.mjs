#!/usr/bin/env node
/**
 * Create a Git-safe n8n workflow source from an exported workflow JSON.
 *
 * n8n's workflow export can include pinned execution data and instance-only
 * metadata. Neither belongs in Git. Credential references are preserved so a
 * target instance can rebind them, while credential values are never exported.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

function usage() {
  console.error('Usage: node scripts/export-n8n-workflow-source.mjs <input.json> <output.json>');
  process.exit(2);
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) usage();

const parsed = JSON.parse(readFileSync(resolve(inputPath), 'utf8'));
const input = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('workflow export must be one workflow object');
if (!Array.isArray(input.nodes) || !input.connections || typeof input.connections !== 'object') {
  throw new Error('workflow export is missing nodes or connections');
}

const workflow = {
  id: String(input.id ?? ''),
  name: String(input.name ?? ''),
  nodes: input.nodes,
  connections: input.connections,
  active: Boolean(input.active),
  settings: input.settings && typeof input.settings === 'object' && !Array.isArray(input.settings) ? input.settings : {},
  pinData: {},
  meta: { templateCredsSetupCompleted: false },
  description: 'Git-managed source exported from the live n8n workflow. Credentials must be rebound in the target instance; pinData and execution data are intentionally excluded.',
};

if (!workflow.id || !workflow.name) throw new Error('workflow export is missing id or name');

mkdirSync(dirname(resolve(outputPath)), { recursive: true });
writeFileSync(resolve(outputPath), `${JSON.stringify(workflow, null, 2)}\n`, { mode: 0o644 });
console.log(`N8N_WORKFLOW_SOURCE_EXPORTED id=${workflow.id} name=${workflow.name} nodes=${workflow.nodes.length}`);
