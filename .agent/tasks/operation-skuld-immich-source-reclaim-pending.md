# Follow-up: Immich old-source reclaim gate

The 1.4.4 migration must leave the old internal Immich media source retained as a rollback copy.
Do not run `scripts/reclaim-immich-old-source.sh --apply` as part of the release. A future, separately
approved gate must re-check the recorded equivalence result, fresh database backup, active external
mount, post-cutover health and the retained source before reclaiming any bytes.
