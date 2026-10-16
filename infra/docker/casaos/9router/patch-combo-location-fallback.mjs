#!/usr/bin/env node
// Make Gemini (and similar) location / FAILED_PRECONDITION 400s fall through
// to the next combo model. Upstream 9Router treats most 4xx as terminal
// invalid_request (no fallback) unless the error text matches the t2 table.
import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const MARKER = "amadeus-combo-location-fallback-0.5.104";
export const VERSION = "0.5.104";
const ANCHOR = '{text:"overloaded",backoff:!0}';
const INSERT = '{text:"overloaded",backoff:!0},/* ' + MARKER + ' */{text:"user location is not supported",cooldownMs:3e4},{text:"location is not supported for the api",cooldownMs:3e4},{text:"failed_precondition",cooldownMs:3e4}';
// Prefer the shared retry-table chunk; also accept other webpack copies of t2.
const TABLE_HINT = '{status:404,cooldownMs:12e4}';

async function filesUnder(root) {
  const output = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && path.endsWith(".js")) output.push(path);
    }
  }
  await walk(root);
  return output;
}

export function patchLocationFallbackSource(source) {
  if (source.includes(MARKER)) return source;
  if (!source.includes(TABLE_HINT)) return source;
  const count = source.split(ANCHOR).length - 1;
  if (count === 0) return source;
  if (count !== 1) throw new Error(`combo_location_fallback_anchor_drift:${count}`);
  return source.replace(ANCHOR, INSERT);
}

async function findCandidates(root) {
  const candidates = [];
  for (const path of await filesUnder(root)) {
    const source = await readFile(path, "utf8");
    if (!source.includes(TABLE_HINT) && !source.includes(MARKER)) continue;
    if (source.includes(ANCHOR) || source.includes(MARKER)) candidates.push({ path, source });
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
  if (candidates.length < 1) throw new Error("combo_location_fallback_bundle_count:0");
  const touched = [];
  for (const candidate of candidates) {
    const output = patchLocationFallbackSource(candidate.source);
    if (mode === "verify") {
      if (!candidate.source.includes(MARKER)) {
        throw new Error(`combo_location_fallback_not_installed:${candidate.path}`);
      }
      touched.push(candidate.path);
      continue;
    }
    if (output === candidate.source) {
      touched.push(candidate.path);
      continue;
    }
    const permissions = (await stat(candidate.path)).mode & 0o777;
    await writeFile(candidate.path, output);
    await chmod(candidate.path, permissions);
    const verify = await readFile(candidate.path, "utf8");
    if (!verify.includes(MARKER) || patchLocationFallbackSource(verify) !== verify) {
      throw new Error(`combo_location_fallback_verify_failed:${candidate.path}`);
    }
    touched.push(candidate.path);
  }
  return touched;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[process.argv.indexOf("--root") + 1];
  if (!root) throw new Error("usage: patch-combo-location-fallback.mjs --root PATH [--apply] [--allow-version-drift]");
  const paths = await install(root, process.argv.includes("--apply") ? "apply" : "verify", {
    checkVersion: !process.argv.includes("--allow-version-drift"),
  });
  console.log(`9ROUTER_COMBO_LOCATION_FALLBACK=${process.argv.includes("--apply") ? "installed" : "verified"}:${paths.join(",")}`);
}
