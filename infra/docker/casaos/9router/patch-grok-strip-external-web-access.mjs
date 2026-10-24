#!/usr/bin/env node
// Grok CLI (cli-chat-proxy) rejects:
// 1) tools[].external_web_access (Codex live web_search), even when false
// 2) reasoning items that keep content:null alongside encrypted_content
//    ("Could not decode the compaction blob...")
import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MARKER = "amadeus-grok-strip-extweb-0.5.104";
export const REASONING_MARKER = "amadeus-grok-reasoning-content-0.5.104";
export const VERSION = "0.5.104";
const HOSTED_HINT = 'new Set(["web_search","x_search","web_search_preview","file_search","image_generation","code_interpreter","mcp","local_shell"])';
const NEEDLE1 = "if(r.has(d))return c.add(d),!0;";
const REPL1 =
  "if(r.has(d))return c.add(d),delete a.external_web_access/* " + MARKER + " */,!0;";
const NEEDLE1_APPLIED =
  "if(r.has(d))return c.add(d),delete a.external_web_access,!0;";
const NEEDLE2 =
  'if(!("function"===d||""===d||a.function||"string"==typeof a.name)||r.has(d))return r.has(d);';
const REPL2 =
  'if(!("function"===d||""===d||a.function||"string"==typeof a.name)||r.has(d))return r.has(d)&&(delete a.external_web_access/* ' +
  MARKER +
  ' */,!0);';
const NEEDLE2_APPLIED =
  'if(!("function"===d||""===d||a.function||"string"==typeof a.name)||r.has(d))return r.has(d)&&(delete a.external_web_access,!0);';

const REASONING_NEEDLE =
  'if("reasoning"===a.type)return A(a.id)&&"string"==typeof a.encrypted_content?c:null;';
const REASONING_REPL =
  'if("reasoning"===a.type){if(!A(a.id)||"string"!=typeof a.encrypted_content)return null;/* ' +
  REASONING_MARKER +
  ' */delete c.content;Array.isArray(c.summary)||(c.summary=[]);return c;}';

async function filesUnder(root) {
  const output = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith(".js")) output.push(path);
    }
  }
  await walk(root);
  return output;
}

export function patchGrokStripExtwebSource(source) {
  let out = source;
  if (!out.includes(MARKER) && out.includes(HOSTED_HINT)) {
    if (out.includes(NEEDLE1)) {
      const count = out.split(NEEDLE1).length - 1;
      if (count !== 1) throw new Error(`grok_strip_extweb_needle1_drift:${count}`);
      out = out.replace(NEEDLE1, REPL1);
    } else if (out.includes(NEEDLE1_APPLIED)) {
      out = out.replace(NEEDLE1_APPLIED, REPL1);
    }
    if (out.includes(NEEDLE2)) out = out.replace(NEEDLE2, REPL2);
    else if (out.includes(NEEDLE2_APPLIED)) out = out.replace(NEEDLE2_APPLIED, REPL2);
  }
  if (!out.includes(REASONING_MARKER) && out.includes(REASONING_NEEDLE)) {
    const count = out.split(REASONING_NEEDLE).length - 1;
    if (count !== 1) throw new Error(`grok_reasoning_content_drift:${count}`);
    out = out.replace(REASONING_NEEDLE, REASONING_REPL);
  }
  return out;
}

async function findCandidates(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, "utf8");
    const relevant =
      source.includes(HOSTED_HINT) ||
      source.includes(REASONING_NEEDLE) ||
      source.includes(MARKER) ||
      source.includes(REASONING_MARKER);
    if (!relevant) continue;
    if (
      source.includes(NEEDLE1) ||
      source.includes(NEEDLE1_APPLIED) ||
      source.includes(REPL1) ||
      source.includes(REASONING_NEEDLE) ||
      source.includes(REASONING_REPL) ||
      source.includes(MARKER) ||
      source.includes(REASONING_MARKER)
    ) {
      candidates.push({ path, source });
    }
  }
  return candidates;
}

export async function install(root, mode = "verify", { checkVersion = true } = {}) {
  const packageJsonPath = join(root, "package.json");
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (checkVersion && packageJson.version !== VERSION) {
      throw new Error(`9router_version_mismatch:${packageJson.version}`);
    }
  } catch (err) {
    if (checkVersion) throw err;
  }
  const candidates = await findCandidates(root);
  if (candidates.length < 1) throw new Error("grok_strip_extweb_bundle_count:0");
  const touched = [];
  for (const candidate of candidates) {
    const output = patchGrokStripExtwebSource(candidate.source);
    if (mode === "verify") {
      if (!candidate.source.includes(MARKER) || !candidate.source.includes(REASONING_MARKER)) {
        throw new Error(`grok_strip_extweb_not_installed:${candidate.path}`);
      }
      touched.push(candidate.path);
      continue;
    }
    if (output === candidate.source) {
      if (!candidate.source.includes(MARKER) || !candidate.source.includes(REASONING_MARKER)) {
        throw new Error(`grok_strip_extweb_unchanged:${candidate.path}`);
      }
      touched.push(candidate.path);
      continue;
    }
    const permissions = (await stat(candidate.path)).mode & 0o777;
    await writeFile(candidate.path, output);
    await chmod(candidate.path, permissions);
    const verify = await readFile(candidate.path, "utf8");
    if (
      !verify.includes(MARKER) ||
      !verify.includes(REASONING_MARKER) ||
      patchGrokStripExtwebSource(verify) !== verify
    ) {
      throw new Error(`grok_strip_extweb_verify_failed:${candidate.path}`);
    }
    touched.push(candidate.path);
  }
  return touched;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[process.argv.indexOf("--root") + 1];
  if (!root) {
    throw new Error("usage: patch-grok-strip-external-web-access.mjs --root PATH [--apply] [--allow-version-drift]");
  }
  const paths = await install(root, process.argv.includes("--apply") ? "apply" : "verify", {
    checkVersion: !process.argv.includes("--allow-version-drift"),
  });
  console.log(
    `9ROUTER_GROK_STRIP_EXTWEB=${process.argv.includes("--apply") ? "installed" : "verified"}:${paths.join(",")}`
  );
}
