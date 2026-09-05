# CasaOS App Templates

模板对应当前观察到的自定义服务：

- langbot：LangBot 与 plugin runtime；
- n8n：workflow engine；
- n8n-sandbox：sandbox API、runner 和一次性 TLS init；
- pubg-query-engine-v3：Mastra/PUBG runtime。

文件名带有 example，表示需要人工审查后再放入
/var/lib/casaos/apps/<app>/docker-compose.yml。所有 env_file 和 secret file 都
指向 /DATA/AppData 下的外部路径。
