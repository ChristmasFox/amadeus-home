#!/usr/bin/env python3
"""Fail-closed unique-runtime acceptance logic, driven by sanitized host probes."""

from __future__ import annotations

import argparse
import json
import sys


def evaluate(source_containers: int, source_processes: int, destination: dict) -> tuple[bool, int, list[str]]:
    candidate_count = int(destination.get("destinationCandidateCount", -1))
    source_running = int(source_containers > 0 or source_processes > 0)
    active_count = source_running + max(candidate_count, 0)
    blockers = []
    if source_containers != 0 or source_processes != 0:
        blockers.append("old source OpenClaw or Gateway is still active")
    if candidate_count > 1:
        blockers.append("multiple M204 OpenClaw candidates are running")
    elif candidate_count != 1:
        blockers.append("M204 OpenClaw candidate count is not one")
    if destination.get("destinationSafeMode") is not True:
        blockers.append("M204 candidate migration-safe isolation is not verified")
    if destination.get("destinationIngressCount") != 0:
        blockers.append("M204 public ingress container is active or unverified")
    if destination.get("destinationProductRadarCount") != 0:
        blockers.append("M204 Product Radar is active or unverified")
    return not blockers, active_count, blockers


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-containers", required=True, type=int)
    parser.add_argument("--source-processes", required=True, type=int)
    parser.add_argument("--destination-json", required=True)
    args = parser.parse_args()
    try:
        destination = json.loads(args.destination_json)
    except json.JSONDecodeError:
        destination = {}
    passed, active_count, blockers = evaluate(args.source_containers, args.source_processes, destination)
    print(f"OLD_SOURCE_OPENCLAW_RUNNING_COUNT={args.source_containers}")
    print(f"OLD_SOURCE_OPENCLAW_PROCESS_COUNT={args.source_processes}")
    print(f"OLD_SOURCE_OWNER_INGRESS={'disabled' if args.source_containers == 0 and args.source_processes == 0 else 'active'}")
    print(f"M204_PRODUCTION_CANDIDATE_COUNT={destination.get('destinationCandidateCount', -1)}")
    print(f"OPENCLAW_ACTIVE_RUNTIME_COUNT={active_count}")
    if passed:
        print("MIGRATION_SAFE_CANDIDATE=passed")
        return 0
    print("UNIQUE_RUNTIME_GATE=BLOCKED")
    for blocker in blockers:
        print(f"BLOCKER={blocker}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
