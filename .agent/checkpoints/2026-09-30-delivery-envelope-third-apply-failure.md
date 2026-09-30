# DeliveryEnvelope v2 — third candidate stopped at pinned CLI inspector

Date: 2026-09-30, Asia/Shanghai. Explicit apply authorization remains active.
Source attempt: `81c9a031519b29b780521d1e0033327fbb6196b9`.

The third attempt built immutable image
`local/openclaw-amadeus:git-81c9a031519b-20260930081212`. The non-root image
bundle preflight passed. It created protected checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930081212` (0700 root,
0600 manifest/config), restored the pinned upstream WhatsApp module and
installed the typed reply plan. Config and Compose files were staged, but
Compose **was not switched**. The out-of-process CLI `plugins inspect amadeus
--runtime` reported an unreadable entry and stopped the script.

Read-only differential diagnosis: the same CLI command produces the same
unreadable-entry diagnostic against the **previous healthy immutable image**
with the same mounted runtime config. The old live Gateway's startup logs
independently show Amadeus registering. In the candidate image, uid 1000 can
read and syntax-check the bundle; the pinned SDK's direct package entry
resolution succeeds. This CLI inspection is not an authoritative Gateway
registration check under this mounted configuration. Do not erase the warning
from audit evidence or reinterpret a failed live registration as success.

Protected rollback atomically restored OpenClaw and Product Radar Compose/env,
OpenClaw config/env, and the previous installed WhatsApp monitor. Each copy
was verified against this checkpoint. Read-only follow-up showed the old
immutable image healthy and `tts.auto=tagged`; no production channel switch,
owner WhatsApp message, or recipient-file gate occurred.

The source deploy gate now validates the bundled contract and uid-1000 image
readability before the switch, then requires an **actual Gateway startup
Amadeus registration log** immediately after candidate health and before
other side effects. A missing registration must stop and restore this new
attempt's own protected checkpoint. Gates A–F remain completely open.
