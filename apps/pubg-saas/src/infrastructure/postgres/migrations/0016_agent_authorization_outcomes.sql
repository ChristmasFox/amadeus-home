ALTER TABLE kook_agent_runs DROP CONSTRAINT kook_agent_runs_outcome_check;
ALTER TABLE kook_agent_runs ADD CONSTRAINT kook_agent_runs_outcome_check
  CHECK (outcome IN ('replied','authorization_denied','provider_fallback','tool_degraded','model_unconfigured'));
