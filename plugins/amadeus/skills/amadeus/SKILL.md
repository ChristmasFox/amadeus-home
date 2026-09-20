---
name: amadeus
description: Use the native Amadeus OpenClaw capabilities selected from the user's meaning.
user-invocable: false
---

# Amadeus capability overview

Amadeus is one OpenClaw plugin with separate capability skills. Select the
skill and structured native tool that matches the user's intent; do not create
a command parser, keyword router, second orchestrator, or channel-specific
business path.

Capability-specific safety, confirmation, time, presentation, and notification
rules live in the corresponding skill. Tool results are the source of truth;
preserve their status and never claim an external side effect was delivered
when the result only says it was queued.
