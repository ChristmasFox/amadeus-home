# Lab Dreaming preflight stop — 2026-10-15

## Scope and decision

Arthur authorized one Dreaming run restricted to Arthur's own WhatsApp direct
message. The run was **not invoked**. The ordered Lab procedure stopped at
item 4 because the live Lab image cannot prove source admission before
transcript reads. Items 5–7 were not started.

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
- The read-only cron listing showed the enabled “Memory Dreaming Promotion”
  job with `lastRunStatus=ok`; this is not evidence of a run in this
  acceptance, so the job was not manually invoked.

## Effects and recovery

No Dreaming command or cron run was started. No session transcript was read,
and no candidate, `DREAMS.md`, or long-term memory write was made. No runtime,
configuration, SQLite, Workspace, or service state was changed in this step;
there is no rollback to perform. The verified pre-write backup from item 3
remains at
`/Volumes/Avalon/backups/operation-skuld/lab-memory/20261015T124516Z`.

The ordered procedure remains stopped at item 4. A future continuation must
first establish and verify the admission guard in the Lab runtime while
preserving the requested order and deploy boundary; no build, deployment, or
release is authorized by this checkpoint alone.
