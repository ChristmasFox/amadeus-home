# 2026-09-24 M204 LAN bindings restored

## Cause

The M204 CasaOS containers were published on `127.0.0.1`, so LAN clients could not reach the
services through the Mac host. OpenClaw was already published on `0.0.0.0:18789`; the remaining
user-facing services were loopback-only.

## Change

The Git-managed Compose defaults and the live CasaOS Compose/env values were changed to publish
user-facing services on `0.0.0.0`: OpenClaw, Product Radar, Changedetection, Immich, 9Router,
Filebrowser, Xiaoya, AriaNG, and Dashdot. Internal PostgreSQL, Redis, and model containers remain
unpublished. No image or application data was changed.

The pre-change runtime files are preserved at:

```text
/Volumes/Avalon/backups/operation-skuld/lan-bindings-before-20260924T080623Z
```

## Verification

All affected Compose files passed `docker compose config`. The containers were recreated with
`--no-build` and are healthy or running. HTTP probes from both M204 LAN addresses returned a
response for every user-facing port:

```text
192.168.5.3:18789  5315  5000  2283  20128  10180  5678  2345  2346  2347  6880  3001
192.168.5.50:18789 5315  5000  2283  20128  10180  5678  2345  2346  2347  6880  3001
```

HTTP status differences such as 403/404/500 are application responses after the TCP connection
was established; they do not indicate a LAN binding failure.
