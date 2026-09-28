# Mac Host Telemetry V1 计划

状态：IMPLEMENTED V1（代码与 M204 MacHostAgent acceptance 已完成；OpenClaw runtime notification acceptance 见实现记录）
日期：2026-09-28
范围：M204 macOS 宿主机遥测、HomeLab 状态纠偏、Avalon 存储、早晚报告与异常通知

## 1. 目标

把 M204 宿主机状态收敛到唯一可信数据源 `MacHostAgent`，移除会把 OrbStack guest 误认为宿主机的 Glances 链路，并增加低成本历史遥测。

完成后：

- “服务器 / M204 / HomeLab 状态”中的宿主机 CPU、内存、uptime、功耗、磁盘均来自真实 macOS host；
- 可回答当前值以及截止查询时的 avg / p95 / max / 峰值时间 / 持续异常；
- `Avalon` 作为宿主机直连存储的一等实体展示容量、剩余空间、挂载状态；
- 每日早晚发送与现有 VPS 报告相同规范、相同风格的 owner 通知；
- 持续采样、聚合和异常检测不调用 LLM，不产生持续 token 消耗。

## 2. 必须保持的边界

1. `MacHostAgent` 是 M204 host telemetry 的唯一权威数据源。
2. 删除 Amadeus 中的 Glances 依赖、`homeLabGlancesUrl`、`homeLabUptimeUrl`、61208 及相关文档/测试/配置。
3. MacHostAgent 不可用时明确返回 `host telemetry unavailable`；禁止 fallback 到 OrbStack/容器指标并称为宿主机状态。
4. OpenWrt 使用独立明确 endpoint/config，不再与 `homeLabHost` / `host.docker.internal` 混用。
5. 不新增第二 Agent、监控 Agent、Prometheus/Grafana 或新的通知 sender。
6. Continuous telemetry collection, aggregation and anomaly detection MUST NOT invoke an LLM. LLM inference is only allowed for user-facing interpretation or notification wording.

## 3. 目标架构

```text
M204 macOS
   │
MacHostAgent
   ├─ 5s  CPU / load / memory pressure / swap / network
   ├─ 15s power / thermal
   ├─ 30s service health
   └─ 60s filesystem / Avalon
          │
          ▼
   local SQLite telemetry
          │
   ┌──────┴────────┐
   │               │
rollup/summary   anomaly engine
   │               │
   │               └─ normalized owner event
   │                    → existing owner outbox/delivery
   ▼
Amadeus host adapter
   ├─ amadeus_macos_host_status
   └─ amadeus_homelab_status
          │
       OpenClaw/Kurisu
```

`amadeus_homelab_status` 聚合真实 Mac host + HomeLab service probes + 独立 OpenWrt 状态；不再把 OrbStack guest telemetry 当 host telemetry。

## 4. 采样与存储

建议频率：

| 指标 | 周期 |
| --- | ---: |
| CPU / load / memory / memory pressure / swap / network | 5s |
| power / thermal / fan（可用时） | 15s |
| bounded service health | 30s |
| system disk / Avalon capacity + mount | 60s |

5 秒只用于轻量 native counters；禁止每次采样都重新启动昂贵命令。`powermetrics` 等若使用，应采用持续采集或低频边界。

本地 SQLite 建议包含：

- `host_samples`
- `storage_samples`
- `service_samples`
- `anomaly_events`
- `minute_rollups`
- `hourly_rollups`
- `daily_rollups`

保留策略：5s raw 7 天、1m rollup 90 天、hourly 1 年、daily 长期；定期 deterministic rollup/purge。

## 5. 指标语义

查询默认时间窗：没有明确时间时，返回“本地当天 00:00 至查询时刻”；显式“过去 24 小时/昨晚”等按用户时间窗查询。

核心指标至少提供：

- `current`
- `avg`
- `p95`
- `max`
- `maxAt`
- `durationAboveThreshold`
- anomaly summary

macOS 内存健康不得只根据 used % 判断。优先使用：

1. Memory Pressure
2. Swap 当前值与增长趋势
3. Compressed / Wired memory
4. Used / physical memory

短时 CPU 峰值不应单独判异常；异常要求持续时间或其它证据。

## 6. Avalon 与人类可读输出

`Avalon` 作为稳定存储实体管理，优先通过 volume UUID + mount identity 识别，而不是只依赖路径字符串。

至少输出：

- mounted / unavailable
- total
- used
- free
- usedPercent
- 最近容量变化（报告/查询需要时）

内部继续使用 byte 精确存储；所有用户可见输出统一转换为常用 `MB / GB / TB`，禁止输出 `5364516442112 bytes` 之类原始字节数。

示例：

```text
Avalon：5.36 / 8.00 TB（67%），剩余 2.64 TB，已挂载
```

## 7. 查询状态

