# macOS / Mac mini

Mac mini 只承载 OrbStack、共享卷和可选的本地转发工具。长期服务仍部署在
OrbStack ubuntu 的 CasaOS 中。

bootstrap.sh 会检查或安装 Homebrew、Git、Node、pnpm、tmux、cloudflared 和
OrbStack。若使用 Apple Silicon，应确认 runtime 与 LangBot 镜像支持目标架构。

host-forwarders/9router_proxy.py 是可选的 9router host 转发器：

    python3 infra/macos/host-forwarders/9router_proxy.py

可以用 ORBSTACK_MACHINE 指定 machine，用 ORB_BIN 指定 orb 路径。启动前确认
本地 20128 端口没有其他进程，并确认 Ubuntu 内 9router 已运行。若 machine
网络不是常见的私有 IPv4，可额外设置 ORBSTACK_TARGET_HOST。
