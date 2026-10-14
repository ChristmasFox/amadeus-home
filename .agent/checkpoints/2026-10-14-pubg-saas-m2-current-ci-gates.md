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

After verification, remove only the generated `/tmp/pubg-saas-current.oci.tar`.
The separately required M204 Compose and database recovery commands are in
[`2026-10-14-pubg-saas-m2-current-image-local-recovery.md`](2026-10-14-pubg-saas-m2-current-image-local-recovery.md).
