# CasaOS App Templates

模板对应当前保留的自定义服务：

- openclaw：唯一 Amadeus Agent、原生 PUBG/Amadeus plugins、briefing 和 SQLite；
- product-radar：独立商品监控服务；
- media-organizer-adapter：外部媒体预览/执行服务，保留在用户既有环境，不由本仓库重建。

LangBot、n8n、旧 Runtime 和 watchdog 模板已退休，不应重新放回 CasaOS。

文件名带有 example，表示需要人工审查后再放入
/var/lib/casaos/apps/<app>/docker-compose.yml。所有 env_file 和 secret file 都
指向 /DATA/AppData 下的外部路径。
