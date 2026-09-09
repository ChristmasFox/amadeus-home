# KOOK LangBot offline recovery watchdog（2026-09-10）

## 结论

KOOK bot 在重启 LangBot 后恢复在线；本轮将恢复动作部署为独立的 root-owned
systemd timer，避免把 LangBot 自身的 adapter 日志或 health 状态当成 KOOK 在线性的唯一
证据。

## 事故证据

- 重启前 CasaOS `langbot` 容器仍为 `running`、restart count 为 0，但 KOOK
  `/api/v3/user/me` 返回 HTTP 200、API code 0、`online=false`。
- 重启前主 LangBot 日志在最近窗口没有 KOOK adapter 的连接/重连记录；这支持“进程仍活着但
  KOOK gateway/adapter 状态已卡住”的判断，但没有足够证据把原因归结为单一底层异常。
- `docker compose restart langbot` 后，`/tmp/kook_adapter_run.txt` 更新时间更新；KOOK
  API 连续探测返回 `online=true`。

## 已实现的恢复事件

`scripts/kook_watchdog.py` 从 CasaOS 外部 secret 读取 token，并只写无 token 的 JSON journal
事件和 0600 状态文件：

- `KOOK_CONNECTION_DEGRADED`：明确 `online=false`，尚未达到阈值；
- `KOOK_AUTO_RESTART_REQUESTED/STARTED/FAILED`：达到 3 次连续离线后的受限重启；
- `KOOK_CONNECTION_RECOVERED`：探测恢复在线；
- `KOOK_CREDENTIAL_INVALID/UNAVAILABLE`、`KOOK_PROBE_UNAVAILABLE`、
  `KOOK_CONTAINER_NOT_RUNNING`：诊断类事件，不盲目重启；
- `KOOK_RESTART_COOLDOWN`、`KOOK_RECOVERY_EXHAUSTED`：保护重启频率和次数上限。

策略为每分钟探测、3 次连续离线、15 分钟 cooldown、6 小时最多 3 次重启。只在 KOOK
明确离线且 `langbot` 容器仍 running 时调用 `docker compose restart langbot`。

## 部署证据

- 目标：OrbStack `ubuntu` / CasaOS；未使用 macOS host Docker、未构建镜像、未修改 LangBot
  Compose。
- 已安装：`/usr/local/libexec/kook-watchdog.py`、
  `/etc/systemd/system/kook-watchdog.service`、
  `/etc/systemd/system/kook-watchdog.timer`；文件 owner 为 `root:root`，权限分别为
  0755/0644/0644。
- `kook-watchdog.timer` 已 `enabled` 且 `active`；立即服务运行成功，状态文件显示
  `last_result=online`、HTTP 200、连续离线/探测失败均为 0、重启历史为空。
- 部署后的 dry-run live probe 返回 `online`；LangBot 仍为 `running`，启动时间为
  `2026-09-09T15:50:29.839746434Z`，restart count 为 0。
- `systemd-analyze verify` 通过；输出中的 `/var/run` PIDFile 提示来自现有 CasaOS unit，
  不属于本次 unit。watchdog 6/6 测试、根测试 129 pass / 1 skip、secret scan、workflow
  plan、shell/Python syntax 和 `git diff --check` 均通过。

## 回滚

```sh
orb -m ubuntu -u root systemctl disable --now kook-watchdog.timer
orb -m ubuntu -u root rm -f /etc/systemd/system/kook-watchdog.timer /etc/systemd/system/kook-watchdog.service /usr/local/libexec/kook-watchdog.py
orb -m ubuntu -u root systemctl daemon-reload
```

若此前已有 watchdog 文件，优先从安装脚本输出的
`/var/lib/casaos/backups/kook-watchdog.codex-<timestamp>/` 恢复对应文件后再
`systemctl daemon-reload`。回滚只移除自动恢复层，不回滚 LangBot 容器或数据。

## 后续边界

本轮没有通过人为断网、改 token 或主动 kill 容器来做故障注入，避免再次造成服务中断；
因此已验证“正常在线探测”和“决策/限频逻辑”，未宣称真实离线重启链路已被强制触发。
若要进一步消除 gateway 卡死的根因，应在 LangBot KOOK adapter 内增加 last-event/heartbeat
观测与 adapter 级 reconnect，但不阻塞当前独立恢复机制。
