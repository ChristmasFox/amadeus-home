# Qwen image bridge candidate — 2026-10-07

Status: local bridge edit accepted; OpenClaw candidate and real WhatsApp
fallback not yet deployed or accepted.

## Source and isolation

- Active Goal: `docs/AMADEUS_QWEN_IMAGE_2_1_UNCENSORED_EDIT_FALLBACK_GOAL.md`.
- Qwen service source: `apps/qwen-image-service/bridge.py`,
  `infra/macos/manage-qwen-image.sh`,
  `infra/macos/qwen-image-engine.json`, and the LaunchAgent template.
- Runtime installed with `manage-qwen-image.sh --start --apply` on
  `Amadeus-M204`. The bridge listens on `127.0.0.1:18793`, and the lazily
  started pinned `sd-server` listens on `127.0.0.1:18795`.
- A new token lives outside Git under the operator's macOS secrets directory;
  its mode is `0600`. Token value, prompts and media bytes are not recorded.
- Krea LaunchAgent was absent and its ports were closed at preflight.
- OpenClaw 1.9.5 and 9Router were unchanged; the image Combo remains a single
  `cx/gpt-image-2.5` primary.

## Verification

- Bridge `load_config()` plus full `verify_runtime_and_assets()` passed for
  all pinned Qwen assets and the `sd-server` binary/commit.
- Host `/health` returned model `local/qwen-image-2.1-uncensored`, concurrency
  one, queue one, deadline 600000 ms, and edit support.
- The live OpenClaw container reached the bridge through
  `host.docker.internal:18793`; an authenticated `/v1/models` request returned
  the Qwen model, while an unauthenticated request returned 401. The token was
  passed over stdin for this read-only container smoke, not persisted in it.
- A real host bridge multipart `/v1/images/edits` request with the synthetic
  `portrait-source.png` returned HTTP 200, model
  `local/qwen-image-2.1-uncensored`, one PNG of 768×768, and elapsed time
  398.35 seconds. The output at
  `/Volumes/Avalon/models/qwen-image-2.1-uncensored/acceptance/bridge-edit-20261007T014414.png`
  has SHA-256
  `a0127c214a609d96d300ed41cf075cae18f109f6aa36391a54739f8680bc50f4`.
  Side-by-side visual review shows the pot changed from terracotta to teal
  while the person, blue jacket and composition remained recognizable.
- A real OpenClaw-container edit using Node's built-in `fetch` failed after
  about 303 seconds (`fetch failed`). Retrying with `undici.fetch`,
  `undici.FormData`, and an `Agent` with 600000 ms headers/body timeouts
  succeeded after about 409 seconds with a 537640-byte image. Built-in
  `fetch` plus that Agent is invalid (`UND_ERR_INVALID_ARG`). The image-route
  candidate uses the working client; this is not a live WhatsApp test.
- Local bridge unit tests: 11 passed, including one active generation plus
  one waiter, idle-monitor protection during active generation and timeout
  lock behavior. OpenClaw image-route tests: 11 passed, including exact
  reference bytes/MIME and refusal-safe fallback classification.
- `pnpm check:secrets`, shell syntax, plist lint and `git diff --check` passed.
  The source is still an uncommitted worktree candidate, not an immutable
  release image.
- Candidate preflight also passed `pnpm test:amadeus` (Identity 10,
  Presentation 8, Amadeus 134), Amadeus typecheck/build, the pinned delivery
  boundary fixture, both live 9Router image verifiers, and the image Combo
  provision fixture. Live fault injection was not performed.
- The installed bridge and engine config match the source bytes. After about
  three idle minutes, the child stopped and port 18795 closed; `/health` stayed
  ready with state `idle`. Host free memory recovered to 81%; swap was
  26,555.31 MiB used of 27,648 MiB, still elevated near the pre-run level.
- Current live image tags remain
  `local/openclaw-amadeus:git-0a062a1c2c13-20261005153543` (healthy) and
  `local/9router:git-0a062a1c2c13-20261005T153458Z` (running).

## Remaining and rollback

- Before any OpenClaw runtime switch, create a protected OpenClaw checkpoint,
  verify primary-only 9Router, and follow the Goal's release gates.
- The real forced-primary-failure WhatsApp single-reference edit, healthy
  primary contrast, exactly-one delivery, caption/follow-up and regressions
  are not yet proven. Do not bump the release or remove Krea source plumbing.
- If the local candidate must be reverted before the OpenClaw switch, run
  `infra/macos/manage-qwen-image.sh --stop --apply` (or `--uninstall --apply`)
  and verify ports 18793/18795 are closed. The service manager preserves
  external model files and the protected token. No production OpenClaw or
  9Router rollback is needed for this local-only stage.
