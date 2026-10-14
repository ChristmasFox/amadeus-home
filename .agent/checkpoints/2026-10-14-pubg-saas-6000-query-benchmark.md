# PUBG SaaS 200-team, 6,000-query synthetic load replay

Date: 2026-10-14 (Asia/Shanghai)

## Scope

Extended `apps/pubg-saas/tests/m2-200-team-load.benchmark.ts` with the bounded
`PUBG_SAAS_BENCH_QUERIES_PER_TEAM` setting (default 1, accepted range 1–50).
The 30-task setting replays 6,000 authorized query tasks over 200 synthetic
teams and 800 users against 400 synthetic matches / 1,600 player rows. Each
task checks the current team's match count, lists its match window, reads one
match, then verifies that an adjacent team's match is not visible. No KOOK,
PUBG or model requests are made. Worker fetches use the benchmark's synthetic
adapter.

The benchmark uses a unique PostgreSQL schema and refuses any database except
loopback `pubg_test`. It removes its schema in `finally`. The existing isolated
`pubg-saas-pg18` PostgreSQL 18.6 fixture on `127.0.0.1:55432` was reused and
left running; the post-run count of `m2_bench_%` schemas was zero.

## Results

With 8 authorized-query workers, 8 concurrent Worker runs, and a 20-connection
pool:

| Measurement | Result |
| --- | ---: |
| Authorized query tasks | 6,000 / 6,000 |
| SQL statements in query phase | 132,000 |
| Query phase wall time / task throughput | 27,288 ms / 219.88 tasks/s |
| SQL statement latency P50 / P95 / P99 | 0.42 / 3.02 / 88.71 ms |
| Query and scope failures | 0 |
| Worker team runs | 200 / 200; 0 failures |
| Worker phase wall time / SQL statement P95 | 380 ms / 1.72 ms |
| Peak PG pool use | 16 / 20; 0 waiters |
| Benchmark Node RSS peak / heap peak | 257 MiB / 95.6 MiB |

The 30-per-team daily volume was replayed as a burst, not distributed over
24 hours. These numbers describe repository/query behavior on the local test
fixture; they are not an end-to-end KOOK response latency, provider-rate test,
canonical M204 container measurement, sustained-load result or production SLO.
The earlier M204 measurement remains separate evidence with its own 1 CPU PG
cap and host samples.

## M204 isolated PostgreSQL replay

Repeated the same compiled benchmark in the canonical host-profile OrbStack
machine `nyannyan`, using the retained isolated
`pubg-saas-m2-canonical-benchmark` project and PG18.1 volume. The current local
runtime image was `local/pubg-saas:git-7f3b95b` (image ID
`sha256:e52c734edc432eb5f9d84af9aa2c8086467f38146ec9dade75e26fe6b4c00d47`).
The current `apps/pubg-saas/dist` was built on the host and mounted read-only
into a benchmark runner attached only to the PG container's internal network.
PostgreSQL remained capped at 1 CPU / 1 GiB; the runner at 1 CPU / 512 MiB.
Its test password file was owner-only. No Gateway, KOOK, PUBG or model process
was involved.

The M204 run completed all 6,000 query tasks and 200/200 Worker team runs with
zero failures. The authorized query phase executed 132,000 SQL statements in
47,609 ms (126.03 tasks/s); statement P50/P95/P99 were 0.17/1.72/32.61 ms.
Worker reads executed 7,356 statements in 576 ms with P95/P99 of 2.30/23.77 ms.
The pool peaked at 16/20 connections with zero waiters. Runner RSS peaked at
115 MiB and heap at 47 MiB under its 512 MiB cap. These are bounded results for
the isolated PG and benchmark runner on M204; they do not measure the public
Gateway/Worker services or establish sustained production capacity/SLO.

The randomly named benchmark schema count was zero after the run. Plain Compose
`down` stopped the test PG container and removed only its network while
preserving the dedicated test volume. Read-only inspection after the run
showed OpenClaw and 9Router still running with their prior IDs and start times,
both at restart count zero. No private or production service was modified.

The first 6,000-task attempt completed all query and Worker work with zero
recorded failures but exited 1 because the final success assertion still
expected one task per team. The isolated schema was removed. The assertion now
compares against the derived total task count; a repeat completed with exit 0.
The package typecheck passed after the final harness change.

## Global PUBG admission contention follow-up

The benchmark now adds 200 simultaneous contenders against the shared
PostgreSQL PUBG admission row, applies synthetic provider headers and a 429
reset window, and checks the shared pause, subsequent reset permit, and
provider-observed two-requests-per-minute ceiling. It makes no HTTP/API request.
Both the package typecheck and container build passed for the harness change.

