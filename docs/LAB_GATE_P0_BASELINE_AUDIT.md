# Lab / Gate P0 baseline audit

Date: 2026-10-15 (Asia/Shanghai)  
Source: `main` after fetching `origin/main`; HEAD `1261eee` matched the remote
tip and the worktree was clean before this audit.  
Scope: sanitized read-only runtime inspection and source/build-path analysis.
No container, Compose file, credential, database, index, or runtime config was
changed.

## Observed product state

| Product / component | Product version | Running artifact | Runtime evidence | Status |
| --- | --- | --- | --- | --- |
| Lab / OpenClaw | `/opt/amadeus/VERSION=1.10.4` | `local/openclaw-amadeus:git-4a57348-202610150912`; image ID/digest `sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f` | Source prefix resolves to `4a5734826eca479f59a2fd039fd12f9ff5d03580`; image created 2026-10-15 17:21:48 +08:00; one `openclaw` consumer, healthy, restart count 0, container created 17:24:17 +08:00 | `UNRELEASED_CANDIDATE`; not Lab 1.10.5 and not a formal release |
| Lab / Product Radar | Not a separate product version | `local/product-radar:git-633dd216339f-20261010081911`; image ID/digest `sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b` | Healthy, restart count 0; app-specific source is unchanged, but shared Presentation and lock inputs changed after the 1.10.4 tag | Running the 1.10.4-era artifact; declared build inputs are stale |
| Lab / 9Router | Independent service version | `local/9router:git-83bb76b5e7c8-20261010T032550Z`; image ID/digest `sha256:828a0c7b2c54e169c8ec4a0219f764c1ca2024efb04a79afb5db2f95a269be9a` | Running, restart count 0 | Unchanged by this audit |
| Gate-Local / Gateway + Worker | Gate source baseline `0.1.0` | Both use `local/pubg-saas:git-0d5de29b5f61049aebaeb255312e39ad6c6a1a5b`; image ID `sha256:ca562817734eeb8f4dc4c68e1febf247c857401a4676a2cb1c9ed58770486c8d` | Gateway running, Worker healthy, both restart counts 0; PostgreSQL and egress proxy healthy; SaaS 9Router running | M2 remains paused and incomplete |

The maintenance host is selected through the local host profile; its machine
identifier and network address are intentionally omitted from this committed
report. The Lab OpenClaw Compose service is `openclaw`. Its container has
persistent bind mounts at `/data`, `/home/node/.openclaw`,
`/home/node/.openclaw/workspace`, `/home/node/.longbridge`,
`/var/lib/amadeus/image-assets`, and `/var/lib/openclaw/notifications`.
Secret mount destinations and host-side mount sources were not enumerated in
the report. The private live Compose file had SHA-256
`16bc284289f270b1d9f451e906feb0cfd6269611e7e206baee6f69ad36fdd771`; its
contents were not read. No checked-in manifest currently binds that file hash
to the Git template, so exact Compose/config drift is `UNKNOWN`.

## Formal release and candidate lineage

- Root `VERSION` remains `1.10.4`; no change to `VERSION` or
  `RELEASE_NOTES.md` exists after the local `v1.10.4` source tag.
- Root `package.json.version=1.0.1` is monorepo tooling metadata. Gate's
  product version source is `apps/pubg-saas/package.json` at `0.1.0`.
- The local and remote `v1.10.4` tag points to
  `df49e06858c80fd9a009e13d2fc69fb80b009327`. The 2026-10-10 release
  checkpoint records image source commit `633dd21`, but that commit is not
  present in the current Git object database. The Product Radar image tag also
  names `633dd216339f`, so its source lineage cannot be inspected from current
  Git. The previous OpenClaw image is still present locally as
  `local/openclaw-amadeus:git-633dd216339f-20261010081911`, digest
  `sha256:240e4872736ac403cea7fdda3649086698c48f01f0f38d216fc692254857ab84`.
  This makes the old checkpoint's source lineage unreproducible from current
  Git; the image remains available as a local rollback artifact.
