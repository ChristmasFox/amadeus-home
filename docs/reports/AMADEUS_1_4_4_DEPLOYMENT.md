# Amadeus 1.4.4 Operation Skuld live evidence

日期：2026-09-21（Asia/Shanghai）  
canonical host：OrbStack `ubuntu` / CasaOS  
版本：`1.4.4`  
live evidence capture 时的仓库 commit：`fc2047c21ff6106e5bcf403bde7126e394baa7aa`（已 push）；
随后只提交本报告、状态文档和 checkpoint，不改变运行时内容

完整的无 secret live evidence 保存在外置盘：

`/Volumes/Avalon/backups/operation-skuld/deploy/amadeus-1.4.4-live-20260921T105442Z`

该目录的 `checks.tsv` 中所有检查均为 `0`，并有 `manifest.json` 记录证据文件 hash。

## Release and runtime

- live OpenClaw/Product Radar image source commit `16a8c15` 的 `VERSION` 已为 `1.4.4`；镜像为
  `local/openclaw-amadeus:git-16a8c15d727f-20260921082428` 和
  `local/product-radar:git-16a8c15d727f-20260921082428`。
- `docker compose config --quiet` 对 Immich、OpenClaw、Product Radar、9Router 均通过。
- `doctor.sh`：0 failure / 0 warning；OpenClaw、Product Radar、媒体 adapter、Immich 四容器、
  FashionSigLIP、9Router dashboard/API boundary 均通过。
- `migration-readiness.sh`：`OPERATION_SKULD=READY`；旧源状态为
  `IMMICH_SOURCE_RECLAIM=READY_BUT_PENDING`。
- owner event `amadeus-release:1.4.4` 与 `immich-storage-cutover:1.4.4` 的生产
  `.sent.json` 均已确认。

## Immich cutover

- external storage identity、sentinel、设备隔离、可写性和 free-space preflight 通过。
- live media mount：`/Volumes/Avalon/immich/data`；PostgreSQL 仍在内部 AppData。
- source/destination：`77,726` files、`130,486,455,925` logical bytes；cutover 前 checksum
  dry-run/equivalence 通过。
- fresh PostgreSQL custom dump：
  `/Volumes/Avalon/backups/operation-skuld/immich-migration/cutover-20260921T070112Z/immich-postgres.dump`；
  live PostgreSQL image 的 `pg_restore --list` 通过。
- cutover 后 Immich server、machine-learning、PostgreSQL、Redis healthy，`/api/server/ping`
  通过，目标媒体样本在容器内可读。
- old source `/DATA/Gallery/immich` 保留约 `130,486,455,925` bytes；没有执行 reclaim，状态为
  `SOURCE_RECLAIM_PENDING`。
- Immich 的容量页面出现 PiB 是 OrbStack/virtiofs `statfs` block-size 显示误差；实际外置盘约
  `7.3T total / 6.9T used / 441G free`，不是实际存在 PiB 级磁盘。

## Storage and secrets

- managed containers 使用 `local` logging，`max-size=20m`、`max-file=5`；未知归属容器只报告，
  没有通用删除。
- post-deploy safe maintenance 已执行：只处理 dangling images/build cache，未清理 volumes、
  数据库、媒体或 rollback image；证据显示 Docker guest free space 增加 `6,943,088,640` bytes。
- storage health 与 weekly maintenance LaunchAgent 已重载并实际运行，最近一次均为 `runs=1`、
  `last exit code=0`；state 为 `healthy`。
- secret inventory 为 metadata-only；加密 bundle 为
  `/Volumes/Avalon/backups/operation-skuld/secrets-20260921T055504Z/secrets.tar.enc`，manifest
  明确 `contentsInGit=false`、`plaintextTemporaryFiles=false`；readiness 的 restore rehearsal
  通过。9Router runtime artifact 与 Immich DB credential coverage 均通过。

## Network boundary and non-goals

- Caddy 当前配置验证通过，`9router.nyannyan.top` 已移除；OrbStack frpc 配置中的 `9router-tcp`
  已移除，9Router 只保留内部网络/API-key boundary。
- 未格式化或重分区外置盘，未使用 `rsync --delete`，未删除旧 Immich 源，未执行 Mac mini cutover、
  DNS/Cloudflare 切换或 secret rotation。
