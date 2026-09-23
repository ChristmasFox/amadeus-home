#!/usr/bin/env python3
"""Fixture tests for single-authority OpenClaw cutover gating."""

from openclaw_unique_runtime_gate import evaluate


safe_destination = {
    "destinationCandidateCount": 1,
    "destinationSafeMode": True,
    "destinationIngressCount": 0,
    "destinationProductRadarCount": 0,
}

passed, count, blockers = evaluate(0, 0, safe_destination)
assert passed and count == 1 and not blockers

passed, count, blockers = evaluate(1, 1, safe_destination)
assert not passed and count == 2 and any("old source" in item for item in blockers)

two_destinations = {**safe_destination, "destinationCandidateCount": 2}
passed, count, blockers = evaluate(0, 0, two_destinations)
assert not passed and count == 2 and any("multiple M204" in item for item in blockers)

no_destination = {**safe_destination, "destinationCandidateCount": 0}
passed, count, blockers = evaluate(0, 0, no_destination)
assert not passed and count == 0 and any("count is not one" in item for item in blockers)

unsafe = {**safe_destination, "destinationSafeMode": False}
passed, _count, blockers = evaluate(0, 0, unsafe)
assert not passed and any("isolation is not verified" in item for item in blockers)

print("OPENCLAW_UNIQUE_RUNTIME_GATE_TEST=passed")
