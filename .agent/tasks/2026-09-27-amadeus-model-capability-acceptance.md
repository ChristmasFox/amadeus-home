# Open acceptance — Amadeus model-capability adapter

Date: 2026-09-27 local. Active Goal:
`docs/AMADEUS_MODEL_CAPABILITY_ADAPTER_GOAL.md` with the owner's GPT-first
priority amendment. This is an evidence audit and next-action record, not a
new Goal or a substitute for real channel acceptance. No private content,
sender/group identifiers, generated media, tokens, or account details belong
in Git.

| Goal criterion / gate | Current evidence and classification |
| --- | --- |
| 1. OpenClaw logical `openai/amadeus-image` | **Proven:** live candidate config readback and healthy immutable image. |
| 2. 9Router `kind=image`, strict GPT → Gemini fallback, idempotent | **Proven:** authenticated API readback, second no-op apply, minimal protected prestate and priority-only rollback snapshots. |
| 3. Normal image through logical capability | **Proven at transport:** one live OpenClaw-network request yielded a valid GPT-first PNG. Real Agent/channel delivery is a separate open gate. |
| 4. Eligible first-model failure advances without a second OpenClaw model-specific request | **Proven for synthetic exact path:** compiled live 9Router image route/helper with GPT 429 → Gemini success from one logical body; live paid first-model failure was not induced, as permitted by the Goal's safe alternative. |
| 5. `arthur-combo`, ASR, unrelated state unchanged | **Proven for inspected boundaries:** live config/model readback; in-memory unchanged fingerprints for unrelated Combos, aliases/settings and provider identities; 9Router and native TTS PIDs unchanged. Do not infer uninspected account internals from a hash alone. |
| 6–8. Real inbound voice, explicit typed voice, ordinary typed text | **Missing real-channel evidence.** Pinned 2026.9.4 tagged-TTS three-way loopback fixture and verified inbound voice lease tests pass, but cannot replace an actual reply/attachment observation. |
| 9. Non-owner admitted group image without approval | **Partial only:** live candidate policy projection allows `image_generate` for non-owner WhatsApp/Telegram groups and keeps direct chat web-only. A recent real WhatsApp group session's redacted trajectory had five `image_generate` tool-result `ok` events, but this does not identify the senders, prove channel attachment delivery, or establish post-GPT-priority coverage. |
| 10. Same non-owner sensitive tools remain denied | **Partial only:** live policy projection and global deny tests pass; real non-owner group negative test is missing. Use a safe read-only sensitive request rather than a destructive mutation. |
| 11. No duplicate image/audio delivery | **Partial only:** source/fixture tests prove one native path and one tagged TTS supplement; actual channel attachment counts and absence of raw directive/internal URL are not yet attested. |
| 12. Build/typecheck/test/secrets/config/release gates | **Partial:** full build, typecheck, test, patch suite, architecture, secrets and pinned config validation passed with GPT-first source. Candidate `--apply --candidate --build-auto --full-verify` passed. Final versioned release checks/build/health have not run. |
| 13. Production acceptance and rollback evidence | **Partial:** content-safe Combo/priority/candidate checkpoints and independent protected rollback paths exist. Real channel acceptance and final release/rollback evidence remain open. |

Additional A3 constraint: the pinned 9Router Combo helper treats an upstream
HTTP 400 as fallback-eligible. An authenticated missing-prompt request is
rejected with 400 **before** Combo dispatch. This distinction is recorded in
the checkpoints; a general no-fallback promise for upstream request errors is
not proven and must not be silently claimed. 9Router source changes and
ASR/TTS Combo work remain prohibited by this Goal.

The owner has said the candidate testing had no issue, but has not specified
which channel/sender/voice cases were covered **after** GPT-first priority was
applied. Obtain an itemized real-channel attestation (or direct observation)
for owner/non-owner group image and sensitive denial, non-image group text,
inbound voice, typed explicit voice, ordinary typed text, single attachments,
matching Japanese spoken/visible text, Chinese summary, and no directive leak.
State each actually tested channel. Do not treat CLI sessions or aggregate
trajectory counts as this proof.

Only after the above evidence and the A3 limitation are honestly disposed:
run the sole `scripts/amadeus-version.sh bump patch`, update single-release
notes, commit/push, run normal release checks, immutable OpenClaw-only build
and explicit CasaOS apply, verify the new checkpoint starts 0700/0600,
health/smoke/owner notification, then update project state and canonical
`main`. Keep this task open until the Goal audit is complete.
