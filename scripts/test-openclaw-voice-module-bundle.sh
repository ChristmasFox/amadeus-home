#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/amadeus-voice-bundle.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
tar -C "$ROOT/scripts" -cf - \
  patch-openclaw-whatsapp-voice-lifecycle.mjs openclaw-voice-markers.mjs \
  openclaw-voice-policy.mjs openclaw-voice-lease.mjs | tar -C "$TMP" -xf -
VOICE_PATCH_BUNDLE="$TMP/patch-openclaw-whatsapp-voice-lifecycle.mjs" node --input-type=module -e '
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.env.VOICE_PATCH_BUNDLE));
assert.equal(mod.resolveAmadeusJapaneseSpeechText("日本語：少し待って。"), "少し待って。");
assert.match(mod.whatsappIngressQueueHelpers, /runAmadeusWhatsAppVoiceScopedIngress/u);
console.log("OPENCLAW_VOICE_BUNDLE_IMPORT=passed");
'
mkdir "$TMP/empty-core"
if node "$TMP/patch-openclaw-whatsapp-voice-lifecycle.mjs" --core-root "$TMP/empty-core" >"$TMP/cli.log" 2>&1; then
  echo 'voice patch CLI unexpectedly accepted missing pinned module' >&2
  exit 1
fi
grep -Fq 'pinned OpenClaw agent-runner module missing' "$TMP/cli.log"
printf '%s\n' 'OPENCLAW_VOICE_BUNDLE_CLI_FAIL_CLOSED=passed'
