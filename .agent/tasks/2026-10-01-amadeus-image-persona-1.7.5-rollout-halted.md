# Amadeus image persona 1.7.5 rollout — first candidate halted

The implementation was committed and pushed as `a242570`, but the first immutable candidate failed its required pre-switch version-identity validation: `/opt/amadeus/VERSION` was mode `0600`, unreadable by the runtime `node` user. The deployment script stopped before creating a protected runtime checkpoint or applying anything.

The production release was halted and the prior 1.7.4 runtime was confirmed healthy and registered. The permission issue was corrected in source commit `431d90f`: the Dockerfile normalizes the baked marker to mode 0644 and the canonical version bump script preserves that mode. This does not authorize bypass or reuse of the failed candidate. Under the still-active Goal, any resumed rollout must use a distinct candidate built from corrected committed source and rerun all hard gates before creating a protected checkpoint or switching production.

Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`.


A later corrected candidate was applied but failed real behavior acceptance (English accepted text for Chinese request; caption omitted with safe telemetry `model_error`). It was rolled back to 1.7.4, now healthy and registered. Current source adds language enforcement/output validation and bounded same-operation retries for language mismatch and early transient caption errors; a new candidate is required. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.


Resolution: corrected source commit `4e514a3` was built as a distinct immutable candidate, all hard gates passed, and Amadeus 1.7.5 is now deployed/verified. The historical rollback remains part of the audit trail. Manual owner-channel acceptance is waived, not performed. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-release.md`.


Reopened: audit of the `4e514a3` candidate found its language hint could come from the model-produced `request.prompt`; that candidate was rolled back. Current production is healthy 1.7.4. Source now captures original inbound text plus derived language at `before_dispatch`; focused tests/typecheck pass, but full gates, commit and a distinct candidate remain. Latest evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-original-request-context-rollback.md`.

Current remediation now distinguishes captured original inbound text/language from OpenClaw's model-produced `taskLabel`; focused 37 tests and Amadeus typecheck pass. Full source gates and new immutable release attempt remain pending. Production stays healthy on 1.7.4.


Latest source now captures original inbound text at `before_dispatch`, derives the language hint from that text alone, snapshots it per taskId, and passes it separately from taskLabel-derived image prompt to accepted/failed/caption. Commits `2e60797` and `d8442d6` are pushed; full gates pass (delivery 82 + pinned integration; Amadeus 116; typecheck/build/architecture/version/secrets/diff). A distinct new candidate remains pending; current production remains healthy 1.7.4.
