# Product Radar FashionSigLIP native macOS deployment（2026-09-11）

## Result

- Product Radar image matching is deployed as `hybrid`: new references and candidates use the native macOS FashionSigLIP worker; legacy Sharp references and worker failures fall back to Sharp.
- The worker runs on the Mac mini host as LaunchAgent `com.productradar.fashion-siglip`, using Apple MPS and listening on `0.0.0.0:18400`. It is not deployed in OrbStack Linux Docker.
- CasaOS `ubuntu` Product Radar is active as `local/product-radar:git-620656340703`, with `FASHION_SIGLIP_BASE_URL=http://host.docker.internal:18400`.

## Source and verification

- FashionSigLIP integration source history is pushed through `6206563` (`6fdcb3d`, `1f2ae31`, `29fa84b`, `c081a26`, `6206563`).
- Product Radar tests: 51/51 passed; TypeScript typecheck, Python compile, `git diff --check`, and `pnpm check:secrets` passed.
- Mac worker health: `status=ok`, provider `fashionSigLIP`, model `Marqo/marqo-fashionSigLIP`, device `mps`, dimension `768`.
- Mac real embedding smoke: two items from a public Bunjang image returned two 768-dimensional vectors with no item errors and self-cosine `1.0`.
- Ubuntu-to-Mac network smoke: Product Radar container received HTTP 200 from `host.docker.internal:18400/health` and observed `device=mps` / dimension `768`.
- Real Watch smoke: a temporary similarity Watch was created with a real image reference, a test listing was injected through the live API, and one FashionSigLIP comparison completed (`imageComparisons=1`, `bestScore=0.3538008186506829`, `aboveThreshold=0`, runtime `HEALTHY`). The temporary Watch was deleted; the pre-existing Watch count remained 1 and no notification was triggered.
- Runtime after deployment: Product Radar container is healthy, startup log reports `fashionSigLIP+sharp-fallback`, and no FashionSigLIP Docker container remains.

## Deployment evidence

- Product Radar image id: `sha256:5105a328098b2428b904d69ddf80191201ecd513563d98e4c04403388483b8d4`.
- Compose rollback: `/var/lib/casaos/apps/product-radar/docker-compose.yml.codex-backup.20260911-214743`.
- Environment rollback: `/var/lib/casaos/apps/product-radar/.env.codex-backup.20260911-214743`.
- LaunchAgent rollback plist: `/Users/blacksidev/Library/LaunchAgents/com.productradar.fashion-siglip.plist.codex-backup.20260911-214712`.
- Native model cache is at `~/Library/Application Support/ProductRadar/FashionSigLIP` and is about 775 MB after removing an old incomplete download residue. That residue was moved to `/tmp/product-radar-fashion-siglip-stale-download-20260911.incomplete` for recovery if needed.

## Rollback

Restore the two CasaOS backups above, run `docker compose up -d --no-build` in `/var/lib/casaos/apps/product-radar`, and verify `/health`. The previous Product Radar image remains the rollback target recorded in the environment backup. The native worker can be stopped independently by booting out `gui/$(id -u)/com.productradar.fashion-siglip`; the LaunchAgent backup is retained outside Git.