The rerun on M204's isolated PG18.1 completed 6,000 authorized tasks in
47,722.54 ms with 132,000 SQL statements and zero failures; query SQL statement
P50/P95/P99 were 0.17/1.69/6.27 ms. Worker reads completed 200/200 runs in
561.97 ms with zero failures. The admission phase returned one immediate
permit and deferred 199 initial contenders; after the simulated 429 all 200
contenders observed the pause, then a reset permit was granted and the newly
observed provider rate limit was enforced. This phase used 1,612 SQL statements
in 186.14 ms. The deliberately simultaneous 200 database contenders peaked at
20/20 pool connections with 180 waiters; this is a saturation burst, not the
serial KOOK ingress profile or a production SLO. Benchmark process RSS peaked
at about 125.6 MiB. The random schema count was zero after exit and the PG
volume was retained with plain Compose `down`.

## Reproduction

Set the database URL from the owner-only local test configuration; do not use
a production connection string:

```sh
export PUBG_SAAS_TEST_DATABASE_URL='postgresql://pubg_test:<test-password>@127.0.0.1:55432/pubg_test'
PUBG_SAAS_BENCH_QUERIES_PER_TEAM=30 \
  pnpm --filter @agent/pubg-saas exec tsx tests/m2-200-team-load.benchmark.ts
```

The run must report 6,000 tasks, zero failures, 200/200 Worker team runs, and
exit 0. The fixture is constrained to localhost and the `pubg_test` database;
the harness drops its generated `m2_bench_*` schema on exit.

The M204 variant reuses the retained capped Compose PG and current runtime image
without exposing PostgreSQL to the host. After
`pnpm --filter @agent/pubg-saas build`, create this owner-only runner outside
Git:

```sh
mkdir -m 700 -p /Users/nyannyan/Library/Caches/pubg-saas-m2-canonical-benchmark/tooling
cat > /Users/nyannyan/Library/Caches/pubg-saas-m2-canonical-benchmark/tooling/benchmark-runner-6k.mjs <<'EOF'
import { readFileSync } from 'node:fs';
const password = readFileSync('/run/test-secrets/pg-password', 'utf8').trim();
process.env.PUBG_SAAS_TEST_DATABASE_URL = `postgresql://pubg_bootstrap:${encodeURIComponent(password)}@127.0.0.1:5432/pubg_test`;
await import('/app/dist/tests/m2-200-team-load.benchmark.js');
EOF
chmod 600 /Users/nyannyan/Library/Caches/pubg-saas-m2-canonical-benchmark/tooling/benchmark-runner-6k.mjs
orb -m nyannyan -u root chmod 600 /var/tmp/pubg-saas-m2-canonical-benchmark-20261014/secrets/pg-password
orb -m nyannyan -u root docker compose --project-name pubg-saas-m2-canonical-benchmark \
  --project-directory /var/tmp/pubg-saas-m2-canonical-benchmark-20261014 \
  -f /var/tmp/pubg-saas-m2-canonical-benchmark-20261014/compose.yaml up -d --wait postgres

PUBG_SAAS_BENCH_PG_ID="$(orb -m nyannyan -u root docker compose \
  --project-name pubg-saas-m2-canonical-benchmark \
  --project-directory /var/tmp/pubg-saas-m2-canonical-benchmark-20261014 \
  -f /var/tmp/pubg-saas-m2-canonical-benchmark-20261014/compose.yaml ps -q postgres)"
orb -m nyannyan -u root docker run --rm --init \
  --network "container:$PUBG_SAAS_BENCH_PG_ID" \
  --memory=512m --cpus=1 --pids-limit=128 --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --security-opt no-new-privileges --cap-drop=ALL --user 0:0 \
  --mount type=bind,source=/Users/nyannyan/amadeus-home/apps/pubg-saas/dist,target=/app/dist,readonly \
  --mount type=bind,source=/Users/nyannyan/Library/Caches/pubg-saas-m2-canonical-benchmark/tooling/benchmark-runner-6k.mjs,target=/tmp/benchmark-runner-6k.mjs,readonly \
  --mount type=bind,source=/var/tmp/pubg-saas-m2-canonical-benchmark-20261014/secrets/pg-password,target=/run/test-secrets/pg-password,readonly \
  --env PUBG_SAAS_BENCH_QUERIES_PER_TEAM=30 \
  --entrypoint node local/pubg-saas:git-7f3b95b /tmp/benchmark-runner-6k.mjs

# Confirm the harness removed its schema, then stop without deleting the volume.
PUBG_SAAS_BENCH_PG_ID="$(orb -m nyannyan -u root docker compose \
  --project-name pubg-saas-m2-canonical-benchmark \
  --project-directory /var/tmp/pubg-saas-m2-canonical-benchmark-20261014 \
  -f /var/tmp/pubg-saas-m2-canonical-benchmark-20261014/compose.yaml ps -q postgres)"
orb -m nyannyan -u root docker exec "$PUBG_SAAS_BENCH_PG_ID" \
  psql -U pubg_bootstrap -d pubg_test -X -v ON_ERROR_STOP=1 -Atc \
  "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'm2_bench_%'"
orb -m nyannyan -u root docker compose --project-name pubg-saas-m2-canonical-benchmark \
  --project-directory /var/tmp/pubg-saas-m2-canonical-benchmark-20261014 \
  -f /var/tmp/pubg-saas-m2-canonical-benchmark-20261014/compose.yaml down
```
