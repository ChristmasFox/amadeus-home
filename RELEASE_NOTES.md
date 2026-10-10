# Amadeus 1.10.4

- 新增按上海自然日统计的 VPS traffic-fuse 确定性源代码，支持 provider/WAN 双源、跨午夜分摊、重置与 stale 状态、持久化事件和固定恢复 timer 模板。
- 将 traffic-fuse 的只读快照接入现有 owner-only VPS 工具、Worldline presentation 和 owner outbox；不新增 sender，也不执行 live `tc` apply。
- 固定 `tc` helper 拒绝覆盖 foreign root qdisc，并保护 IPv4/IPv6 SSH 回程；当前 VPS 的 `fq` root 仍保持不变。
