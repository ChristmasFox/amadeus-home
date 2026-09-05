# HomeLab Templates

这些模板覆盖迁移时最容易遗漏的 aria2、9router 和 Jellyfin。它们只保存
路径、端口、镜像和变量名；RPC secret、JWT secret、初始密码和 machine salt
必须由外部 secret store 注入。

共享目录约定：

- movies：/Volumes/Avalon/media/movies
- tv：/Volumes/Avalon/media/tv
- music：/Volumes/Avalon/media/music
- photos：/Volumes/Avalon/media/photos
- downloads：/Volumes/Avalon/downloads

模板可能需要 CasaOS 的 x-casaos metadata 或现有 network 才能在 UI 中显示。
部署前以目标 CasaOS 实际 compose 为准。
