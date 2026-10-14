# PUBG SaaS current-source CI and multiarch gate

Date: 2026-10-14 (Asia/Shanghai)

## Results

The SaaS source at commit `20b06da` (current `HEAD` was `5409671`, a
documentation-only follow-up) passed the full `pnpm test:pubg-saas` suite:
104 passed, 0 failed, 0 skipped. The test runner reused the existing isolated
`pubg-saas-pg18` container through its host-loopback-only port 55432. Its
database was `pubg_test`, PostgreSQL server version 18.6, initialized under the
dedicated test role `pubg_test`; it used a dedicated named volume. The
connection URL was assembled inside a short-lived local process from the
container's test-only configuration and was not printed or written to Git.
The fixture remained running after the suite for future isolated tests.

`pnpm check:architecture` passed. Python backup and Compose PostgreSQL adapter
safety tests passed 23/23. They cover secret-free process settings, external
host denial, local project/volume/network guards, restore markers and
permissions, archive checksums, retention safety and sequence grants.

Buildx built the current checkout for both `linux/amd64` and `linux/arm64` as
a local OCI archive. `scripts/verify-pubg-saas-oci.py` reported both expected
platforms. OCI manifest-list digest:
`sha256:c5cc84807ec14041d98d7bbaf4ca500fb85ae19912381e49a2cc8bd87fae3540`.
The temporary OCI archive was removed after verification. No image was loaded
into a release registry, pushed or deployed.

The previous current-source checkpoint separately proves the native ARM64 M204
Compose startup, 14 migrations, encrypted backup/restore and private-stop
regression. This CI gate does not supply live human KOOK events or PUBG/model
provider evidence. GitHub Actions itself has not run because the branch has not
been pushed.

## Latest-source multiarch follow-up

After the egress-proxy metrics relay landed in source commit `7f3b95b`, M204's
local BuildKit builder produced an OCI archive for both `linux/amd64` and
`linux/arm64`. The verifier accepted both platforms. OCI manifest-list digest:
`sha256:7cfc5d19b320b431f2da8b93afc4f1b6b6fd22f63bf884c139945d32d4da2d68`.
The 163 MB temporary archive was removed after verification. No image was
pushed. This proves the latest source builds for both OCI platforms; it is not
a Compose runtime test on physical amd64 Linux. Native ARM64 M204 Compose and
host metrics relay acceptance are recorded in
`.agent/checkpoints/2026-10-14-pubg-saas-metrics-relay-host-acceptance.md`.

Reproduce on M204 without publishing:

```sh
orb -m nyannyan -u root bash -lc 'cd /Users/nyannyan/amadeus-home && docker buildx build --platform linux/amd64,linux/arm64 --progress=plain --resource memory=4g --resource cpu-quota=400000 --output type=oci,dest=/var/tmp/pubg-saas-7f3b95b-multiarch.oci -f apps/pubg-saas/Dockerfile . && python3 scripts/verify-pubg-saas-oci.py /var/tmp/pubg-saas-7f3b95b-multiarch.oci && rm -f -- /var/tmp/pubg-saas-7f3b95b-multiarch.oci'
```

## Reproduction

Use the existing isolated PG fixture; do not start or stop it for this run.
Provide `PUBG_SAAS_TEST_DATABASE_URL` from its owner-only test configuration,
without echoing the URL:

```sh
PUBG_SAAS_TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm test:pubg-saas
pnpm check:architecture
python3 -m unittest discover -s scripts/tests -p 'test_pubg_saas_*.py' -v
```

Build and validate both architectures without publishing:

```sh
docker buildx build --builder orbstack \
  --platform linux/amd64,linux/arm64 \
  --output type=oci,dest=/tmp/pubg-saas-current.oci.tar \
  --file apps/pubg-saas/Dockerfile .
python3 scripts/verify-pubg-saas-oci.py /tmp/pubg-saas-current.oci.tar
```

For a current-source M204 reproduction, use the host profile's `nyannyan`
machine and write the OCI output under `/var/tmp`, then run the same verifier.
After verification, remove only the generated OCI archive.
The separately required M204 Compose and database recovery commands are in
[`2026-10-14-pubg-saas-m2-current-image-local-recovery.md`](2026-10-14-pubg-saas-m2-current-image-local-recovery.md).
