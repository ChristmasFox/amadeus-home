# VPS proxy credential rotation

Date: 2026-10-07 (Asia/Shanghai)

## Authorization and scope

- The owner explicitly authorized rotation of both the Hysteria 2 password and
  Xray VLESS UUID after the previous subscription URL token was revoked.
- Only the existing single proxy identities and four current subscription
  bodies changed. The current subscription URL token, Xray Reality keypair,
  Caddy routing, firewall, and SSH configuration were not changed.
- Neither old nor new credentials or full subscription URLs are recorded here.

## Protected preparation

- Root-only VPS checkpoint:
  `/root/example-vps-checkpoints/proxy-credential-rotation-20261007T014956`.
  It contains protected originals, candidate files, and a file-hash manifest.
  Treat this checkpoint as sensitive; **do not restore the old credentials**.
- Preflight confirmed one VLESS client and Hysteria password authentication.
  The UUID appeared once in each QX subscription; the password appeared once
  in each Clash and Shadowrocket subscription.
- `xray run -test` passed for the candidate config. A candidate Hysteria server
  started on a temporary loopback-only UDP port without touching UDP <SERVICE_PORT>.

## Applied state and verification

- Stopped `hysteria-server.service` and `xray.service`, atomically replaced
  their configs and all four current subscription files, then started both
  services with regenerated credentials.
- The old credentials are absent from the six live files. Both services remain
  active and listen on UDP/TCP <SERVICE_PORT> respectively. Caddy and the subscription
  responder remain active.
- Eight local HTTPS body checks passed on ports 443 and <SERVICE_PORT>: all four formats
  returned the exact new candidate content. All four public HTTPS downloads
  returned `200` with non-empty bodies.
- Device-side proxy handshake and the effect on monthly traffic remain to be
  checked after clients refresh or re-import. The old credentials cannot
  authenticate against the restarted services, but this operation does not
  identify which client was responsible for earlier aggregate traffic.
- Subsequent short network samples measured approximately 5.4–6.8 Mbps of
  aggregate VPS interface traffic. Seven successful Hysteria connection events
  after restart came from one source IP, matching the current SSH management
  egress; this does not establish the device or attribute all VPS bytes to
  Hysteria. No per-user proxy byte counters were enabled. Continued usage
  requires client-side isolation or a separately authorized port-level capture.
