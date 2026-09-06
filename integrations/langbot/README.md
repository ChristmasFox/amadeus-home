# LangBot Integration

本目录只保存 LangBot 的自定义部分，不包含第三方 LangBot 本体。

## 内容

- plugins/pubg-stats-v3：当前 V3 PUBG tool、command、listener、platform adapter，以及只读 `/whoami` command；
- plugins/pubg-stats-v2：V2 兼容插件，配合 packages/pubg-domain/legacy-v2；
- plugins/organize-emby：媒体整理插件；
- plugins/macos-nas-control：Mac/NAS 管理插件（V2 status payload、资源/网络/磁盘卡片）；
- patches/patch_kook_adapter.py：KOOK WebSocket 重连修复；
- patches/patch_telegram_adapter.py：Telegram polling recovery、outbound `<think>` 过滤和消息重试 patch；
- patches/patch_message_conversion.py：消息转换兼容 patch；
- patches/patch_pubg_telegram_picker.py：PUBG Telegram picker patch；
- patches/whatsapp.*：WhatsApp 资源和消息入口 patch；
- config-example/：只含键名和空值的配置模板。

## 兼容基线

当前生产观察到的 LangBot 定制运行时基于 4.10.8。实际镜像可能是本地构建的
langbot-local 标签，不能把运行中的容器层当作 Git source。升级 LangBot 时必须：

1. 在目标版本重新应用本目录 patch；
2. 用对应版本的测试环境构建插件；
3. 执行 scripts/build_pubg_plugin.sh 和 scripts/build_pubg_v3_plugin.sh；
4. 验证 plugin manifest、tool、command、listener 和平台 adapter；
5. 更新本文件、docs/PROJECT_STATE.md 和 checkpoint。

## 安装方式

构建产物只在本机或目标 CasaOS 中生成：

    ./scripts/build_pubg_plugin.sh
    ./scripts/build_pubg_v3_plugin.sh

生成的 lbpkg 在 .gitignore 中排除。把构建产物复制到 LangBot 的外部插件安装
目录后，在 LangBot 中安装；不要把插件安装目录或第三方源码反向复制回仓库。


### macOS NAS forced-command 部署

`plugins/macos-nas-control/nas-control.sh` 是 macOS 端 SSH forced-command 的 Git source。
实际目标默认为 `$HOME/.local/bin/nas-control`，使用以下命令预览或显式部署：

    ./scripts/deploy-nas-control.sh --dry-run
    ./scripts/deploy-nas-control.sh --apply

`--apply` 会在覆盖前创建带时间戳的 `.codex-backup.<timestamp>`，并运行
`SSH_ORIGINAL_COMMAND=nas.status` smoke；不要直接手改外部文件后不回写仓库。

## Secrets

Bot token、LLM API key、n8n auth、WhatsApp Cloud API token、webhook verify token
和 SSH private key 都必须由目标主机的 env file / secret file 提供。配置模板中的
空值不能直接作为生产配置，真实值只能从外部密码管理器恢复。

## 运行时约束

LangBot 和 plugin runtime 应作为 CasaOS app 运行在 OrbStack ubuntu 中。
修改服务前先检查 /var/lib/casaos/apps/langbot/docker-compose.yml；不要在
macOS host Docker 中启动一套看似相同但不持久的副本。
