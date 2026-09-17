# CasaOS App Templates

模板对应当前保留的自定义服务：

- openclaw：唯一 PUBG 私聊 Agent、原生插件与 SQLite；
- langbot：仍由用户独立运行的非 PUBG 服务；
- n8n：仍由用户独立运行的 workflow engine；
- n8n-sandbox：sandbox API、runner 和一次性 TLS init；
- product-radar：独立商品监控服务。

文件名带有 example，表示需要人工审查后再放入
/var/lib/casaos/apps/<app>/docker-compose.yml。所有 env_file 和 secret file 都
指向 /DATA/AppData 下的外部路径。
