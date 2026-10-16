#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PRODUCT="${1:-}"
COMMAND="${2:-}"
[[ "$PRODUCT" == lab || "$PRODUCT" == gate ]] || { echo 'usage: release-cli.sh lab|gate command [options]' >&2; exit 2; }
[[ -n "$COMMAND" ]] || { echo 'missing release command' >&2; exit 2; }
shift 2

APPLY=0
APPROVAL_REF=""
BUILD_MODE=build-auto
BUILD_MODE_SET=0
OPENCLAW_ONLY=0
OPENCLAW_IMAGE=""
PROMOTE_LIVE_CANDIDATE=0
PROMOTION_CHECKPOINT_REF=""
LINEAGE_BRIDGE=0
CREATE_TAG=0
LIVE=0
ENVIRONMENT=""
MANIFEST=""
RUNTIME_SNAPSHOT=""
MEMORY_ACCEPTANCE=""
MEMORY_EVIDENCE_REF=""
ACTOR_ID="${RELEASE_ACTOR_ID:-operator}"
CLEANUP_FILES=()

fail() { printf '%s\n' "$*" >&2; exit 2; }
cleanup_temporary_files() {
  for temporary_file in "${CLEANUP_FILES[@]:-}"; do
    [[ -n "$temporary_file" ]] || continue
    rm -f -- "$temporary_file"
  done
  return 0
}
trap cleanup_temporary_files EXIT
usage() {
  if [[ "$PRODUCT" == lab ]]; then
    printf 'Usage: scripts/release-%s.sh plan|verify|candidate|release|status|rollback-plan [options]\n' "$PRODUCT"
    cat <<'USAGE'

Options:
  --apply                         required for any release/runtime write
  --approval-ref <non-secret-id> required with --apply
  --build-auto | --build | --build-openclaw | --no-build   Lab build selection
  --openclaw-only                  limit Lab candidate scope to the OpenClaw service
  --image <immutable-ref>          prebuilt Lab OpenClaw candidate image
  --promote-live-candidate         formalize the already-live candidate without switching containers
  --checkpoint-ref <path>          protected candidate checkpoint used for promotion
  --lineage-bridge                Lab-only guarded source-lineage bridge
  --create-tag                    required with an applied formal release
  --live                          query current Lab container metadata (read-only)
  --manifest <path>               protected external release manifest
  --runtime-snapshot <path>       sanitized runtime snapshot for drift doctor
  --memory-acceptance <path>      external LIVE_VERIFIED P1 report required for Lab release
USAGE
  else
    printf 'Usage: scripts/release-%s.sh plan|verify|candidate|release|status|rollback-plan [options]\n' "$PRODUCT"
    cat <<'USAGE'

Options:
  --apply                         required for any release/runtime write
  --approval-ref <non-secret-id> required with --apply
  --create-tag                    required with an applied formal release
  --environment <name>            gate-local|gate-staging|gate-prod (default: gate-local)
  --manifest <path>               protected external release manifest (status)
  --runtime-snapshot <path>       sanitized Gate runtime snapshot (status)

Gate-Local candidate apply uses the protected local autopilot and requires
the external one-time Gate approval. M2 may remain paused; candidate apply
does not clear or resume M2. M2 clearance is reserved for future formal
release. The optional control-plane flag is only for an explicitly reviewed
direct Gate-Local apply; automatic phase deployment still blocks those edits.
Staging/Prod apply requires a reviewed environment adapter.
Gate verify requires `PUBG_SAAS_TEST_DATABASE_URL` to point to a loopback
database named `test`/`testing` or ending in `_test`/`_testing`.
USAGE
  fi
}

