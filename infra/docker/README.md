# Docker / CasaOS Templates

这些文件是脱敏的迁移模板，不是当前 CasaOS 实例的自动导入包。

长期服务的实际 compose 文件应位于 OrbStack ubuntu：

    /var/lib/casaos/apps/<app>/docker-compose.yml

持久化数据使用 /DATA/AppData/<app>，共享媒体使用 /Volumes/Avalon/...。部署前：

1. 读取目标 Ubuntu 上现有的 CasaOS compose；
2. 复制模板并替换 image、域名、端口和外部 env 路径；
3. 从密码管理器恢复 secret file；
4. 在 ubuntu 内执行 docker compose up -d；
5. 用 docker inspect、docker ps 和 scripts/doctor.sh 验证。

不要在 macOS host Docker 中启动长期服务，也不要把恢复后的 compose 反向提交到
Git；只有模板和不含敏感值的结构变更应回写本目录。