- A protected rollback checkpoint `memory-core-repair-20261015T091130Z` was
  observed. Its manifest was created at `2026-10-15T09:11:36Z`, records the
  prior image above, and describes an OpenClaw memory-core image/config
  rollback. The running candidate image/container were created shortly after
  it. The checkpoint is a recovery record, not a product Release/Deployment
  Manifest: it has no product approval reference, source validation reference,
  or candidate expiry record.
- A separate `memory-specialist-20261015T074735Z` protected copy contains a
  334,159,872-byte SQLite snapshot. Its contents were not read, changed, or
  rebuilt. This remains a protected external recovery artifact.
- The running Lab image reports `/opt/amadeus/VERSION=1.10.4` while its tag
  names source `4a57348`, a commit after the 1.10.4 release tag. Therefore its
  product version does not identify its deployed source. It is an
  `UNRELEASED_CANDIDATE`, not a release.
- The image has `org.opencontainers.image.source=agent-monorepo` and a
  `revision` label of `3a9d69...`. The Lab Dockerfile does not set the
  `revision` label; it is not evidence of the Amadeus Git revision. The tag
  names the expected source prefix, but there is no checked-in build/deployment
  manifest proving that the image digest was built from that full SHA.

## Drift classification

| Drift type | Finding |
| --- | --- |
| Source drift | Confirmed: Git advanced from the 1.10.4 release source. The relevant Lab delta adds the Memory Core patch and its Dockerfile COPY/RUN steps, modifies the deploy script and Compose example, updates root package/lock inputs, and changes shared `packages/presentation` in `ac628dd`. The root product version and release notes did not advance. |
| Build drift | OpenClaw byte-for-byte provenance is `UNKNOWN`: its local tag claims source `4a57348`, but there is no Amadeus source-revision OCI label or Deployment Manifest. Product Radar has a confirmed stale declared input: its Dockerfile copies `packages/presentation`, changed in `ac628dd`, and the root lock file; its recorded `633dd21` source is unreachable in current Git. |
| Runtime drift | Confirmed: active OpenClaw digest differs from the prior 1.10.4 image, and Product Radar still runs an artifact built before the shared Presentation change. OpenClaw is healthy and its source tag is reachable, but its version remains 1.10.4 and it is not formally released. |
| Release drift | Confirmed: the memory repair candidate is live and has a protected rollback checkpoint, but lacks a product-level candidate manifest with approval, validation, expiry, and immutable digest lineage. |
| Config drift | `UNKNOWN`: the private Compose file hash is recorded above, but no source-linked manifest or exact safe comparison to the rendered private configuration exists. |

## Reproducible `--build-auto` false negative

The OpenClaw Dockerfile copies `scripts/patch-openclaw-memory-core.mjs` and
executes it against the pinned OpenClaw build output. The current
`is_openclaw_image_path()` allowlist omits that file. I cloned the source into
an isolated temporary Git directory at `4a57348`, committed a mutation to only
that patch file, and invoked the exact `image_source_commit`,
`is_openclaw_image_path`, and `image_needs_rebuild` functions extracted from
`scripts/deploy-openclaw.sh`. With a valid 14-digit timestamp image tag, the
result was `REBUILD_MISSED`. This proves a single-file patch change can silently
reuse a stale OpenClaw image under `--build-auto`.

There is a separate fail-closed issue for the currently running image tag:
`git-4a57348-202610150912` has a 12-digit time suffix, while
`image_source_commit()` requires 14 digits. The default read-only command
`./scripts/deploy-openclaw.sh --dry-run --candidate --build-auto` returned:

```text
MODE=dry-run
BUILD_MODE=auto/no-build
openclaw image tag must contain a git commit and timestamp: local/openclaw-amadeus:git-4a57348-202610150912
```

So the current live tag is rejected instead of silently skipped; the
reproducible missing-path false negative applies to otherwise valid tags. The
`--candidate` mode preserves the same single-runtime boundary and skips formal
release notification. `--no-build` checks image freshness before applying.
`--lineage-bridge` remains an explicit `--apply`-only path requiring fresh
OpenClaw and Product Radar builds; none of these apply paths ran during this
audit.