“服务器现在怎么样 / M204 状态”应优先给出简洁结论，再提供：

- 当前 CPU + 今日 avg/p95/max 与峰值时间；
- 当前内存 + 今日峰值 + Memory Pressure + Swap 趋势；
- 当前/平均/峰值功耗；
- Macintosh HD 与 Avalon 人类可读容量；
- 本时间窗异常及持续时间；
- HomeLab critical services / OpenWrt 状态。

群聊可以调用上述只读查询；任何 `notifyOwner`、早晚报告或异常投递仍只
允许 direct owner/cron，并继续使用既有 WhatsApp owner outbox。

必须清楚区分“宿主机事实”和“服务状态”，不能再次出现 OrbStack 12GB 被描述成 M204 物理内存。

## 8. 早晚通知：严格沿用现有 VPS 规范

现有 VPS 已使用 09:30 / 23:00 Asia/Shanghai cron，并通过 `amadeus_notify_owner` 以 `eventKey + source + title + message` 投递到唯一 WhatsApp owner DM；禁止 cron fallback delivery。Mac Host 报告沿用同一规范、同一 presentation 风格和同一 delivery path，不新增 sender。

建议：

- `amadeus-mac-host-morning`：09:30，回顾夜间 + 当日截至当前；
- `amadeus-mac-host-evening`：23:00，回顾当日；
- `eventKey=mac-host-report:YYYY-MM-DD:morning|evening`
- `source=mac-host-report`
- `title=🖥 M204 晨间状态` / `🖥 M204 晚间状态`
- 只发送 WhatsApp owner DM；不向 Telegram、KOOK、群聊发送；不使用 cron fallback delivery。

报告语气、段落密度、异常强调方式与 VPS 报告一致：简洁中文，突出 unavailable / sustained high CPU / memory pressure / abnormal swap growth / high disk usage / Avalon unmounted / critical service unhealthy / unknown；unknown 不得写成健康。

不要复制一套通知框架。如果 VPS 报告已有可复用 formatter/presentation helper，应共享它；否则至少共享 owner event envelope 和 delivery worker。

### 异常通知

高频遥测不得通过高频 Agent cron 检查。MacHostAgent deterministic anomaly engine 记录异常；Amadeus 后台桥只把新 anomaly 转为现有 normalized owner event/outbox，沿用现有幂等、重试、sent marker 与 owner-only delivery。

异常事件必须支持 dedupe/cooldown，避免 CPU 抖动造成通知风暴。恢复事件只在确有价值时发送。

## 9. 初始异常规则

V1 规则保持保守并可配置：

- CPU：高阈值持续数分钟，而非单个 5s 峰值；
- Memory：Memory Pressure warning/critical 或 Swap 持续异常增长；
- Storage：free < 15% warning，< 10% critical；
- Avalon：意外 unmounted / probe error；
- Service：critical service 连续 N 次失败；
- Telemetry：MacHostAgent 本身持续不可用。

阈值判断 deterministic；LLM 不参与是否触发告警。

## 10. 实现顺序

1. 删除 Glances 代码、配置、文档和测试引用；修正 OpenWrt 独立 endpoint。
2. 抽出可复用 `readMacHostStatus()`/host adapter，让 `macos-host` 与 `homelab` 共用真实宿主机事实。
3. 扩展 MacHostAgent：采样、SQLite、rollup、summary、Avalon/storage、anomaly event。
4. `amadeus_homelab_status` 改为 MacHostAgent + bounded service/OpenWrt aggregation。
5. 接入现有 owner event/outbox 的 anomaly delivery。
6. 按 VPS 规范增加 09:30/23:00 Mac Host report cron。
7. 更新 Skill、配置、部署脚本、架构文档并做真实 M204 acceptance。

## 11. 验收标准

- M204 物理内存显示真实 24 GB；任何 OrbStack 12 GB 数据都不能冒充 host memory。
- repo/runtime 不再依赖 Glances / 61208。
- MacHostAgent 不可用时 fail explicit，不使用 guest fallback。
- 5s telemetry 在无用户请求时产生 0 次 LLM 调用。
- 查询状态包含当前值 + 默认当天截至查询时的 avg/p95/max/maxAt/异常摘要。
- Memory Pressure / Swap 参与内存健康判断。
- Avalon 能识别 mounted/unavailable，容量全部用易读 GB/TB。
- 09:30/23:00 Mac Host 报告与 VPS 报告使用同一通知规范、同一 owner-only delivery path、相同风格。
- anomaly 通知复用 owner outbox，具备 dedupe/cooldown，无 duplicate delivery。
- OpenWrt endpoint 与 Mac host endpoint 明确分离。
- 相关 typecheck/test/build/deploy preflight 通过，并在真实 M204 上完成 query + morning/evening notification acceptance。
