#!/usr/bin/env node
// Codex live web_search sets tools[].external_web_access. Grok CLI rejects that
// field (even when false). Hosted tools are passed through as-is in the compiled
// Responses allowlist filter; strip the key before upstream.
import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MARKER = "amadeus-grok-strip-extweb-0.5.104";
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
  if (source.includes(MARKER)) return source;
  if (!source.includes(HOSTED_HINT)) return source;
  let out = source;
  if (out.includes(NEEDLE1)) {
    const count = out.split(NEEDLE1).length - 1;
    if (count !== 1) throw new Error(`grok_strip_extweb_needle1_drift:${count}`);
    out = out.replace(NEEDLE1, REPL1);
  } else if (out.includes(NEEDLE1_APPLIED)) {
    out = out.replace(NEEDLE1_APPLIED, REPL1);
  } else if (!out.includes(REPL1)) {
    return source;
  }
  if (out.includes(NEEDLE2)) {
    out = out.replace(NEEDLE2, REPL2);
  } else if (out.includes(NEEDLE2_APPLIED)) {
    out = out.replace(NEEDLE2_APPLIED, REPL2);
  }
  return out;
}

async function findCandidates(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, "utf8");
    if (!source.includes(HOSTED_HINT) && !source.includes(MARKER)) continue;
    if (
      source.includes(NEEDLE1) ||
      source.includes(NEEDLE1_APPLIED) ||
      source.includes(REPL1) ||
      source.includes(MARKER)
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
      if (!candidate.source.includes(MARKER)) {
        throw new Error(`grok_strip_extweb_not_installed:${candidate.path}`);
      }
      touched.push(candidate.path);
      continue;
    }
    if (output === candidate.source) {
      if (!candidate.source.includes(MARKER) && !candidate.source.includes("delete a.external_web_access")) {
        throw new Error(`grok_strip_extweb_unchanged:${candidate.path}`);
      }
      touched.push(candidate.path);
      continue;
    }
    const permissions = (await stat(candidate.path)).mode & 0o777;
    await writeFile(candidate.path, output);
    await chmod(candidate.path, permissions);
    const verify = await readFile(candidate.path, "utf8");
    if (!verify.includes(MARKER) || patchGrokStripExtwebSource(verify) !== verify) {
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
