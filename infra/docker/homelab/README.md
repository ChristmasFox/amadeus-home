# HomeLab Templates

这些模板覆盖迁移时最容易遗漏的 aria2、AriaNG、Dashdot、Emby、qBittorrent、Glances、Jellyfin、frpc、9router、Filebrowser 和 Xiaoya。它们只保存
路径、端口、镜像和变量名；RPC secret、JWT secret、初始密码和 machine salt
必须由外部 secret store 注入。

AriaNG、Dashdot、Filebrowser 与 Xiaoya 的迁移模板默认只绑定 guest loopback，供本机验收，
不自动开放 LAN/公网入口。9router 默认发布到 guest 的 LAN 地址，便于从 `192.168.5.3:20128`
访问；需要仅供 OpenClaw 本机使用时，将 `NINE_ROUTER_PORT` 覆盖为
`127.0.0.1:20128`。Filebrowser 的 `/DATA` 是可写全盘 AppData 视图，必须保留
loopback 限制并核对现有用户数据库后再考虑调整访问面。Xiaoya 的 Alist 数据使用显式
`/DATA/AppData/xiaoya/alist-data` 持久路径；虽然没有直接 Avalon bind，仍需单独确认其
Alist storage 配置后才能宣称 Avalon-backed 功能已恢复。Dashdot 只读挂载 guest `/` 以采集指标，
仍需保持 loopback，避免把主机文件系统信息暴露到 LAN/公网。

共享目录约定：

- movies：/Volumes/Avalon/media/movies
- tv：/Volumes/Avalon/media/tv
- music：/Volumes/Avalon/media/music
- photos：/Volumes/Avalon/media/photos
- downloads：/Volumes/Avalon/downloads

模板可能需要 CasaOS 的 x-casaos metadata 或现有 network 才能在 UI 中显示。
部署前以目标 CasaOS 实际 compose 为准。

`9router` 的 LAN 发布不等于公网发布；frpc 公网配置不得包含 `9router` 映射。Homarr 的
Docker socket 和凭据边界未满足前不恢复。