The Dockerfile dependency scan confirms OpenClaw inputs include the root
package/lock/workspace, `VERSION`, bundled PUBG and Amadeus plugins, shared
Domain/Presentation outputs, OpenClaw Dockerfile helpers, patch scripts, and
delivery-boundary files. Product Radar copies the root package/lock/workspace,
its app source, and `packages/presentation`. Its app-specific files have not
changed since the 1.10.4 tag, but shared Presentation and lock inputs have.
Unclassified Docker/build dependencies must be treated conservatively as
rebuild inputs. The current OpenClaw deploy script's `--lineage-bridge` is the
explicit route for the unreachable pre-candidate source, and requires fresh
builds of both images; it was not invoked.

## Gate M2 freeze and evidence limits

The paused M2 source and checkpoint remain intact. The current Gate-Local
Gateway/Worker and backing containers were observed running; there was no
container replacement or restart during this audit. The pause checkpoint
records no M2 command in flight. No PostgreSQL query was made, so this audit
does not claim live migration/queue state or repeat the human KOOK acceptance.
Arthur's real group conversation and the controlled release Go/No-Go remain
open.

## P0 outcome and remaining work

- P0 exit is met: the current source/runtime/build lineage matrix, a live
  candidate, a protected rollback checkpoint, the reachable-source mismatch in
  the historical release record, and the reproducible build-input false
  negative are recorded.
- No runtime write occurred. No service was restarted, deployed, or rolled
  back; no credential, database, memory file, or index was changed.
- At P0 exit, P1 still needed to validate the real OpenClaw 2026.9.4
  plugin/config/schema behavior, Dreaming admission, and 9Router Embedding
  capability. Later authorized probe/index evidence and the remaining live
  gates are recorded in the P1 report; full `LIVE_VERIFIED` is still open.
- At P0 exit, P2/P3 version sources, manifests, build-impact analysis, and
  drift tooling remained to be implemented. They were subsequently completed
  in the P2/P3 reports. No formal Tag, registry push, or environment
  promotion occurred.

## Latest sanitized Lab runtime observation — 2026-10-15T13:14:51Z

`python3 scripts/lab-runtime-snapshot.py` read only image/container identity,
health, and Compose/config digests. OpenClaw remained healthy at
`local/openclaw-amadeus:git-4a57348-202610150912`, digest
`sha256:4f114efaca19335424915fdc7d365b03d7af474354fe49ff8ced4581f932dc9f`,
Lab version `1.10.4`, source
`4a5734826eca479f59a2fd039fd12f9ff5d03580`; its provenance was resolved from
the immutable image tag and reachable Git source. Compose and config digests
were respectively
`sha256:16bc284289f270b1d9f451e906feb0cfd6269611e7e206baee6f69ad36fdd771`
and
`sha256:7106f78e2cde95b7b3ed6cf4ef457eaf4fd7f9d0ea75a125da54768190f09315`.
Product Radar remained healthy at digest
`sha256:1f708837c5d55fcb608108621d74402936a767397fb76af0b4c9c4fc655e396b`;
its tagged source `633dd216339f` is still unreachable and product provenance
is unavailable. No configuration contents, credentials, memory, database,
logs, or session data were read; no runtime state changed. This confirms the
earlier candidate is still live, not that its unbuilt source patches are
active.

## Post-audit source-plan revalidation — 2026-10-15

After the P0 baseline, `scripts/release-lab.sh plan` was rerun against the
current committed source. It returned `MODE=dry-run`, `BUILD_MODE=auto/no-build`,
and `CHANGED_PATHS=0`; it did not query the live containers because the plan
resolves those image references only on apply. The current source plan selects
an OpenClaw rebuild for the changed Dockerfile/build analyzer/Memory Core patch
inputs, and requires a Product Radar rebuild because its recorded source
`633dd216339f` is unavailable in the current Git object database. This is
source/lineage planning evidence only: no image was built, no container was
queried or changed, and `BUILD_VERIFIED` remains false. The dry-run does not
resolve the outstanding live digest/Compose provenance evidence.
