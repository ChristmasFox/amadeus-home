# DeliveryEnvelope v2 — first candidate apply stopped before switch

Date: 2026-09-30, Asia/Shanghai. Operator explicitly authorized production apply.
Source at attempt: `96de4537c1b602a0ca73383efd88430dcb1b3a5f`.

The repository candidate deploy ran focused tests and secrets checks, built the
immutable OpenClaw image
`local/openclaw-amadeus:git-96de4537c1b6-20260930074729`, then created the
protected external checkpoint
`/DATA/AppData/openclaw/backups/amadeus-openclaw-20260930074729` (root 0700,
manifest/config copies 0600). It had not switched CasaOS Compose or the
running container. Product Radar and 9Router were not changed by this apply.

The checksum-pinned WhatsApp integration installer stopped before writing its
module: invoking npm's `/usr/bin/env` shebang inherited the pinned OpenClaw
private glibc loader and failed on a GLIBC_PRIVATE symbol. The source installer
was corrected to invoke npm's JS CLI with the running Node executable directly.
A read-only live-container probe verified that direct npm CLI works, and a
bounded pinned archive fetch from that same container verified the expected
SHA-512. Before retry, tar extraction was also moved in-process to avoid the
same private-glibc fault from a second system-binary subprocess. No archive, credentials, or media bytes were copied into Git.

The first attempt's config preparation had written `tts.auto=off` to disk while
the old image was still running. The config was atomically restored from that
attempt's protected checkpoint with the original `1000:1000`, `0600` metadata.
Read-only follow-up showed `tts.auto=tagged` and the previous immutable OpenClaw
image healthy. The full Goal remains open; no owner WhatsApp Gate is claimed.
Before a retry, commit the corrected installer and generate a new immutable
source tag/checkpoint. If a later switch fails, restore both the prior image
and the protected npm project/config copies, not the retired Git hacks.
