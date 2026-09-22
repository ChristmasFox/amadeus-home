# Operation Skuld Migration Artifact Report

Generated: 20260922T132143Z

> This is a sanitized artifact proof. No credential values are included.
> Each MIGRATE service has exactly one verified recovery status.
> External references (Avalon) are verified by identity, not archived.

| service | classification | artifact | sha256 | restoreMethod | verify | sensitiveState |
| --- | --- | --- | --- | --- | --- | --- |
| openclaw | MIGRATE | `fixture://openclaw-artifact` | `fixture-sha256` | sqlite-backup-api-restore + workspace-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| product-radar | MIGRATE | `fixture://product-radar-artifact` | `fixture-sha256` | sqlite-backup-api-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| 9router | MIGRATE | `fixture://9router-artifact` | `fixture-sha256` | docker-load exact image + restore data archive + encrypted-bundle-decrypt | passed | encrypted-bundle |
| immich | MIGRATE | `fixture://immich-artifact` | `fixture-sha256` | pg_restore logical dump + attach Avalon external disk | passed | encrypted-bundle |
| immich-media | MIGRATE | `fixture://immich-media-artifact` | `fixture-sha256` | external-reference: physical Avalon disk move + UUID/sentinel verify | passed | none-required |
| changedetection | MIGRATE | `fixture://changedetection-artifact` | `fixture-sha256` | datastore-directory-archive-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| media-organizer-adapter | MIGRATE | `fixture://media-organizer-adapter-artifact` | `fixture-sha256` | state-directory-archive-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| frpc | MIGRATE | `fixture://frpc-artifact` | `fixture-sha256` | config-archive-restore + encrypted-bundle-decrypt for credentials | passed | encrypted-bundle |
| xiaoya | MIGRATE | `fixture://xiaoya-artifact` | `fixture-sha256` | appdata-directory-archive-restore to /DATA/AppData/xiaoya + encrypted-bundle-decrypt | passed | encrypted-bundle |
| emby | MIGRATE | `fixture://emby-artifact` | `fixture-sha256` | config-archive-restore + external-media-reference (Avalon) | passed | encrypted-bundle |
| qbittorrent | MIGRATE | `fixture://qbittorrent-artifact` | `fixture-sha256` | config-archive-restore + external-downloads-reference (Avalon) | passed | encrypted-bundle |
| nginxproxymanager | MIGRATE | `fixture://nginxproxymanager-artifact` | `fixture-sha256` | db-certificate-archive-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| filebrowser | MIGRATE | `fixture://filebrowser-artifact` | `fixture-sha256` | appdata-archive-restore + named-volume-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |
| aria2 | MIGRATE | `fixture://aria2-artifact` | `fixture-sha256` | config-archive-restore + external-downloads-reference (Avalon) | passed | encrypted-bundle |
| jellyfin | MIGRATE | `fixture://jellyfin-artifact` | `fixture-sha256` | config-archive-restore + external-media-reference (Avalon) | passed | encrypted-bundle |
| alist | MIGRATE | `fixture://alist-artifact` | `fixture-sha256` | data-archive-restore + external-storage-reference (Avalon) | passed | encrypted-bundle |
| v2raya | MIGRATE | `fixture://v2raya-artifact` | `fixture-sha256` | state-directory-archive-restore + encrypted-bundle-decrypt | passed | encrypted-bundle |

## Coverage summary

- Total MIGRATE services: 17
- Verified: 17
- Missing: 0

## Avalon external data policy

Avalon bulk media, downloads, and storage are **not archived** — they are physically
moved with the external disk. Identity is verified by UUID, sentinel, and file count.

## Sensitive state coverage

- All MIGRATE services with credential-bearing state: `encrypted-bundle`
- Immich media (Avalon): `none-required` (physical disk identity, no credential)
- Encrypted bundle path: see `SKULD_BACKUP_ROOT/secrets-*/secrets.tar.enc`
