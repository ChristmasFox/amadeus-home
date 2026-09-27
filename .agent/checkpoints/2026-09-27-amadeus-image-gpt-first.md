# Amadeus image priority amendment — GPT Image 2.5 first

Date: 2026-09-27 local. The owner explicitly requested GPT Image 2.5 as the
preferred image-generation backend after testing the OpenClaw candidate. This
amends only the image Combo ordering in the active Goal; the earlier
Gemini-first checkpoint remains historical, not the release target. The
owner's broad “测试了没有问题” feedback is not treated as itemized non-owner
and three-way voice acceptance. No private prompt, account, sender/group ID,
credential, or generated image/audio payload is included in this Git record.

## Protected prestate and applied desired state

- Source commit before the priority write:
  `2c6808687bd909ac759d5b8d68f89ef63066d8a1`, committed and pushed,
  with `VERSION=1.6.4`. `docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md` and
  `infra/9router/model-capabilities.json` now define the exact order:
  `cx/gpt-image-2.5` → `ag/gemini-3.1-flash-image`, `kind=image`,
  `strategy=fallback`.
- Before apply, the live Combo still had Gemini first and explicit fallback.
  The protected **priority-only** rollback snapshot is
  `/Volumes/Avalon/backups/operation-skuld/amadeus-model-capability/amadeus-image-preapply-20260927T131127Z-57850.json`
  (0600 under 0700). Readback proved it contains only the previous Combo
  identity/order and this Combo's strategy presence/value; no provider
  settings or credentials. Avalon UUID and sentinel matched the private host
  profile. The existing pre-goal OpenClaw and candidate release checkpoints
  were both verified protected before this write.
- The existing 9Router management API reconciled only `amadeus-image` model
  order; strategy was already fallback. Authenticated `--verify-live` passed.
  A second `--apply` returned `IMAGE_COMBO=existing` and
  `IMAGE_STRATEGY=existing`; its later post-change snapshot is **not** the
  priority rollback file. In-memory projections of unrelated Combos, aliases,
  other/global strategy settings and provider connection identities were
  unchanged. 9Router image/PID remained the same (`1449961`); no restart or
  9Router source/database edit occurred.

## Transport and fallback proof

- One paid prompt-only request from the **live OpenClaw container network**
  using `model=amadeus-image` returned HTTP 200 and one valid PNG (827,799
  bytes). Sanitized 9Router logs showed `cx/gpt-image-2.5` as attempt 1/2
  and successful first backend. The PNG/base64 stayed in process memory and
  was discarded, not committed or copied to an acceptance artifact. This is
  not real Agent/group-channel delivery evidence.
- A read-only synthetic 429 against the exact compiled live 9Router image
  Combo route/helper advanced from GPT Image 2.5 to Gemini 3.1 Flash Image
  and succeeded with one logical input body. Healthy GPT success stayed on
  attempt 1; both unavailable returned a structured error. No account was
  disabled and no quota was intentionally exhausted. **No live first-model
  fault was induced.** The pinned helper considers an upstream HTTP 400
  fallback-eligible; route-level missing-prompt 400 had previously been
  verified to return before Combo dispatch. Do not claim a general no-fallback
  boundary for upstream client errors under this Goal.
- OpenClaw remains on the healthy 1.6.4 candidate image
  `local/openclaw-amadeus:git-02df41443a54-20260927125732`; its stable
  default is still `openai/amadeus-image`, so no OpenClaw rebuild or restart
  was needed for the backend priority change. Native Mac TTS LaunchAgent
  remained PID `50062`, exit 0, HTTP 200/ready. `arthur-combo`, ASR/TTS
  aliases, unrelated tool permissions and Product Radar were not changed.

## Independent recovery

- **Priority-only rollback:** run the Git-managed provisioner with explicit
  `--apply --restore-checkpoint` using the `...131127Z-57850.json` file above;
  it restores Gemini-first order without rolling back OpenClaw, accounts,
  ASR/TTS, or unrelated Combos.
- **Goal-wide Combo rollback:** the original *absent-Combo* prestate file
  `.../amadeus-image-preapply-20260927T125332Z-47371.json` removes the new
  Combo/strategy. Do not confuse it with the priority-only or idempotence
  snapshots. Prior OpenClaw config/voice/group policy and image are independently
  protected under the pre-goal and candidate deployment checkpoints documented
  in the previous dated records.

Real owner/non-owner group image and three-way voice acceptance remain open;
there has been no final version bump, release or Goal completion.
