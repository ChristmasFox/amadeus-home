# M204 SoC 功率报告边界修正（未部署）

日期：2026-09-24（Asia/Shanghai）

背景：用户粘贴的回答把单次 33.3 mW SoC 估算解释为整机轻载、低频/门控。
这与同一报告的 CPU 16.5% 及多进程活动不宜直接并列下结论。Apple 本地
`man powermetrics` 明确平均功率是估算且可能不准确。

变更：`infra/macos/machostagent_power.py` 不再把缺失子系统的功率填 0，
拒绝负数 combined；Skill 规定范围、采样窗口、零值/缺失值、不可由 CPU/load
反推 W，以及需要外部墙插计量才计算整机 W/kWh；README 同步。

恢复：仅 Git 源码修改，无外部状态变更。若后续部署后出现解析回归，可回滚
本变更对应 commit 并重新安装 root sampler，保持此前 live sampler 不受影响。

验收：HostAgent 7 个 Python 单测、Amadeus 50 个 Node 单测、Amadeus
typecheck、workspace 检查、architecture 检查、`pnpm check:secrets`、
`git diff --check` 通过。未做线上验收或声称整机功耗已测得。后续设备接入见 `.agent/tasks/amadeus-wall-power-meter.md`。
