# Amadeus image persona 1.7.5 rollout — first candidate halted

The implementation was committed and pushed as `a242570`, but the first immutable candidate failed its required pre-switch version-identity validation: `/opt/amadeus/VERSION` was mode `0600`, unreadable by the runtime `node` user. The deployment script stopped before creating a protected runtime checkpoint or applying anything.

The production release was halted and the prior 1.7.4 runtime was confirmed healthy and registered. The permission issue was corrected in source commit `431d90f`: the Dockerfile normalizes the baked marker to mode 0644 and the canonical version bump script preserves that mode. This does not authorize bypass or reuse of the failed candidate. Under the still-active Goal, any resumed rollout must use a distinct candidate built from corrected committed source and rerun all hard gates before creating a protected checkpoint or switching production.

Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`.


A later corrected candidate was applied but failed real behavior acceptance (English accepted text for Chinese request; caption omitted with safe telemetry `model_error`). It was rolled back to 1.7.4, now healthy and registered. Current source adds language enforcement/output validation and bounded same-operation retries for language mismatch and early transient caption errors; a new candidate is required. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-postapply-symptom-rollback.md`.


Resolution: corrected source commit `4e514a3` was built as a distinct immutable candidate, all hard gates passed, and Amadeus 1.7.5 is now deployed/verified. The historical rollback remains part of the audit trail. Manual owner-channel acceptance is waived, not performed. See `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-release.md`.
