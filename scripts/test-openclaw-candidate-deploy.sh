#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
bash -n scripts/deploy-openclaw.sh
scripts/test-vps-account-map-permissions.sh
bash scripts/test-openclaw-lineage-compatibility.sh
candidate="$(scripts/deploy-openclaw.sh --dry-run --candidate --build-auto)"
release="$(scripts/deploy-openclaw.sh --dry-run --build-auto)"
if scripts/deploy-openclaw.sh --dry-run --lineage-bridge >/dev/null 2>&1; then
  echo 'lineage bridge unexpectedly allowed without --apply' >&2
  exit 1
fi
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
assert 'COPY scripts/patch-openclaw-heartbeat-silence.mjs /tmp/patch-openclaw-heartbeat-silence.mjs' in image
assert 'node /tmp/patch-openclaw-heartbeat-silence.mjs --core-root /app/dist --apply' in image
assert 'COPY integrations/openclaw/delivery-boundary /opt/amadeus/delivery-boundary' in image
assert 'COPY VERSION /opt/amadeus/VERSION' in image
assert 'RUN chmod 0644 /opt/amadeus/VERSION' in image
assert 'chmod 0644 "$temporary"' in Path('scripts/amadeus-version.sh').read_text()
assert 'RUN chmod 0644 /app/dist/extensions/amadeus/dist/index.js' in image
assert 'OPENCLAW_IMAGE_NODE_PREFLIGHT=passed' in s
assert 'AMADEUS_GATEWAY_REGISTRATION=passed' in s
assert 'OPENCLAW_IMAGE_AMADEUS_VERSION=%s' in s
assert 'RUNTIME_AMADEUS_VERSION=%s' in s
assert 'cat /opt/amadeus/VERSION' in s
assert 'LINEAGE_BRIDGE=validated' in s
assert '--lineage-bridge requires fresh OpenClaw and Product Radar builds' in s
assert 'IMAGE_LINEAGE_MISSING' in s
assert 'validate_vps_account_map_source' in s
assert 'OPENCLAW_VPS_ACCOUNT_MAP_PREFLIGHT=passed' in s
assert 'OPENCLAW_VPS_ACCOUNT_MAP_NODE_READ=passed' in s
assert 'OPENCLAW_VPS_ACCOUNT_MAP_HOST_FILE' in s
assert 'OPENCLAW_VPS_ACCOUNT_MAP_GUEST_FILE' in s
assert 'run_vps_account_map_node_preflight' in s
assert 'mkdir -- "$dir"' in s
assert 'chown 1000:1000 "$dir/vps-account-map.json"' in s
assert 'test ! -e "$dir"' in s
assert 'plugins inspect amadeus --runtime --json' in s
assert 'plugins registry --refresh --json' in s
assert 'openclaw-state.sqlite.before' in s
assert 'sqlite3.connect' in s
assert '/tmp/openclaw-voice-*.mjs' in image
assert 'Owner deployment notification remained pending after 30 seconds.' in s
compose=Path('infra/docker/casaos/openclaw/docker-compose.example.yml').read_text()
assert 'AMADEUS_KREA2_IMAGE_' not in compose
assert 'OPENCLAW_KREA2_IMAGE_TOKEN_HOST_FILE' not in compose
assert "AMADEUS_KREA2_IMAGE_TOKEN_FILE=" in s
assert 'KREA2_IMAGE_TOKEN_HOST_FILE="${' not in s
assert 'KREA2_IMAGE_TOKEN_GUEST_FILE' not in s
assert 'vps_account_map.json' in compose
PY
printf '%s\n' 'OPENCLAW_CANDIDATE_MODE_FIXTURE=passed'