while (($#)); do
  case "$1" in
    --apply) APPLY=1 ;;
    --approval-ref) (($# >= 2)) || fail '--approval-ref requires a value'; APPROVAL_REF="$2"; shift ;;
    --build-auto) BUILD_MODE=build-auto; BUILD_MODE_SET=1 ;;
    --build) BUILD_MODE=build; BUILD_MODE_SET=1 ;;
    --build-openclaw) BUILD_MODE=build-openclaw; BUILD_MODE_SET=1 ;;
    --no-build) BUILD_MODE=no-build; BUILD_MODE_SET=1 ;;
    --openclaw-only) OPENCLAW_ONLY=1 ;;
    --image) (($# >= 2)) || fail '--image requires a value'; OPENCLAW_IMAGE="$2"; shift ;;
    --promote-live-candidate) PROMOTE_LIVE_CANDIDATE=1 ;;
    --checkpoint-ref) (($# >= 2)) || fail '--checkpoint-ref requires a value'; PROMOTION_CHECKPOINT_REF="$2"; shift ;;
    --lineage-bridge) LINEAGE_BRIDGE=1 ;;
    --create-tag) CREATE_TAG=1 ;;
    --live) LIVE=1 ;;
    --environment) (($# >= 2)) || fail '--environment requires a value'; ENVIRONMENT="$2"; shift ;;
    --manifest) (($# >= 2)) || fail '--manifest requires a path'; MANIFEST="$2"; shift ;;
    --runtime-snapshot) (($# >= 2)) || fail '--runtime-snapshot requires a path'; RUNTIME_SNAPSHOT="$2"; shift ;;
    --memory-acceptance) (($# >= 2)) || fail '--memory-acceptance requires a path'; MEMORY_ACCEPTANCE="$2"; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1" ;;
  esac
  shift
done

[[ "$COMMAND" =~ ^(plan|verify|candidate|release|status|rollback-plan)$ ]] || fail "Unknown command: $COMMAND"
if ((OPENCLAW_ONLY)); then
  [[ "$BUILD_MODE" == no-build ]] || fail 'OpenClaw-only candidate apply reuses the separately verified immutable image via --no-build.'
  if [[ "$COMMAND" == candidate ]]; then
    [[ "$PRODUCT" == lab ]] || fail '--openclaw-only applies only to Lab.'
    [[ -n "$OPENCLAW_IMAGE" ]] || fail '--openclaw-only candidate requires --image <immutable-ref>.'
  elif [[ "$COMMAND" == release ]]; then
    ((PROMOTE_LIVE_CANDIDATE)) || fail 'OpenClaw-only formal release requires --promote-live-candidate.'
  else
    fail '--openclaw-only applies only to Lab candidate or live-candidate promotion.'
  fi
fi
if ((PROMOTE_LIVE_CANDIDATE)); then
  [[ "$PRODUCT" == lab && "$COMMAND" == release ]] || fail '--promote-live-candidate applies only to formal Lab release.'
  ((OPENCLAW_ONLY)) || fail '--promote-live-candidate requires --openclaw-only.'
  [[ "$BUILD_MODE" == no-build ]] || fail 'Live candidate promotion cannot build or switch containers.'
  [[ -n "$PROMOTION_CHECKPOINT_REF" ]] || fail 'Live candidate promotion requires --checkpoint-ref from the candidate deploy.'
fi
if ((APPLY)); then
  [[ "$COMMAND" == candidate || "$COMMAND" == release ]] || fail "--apply is not valid for $COMMAND"
  [[ "$APPROVAL_REF" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{1,159}$ ]] || fail '--apply requires a non-secret --approval-ref identifier'
fi
if [[ -n "$APPROVAL_REF" ]] && grep -Eiq '(token|secret|password|api[-_]?key|bearer)' <<<"$APPROVAL_REF"; then
  fail '--approval-ref must be a non-secret identifier'
fi
if ((APPLY)) && grep -Eiq '(token|secret|password|api[-_]?key|bearer)' <<<"$ACTOR_ID"; then
  fail 'RELEASE_ACTOR_ID must be a non-secret identifier'
fi
if ((APPLY == 0)) && [[ -n "$APPROVAL_REF" ]]; then
  printf 'APPROVAL_REF=%s\n' "$APPROVAL_REF"
fi
if [[ "$PRODUCT" == gate ]]; then
  ENVIRONMENT="${ENVIRONMENT:-gate-local}"
  [[ "$ENVIRONMENT" =~ ^gate-(local|staging|prod)$ ]] || fail 'Gate environment must be gate-local, gate-staging, or gate-prod'
  ((BUILD_MODE_SET == 0)) || fail 'Gate build selection is owned by its future protected environment adapter'
  ((LINEAGE_BRIDGE == 0)) || fail 'lineage bridge applies only to the Lab image pair'
  ((LIVE == 0)) || fail 'Gate runtime reads require an explicit sanitized --runtime-snapshot'
  [[ -z "$MEMORY_ACCEPTANCE" ]] || fail '--memory-acceptance applies only to Lab'
else
  [[ -z "$ENVIRONMENT" || "$ENVIRONMENT" == lab-maintainer ]] || fail 'Lab environment is fixed to lab-maintainer'
  ENVIRONMENT=lab-maintainer
fi
if [[ "$PRODUCT" == gate && "$COMMAND" == verify ]]; then
  python3 "$ROOT_DIR/scripts/validate-pubg-saas-test-database.py" || fail 'Gate verify requires a dedicated loopback PostgreSQL test database; see apps/pubg-saas/README.md'
fi
((CREATE_TAG == 0)) || [[ "$COMMAND" == release ]] || fail '--create-tag is valid only for release'
((LIVE == 0)) || [[ "$COMMAND" == status ]] || fail '--live is valid only for status'
if [[ "$COMMAND" != status ]]; then
  [[ -z "$MANIFEST" && -z "$RUNTIME_SNAPSHOT" ]] || fail '--manifest and --runtime-snapshot are status-only options'
fi
if [[ "$COMMAND" != release ]]; then
  [[ -z "$MEMORY_ACCEPTANCE" ]] || fail '--memory-acceptance is valid only for formal Lab release'
fi

VERSION="$(if [[ "$PRODUCT" == lab ]]; then bash "$ROOT_DIR/scripts/amadeus-version.sh" show; else bash "$ROOT_DIR/scripts/pubg-saas-version.sh" show; fi)"
printf 'PRODUCT=%s\nENVIRONMENT=%s\nCOMMAND=%s\nVERSION=%s\n' "$PRODUCT" "$ENVIRONMENT" "$COMMAND" "$VERSION"

run_lab_deploy_plan() {
  local -a args=()
  if [[ "$COMMAND" == candidate ]]; then args+=(--candidate); fi
  if ((OPENCLAW_ONLY)); then args+=(--openclaw-only --image "$OPENCLAW_IMAGE"); fi
  if ((LINEAGE_BRIDGE)); then args+=(--lineage-bridge --build); else args+=("--$BUILD_MODE"); fi
  bash "$ROOT_DIR/scripts/deploy-openclaw.sh" "${args[@]}"
}

require_clean_tree() {
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] || fail 'Apply requires a clean committed Git tree; review and commit source first.'
}

lab_apply_and_record() {
  local phase="$1" state_root timestamp output_path temp_output temp_runtime checkpoint status tag_created=0
  state_root="${AMAD_RELEASE_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/amadeus/releases}"
  python3 - "$state_root" "$ROOT_DIR" <<'PY' || fail 'Protected external Lab release-state directory must already exist with mode 0700.'
import os
import stat
import sys
from pathlib import Path

path = Path(sys.argv[1]).expanduser()
repo = Path(sys.argv[2]).resolve()
if path.is_symlink() or not path.is_dir():
    raise SystemExit(1)
resolved = path.resolve(strict=True)
if resolved == repo or repo in resolved.parents or stat.S_IMODE(path.stat().st_mode) != 0o700:
    raise SystemExit(1)
PY
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  status=candidate
  [[ "$phase" != release ]] || status=released
  output_path="$state_root/lab-$ENVIRONMENT-$timestamp-$status.json"
  [[ ! -e "$output_path" && ! -L "$output_path" ]] || fail 'release-state output already exists; retry with a new review window.'
  [[ ! -e "$state_root/.$(basename "$output_path").validated-input" ]] || fail 'release-state temporary path already exists; inspect the protected state directory first.'
  umask 077
  temp_output="$(mktemp "${TMPDIR:-/tmp}/lab-release-apply.XXXXXX")"
  CLEANUP_FILES+=("$temp_output")
  temp_runtime="$(mktemp "${TMPDIR:-/tmp}/lab-release-runtime.XXXXXX")"
  CLEANUP_FILES+=("$temp_runtime")
  if [[ "$phase" == release && "$PROMOTE_LIVE_CANDIDATE" -eq 1 ]]; then
    # shellcheck disable=SC1091
    source "$ROOT_DIR/scripts/host-profile.sh"
    amadeus_host_profile_load "$ROOT_DIR"
    [[ "$PROMOTION_CHECKPOINT_REF" == "$SKULD_BACKUP_ROOT/deploy/"* ]] \
      || fail '--checkpoint-ref must be under the verified external Lab deployment backup root.'
    [[ -d "$PROMOTION_CHECKPOINT_REF" && ! -L "$PROMOTION_CHECKPOINT_REF" && "$(stat -f %Lp "$PROMOTION_CHECKPOINT_REF")" == 700 ]] \
      || fail '--checkpoint-ref must be an existing protected directory with mode 0700.'
    checkpoint="$PROMOTION_CHECKPOINT_REF"
  elif [[ "$phase" == release ]]; then
    if ((LINEAGE_BRIDGE)); then
      bash "$ROOT_DIR/scripts/deploy-openclaw.sh" --apply --build --lineage-bridge --full-verify 2>&1 | tee "$temp_output"
    else
      bash "$ROOT_DIR/scripts/deploy-openclaw.sh" --apply "--$BUILD_MODE" --full-verify 2>&1 | tee "$temp_output"
    fi
  else
    if ((LINEAGE_BRIDGE)); then
      candidate_args=(--apply --candidate --build --lineage-bridge)
    elif ((OPENCLAW_ONLY)); then
      candidate_args=(--apply --candidate --openclaw-only --no-build --image "$OPENCLAW_IMAGE")
    else
      candidate_args=(--apply --candidate "--$BUILD_MODE")
    fi
    bash "$ROOT_DIR/scripts/deploy-openclaw.sh" "${candidate_args[@]}" 2>&1 | tee "$temp_output"
  fi
  if ! { [[ "$phase" == release && "$PROMOTE_LIVE_CANDIDATE" -eq 1 ]]; }; then
    checkpoint="$(sed -n 's/^CHECKPOINT=//p' "$temp_output" | tail -n 1)"
  fi
  [[ -n "$checkpoint" ]] || fail 'Deploy completed without a checkpoint reference; release manifest was not written.'
  snapshot_args=()
  if ((OPENCLAW_ONLY)); then snapshot_args+=(--service openclaw); fi
  python3 "$ROOT_DIR/scripts/lab-runtime-snapshot.py" "${snapshot_args[@]}" > "$temp_runtime" || fail 'Deploy completed but actual runtime provenance could not be read; release manifest was not written.'
  if [[ "$phase" == release && "$PROMOTE_LIVE_CANDIDATE" -eq 1 ]]; then
    python3 - "$MEMORY_ACCEPTANCE" "$temp_runtime" "$VERSION" <<'PY' || fail 'Live runtime does not match the accepted P1 candidate digest/source/version; no formal tag was created.'
import json, re, sys
from pathlib import Path
evidence_path, runtime_path, expected_version = sys.argv[1:]
evidence = json.loads(Path(evidence_path).read_text())
snapshot = json.loads(Path(runtime_path).read_text())
rows = snapshot.get('services') or []
if len(rows) != 1 or rows[0].get('service') != 'openclaw': raise SystemExit('promotion snapshot must contain exactly the Lab OpenClaw service')
row = rows[0]
if row.get('state') != 'running' or row.get('health') != 'healthy': raise SystemExit('live candidate is not healthy')
if row.get('version') != expected_version: raise SystemExit('live candidate version differs from Lab VERSION')
if row.get('digest') != evidence.get('runtimeImageDigest'): raise SystemExit('live image digest differs from LIVE_VERIFIED evidence')
if row.get('gitSha') != evidence.get('sourceCommit') or not re.fullmatch(r'[0-9a-f]{40}', str(row.get('gitSha', ''))):
    raise SystemExit('live image source differs from the LIVE_VERIFIED source commit')
print('LIVE_CANDIDATE_MATCH=passed')
PY
  fi
  if [[ "$phase" == release ]]; then
    version_tag="lab/v$VERSION"
    git -C "$ROOT_DIR" tag -a "$version_tag" -m "Lab $VERSION release"
    tag_created=1
    printf 'PRODUCT_TAG_CREATED=%s\nPUSHED=0\n' "$version_tag"
  fi
  manifest_args=(
    python3 "$ROOT_DIR/scripts/release-state.py" compose
    --product lab --environment "$ENVIRONMENT" --status "$status"
    --version "$VERSION" --git-sha "$(git -C "$ROOT_DIR" rev-parse HEAD)"
    --runtime "$temp_runtime" --checkpoint-ref "$checkpoint"
    --actor "$ACTOR_ID" --approval-ref "$APPROVAL_REF"
    --validation-ref "$checkpoint/validation${MEMORY_EVIDENCE_REF:+;memory=$MEMORY_EVIDENCE_REF}" --output "$output_path" --apply
  )
  if [[ "$phase" == release ]]; then manifest_args+=(--release-tag "lab/v$VERSION"); fi
  if ! "${manifest_args[@]}"; then
    if ((tag_created && PROMOTE_LIVE_CANDIDATE)); then
      git -C "$ROOT_DIR" tag -d "lab/v$VERSION" >/dev/null 2>&1 || true
      rm -f -- "$output_path"
      printf '%s\n' 'PROMOTION_ROLLBACK=removed_new_local_tag_and_manifest; live_candidate_and_data_preserved' >&2
      exit 2
    fi
    printf '%s\n' 'POST_APPLY_STATE=FAILED; runtime changed, preserve the checkpoint and reconcile the external manifest manually.' >&2
    exit 2
  fi
  if ((PROMOTE_LIVE_CANDIDATE)); then
    # The formal notice follows the same fixed owner outbox path used by the
    # deployment script; failure removes only this unpushed tag/manifest.
    # shellcheck disable=SC1091
    source "$ROOT_DIR/scripts/host-profile.sh"
    amadeus_host_profile_load "$ROOT_DIR"
    event_key="amadeus-release:$VERSION"
    event_id="$(printf '%s' "$event_key" | shasum -a 256 | cut -c1-40)"
    if ! "$ROOT_DIR/scripts/notify-owner.sh" \
      --remote-machine "$ORBSTACK_MACHINE" \
      --outbox-dir "$OPENCLAW_DATA_DIR/notifications" \
      --event-key "$event_key" \
      --source amadeus-release \
      --headline "Amadeus $VERSION · 世界线收束" \
      --summary "$(bash "$ROOT_DIR/scripts/amadeus-version.sh" notes)" \
      --severity success --significance major --theme worldline_convergence \
      --fact-label 版本 --fact-value "$VERSION" --worldline-closing; then
      git -C "$ROOT_DIR" tag -d "lab/v$VERSION" >/dev/null 2>&1 || true
      rm -f -- "$output_path"
      fail 'Formal owner notification failed; the new local tag and manifest were removed; the live candidate and data remain.'
    fi
    if ! orb -m "$ORBSTACK_MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$event_id.sent.json"; then
      for attempt in $(seq 1 30); do
        orb -m "$ORBSTACK_MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$event_id.sent.json" && break
        sleep 1
      done
    fi
    if ! orb -m "$ORBSTACK_MACHINE" -u root test -f "$OPENCLAW_DATA_DIR/notifications/$event_id.sent.json"; then
      git -C "$ROOT_DIR" tag -d "lab/v$VERSION" >/dev/null 2>&1 || true
      rm -f -- "$output_path"
      fail 'Formal owner notification did not reach sent state; the new local tag and manifest were removed; the live candidate and data remain.'
    fi
    printf 'FORMAL_RELEASE_NOTIFICATION=sent\n'
    printf 'LIVE_CANDIDATE_PROMOTED=1\n'
  fi
}

case "$COMMAND" in
  plan)
    ((APPLY == 0)) || fail 'plan is read-only'
    if [[ "$PRODUCT" == lab ]]; then
      bash "$ROOT_DIR/scripts/developer-workflow.sh" --plan
      run_lab_deploy_plan
    else
      bash "$ROOT_DIR/scripts/pubg-saas-version.sh" check
      printf 'GATE_RELEASE=DRY_RUN\n'
      if [[ "$ENVIRONMENT" == gate-local ]]; then
        printf '%s\n' 'GATE_ADAPTER=protected-local-autopilot' 'GATE_M2_CLEARANCE=formal-release-only'
      else
        printf 'GATE_ADAPTER=%s\n' "$([[ -x "$ROOT_DIR/infra/pubg-saas/release-adapters/$ENVIRONMENT.sh" ]] && printf configured || printf unconfigured)"
      fi
      printf '%s\n' 'SEQUENCE=verify -> same-digest build -> backup/precheck -> migrator -> gateway/worker -> health/rollback-plan'
      printf '%s\n' 'NO_RUNTIME_QUERY=planning never queries Gate-Local; candidate apply requires the external Gate approval; M2 clearance is formal-release-only.'
    fi
    ;;
  verify)
    ((APPLY == 0)) || fail 'verify is local-only and does not accept --apply'
    if [[ "$PRODUCT" == lab ]]; then
      bash "$ROOT_DIR/scripts/amadeus-version.sh" check
      node "$ROOT_DIR/scripts/test-patch-openclaw-memory-core.mjs"
      python3 "$ROOT_DIR/scripts/test-openclaw-memory-policy.py"
      pnpm check:architecture
      pnpm check:secrets
      pnpm typecheck:pubg
      pnpm test:pubg
      pnpm typecheck:amadeus
      pnpm test:amadeus
    else
      bash "$ROOT_DIR/scripts/pubg-saas-version.sh" check
      bash "$ROOT_DIR/scripts/test-pubg-saas-version.sh"
      pnpm check:architecture
      pnpm check:secrets
      pnpm build:pubg
      pnpm --filter @agent/pubg-saas build
      pnpm typecheck:pubg-saas
      pnpm test:pubg-saas
      pnpm typecheck:pubg
      pnpm test:pubg
    fi
    git -C "$ROOT_DIR" diff --check
    ;;
  candidate|release)
    if [[ "$COMMAND" == release ]]; then
      if ((APPLY)); then
        ((CREATE_TAG)) || fail 'formal release apply requires explicit --create-tag approval'
      fi
    fi
    if ((APPLY)); then
      require_clean_tree
      if [[ "$PRODUCT" == lab ]]; then
        if ((LINEAGE_BRIDGE)); then BUILD_MODE=build; fi
        version_tag="lab/v$VERSION"
        if [[ "$COMMAND" == release ]]; then
          if git -C "$ROOT_DIR" rev-parse --verify --quiet "refs/tags/$version_tag" >/dev/null; then
            fail "formal tag already exists and will not be moved: $version_tag"
          fi
          [[ -n "$MEMORY_ACCEPTANCE" ]] || fail 'formal Lab release requires --memory-acceptance with independently verified P1 LIVE_VERIFIED evidence'
          memory_validation="$(python3 "$ROOT_DIR/scripts/validate-lab-memory-acceptance.py" "$MEMORY_ACCEPTANCE" --repo "$ROOT_DIR")"
          printf '%s\n' "$memory_validation"
          MEMORY_EVIDENCE_REF="$(sed -n 's/.* evidenceRef=//p' <<<"$memory_validation" | tail -n 1)"
          [[ -n "$MEMORY_EVIDENCE_REF" ]] || fail 'Memory acceptance did not provide an evidence reference.'
          lab_apply_and_record release
          printf 'APPROVAL_REF=%s\n' "$APPROVAL_REF"
        else
          lab_apply_and_record candidate
          printf 'CANDIDATE_APPLIED=1\nAPPROVAL_REF=%s\n' "$APPROVAL_REF"
        fi
      else
        if [[ "$ENVIRONMENT" == gate-local ]]; then
          [[ "$COMMAND" == candidate ]] || fail 'Gate-Local supports only an unreleased candidate; formal Gate release/tag is not available.'
          candidate_args=(candidate --apply --approval-ref "$APPROVAL_REF")
          python3 "$ROOT_DIR/scripts/gate-local-candidate.py" "${candidate_args[@]}"
          printf 'CANDIDATE_APPLIED=1\nAPPROVAL_REF=%s\n' "$APPROVAL_REF"
          exit 0
        fi
        adapter="$ROOT_DIR/infra/pubg-saas/release-adapters/$ENVIRONMENT.sh"
        [[ -x "$adapter" ]] || fail "No reviewed $ENVIRONMENT release adapter exists; no Gate service or database was changed."
        adapter_args=("$COMMAND" --apply --approval-ref "$APPROVAL_REF")
        ((CREATE_TAG == 0)) || adapter_args+=(--create-tag)
        "$adapter" "${adapter_args[@]}"
      fi
    else
      printf 'APPLY=not-requested\nRELEASE_STATUS=%s\n' "$([[ $COMMAND == candidate ]] && printf UNRELEASED_CANDIDATE || printf PLAN_ONLY)"
      printf 'APPROVAL_REQUIRED=explicit --apply --approval-ref <id>%s\n' "$([[ $COMMAND == release ]] && printf ' --create-tag' || true)"
      if [[ "$PRODUCT" == lab ]]; then
        if ((PROMOTE_LIVE_CANDIDATE)); then
          [[ -n "$MEMORY_ACCEPTANCE" ]] || fail 'live-candidate promotion plan requires --memory-acceptance evidence.'
          python3 "$ROOT_DIR/scripts/validate-lab-memory-acceptance.py" "$MEMORY_ACCEPTANCE" --repo "$ROOT_DIR"
          printf 'PROMOTION_SCOPE=existing-live-openclaw-digest\nCONTAINER_SWITCH=none\nTAG=lab/v%s\n' "$VERSION"
        else
          run_lab_deploy_plan
        fi
      else
        printf 'GATE_SEQUENCE=verify,build-once,precheck,protected-backup,migrator,application-switch,health\n'
        printf '%s\n' 'GATE_ROLLBACK=application rollback only when schema compatibility allows; never force-restore the entire PostgreSQL volume by default.'
        if [[ "$ENVIRONMENT" == gate-local ]]; then
          printf '%s\n' 'GATE_ADAPTER=protected-local-autopilot' 'GATE_M2_CLEARANCE=formal-release-only'
        else
          printf 'GATE_ADAPTER=%s\n' "$([[ -x "$ROOT_DIR/infra/pubg-saas/release-adapters/$ENVIRONMENT.sh" ]] && printf configured || printf unconfigured)"
        fi
      fi
    fi
    ;;
  status)
    if [[ -z "$MANIFEST" ]]; then
      state_root="${AMAD_RELEASE_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/amadeus/releases}"
      shopt -s nullglob
      manifests=("$state_root/$PRODUCT-$ENVIRONMENT-"*.json)
      if ((${#manifests[@]})); then MANIFEST="${manifests[${#manifests[@]}-1]}"; fi
    fi
    if [[ "$PRODUCT" == lab && "$LIVE" -eq 1 ]]; then
      temp_snapshot="$(mktemp "${TMPDIR:-/tmp}/lab-release-runtime.XXXXXX")"
      CLEANUP_FILES+=("$temp_snapshot")
      snapshot_args=()
      if [[ -n "$MANIFEST" && -f "$MANIFEST" ]]; then
        manifest_services="$(python3 - "$MANIFEST" <<'PY'
import json, sys
from pathlib import Path
document = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
rows = document.get('imageDigests')
if not isinstance(rows, list) or not rows:
    raise SystemExit('release manifest has no controlled service images')
services = [row.get('service') if isinstance(row, dict) else None for row in rows]
if len(set(services)) != len(services) or any(service not in {'openclaw', 'product-radar'} for service in services):
    raise SystemExit('release manifest contains invalid or duplicate Lab services')
for service in services:
    print(service)
PY
)" || fail 'Could not derive the live snapshot scope from the protected manifest.'
        while IFS= read -r service; do
          [[ -n "$service" ]] && snapshot_args+=(--service "$service")
        done <<< "$manifest_services"
      fi
      if python3 "$ROOT_DIR/scripts/lab-runtime-snapshot.py" "${snapshot_args[@]}" > "$temp_snapshot"; then
        printf '%s\n' 'RUNTIME_SNAPSHOT=observed'
        printf 'RUNTIME_FACTS_JSON='
        cat "$temp_snapshot"
        RUNTIME_SNAPSHOT="$temp_snapshot"
      else
        printf '%s\n' 'RUNTIME_SNAPSHOT=UNKNOWN'
      fi
    fi
    if [[ -n "$RUNTIME_SNAPSHOT" && -f "$MANIFEST" ]]; then
      python3 "$ROOT_DIR/scripts/release-state.py" doctor --manifest "$MANIFEST" --runtime "$RUNTIME_SNAPSHOT"
    elif [[ -f "$MANIFEST" ]]; then
      python3 "$ROOT_DIR/scripts/release-state.py" validate "$MANIFEST"
      printf '%s\n' 'DRIFT_STATUS=UNKNOWN' 'DETAIL=actual runtime evidence was not supplied or queried' 'AUTOMATIC_ACTION=none'
    else
      printf '%s\n' 'DRIFT_STATUS=UNKNOWN' 'DETAIL=no protected release manifest is available' 'AUTOMATIC_ACTION=none'
    fi
    ;;
  rollback-plan)
    ((APPLY == 0)) || fail 'rollback-plan is read-only'
    if [[ "$PRODUCT" == lab ]]; then
      printf '%s\n' 'ROLLBACK=manual review of the protected OpenClaw/Product Radar checkpoint and saved Compose files'
      printf '%s\n' 'DATA=preserve the live SQLite/WAL, Workspace, MEMORY.md and user state; do not restore an old whole-data snapshot over newer writes'
      printf '%s\n' 'APPLY=not-performed; use the guarded deploy/checkpoint procedure only after explicit approval'
    else
      printf '%s\n' 'ROLLBACK=restore compatible Gateway/Worker/Migrator image references from the protected checkpoint'
      printf '%s\n' 'DATABASE=keep the current PostgreSQL volume; use a forward repair or reviewed schema recovery, not an automatic old-volume restore'
      printf '%s\n' 'ORDER=stop new writes if needed -> verify schema compatibility -> switch application images -> health check -> preserve evidence'
      printf '%s\n' 'APPLY=not-performed'
    fi
    ;;
esac
