ALTER TABLE teams ADD COLUMN query_revision BIGINT NOT NULL DEFAULT 0 CHECK (query_revision>=0);

CREATE TABLE public_query_sessions (
  session_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform='kook'),
  bot_account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bound_channel','direct_team')),
  team_revision BIGINT NOT NULL,
  binding_revision BIGINT,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,team_id) REFERENCES teams(tenant_id,team_id) ON DELETE CASCADE,
  CHECK ((kind='bound_channel' AND binding_revision IS NOT NULL)
    OR (kind='direct_team' AND binding_revision IS NULL))
);
CREATE INDEX idx_public_query_sessions_actor
  ON public_query_sessions(tenant_id,team_id,bot_account_id,user_id,channel_id,kind,updated_at DESC);
CREATE INDEX idx_public_query_sessions_expiry ON public_query_sessions(expires_at);

-- Event correlation only: no user message, model prompt or credential copy.
CREATE TABLE public_query_requests (
  bot_account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES public_query_sessions(session_id) ON DELETE CASCADE,
  PRIMARY KEY (bot_account_id,event_id)
);

-- A roster/alias change away and back must not resurrect prior follow-up state.
CREATE FUNCTION advance_team_query_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN
    UPDATE teams SET query_revision=query_revision+1
      WHERE tenant_id=OLD.tenant_id AND team_id=OLD.team_id;
  END IF;
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND (NEW.tenant_id,NEW.team_id) IS DISTINCT FROM (OLD.tenant_id,OLD.team_id)) THEN
    UPDATE teams SET query_revision=query_revision+1
      WHERE tenant_id=NEW.tenant_id AND team_id=NEW.team_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER team_members_query_revision AFTER INSERT OR UPDATE OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION advance_team_query_revision();
CREATE TRIGGER team_aliases_query_revision AFTER INSERT OR UPDATE OR DELETE ON team_aliases
  FOR EACH ROW EXECUTE FUNCTION advance_team_query_revision();
CREATE FUNCTION advance_team_metadata_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.label,NEW.pubg_shard) IS DISTINCT FROM (OLD.label,OLD.pubg_shard) THEN
    NEW.query_revision:=OLD.query_revision+1;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER team_metadata_query_revision BEFORE UPDATE OF label,pubg_shard ON teams
  FOR EACH ROW EXECUTE FUNCTION advance_team_metadata_revision();

-- Regranting a revoked actor cannot restore that actor's old DM sessions.
CREATE FUNCTION invalidate_actor_query_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public_query_sessions WHERE tenant_id=OLD.tenant_id AND team_id=OLD.team_id
    AND platform=OLD.platform AND bot_account_id=OLD.bot_account_id AND user_id=OLD.user_id AND kind='direct_team';
  RETURN NULL;
END $$;
CREATE TRIGGER team_access_query_sessions AFTER UPDATE OR DELETE ON team_user_access
  FOR EACH ROW EXECUTE FUNCTION invalidate_actor_query_sessions();

ALTER TABLE kook_ingress_events ADD COLUMN binding_revision BIGINT;
-- Old queued events did not record a binding generation. Preserve their audit
-- identity, but do not reconstruct authority from today's channel binding.
UPDATE kook_ingress_events SET status='dead',event_json=NULL,lease_token=NULL,lease_until=NULL,
  next_attempt_at=NULL,last_error_code='kook_ingress_binding_revision_unknown',finished_at=now()
  WHERE event_kind='group' AND status IN ('pending','processing','retry');
