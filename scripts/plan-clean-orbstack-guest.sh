#!/usr/bin/env bash
# scripts/plan-clean-orbstack-guest.sh
# Amadeus 1.4.6 — Clean OrbStack Ubuntu guest creation planner.
# Prints the steps to create a fresh Ubuntu 24.04 LTS OrbStack guest on the destination Mac.
# This is PLAN-ONLY: no SSH to real destination, no guest creation executed.
#
# Strategy: clean install, NOT an import/export of the source OrbStack machine.
# Source machine is "ubuntu" (old Mac). Destination machine is "nyannyan" (new Mac).
#
# Usage: scripts/plan-clean-orbstack-guest.sh [--fixture]
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
      printf '%s\n' 'Usage: scripts/plan-clean-orbstack-guest.sh [--fixture] [--output-dir DIR]'
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

DEST_ORBSTACK_MACHINE="nyannyan"
DEST_UBUNTU_RELEASE="Ubuntu 24.04 LTS / noble"
DEST_LINUX_USER="nyannyan"
SOURCE_ORBSTACK_MACHINE="ubuntu"

print_plan() {
cat << PLAN
# Operation Skuld — Clean OrbStack Guest Creation Plan

Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)

## Strategy: CLEAN INSTALL — NOT import/export of source machine

GUEST_PLAN_STRATEGY=clean-ubuntu-24.04
SOURCE_MACHINE=${SOURCE_ORBSTACK_MACHINE}
DESTINATION_MACHINE=${DEST_ORBSTACK_MACHINE}
DESTINATION_RELEASE=${DEST_UBUNTU_RELEASE}
DESTINATION_LINUX_USER=${DEST_LINUX_USER}

The destination uses a CLEAN OrbStack Ubuntu 24.04 LTS guest named "${DEST_ORBSTACK_MACHINE}".
Importing or exporting the source machine ("${SOURCE_ORBSTACK_MACHINE}") is NOT the migration strategy:
- The source machine may contain stale paths (/home/blacksidev, old AppData, retired services).
- A clean guest ensures no hidden local state dependencies survive to the destination.
- All persistent data is restored from explicit service-aware backup artifacts.
- All secrets are restored from the encrypted Skuld bundle.

## Phase 2 (detailed): Create clean OrbStack guest

Step 2.1  On the destination Mac (Amadeus-M204), open OrbStack.
  Verify OrbStack is installed: orbctl version

Step 2.2  Create a new Ubuntu 24.04 LTS machine named "${DEST_ORBSTACK_MACHINE}".
  GUI: OrbStack > Machines > + > Ubuntu 24.04 LTS > name: nyannyan
  CLI: orb create ubuntu:24.04 nyannyan

Step 2.3  Verify the guest is running.
  Command: orb list | grep nyannyan
  Expected: nyannyan  running  ubuntu:24.04

Step 2.4  Verify guest identity (not the old machine).
  Command: orb -m nyannyan bash -lc 'uname -a && cat /etc/os-release | grep PRETTY_NAME'
  Expected: Ubuntu 24.04.*noble

Step 2.5  Verify default Linux user is nyannyan (OrbStack uses macOS username by default).
  Command: orb -m nyannyan whoami
  Expected: nyannyan

Step 2.6  Create required CasaOS directory structure.
  Command: orb -m nyannyan -u root bash -lc 'mkdir -p /DATA/AppData /var/lib/casaos/apps'

Step 2.7  Install CasaOS on the guest.
  Command: orb -m nyannyan -u root bash -lc 'curl -fsSL https://get.casaos.io | bash'
  Or use the tracked infra CasaOS installer if available.

Step 2.8  Create the amadeus_network Docker network.
  Command: orb -m nyannyan -u root bash -lc 'docker network create amadeus_network'

Step 2.9  Restore /DATA/AppData/<service> directories from service-aware backup.
  See: scripts/plan-homelab-clean-restore.sh for service-by-service steps.

Step 2.10 Do NOT import from source machine.
  NEVER: orb import ubuntu (this would bring the source machine with stale paths)
  NEVER: orb clone ubuntu nyannyan (same issue)
  The source machine "ubuntu" on the old Mac remains unchanged.

## Guest resource configuration

OrbStack guest resources (allocate on creation or via Settings > Machines):
  Recommended: 4 vCPU, 8 GiB RAM for HomeLab services.
  macOS manages memory dynamically; initial allocation is advisory.

## Avalon disk attachment

Avalon (8TB external SSD) will be physically moved to destination Mac.
  - Attach Avalon via USB-C/Thunderbolt to Amadeus-M204.
  - Mount path: /Volumes/Avalon (same as source).
  - OrbStack will auto-share macOS volumes; verify: orb -m nyannyan ls /Volumes/Avalon.
  - Immich media root: /Volumes/Avalon/immich/data (same as source; no media migration needed).
  - The Avalon disk is NEVER tarred or copied; it is attached directly.
  - Verify UUID: diskutil info /Volumes/Avalon | grep 'Volume UUID'.

## Source machine (ubuntu) status

The source OrbStack machine "ubuntu" on the old Mac remains:
  - Running and serving until the Phase 14 cutover window.
  - Not paused, stopped, exported or destroyed in this goal.
  - SOURCE_FROZEN=NO throughout this goal.
PLAN
}

plan_output="$(print_plan)"

if [[ -n "$OUTPUT_DIR" ]]; then
  mkdir -p "$OUTPUT_DIR"
  printf '%s\n' "$plan_output" > "$OUTPUT_DIR/clean-orbstack-guest-plan.md"
  printf 'PLAN_FILE=%s/clean-orbstack-guest-plan.md\n' "$OUTPUT_DIR"
else
  printf '%s\n' "$plan_output"
fi

printf 'GUEST_PLAN_STRATEGY=clean-ubuntu-24.04\n'
printf 'DESTINATION_MACHINE=%s\n' "$DEST_ORBSTACK_MACHINE"
printf 'DESTINATION_RELEASE=%s\n' "$DEST_UBUNTU_RELEASE"
printf 'DESTINATION_LINUX_USER=%s\n' "$DEST_LINUX_USER"
printf 'SOURCE_MACHINE=%s\n' "$SOURCE_ORBSTACK_MACHINE"
printf 'SOURCE_FROZEN=NO\n'
printf 'CLEAN_GUEST_CREATION_PLAN=ready\n'
