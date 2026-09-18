# OpenClaw Identity acceptance coverage

日期：2026-09-18（Asia/Shanghai）  
状态：DEPLOYED_LIVE_REAL_INPUT_PENDING

## 新增证据

- Identity 测试覆盖同一 canonical Person 同时通过 Telegram 和 WhatsApp trusted binding
  解析到同一 Person 及同一 provider-neutral external account。
- PUBG boundary 测试覆盖两个 canonical Person 映射为两个显式 PUBG player subject，可供
  compare tool 使用；仍禁止未绑定 sender 回退到默认队伍。
- 测试同时覆盖 preset 热刷新、群级 alias 优先级、observed candidate 只能经 owner 确认升级、
  重启持久化和 display name 不作为 channel identity。

## 当前边界

- 代码只使用结构化 Identity tool 参数；自然语言解析仍由 OpenClaw 负责。
- 真实生产人物映射、sender binding、alias confirmation、PUBG account link 和重启后的 live
  入口验收仍等待用户提供外部 preset/确认，不把测试 ID 当作生产证据。
