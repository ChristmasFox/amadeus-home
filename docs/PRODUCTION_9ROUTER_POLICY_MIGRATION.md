# Production 9Router account-policy migration (manual, zero live mutation)

**Before merging the community PR into any clone used for production**, save the current, tracked `infra/9router/runtime-policy.json` into `.local/9router-production-policy.json` (outside Git) with mode 0600. The current file contains your *account routing email*, not a provider OAuth token.

From a clean checkout of the **current main branch**, on your own trusted Mac:

```sh
mkdir -p .local
cp infra/9router/runtime-policy.json .local/9router-production-policy.json
chmod 600 .local/9router-production-policy.json
```

**Verify** the output file exists and contains the correct account mapping **without pasting it into chat or publishing it**. You may alternatively use an absolute protected file path by setting `AMADEUS_9ROUTER_PRIVATE_POLICY_FILE` in your ignored `infra/host-profile.env`.

After merging community changes, the old Git-tracked `infra/9router/runtime-policy.json` disappears from the source tree, but `.local/9router-production-policy.json` persists. The existing running 9Router image and its SQLite/OAuth data are **untouched**.

### What changes at your next production deployment?

- `scripts/deploy-9router.sh --apply` now REQUIRES a readable, valid private policy. If absent, **fails closed before mutation**.
- `--apply --build` injects only that protected JSON file into the *temporary* Git archive build context (never back into Git).
- An imported/prebuilt candidate image must embed the identical account policy. Different or unrestricted policies are **rejected** before switching the live service.
- Do NOT rename `.local` or delete this protected file while relying on the restricted image account. Back it up in private storage.
- Use `--dry-run` then a planned release after verifying the private path. No daemon restart or credential rotation is part of this migration.

### Security and history

Removing the current file from tracked Git does **NOT** remove its contents from old commits, clones or cached GitHub copies. This email exposure and the remaining privacy audit must be handled separately; do not force-rewrite the production branch history without independent coordination.
