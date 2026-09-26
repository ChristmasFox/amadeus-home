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
assert "owner_notification_status='skipped-candidate'\nelse\nACCEPTANCE_KEY=\"amadeus-release:$AMADEUS_VERSION\"" in s
assert "post_deploy_maintenance='skipped-candidate'" in s
assert "OWNER_OUTBOX_SMOKE=%s" in s
assert 'Single OpenClaw candidate runtime ready for real acceptance; not a release.' in s
assert 'scripts/openclaw-voice-*.mjs|pnpm-lock.yaml' in s
assert 'tar -C "$ROOT_DIR/scripts" -cf -' in s
assert 'node "$tmp/patch-openclaw-whatsapp-voice-lifecycle.mjs" --whatsapp-root' in s
image=Path('infra/docker/casaos/openclaw/Dockerfile').read_text()
assert 'COPY scripts/openclaw-voice-*.mjs /tmp/' in image
assert '/tmp/openclaw-voice-*.mjs' in image
assert 'Owner release notification remained pending after 30 seconds.' in s
PY
printf '%s\n' 'OPENCLAW_CANDIDATE_MODE_FIXTURE=passed'
