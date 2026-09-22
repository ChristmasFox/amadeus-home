#!/usr/bin/env bash
# scripts/plan-destination-bootstrap.sh
# Amadeus 1.4.6 — Destination bootstrap planner for Operation Skuld cutover.
# Prints the complete preparation checklist for the destination Mac (Amadeus-M204 / nyannyan).
# This script is PLAN-ONLY: it never SSHes to or mutates the real destination.
#
# Usage: scripts/plan-destination-bootstrap.sh [--fixture] [--output-dir DIR]
set -Eeuo pipefail

ROOT_DIR="${SKULD_ROOT_DIR:-$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/host-profile.sh"
amadeus_host_profile_load "$ROOT_DIR"

FIXTURE_MODE=0
OUTPUT_DIR=''

while (($#)); do
  case "$1" in
    --fixture) FIXTURE_MODE=1 ;;
    --output-dir) shift; OUTPUT_DIR="${1:?--output-dir requires a path}" ;;
    --help|-h)
      printf '%s\n' 'Usage: scripts/plan-destination-bootstrap.sh [--fixture] [--output-dir DIR]'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# Destination identity — never /Users/blacksidev or ubuntu machine.
DEST_HOST_IDENTITY="Amadeus-M204"
DEST_MACOS_USER="nyannyan"
DEST_MACOS_HOME="/Users/nyannyan"
DEST_ORBSTACK_MACHINE="nyannyan"
DEST_UBUNTU_RELEASE="Ubuntu 24.04 LTS / noble"
DEST_LINUX_USER="nyannyan"
DEST_LINUX_HOME="/home/nyannyan"
DEST_SSD_GB=512
DEST_STRATEGY="clean-orbstack-ubuntu-guest"

print_plan() {
cat << PLAN
# Operation Skuld — Destination Bootstrap Plan

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Destination identity verified below.

## Destination Identity

HOST_IDENTITY=${DEST_HOST_IDENTITY}
MACOS_USER=${DEST_MACOS_USER}
MACOS_HOME=${DEST_MACOS_HOME}
ORBSTACK_MACHINE=${DEST_ORBSTACK_MACHINE}
UBUNTU_RELEASE=${DEST_UBUNTU_RELEASE}
LINUX_USER=${DEST_LINUX_USER}
LINUX_HOME=${DEST_LINUX_HOME}
DESTINATION_SSD_GB=${DEST_SSD_GB}
GUEST_STRATEGY=${DEST_STRATEGY}

## Hard constraints
- Destination is NOT the same as source (Amadeus-M204 vs current Mac).
- OrbStack machine name: nyannyan (NOT ubuntu — that is the source machine name).
- All CasaOS app paths use /DATA/AppData/<app> (same as source).
- Avalon 8TB is a shared external disk — it is NOT migrated; it is remounted.
- No /Users/blacksidev or /home/blacksidev paths are active destination production dependencies.
- Source (old Mac) remains running and authoritative until Phase 14 cutover window.

## Phase 1: macOS host preparation

Step 1.1  Verify Mac hostname is Amadeus-M204
  Command: hostname (expect Amadeus-M204 or scutil --get ComputerName)

Step 1.2  Install Homebrew (if not present)
  Command: /bin/bash -c "\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

Step 1.3  Install OrbStack
  Command: brew install --cask orbstack
  Or: download from https://orbstack.dev and install manually.

Step 1.4  Install Node.js 24 LTS via Homebrew
  Command: brew install node@24 && brew link node@24

Step 1.5  Install pnpm
  Command: corepack enable && corepack prepare pnpm@latest --activate

Step 1.6  Install Python 3 (system Python 3.11+ acceptable)
  Verify: python3 --version

Step 1.7  Configure Git (if not already)
  Command: git config --global user.email <operator-email>

Step 1.8  Clone the monorepo
  Command: git clone <repo-url> ~/agent-monorepo
  Or: copy from source Mac (without .git ignored files).

Step 1.9  Copy host-profile override
  Command: cp infra/host-profile.env.example infra/host-profile.env
  Edit ORBSTACK_MACHINE=nyannyan, MAC_CONTROL_USER=nyannyan, EXTERNAL_STORAGE_ROOT=/Volumes/Avalon

Step 1.10 Verify bootstrap
  Command: ./scripts/bootstrap.sh --check

## Phase 2: OrbStack Ubuntu guest

See: scripts/plan-clean-orbstack-guest.sh for the clean guest creation plan.

## Phase 3: Secret restoration (out-of-band)

Step 3.1  Restore the encrypted secret bundle from the Operation Skuld backup.
  Command: scripts/import-skuld-secrets.sh --apply --passphrase-file PATH
  NOTE: passphrase file must never be committed to Git.

Step 3.2  Verify secret file presence and permissions.
  Command: scripts/secrets-inventory.sh --check

## Phase 4: FashionSigLIP (macOS LaunchAgent)

Step 4.1  Install FashionSigLIP on destination Mac.
  Command: scripts/install-fashion-siglip-macos.sh --apply
  Wait for health: curl http://127.0.0.1:${FASHION_SIGLIP_PORT}/health (expect status=ok, device=mps)

Step 4.2  Model cache will be redownloaded (not migrated).
  Policy: FASHION_SIGLIP_MODEL_CACHE_POLICY=redownload (set in host-profile.env)

## Phase 5: Data restoration

See: scripts/plan-homelab-clean-restore.sh for service-by-service restore plan.

## Phase 6: Image build

Step 6.1  Build immutable OpenClaw and Product Radar ARM64 images.
  Command: scripts/deploy-openclaw.sh --apply --build

Step 6.2  Run CasaOS preflight and architecture checks.
  Command: scripts/deploy-openclaw.sh --dry-run

## Phase 7: Pre-cutover validation

Step 7.1  Run doctor.
  Command: scripts/doctor.sh

Step 7.2  Run migration readiness.
  Command: scripts/migration-readiness.sh

Step 7.3  Verify all health endpoints and cron definitions.

## Notes

- All steps are preparation-only. Cutover (Phase 14) is a separate authorized action.
- MAC_MINI_CUTOVER=NOT_EXECUTED until Phase 14 is explicitly authorized.
- DESTINATION_MUTATED=NO until Phase 11 is explicitly started.
PLAN
}

plan_output="$(print_plan)"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$plan_output" > "$OUTPUT_DIR/destination-bootstrap-plan.md"
  printf 'PLAN_FILE=%s/destination-bootstrap-plan.md\n' "$OUTPUT_DIR"
else
  printf '%s\n' "$plan_output"
fi

printf 'HOST_IDENTITY=%s\n' "$DEST_HOST_IDENTITY"
printf 'DESTINATION_MACOS_USER=%s\n' "$DEST_MACOS_USER"
printf 'DESTINATION_ORBSTACK_MACHINE=%s\n' "$DEST_ORBSTACK_MACHINE"
printf 'DESTINATION_LINUX_USER=%s\n' "$DEST_LINUX_USER"
printf 'DESTINATION_SSD_GB=%s\n' "$DEST_SSD_GB"
printf 'DESTINATION_STRATEGY=%s\n' "$DEST_STRATEGY"
printf 'DESTINATION_BOOTSTRAP_PLAN=ready\n'
