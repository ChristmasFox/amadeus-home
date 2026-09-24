# 2026-09-24 frpc and public backends restore

## Scope

The user requested restoration of the public services and frpc while excluding 9Router. The
source-freeze frpc archive was used as the external recovery source. Secret values remain outside
Git and are not reproduced here.

## Storage gate

- Host `diskutil` reports the Avalon USB volume mounted with UUID
  `0C2CC618-D273-470C-8036-9AD6A0D967D7`.
- `/Volumes/Avalon/.amadeus-storage.json` contains the expected `avalon-primary-8tb` identity.
- The M204 guest sees `/Volumes/Avalon` on the external virtiofs device (`dev=35`), distinct from
  the guest root filesystem (`dev=41`). Media and download roots are present and readable; the
  downloads complete root is writable.

## Runtime changes

- Restored `frpc` `0.69.0` to `/usr/local/bin/frpc` and enabled `/etc/systemd/system/frpc.service`.
- Restored `/DATA/AppData/frpc/frpc.toml` from the protected archive, filtering `9router-tcp` and
  the unavailable Homarr proxy. The frpc admin server is bound to `127.0.0.1:7500`; Glances uses
  `127.0.0.1` as its source.
- Restored Emby, Jellyfin, qBittorrent, and aria2 configs from the source-freeze archives, and
  imported the matching arm64 images pulled through the Mac host Docker daemon. Rebuilt Glances
  with a read-only Docker socket and host PID view.
- 9Router remains available only for the OpenClaw internal dependency and is bound to
  `127.0.0.1:20128`; it is absent from frpc and has no public DNS record. Homarr remains stopped.
- A recoverable pre-restore copy is at
  `/Volumes/Avalon/backups/operation-skuld/public-backends-before-20260924T090150Z`.

## Evidence

`frpc verify` passed and `frpc.service` is active. The latest login journal reports successful
registration of exactly these proxies: `aria2rpc-tcp`, `ariang-tcp`, `emby-tcp`, `glances-tcp`,
`immich-tcp`, `jellyfin-tcp`, `openclaw-tcp`, and `qBittorrent-tcp` (plus no 9Router or Homarr
proxy). Local probes returned Emby 302, Jellyfin 302, qBittorrent 200, Glances 200; the aria2
JSON-RPC endpoint returned its expected unauthenticated 400 response.

Public probes returned:

| Host | Result |
| --- | --- |
| `immich.nyannyan.top` | 200 |
| `emby.nyannyan.top` | 302 |
| `jellyfin.nyannyan.top` | 302 |
| `qb.nyannyan.top` | 200 |
| `aria.nyannyan.top` | 200 |
| `monitor.nyannyan.top` | 200 |
| `claw.nyannyan.top` | 403, expected token gate |
| `9router.nyannyan.top` | no DNS record |
