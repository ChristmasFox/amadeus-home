-- Never assign a guessed shard to historical telemetry without a parent match.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM telemetry_features feature LEFT JOIN matches match ON match.match_id=feature.match_id WHERE match.match_id IS NULL)
    OR EXISTS (SELECT 1 FROM telemetry_prefetch_attempts attempt LEFT JOIN matches match ON match.match_id=attempt.match_id WHERE match.match_id IS NULL)
  THEN RAISE EXCEPTION 'public_match_shard_backfill_unresolved'; END IF;
END $$;

ALTER TABLE match_players ADD COLUMN shard TEXT;
UPDATE match_players player SET shard=match.shard FROM matches match WHERE match.match_id=player.match_id;
ALTER TABLE match_players ALTER COLUMN shard SET NOT NULL;
ALTER TABLE match_players DROP CONSTRAINT match_players_match_id_fkey;
ALTER TABLE match_players DROP CONSTRAINT match_players_pkey;
ALTER TABLE matches DROP CONSTRAINT matches_pkey;
ALTER TABLE matches ADD PRIMARY KEY (shard,match_id);
ALTER TABLE match_players ADD PRIMARY KEY (shard,match_id,account_id);
ALTER TABLE match_players ADD CONSTRAINT match_players_match_ref FOREIGN KEY (shard,match_id) REFERENCES matches(shard,match_id) ON DELETE CASCADE;
CREATE INDEX idx_matches_shard_time ON matches(shard,timestamp_ms,match_id);
CREATE INDEX idx_match_players_shard_account ON match_players(shard,account_id,match_id);

ALTER TABLE telemetry_features ADD COLUMN shard TEXT;
UPDATE telemetry_features feature SET shard=match.shard FROM matches match WHERE match.match_id=feature.match_id;
ALTER TABLE telemetry_features ALTER COLUMN shard SET NOT NULL;
ALTER TABLE telemetry_features DROP CONSTRAINT telemetry_features_pkey;
ALTER TABLE telemetry_features ADD PRIMARY KEY (shard,match_id,parser_version,feature_version);
ALTER TABLE telemetry_features ADD CONSTRAINT telemetry_features_match_ref FOREIGN KEY (shard,match_id) REFERENCES matches(shard,match_id) ON DELETE CASCADE;

ALTER TABLE telemetry_prefetch_attempts ADD COLUMN shard TEXT;
UPDATE telemetry_prefetch_attempts attempt SET shard=match.shard FROM matches match WHERE match.match_id=attempt.match_id;
ALTER TABLE telemetry_prefetch_attempts ALTER COLUMN shard SET NOT NULL;
ALTER TABLE telemetry_prefetch_attempts DROP CONSTRAINT telemetry_prefetch_attempts_pkey;
ALTER TABLE telemetry_prefetch_attempts ADD PRIMARY KEY (shard,match_id,parser_version,feature_version);
ALTER TABLE telemetry_prefetch_attempts ADD CONSTRAINT telemetry_attempts_match_ref FOREIGN KEY (shard,match_id) REFERENCES matches(shard,match_id) ON DELETE CASCADE;
CREATE INDEX idx_telemetry_attempts_shard_due ON telemetry_prefetch_attempts(shard,parser_version,feature_version,status,next_retry_at);
