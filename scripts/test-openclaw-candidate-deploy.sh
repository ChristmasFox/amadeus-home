#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
bash -n scripts/deploy-openclaw.sh
candidate="$(scripts/deploy-openclaw.sh --dry-run --candidate --build-auto)"
release="$(scripts/deploy-openclaw.sh --dry-run --build-auto)"
grep -Fxq 'DEPLOYMENT_PHASE=candidate' <<<"$candidate"
grep -Fxq 'DEPLOYMENT_PHASE=release' <<<"$release"
grep -Fxq 'MODE=dry-run' <<<"$candidate"
python3 - <<'PY'
from pathlib import Path
s=Path('scripts/deploy-openclaw.sh').read_text()
assert 'if ((CANDIDATE)); then assert_candidate_version_unchanged; else assert_release_version_advanced; fi' in s
assert "ACCEPTANCE_KEY=\"amadeus-candidate-deploy:$CHECKPOINT_ID\"" in s
assert "NOTIFICATION_SOURCE='amadeus-candidate-deploy'" in s
assert "post_deploy_maintenance='skipped-candidate'" in s
assert "OWNER_OUTBOX_SMOKE=%s" in s
assert 'Single OpenClaw candidate runtime ready for real acceptance; not a release.' in s
assert 'scripts/openclaw-voice-*.mjs|pnpm-lock.yaml' in s
assert 'checkpoint.mkdir(mode=0o700, parents=True)' in s
assert "protected checkpoint directory is not mode 0700" in s
assert "protected checkpoint manifest is not mode 0600" in s
assert 'tar -C "$ROOT_DIR/scripts" -cf -' in s
assert 'node "$tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs" --whatsapp-root' in s
image=Path('infra/docker/casaos/openclaw/Dockerfile').read_text()
assert 'COPY scripts/openclaw-voice-*.mjs /tmp/' in image
assert 'COPY integrations/openclaw/delivery-boundary /opt/amadeus/delivery-boundary' in image
assert 'RUN chmod 0644 /app/dist/extensions/amadeus/dist/index.js' in image
assert 'OPENCLAW_IMAGE_NODE_PREFLIGHT=passed' in s
assert 'AMADEUS_GATEWAY_REGISTRATION=passed' in s
assert 'plugins inspect amadeus --runtime --json' in s
assert 'plugins registry --refresh --json' in s
assert 'openclaw-state.sqlite.before' in s
assert 'sqlite3.connect' in s
assert '/tmp/openclaw-voice-*.mjs' in image
assert 'Owner deployment notification remained pending after 30 seconds.' in s
PY
printf '%s\n' 'OPENCLAW_CANDIDATE_MODE_FIXTURE=passed'
