# Lab Dreaming preflight stop — 2026-10-15

## Scope and decision

Arthur authorized one controlled Dreaming run restricted to Arthur's own
WhatsApp direct message. That controlled run was **not invoked**. The ordered
Lab procedure stopped at item 4 because the live Lab image cannot prove source
admission before transcript reads. Items 5–7 were not started.

## Sanitized evidence

- The live container is OpenClaw 2026.9.4. A read-only search under `/app`
  found zero occurrences of the source patch marker
  `amadeus-memory-dreaming-peer-admission-v2` and zero occurrences of
  `classifyDreamingSessionAdmission`. The repository patch that adds this
  before-read guard is not present in the running image.
- The live sanitized memory policy allows both `whatsapp` and `telegram`.
  Group/channel exclusions and a protected WhatsApp peer-file reference are
  present, but without the admission code they do not establish that
  transcript reads enforce the requested WhatsApp-only direct-peer boundary.
  No peer value, phone number, transcript, or memory snippet was read or
  recorded.
- Live Memory status reported zero session-corpus files. This does not prove
  that the current runtime would avoid reading other session sources.
- The initial read-only cron listing showed the enabled “Memory Dreaming
  Promotion” job with `lastRunStatus=ok`. A later read-only metadata query
  found seven retained run records. The scheduled run on 2026-10-15 at
  03:00 Asia/Shanghai completed successfully in 200245 ms; delivery was not
  requested. A prior scheduled run on 2026-10-13 failed. The metadata query
  omitted prompts, summaries, session identifiers, and content. This scheduled
  execution was not initiated as the authorized controlled run and does not
  prove source isolation.
- The job remains enabled and its next scheduled time is 2026-10-16 at 03:00
  Asia/Shanghai. The later read-only Memory status reported zero session-corpus
  files, zero suspicious corpus files/lines, no session-ingestion state, zero
  audit entries, and zero promotions. `DREAMS.md` remains absent; the memory
  directory contained one zero-byte file. These current counters and paths do
  not establish which sources the completed scheduled run read. No transcript,
  Dreaming summary, or memory text was opened.

## Effects and recovery

No manual Dreaming command or cron control command was started by this
acceptance; the pre-existing scheduled job ran automatically as recorded
above. We did not read a session transcript or Dreaming output and did not
modify the cron, runtime, configuration, SQLite, Workspace, or service state.
The post-run counters show no current session corpus, audit entries, or
promotions, but source isolation and the scheduled run's exact read/write
effects remain unverified. No rollback was performed. The verified pre-write
backup from item 3 remains at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`.

The ordered procedure remains stopped at item 4. The job is still enabled, so
another scheduled execution is due at the time above. The current source-only
continuation does not authorize changing that schedule. A future continuation
must first establish and verify the admission guard in the Lab runtime while
preserving the requested order and deploy boundary; no build, deployment, or
release is authorized by this checkpoint alone. Any temporary pause and later
resume of the existing job require explicit runtime authorization; recovery is
to re-enable that same job only after the source guard is live and verified.
