ALTER TABLE pending_team_actions
  DROP CONSTRAINT IF EXISTS pending_team_actions_action_check;

ALTER TABLE pending_team_actions
  ADD CONSTRAINT pending_team_actions_action_check
  CHECK (action IN (
    'add_members',
    'replace_roster',
    'set_leaderboard_metric',
    'delete_leaderboard_metric',
    'unbind_channel',
    'disband_team'
  ));
