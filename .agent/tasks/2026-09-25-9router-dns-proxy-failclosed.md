# 9Router intermittent OpenAI/Codex TLS/DNS failure after startup proxy parity

Status: pending. Container-level proxy parity applied on M204 2026-09-25, but the first real completion still timed out; retry passed.

1. Correlate 9Router `[ProxyFetch] Proxy failed` with Clash connection/error logs and container network-namespace outbound sockets. Identify whether the proxy rejects/interrupts the exact Codex request; do not infer from a successful HEAD to `/` alone.
2. Trace Tailscale `100.100.100.100` through the actual host/upstream resolver. Compare proxied DoH and system answers during an incident, with rollback-safe DNS experiments only after recording current network state. Old Mac is offline/unavailable for live DNS comparison.
3. Make Codex/OpenAI proxy routing fail-closed: never fall back to direct when the proxy fails. Keep TLS verification enabled and document a focused failure fixture and real successful completion acceptance.
4. Preserve the external proxy-env checkpoint, run focused tests and secrets scan, update current/project state, and checkpoint any eventual fix.
