# Amadeus image persona 1.7.5 rollout — first candidate halted

The implementation was committed and pushed as `a242570`, but the first immutable candidate failed its required pre-switch version-identity validation: `/opt/amadeus/VERSION` was mode `0600`, unreadable by the runtime `node` user. The deployment script stopped before creating a protected runtime checkpoint or applying anything.

The production release was halted and the prior 1.7.4 runtime was confirmed healthy and registered. The permission issue was corrected in source commit `431d90f`: the Dockerfile normalizes the baked marker to mode 0644 and the canonical version bump script preserves that mode. This does not authorize bypass or reuse of the failed candidate. Under the still-active Goal, any resumed rollout must use a distinct candidate built from corrected committed source and rerun all hard gates before creating a protected checkpoint or switching production.

Evidence: `.agent/checkpoints/2026-10-01-amadeus-image-persona-1.7.5-candidate-preflight-failed.md`.
